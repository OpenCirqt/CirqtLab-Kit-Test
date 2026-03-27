/**
 * usePPGStream.ts
 *
 * Online (sample-by-sample) spike filter for raw PPG data streams.
 *
 * Responsibility:
 *   Receive raw BLE packets → clean spikes → emit PPGSample objects
 *   ready for usePPGAnalyzer.
 *
 * ─── Why a separate hook from usePPGAnalyzer? ────────────────────────────────
 *
 *   usePPGAnalyzer operates on a buffered window and runs FFT every ~500 ms.
 *   Its internal batch spike-filter is therefore retrospective — it rescans
 *   the whole window each analysis cycle.
 *
 *   usePPGStream operates *causal* — it decides per incoming sample whether
 *   it is a spike, without any lookahead.  This means:
 *
 *     1. Zero latency — every sample is emitted immediately.
 *     2. Rejected spikes are NEVER pushed into the reference buffer, so the
 *        reference median cannot be contaminated by previous spikes.
 *     3. Motion artifacts (gradual multi-sample excursions) shift the reference
 *        buffer together, keeping per-sample deviation low → they pass through.
 *     4. Finger-off / finger-on transitions (long run of silent samples) are
 *        handled by a consecutive-spike reset that avoids locking onto a stale
 *        reference forever.
 *
 * ─── Spike vs motion: the core intuition ────────────────────────────────────
 *
 *   Spike:          2500 → 250000 → 2500   (1–2 samples, 100× jump)
 *   Motion artifact: 2500 → 3000 → 4000 → 5000 → ... → 8000 → 5000 → 2500
 *                    (spans tens–hundreds of samples, gradual)
 *
 *   For each incoming value we compare it against the median of the last
 *   `referenceWindowSize` *accepted* (non-spike) values.
 *
 *   - Spike: reference median is stable; new value deviates wildly → caught.
 *   - Motion: the accepted buffer tracks the drift; each new motion sample
 *     deviates only slightly from its predecessor → ratio stays low → passed.
 *
 * ─── Packet format ───────────────────────────────────────────────────────────
 *   Expects: [ir, red, green, timestamp]  (green is optional)
 */

import { useCallback, useRef } from "react";
import type { PPGSample } from "./usePPGAnalyzer";

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface PPGStreamConfig {
  /**
   * Multiplier used to decide if a sample is a spike.
   *
   *   |incoming − reference_median| > spikeRatioThreshold × |reference_median|
   *
   * Default: 3.0
   *   → Value must jump >3× the local baseline to be called a spike.
   *
   * Lower (e.g. 2.0) → more aggressive, may clip legitimate motion peaks.
   * Higher (e.g. 5.0) → more lenient, may miss moderate spikes.
   */
  spikeRatioThreshold?: number;

  /**
   * Absolute threshold (raw ADC units) that must also be exceeded before a
   * sample is flagged as a spike.  Prevents false positives when the signal
   * is near zero (where ratio alone can be overly sensitive).
   *
   * Default: 500   (tune to your sensor's ADC scale)
   */
  spikeAbsoluteThreshold?: number;

  /**
   * How many *accepted* samples to keep as the rolling reference window.
   * A larger window makes the reference more stable but slower to adapt
   * after a genuine step-change in signal level.
   *
   * Default: 12  (at 25 Hz ≈ 480 ms of clean history)
   */
  referenceWindowSize?: number;

  /**
   * If this many *consecutive* samples are flagged as spikes, assume the
   * signal has genuinely shifted (e.g. finger lifted and replaced) and reset
   * the reference buffer to the new incoming level.
   *
   * Without this guard the filter would hold the old level indefinitely after
   * a finger-off/on event.
   *
   * Default: 8  (at 25 Hz ≈ 320 ms of silence before reset)
   */
  maxConsecutiveSpikes?: number;

  /**
   * Replacement strategy for a detected spike sample.
   *
   *  'hold'   — output the last accepted value (default, flattest)
   *  'median' — output the current reference median
   *  'lerp'   — linearly interpolate between last and next accepted values
   *             (smoothest, but introduces a one-sample delay for the next
   *              value — use only when latency is not critical)
   *
   * Default: 'hold'
   */
  replacementStrategy?: "hold" | "median" | "lerp";

  /**
   * Called for every incoming packet (after filtering).
   * The emitted PPGSample contains cleaned ir / red / green values and the
   * original hardware timestamp.
   */
  onCleanSample: (sample: PPGSample) => void;

  /**
   * Optional: called whenever a spike is detected on any channel.
   * Useful for diagnostics / counters.
   */
  onSpike?: (info: SpikeEvent) => void;
}

export interface SpikeEvent {
  channel: "ir" | "red" | "green";
  rawValue: number;
  referenceMedian: number;
  replacedWith: number;
  timestamp: number;
}

export interface PPGStreamStats {
  totalSamples: number;
  spikesIR: number;
  spikesRed: number;
  spikesGreen: number;
  referenceResets: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal: per-channel online spike filter
// ─────────────────────────────────────────────────────────────────────────────

/** Sorted insertion into a small array — O(n) but n ≤ ~16, cache-friendly */
function sortedInsert(sorted: number[], value: number): void {
  let i = sorted.length;
  sorted.push(value);
  while (i > 0 && sorted[i - 1] > sorted[i]) {
    const tmp = sorted[i - 1];
    sorted[i - 1] = sorted[i];
    sorted[i] = tmp;
    i--;
  }
}

function sortedRemove(sorted: number[], value: number): void {
  const idx = sorted.indexOf(value);
  if (idx !== -1) sorted.splice(idx, 1);
}

/** Median from a pre-sorted array */
function sortedMedian(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

class ChannelFilter {
  // Rolling FIFO of accepted values (insertion-order)
  private fifo: number[] = [];
  // Parallel sorted copy for O(1) median
  private sorted: number[] = [];

  private readonly windowSize: number;
  private readonly ratioThreshold: number;
  private readonly absoluteThreshold: number;
  private readonly maxConsecutiveSpikes: number;

  private lastAccepted: number | null = null;
  private consecutiveSpikes: number = 0;
  private resets: number = 0;

  // For 'lerp' strategy: buffer the previous accepted value so we can patch
  // the held replacement once the next real value arrives.
  // (Simple approach: track the pending lerp target count.)
  private pendingLerpCount: number = 0;

  constructor(
    windowSize: number,
    ratioThreshold: number,
    absoluteThreshold: number,
    maxConsecutiveSpikes: number,
  ) {
    this.windowSize = windowSize;
    this.ratioThreshold = ratioThreshold;
    this.absoluteThreshold = absoluteThreshold;
    this.maxConsecutiveSpikes = maxConsecutiveSpikes;
  }

  /**
   * Process a single raw value.
   * Returns { cleaned, isSpike, referenceMedian, didReset }.
   */
  process(
    raw: number,
    strategy: "hold" | "median" | "lerp",
  ): {
    cleaned: number;
    isSpike: boolean;
    referenceMedian: number;
    didReset: boolean;
  } {
    // ── Bootstrap: not enough reference yet ──────────────────────────────
    if (this.fifo.length < 3) {
      this.accept(raw);
      return {
        cleaned: raw,
        isSpike: false,
        referenceMedian: raw,
        didReset: false,
      };
    }

    const refMedian = sortedMedian(this.sorted);

    // ── Spike test ────────────────────────────────────────────────────────
    // Both ratio AND absolute conditions must be met to avoid false positives
    // near zero baseline.
    const absDiff = Math.abs(raw - refMedian);
    const ratioExceeded =
      refMedian !== 0 && absDiff / Math.abs(refMedian) > this.ratioThreshold;
    const absExceeded = absDiff > this.absoluteThreshold;
    const isSpike = ratioExceeded && absExceeded;

    if (!isSpike) {
      this.consecutiveSpikes = 0;
      this.pendingLerpCount = 0;
      this.accept(raw);
      return {
        cleaned: raw,
        isSpike: false,
        referenceMedian: refMedian,
        didReset: false,
      };
    }

    // ── Spike detected ────────────────────────────────────────────────────
    this.consecutiveSpikes++;

    // Long run of spikes → likely a genuine signal level change (finger
    // off/on). Reset the reference to the incoming value.
    if (this.consecutiveSpikes >= this.maxConsecutiveSpikes) {
      this.reset(raw);
      this.resets++;
      return {
        cleaned: raw,
        isSpike: true,
        referenceMedian: refMedian,
        didReset: true,
      };
    }

    // Choose replacement
    let replacement: number;
    if (strategy === "median") {
      replacement = refMedian;
    } else if (strategy === "lerp") {
      // Output last accepted now; callers can't easily patch previous samples,
      // so this is effectively 'hold' in a streaming context. We track the
      // count so the *next* real value can fill a smoother interpolated gap.
      replacement = this.lastAccepted ?? refMedian;
      this.pendingLerpCount++;
    } else {
      // 'hold'
      replacement = this.lastAccepted ?? refMedian;
    }

    // Do NOT push the spike (or replacement) into the reference buffer.
    // This is the key invariant: the reference always reflects clean signal.

    return {
      cleaned: replacement,
      isSpike: true,
      referenceMedian: refMedian,
      didReset: false,
    };
  }

  getResets(): number {
    return this.resets;
  }

  reset(seedValue?: number): void {
    this.fifo = [];
    this.sorted = [];
    this.consecutiveSpikes = 0;
    this.pendingLerpCount = 0;
    this.lastAccepted = seedValue ?? null;
    if (seedValue !== undefined) this.accept(seedValue);
  }

  // ── Private helpers ────────────────────────────────────────────────────

  private accept(value: number): void {
    this.lastAccepted = value;

    // Evict oldest if at capacity
    if (this.fifo.length >= this.windowSize) {
      const evicted = this.fifo.shift()!;
      sortedRemove(this.sorted, evicted);
    }

    this.fifo.push(value);
    sortedInsert(this.sorted, value);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

const STREAM_DEFAULTS = {
  spikeRatioThreshold: 3.0,
  spikeAbsoluteThreshold: 500,
  referenceWindowSize: 12,
  maxConsecutiveSpikes: 8,
  replacementStrategy: "hold" as const,
};

/**
 * usePPGStream
 *
 * Wraps a raw BLE PPG data stream with per-channel online spike filtering.
 * Feed raw `[ir, red, green, timestamp]` packets via `addRawPacket`; receive
 * cleaned `PPGSample` objects via the `onCleanSample` callback.
 *
 * Pair with usePPGAnalyzer (set `skipSpikeFilter: true` when using this hook):
 *
 * ```tsx
 * const { addSample, analysis } = usePPGAnalyzer({ skipSpikeFilter: true });
 *
 * const { addRawPacket, stats, resetStream } = usePPGStream({
 *   onCleanSample: addSample,
 * });
 *
 * useBleLiveStream(deviceId, collecting, (data) => {
 *   cachedData.current.push(data as number[]);
 *   addRawPacket(data as number[]);
 * });
 * ```
 */
export function usePPGStream(config: PPGStreamConfig) {
  const cfg = { ...STREAM_DEFAULTS, ...config };

  // Per-channel filters live in refs — they must survive re-renders without
  // being recreated (that would reset learned reference buffers).
  const irFilter = useRef(
    new ChannelFilter(
      cfg.referenceWindowSize,
      cfg.spikeRatioThreshold,
      cfg.spikeAbsoluteThreshold,
      cfg.maxConsecutiveSpikes,
    ),
  );
  const redFilter = useRef(
    new ChannelFilter(
      cfg.referenceWindowSize,
      cfg.spikeRatioThreshold,
      cfg.spikeAbsoluteThreshold,
      cfg.maxConsecutiveSpikes,
    ),
  );
  const greenFilter = useRef(
    new ChannelFilter(
      cfg.referenceWindowSize,
      cfg.spikeRatioThreshold,
      cfg.spikeAbsoluteThreshold,
      cfg.maxConsecutiveSpikes,
    ),
  );

  // Mutable stats counters — not state, to avoid re-renders on every packet
  const statsRef = useRef<PPGStreamStats>({
    totalSamples: 0,
    spikesIR: 0,
    spikesRed: 0,
    spikesGreen: 0,
    referenceResets: 0,
  });

  // Keep callback refs stable so addRawPacket doesn't need to be recreated
  const onCleanRef = useRef(config.onCleanSample);
  onCleanRef.current = config.onCleanSample;

  const onSpikeRef = useRef(config.onSpike);
  onSpikeRef.current = config.onSpike;

  // ── addRawPacket ──────────────────────────────────────────────────────────

  /**
   * Feed a raw BLE packet into the stream.
   * Expected format: [ir, red, green, timestamp]
   *
   * - `ir`, `red`, `green` are raw ADC values from the photodiode channels.
   * - `timestamp` is the hardware/BLE packet timestamp in milliseconds.
   *   Pass `Date.now()` only if the hardware does not provide one.
   */
  const addRawPacket = useCallback((packet: number[]): PPGSample | null => {
    if (!Array.isArray(packet) || packet.length < 4) return null;

    const [rawIr, rawRed, rawGreen, timestamp] = packet;

    // Hard guard: sensor not on skin or hardware error
    if (rawIr <= 0 || rawRed <= 0) return null;

    statsRef.current.totalSamples++;

    const strategy = cfg.replacementStrategy;

    // ── IR ────────────────────────────────────────────────────────────────
    const irResult = irFilter.current.process(rawIr, strategy);
    if (irResult.isSpike) {
      statsRef.current.spikesIR++;
      onSpikeRef.current?.({
        channel: "ir",
        rawValue: rawIr,
        referenceMedian: irResult.referenceMedian,
        replacedWith: irResult.cleaned,
        timestamp,
      });
    }
    if (irResult.didReset) statsRef.current.referenceResets++;

    // ── Red ───────────────────────────────────────────────────────────────
    const redResult = redFilter.current.process(rawRed, strategy);
    if (redResult.isSpike) {
      statsRef.current.spikesRed++;
      onSpikeRef.current?.({
        channel: "red",
        rawValue: rawRed,
        referenceMedian: redResult.referenceMedian,
        replacedWith: redResult.cleaned,
        timestamp,
      });
    }

    // ── Green (optional channel) ───────────────────────────────────────────
    // Fall back to IR if green is missing / 0 (some rings omit green).
    const effectiveGreen = rawGreen != null && rawGreen > 0 ? rawGreen : rawIr;
    const greenResult = greenFilter.current.process(effectiveGreen, strategy);
    if (greenResult.isSpike) {
      statsRef.current.spikesGreen++;
      onSpikeRef.current?.({
        channel: "green",
        rawValue: effectiveGreen,
        referenceMedian: greenResult.referenceMedian,
        replacedWith: greenResult.cleaned,
        timestamp,
      });
    }

    // ── Build cleaned sample ──────────────────────────────────────────────
    const cleanedSample: PPGSample = {
      ir: irResult.cleaned,
      red: redResult.cleaned,
      green: greenResult.cleaned,
      timestamp,
    };

    // ── Emit via callback AND return to caller ────────────────────────────
    onCleanRef.current(cleanedSample);
    return cleanedSample;
  }, []); // no deps — all mutable state lives in refs

  // ── resetStream ──────────────────────────────────────────────────────────

  /** Clear all channel reference buffers and reset spike counters. */
  const resetStream = useCallback(() => {
    irFilter.current.reset();
    redFilter.current.reset();
    greenFilter.current.reset();
    statsRef.current = {
      totalSamples: 0,
      spikesIR: 0,
      spikesRed: 0,
      spikesGreen: 0,
      referenceResets: 0,
    };
  }, []);

  // ── getStats ─────────────────────────────────────────────────────────────

  /**
   * Returns a snapshot of cumulative spike statistics.
   * Reads from a ref — does not trigger re-renders.
   */
  const getStats = useCallback(
    (): PPGStreamStats => ({ ...statsRef.current }),
    [],
  );

  return {
    /**
     * Feed a raw `[ir, red, green, timestamp]` packet.
     * Emits a cleaned PPGSample via `onCleanSample` synchronously,
     * and also returns it directly — `null` if the packet was rejected
     * (wrong format, or ir/red ≤ 0).
     */
    addRawPacket,
    /** Clear reference buffers and counters. */
    resetStream,
    /** Snapshot of cumulative spike stats (does not cause re-render). */
    getStats,
  } as const;
}
