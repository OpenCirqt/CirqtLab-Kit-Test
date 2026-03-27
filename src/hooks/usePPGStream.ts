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
   *  'lerp'   — hold spike samples back in a queue, then backfill them
   *             with linear interpolation between the last good value and
   *             the next good value once it arrives.  Produces the smoothest
   *             waveform at the cost of up to maxConsecutiveSpikes samples
   *             of latency during a spike run (typically 1–3 samples = 40–120 ms
   *             at 25 Hz).  Recommended when feeding a display waveform or
   *             an FFT analyzer — the interpolated gap looks natural and
   *             does not introduce discontinuities.
   *
   * Default: 'lerp'
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

/**
 * Result from ChannelFilter.process().
 *
 * For 'hold' and 'median' strategies, `emit` always contains exactly one
 * entry — the current sample (cleaned or replaced).
 *
 * For 'lerp' strategy, `emit` may contain MORE than one entry when a run
 * of spike samples is resolved by the arrival of the next valid sample.
 * The extra entries are the back-filled interpolated values that were held
 * back during the spike run.  The caller must emit all of them in order.
 *
 * `timestamps` is parallel to `emit` — same length, providing the original
 * hardware timestamp for each held-back sample so the downstream sliding
 * window gets accurate timing.
 */
interface ChannelProcessResult {
  emit: number[]; // values to emit (length ≥ 1)
  timestamps: number[]; // parallel timestamps
  isSpike: boolean; // true if the incoming raw sample was a spike
  referenceMedian: number;
  didReset: boolean;
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

  // Lerp pending queue:
  //   When a spike is detected and strategy === 'lerp', we don't emit
  //   immediately.  Instead we push { rawTimestamp } into lerpPending and
  //   hold the sample.  When the next NON-spike sample arrives we know both
  //   endpoints (lastAccepted = start, newValue = end) and can interpolate
  //   all the held positions linearly before emitting the new value.
  private lerpPending: { timestamp: number }[] = [];

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
   * Process a single raw value + its hardware timestamp.
   *
   * Returns a ChannelProcessResult.  For 'lerp' strategy the caller MUST
   * iterate result.emit in full and emit each entry — there may be multiple
   * back-filled samples followed by the current one.
   */
  process(
    raw: number,
    timestamp: number,
    strategy: "hold" | "median" | "lerp",
  ): ChannelProcessResult {
    // ── Bootstrap: not enough reference yet ──────────────────────────────
    if (this.fifo.length < 3) {
      this.accept(raw);
      return {
        emit: [raw],
        timestamps: [timestamp],
        isSpike: false,
        referenceMedian: raw,
        didReset: false,
      };
    }

    const refMedian = sortedMedian(this.sorted);

    // ── Spike test ────────────────────────────────────────────────────────
    // Both ratio AND absolute thresholds must be exceeded to avoid false
    // positives when the signal baseline is near zero.
    const absDiff = Math.abs(raw - refMedian);
    const ratioExceeded =
      refMedian !== 0 && absDiff / Math.abs(refMedian) > this.ratioThreshold;
    const absExceeded = absDiff > this.absoluteThreshold;
    const isSpike = ratioExceeded && absExceeded;

    // ── Non-spike: clean sample arrived ──────────────────────────────────
    if (!isSpike) {
      this.consecutiveSpikes = 0;

      if (strategy === "lerp" && this.lerpPending.length > 0) {
        // We have N held-back spike positions between lastAccepted and raw.
        // Interpolate linearly: position 0 → lastAccepted, position N+1 → raw.
        const start = this.lastAccepted ?? refMedian;
        const end = raw;
        const steps = this.lerpPending.length + 1; // N gaps between start and end

        const backfilled = this.lerpPending.map((p, i) => ({
          value: start + (end - start) * ((i + 1) / steps),
          timestamp: p.timestamp,
        }));
        this.lerpPending = [];

        this.accept(raw);

        // Emit all backfilled interpolated values, then the current real value
        return {
          emit: [...backfilled.map((b) => b.value), raw],
          timestamps: [...backfilled.map((b) => b.timestamp), timestamp],
          isSpike: true, // the prior samples were spikes
          referenceMedian: refMedian,
          didReset: false,
        };
      }

      // Normal (non-lerp) path or lerp with no pending
      this.accept(raw);
      return {
        emit: [raw],
        timestamps: [timestamp],
        isSpike: false,
        referenceMedian: refMedian,
        didReset: false,
      };
    }

    // ── Spike detected ────────────────────────────────────────────────────
    this.consecutiveSpikes++;

    // Long run of spikes → genuine signal level change (finger off/on).
    // Flush any lerp pending, reset reference, emit the incoming value as-is.
    if (this.consecutiveSpikes >= this.maxConsecutiveSpikes) {
      const flushedPending = this.lerpPending.map((p) => ({
        value: this.lastAccepted ?? refMedian,
        timestamp: p.timestamp,
      }));
      this.lerpPending = [];
      this.reset(raw);
      this.resets++;

      const emitValues = [...flushedPending.map((p) => p.value), raw];
      const emitTimestamps = [
        ...flushedPending.map((p) => p.timestamp),
        timestamp,
      ];

      return {
        emit: emitValues,
        timestamps: emitTimestamps,
        isSpike: true,
        referenceMedian: refMedian,
        didReset: true,
      };
    }

    // ── Spike: apply replacement strategy ────────────────────────────────
    if (strategy === "lerp") {
      // Hold this sample — do not emit yet.
      // Record its timestamp so we can interpolate once the next clean
      // sample arrives.  The caller will receive an empty emit array
      // and must NOT forward anything downstream for this sample.
      this.lerpPending.push({ timestamp });
      // Do NOT add to reference buffer — key invariant preserved.
      return {
        emit: [],
        timestamps: [],
        isSpike: true,
        referenceMedian: refMedian,
        didReset: false,
      };
    }

    // 'hold' or 'median' — emit a placeholder immediately
    const replacement =
      strategy === "median" ? refMedian : (this.lastAccepted ?? refMedian);

    return {
      emit: [replacement],
      timestamps: [timestamp],
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
    this.lerpPending = [];
    this.lastAccepted = seedValue ?? null;
    if (seedValue !== undefined) this.accept(seedValue);
  }

  // ── Private ────────────────────────────────────────────────────────────

  private accept(value: number): void {
    this.lastAccepted = value;
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
  replacementStrategy: "lerp" as const,
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

    // ── Per-channel filtering ─────────────────────────────────────────────
    // Each filter returns an `emit` array.
    //   • 'hold' / 'median': always length 1 (immediate replacement)
    //   • 'lerp':            length 0 while spike is pending (held back),
    //                        then length N+1 when the next clean sample
    //                        arrives (N backfilled lerp values + current)
    //
    // All three channels are processed with the SAME timestamp so the
    // backfill arrays are always the same length — we zip them below.

    const irResult = irFilter.current.process(rawIr, timestamp, strategy);
    const redResult = redFilter.current.process(rawRed, timestamp, strategy);
    const effectiveGreen = rawGreen != null && rawGreen > 0 ? rawGreen : rawIr;
    const greenResult = greenFilter.current.process(
      effectiveGreen,
      timestamp,
      strategy,
    );

    // ── Spike diagnostics ─────────────────────────────────────────────────
    if (irResult.isSpike) {
      statsRef.current.spikesIR++;
      // For lerp, replacedWith is the interpolated value that will be emitted
      // once the next clean sample resolves the gap — use 0 as placeholder
      // since the actual value isn't known yet.
      onSpikeRef.current?.({
        channel: "ir",
        rawValue: rawIr,
        referenceMedian: irResult.referenceMedian,
        replacedWith: irResult.emit[0] ?? 0,
        timestamp,
      });
    }
    if (irResult.didReset) statsRef.current.referenceResets++;
    if (redResult.isSpike) {
      statsRef.current.spikesRed++;
      onSpikeRef.current?.({
        channel: "red",
        rawValue: rawRed,
        referenceMedian: redResult.referenceMedian,
        replacedWith: redResult.emit[0] ?? 0,
        timestamp,
      });
    }
    if (greenResult.isSpike) {
      statsRef.current.spikesGreen++;
      onSpikeRef.current?.({
        channel: "green",
        rawValue: effectiveGreen,
        referenceMedian: greenResult.referenceMedian,
        replacedWith: greenResult.emit[0] ?? 0,
        timestamp,
      });
    }

    // ── Zip and emit ──────────────────────────────────────────────────────
    // All three channels must agree on emit length (they always will because
    // they receive the same spike pattern, but we guard with Math.min).
    const emitCount = Math.min(
      irResult.emit.length,
      redResult.emit.length,
      greenResult.emit.length,
    );

    // Nothing to emit this cycle (lerp is buffering a spike run)
    if (emitCount === 0) return null;

    let lastEmitted: PPGSample | null = null;

    for (let i = 0; i < emitCount; i++) {
      const sample: PPGSample = {
        ir: irResult.emit[i],
        red: redResult.emit[i],
        green: greenResult.emit[i],
        timestamp: irResult.timestamps[i], // per-sample timestamp from lerp queue
      };
      onCleanRef.current(sample);
      lastEmitted = sample;
    }

    return lastEmitted;
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
