/**
 * usePPGAnalyzer.ts
 *
 * React Native hook for real-time BPM and SpO2 analysis from raw PPG data.
 *
 * Features:
 *  - Sliding window sample rate (no fixed Hz assumed)
 *  - Spike removal: isolated amplitude outliers (e.g. 2500 → 250000 → 2500)
 *    distinguished from legitimate motion artifacts (gradual multi-sample changes)
 *  - FFT-based BPM via fft.js with parabolic bin interpolation
 *  - BPM temporal stabilisation: rejects physiologically implausible jumps
 *    unless corroborated by high spectral confidence
 *  - SpO2 derived from AC/DC ratio of IR and Red channels
 *
 * Installation:
 *   yarn add fft.js
 *   # or
 *   npm install fft.js
 */

import FFT from "fft.js";
import { useCallback, useRef, useState } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface PPGSample {
  /** Raw IR (infrared) photodiode reading */
  ir: number;
  /** Raw Red photodiode reading */
  red: number;
  /** Raw Green photodiode reading (optional, used as BPM fallback) */
  green?: number;
  /** Unix timestamp in milliseconds (Date.now()) */
  timestamp: number;
}

export interface PPGAnalysis {
  /** Heart rate in beats per minute, null until enough data is collected */
  bpm: number | null;
  /** Blood oxygen saturation 70–100 %, null when signal is insufficient */
  spo2: number | null;
  /**
   * Spectral confidence 0–1.
   * ~1 means the dominant FFT peak clearly stands above the rest of the BPM band.
   * Low values (<0.3) indicate a noisy or motion-corrupted window.
   */
  confidence: number;
  /** Dynamically calculated sample rate (Hz) from the sliding window timestamps */
  sampleRate: number | null;
  /** True once the buffer contains ≥ 50 % of windowSeconds of data */
  isReady: boolean;
  /**
   * Diagnostic flags – useful during development / debugging.
   * Not needed in production UI.
   */
  diagnostics: {
    bufferSamples: number;
    bufferDurationSec: number;
    spikesRemovedIR: number;
    spikesRemovedRed: number;
    rawFFTBpm: number | null;
  };
}

export interface PPGAnalyzerConfig {
  /**
   * Sliding-window duration in seconds.
   * Longer windows give better frequency resolution but slower response.
   * Default: 9 (range: 8–10 recommended)
   */
  windowSeconds?: number;

  /** Minimum physiologically valid BPM. Default: 40 */
  minBPM?: number;

  /** Maximum physiologically valid BPM. Default: 200 */
  maxBPM?: number;

  /**
   * Spike detection sensitivity.
   * A sample is flagged as a spike if it deviates more than
   * (spikeRatioThreshold × local median) from its neighbourhood.
   *
   * 3.0 = value must be >3× the local median to be called a spike.
   * Lower → more aggressive (may clip motion peaks).
   * Higher → less aggressive (may miss spikes).
   * Default: 3.0
   */
  spikeRatioThreshold?: number;

  /**
   * Half-width (in samples) of the neighbourhood used for spike detection.
   * Spikes are isolated (1–2 samples wide); motion artifacts span many samples.
   * Setting this to 3–5 means we look at ±3–5 samples around each point.
   * Default: 4
   */
  spikeNeighborRadius?: number;

  /**
   * How many recent BPM estimates to keep for the temporal median filter.
   * Default: 6
   */
  bpmHistorySize?: number;

  /**
   * A new raw BPM estimate is only accepted as-is if:
   *   |new_bpm − recent_median| ≤ bpmJumpThreshold
   *
   * The confidence override (bpmConfidenceOverrideThreshold) additionally
   * requires the jump to be ≤ 2× this threshold, preventing a high-confidence
   * subharmonic peak from overwriting good history.
   * Default: 20
   */
  bpmJumpThreshold?: number;

  /**
   * If spectral confidence exceeds this value the jump guard is bypassed
   * (i.e. a confident large BPM change is treated as real).
   * Default: 0.65
   */
  bpmConfidenceOverrideThreshold?: number;

  /**
   * Minimum interval between analysis runs in milliseconds.
   * Lower = more CPU; higher = less responsive.
   * Default: 500 (2 Hz analysis cadence)
   */
  analysisIntervalMs?: number;

  /**
   * Which PPG channel to use as the primary BPM signal.
   * 'ir' is usually the cleanest for heart rate; 'green' can also work.
   * Default: 'ir'
   */
  bpmChannel?: "ir" | "red" | "green";

  /**
   * Skip the internal batch spike-filter pass.
   *
   * Set to `true` when samples have already been cleaned by usePPGStream.
   * Running both filters is wasteful and the batch pass can slightly distort
   * an already-clean signal.
   *
   * Default: false  (internal filter runs — safe to use standalone)
   */
  skipSpikeFilter?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal defaults
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULTS: Required<PPGAnalyzerConfig> = {
  windowSeconds: 9,
  minBPM: 40,
  maxBPM: 200,
  spikeRatioThreshold: 3.0,
  spikeNeighborRadius: 4,
  bpmHistorySize: 6,
  bpmJumpThreshold: 20,
  bpmConfidenceOverrideThreshold: 0.8, // tightened — see stabilisation logic
  analysisIntervalMs: 500,
  bpmChannel: "ir",
  skipSpikeFilter: false,
};

// ─────────────────────────────────────────────────────────────────────────────
// Pure utility functions  (no React deps – easier to unit-test in isolation)
// ─────────────────────────────────────────────────────────────────────────────

/** Next power of two ≥ n */
function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/** Hamming window coefficients */
function makeHammingWindow(size: number): Float64Array {
  const w = new Float64Array(size);
  for (let i = 0; i < size; i++) {
    w[i] = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (size - 1));
  }
  return w;
}

/** Median of a numeric array (non-destructive) */
function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 !== 0 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Detect and repair isolated amplitude spikes.
 *
 * Strategy:
 *  For each sample i, compute the median of a ±radius neighbourhood
 *  (excluding i itself).  If |sample[i] − neighbourhood_median| >
 *  spikeRatioThreshold × |neighbourhood_median|, mark it as a spike and
 *  replace with linear interpolation from valid neighbours.
 *
 * Why this doesn't confuse motion with spikes:
 *  Motion artifacts produce gradual, multi-sample excursions.  The
 *  neighbourhood median will shift with them, so the per-sample ratio
 *  stays low.  A true spike (1–2 samples) deviates sharply from its
 *  otherwise-stable neighbourhood.
 *
 * @returns { cleaned, spikeCount }
 */
function removeSpikesMutating(
  data: number[],
  ratioThreshold: number,
  radius: number,
): { cleaned: number[]; spikeCount: number } {
  const result = [...data];
  const n = data.length;
  let spikeCount = 0;

  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - radius);
    const hi = Math.min(n - 1, i + radius);

    // Collect neighbours (exclude self)
    const neighbours: number[] = [];
    for (let j = lo; j <= hi; j++) {
      if (j !== i) neighbours.push(data[j]);
    }
    if (neighbours.length === 0) continue;

    const localMed = median(neighbours);
    if (localMed === 0) continue; // avoid divide-by-zero

    const deviation = Math.abs(data[i] - localMed) / Math.abs(localMed);

    if (deviation > ratioThreshold) {
      spikeCount++;
      // Replace with the mean of immediate valid neighbours
      const prev = i > 0 ? result[i - 1] : localMed;
      const next = i < n - 1 ? result[i + 1] : localMed;
      result[i] = (prev + next) / 2;
    }
  }

  return { cleaned: result, spikeCount };
}

/**
 * FFT-based dominant frequency in the BPM band.
 *
 * Returns the estimated BPM and a confidence metric [0, 1].
 * Returns null when the signal is too noisy to produce a reliable estimate —
 * the caller should hold the last known good value in that case.
 *
 * Key improvements over a naive peak-pick:
 *
 * 1. Peak-to-noise ratio (PNR) guard
 *    The raw peak magnitude is compared against the median magnitude of the
 *    rest of the band.  If the peak does not stand at least PNR_MIN times
 *    above the noise floor, the window is too noisy → return null.
 *
 * 2. Harmonic promotion
 *    After finding the dominant peak, we check whether a harmonic (2× or 3×
 *    the candidate frequency) carries more energy than the candidate itself.
 *    If so, the candidate is likely a subharmonic (e.g. 46 bpm when the real
 *    HR is 92 bpm) and we promote the harmonic to the final estimate.
 *    Promotion only fires when the harmonic bin falls within the valid BPM
 *    range, has significantly more energy than the candidate, and the
 *    promoted BPM is physiologically plausible.
 *
 * 3. Parabolic interpolation
 *    Sub-bin frequency precision after the integer peak-pick.
 */
function fftBPM(
  signal: number[],
  sampleRateHz: number,
  minBPM: number,
  maxBPM: number,
): { bpm: number; confidence: number } | null {
  const n = signal.length;
  if (n < 8) return null;

  // Zero-pad to 4× next power-of-two for finer frequency resolution.
  // At 25 Hz over 9 s (225 samples) this gives fftSize=1024,
  // freqRes = 25/1024 ≈ 0.024 Hz ≈ 1.5 bpm per bin — good enough for HR.
  const fftSize = Math.max(nextPow2(n) * 4, 1024);

  // DC removal + Hann window (lower sidelobe leakage than Hamming)
  const dcMean = signal.reduce((s, v) => s + v, 0) / n;
  const padded = new Array<number>(fftSize).fill(0);
  for (let i = 0; i < n; i++) {
    const hann = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
    padded[i] = (signal[i] - dcMean) * hann;
  }

  // Run FFT
  const fft = new FFT(fftSize);
  const complexOut = fft.createComplexArray();
  fft.realTransform(complexOut, padded);
  fft.completeSpectrum(complexOut);

  // Magnitude spectrum (first half — real signal is conjugate symmetric)
  const halfSize = fftSize / 2;
  const mag = new Float64Array(halfSize);
  for (let i = 0; i < halfSize; i++) {
    const re = complexOut[2 * i];
    const im = complexOut[2 * i + 1];
    mag[i] = Math.sqrt(re * re + im * im);
  }

  // Convert BPM limits → FFT bin indices
  const freqResHz = sampleRateHz / fftSize;
  const minBin = Math.max(1, Math.ceil(minBPM / 60 / freqResHz));
  const maxBin = Math.min(halfSize - 2, Math.floor(maxBPM / 60 / freqResHz));
  if (minBin >= maxBin) return null;

  // ── 1. Find the dominant peak bin in the physiological band ─────────────
  let peakBin = minBin;
  let peakMag = mag[minBin];
  for (let i = minBin + 1; i <= maxBin; i++) {
    if (mag[i] > peakMag) {
      peakMag = mag[i];
      peakBin = i;
    }
  }

  // ── 1a. Peak-to-noise ratio guard ───────────────────────────────────────
  // Compute median magnitude of the band excluding a ±3-bin window around
  // the peak (so the peak itself doesn't inflate the noise estimate).
  const PEAK_EXCLUSION = 3;
  const noiseSamples: number[] = [];
  for (let i = minBin; i <= maxBin; i++) {
    if (Math.abs(i - peakBin) > PEAK_EXCLUSION) noiseSamples.push(mag[i]);
  }
  const noiseFloor = noiseSamples.length > 0 ? median(noiseSamples) : 0;

  // Minimum ratio of peak to noise floor required to trust the estimate.
  // Empirically: clean resting PPG gives PNR 4–10; motion gives PNR < 2.
  const PNR_MIN = 2.5;
  if (noiseFloor > 0 && peakMag / noiseFloor < PNR_MIN) {
    // Too noisy — caller holds last known good value
    return null;
  }

  // ── 2. Harmonic promotion ────────────────────────────────────────────────
  // If the dominant peak is a subharmonic (e.g. 46 bpm ≈ 0.77 Hz) the real
  // HR (92 bpm ≈ 1.53 Hz) will appear as the 2nd harmonic with higher or
  // comparable energy.  Check 2× and 3× the candidate frequency.
  //
  // Promotion conditions (all must hold):
  //   a) Harmonic bin falls within the valid BPM range
  //   b) Harmonic magnitude > HARMONIC_RATIO × candidate magnitude
  //   c) Harmonic PNR also clears PNR_MIN (not just another noise peak)
  const HARMONIC_RATIO = 0.7; // harmonic needs ≥ 70 % of candidate energy to promote
  let finalPeakBin = peakBin;

  for (const multiplier of [2, 3]) {
    const harmonicBin = Math.round(peakBin * multiplier);
    if (harmonicBin < minBin || harmonicBin > maxBin) continue;

    // Look for the local maximum within ±2 bins of the expected harmonic
    let hBin = harmonicBin;
    let hMag = mag[harmonicBin];
    for (let d = -2; d <= 2; d++) {
      const b = harmonicBin + d;
      if (b >= minBin && b <= maxBin && mag[b] > hMag) {
        hMag = mag[b];
        hBin = b;
      }
    }

    const harmonicPNR = noiseFloor > 0 ? hMag / noiseFloor : 0;

    if (hMag >= peakMag * HARMONIC_RATIO && harmonicPNR >= PNR_MIN) {
      // Promote: the harmonic is the real fundamental
      finalPeakBin = hBin;
      peakMag = hMag; // use harmonic magnitude for confidence calc
      break; // prefer 2nd harmonic over 3rd
    }
  }

  // ── 3. Parabolic interpolation for sub-bin accuracy ─────────────────────
  let refinedBin = finalPeakBin;
  if (finalPeakBin > minBin && finalPeakBin < maxBin) {
    const alpha = mag[finalPeakBin - 1];
    const beta = mag[finalPeakBin];
    const gamma = mag[finalPeakBin + 1];
    const denom = alpha - 2 * beta + gamma;
    if (Math.abs(denom) > 1e-10) {
      refinedBin = finalPeakBin + (0.5 * (alpha - gamma)) / denom;
    }
  }

  const bpm = refinedBin * freqResHz * 60;

  // Sanity-check the final BPM is within range (interpolation can nudge it out)
  if (bpm < minBPM || bpm > maxBPM) return null;

  // ── Confidence: peak power fraction of total band power ─────────────────
  let bandPower = 0;
  for (let i = minBin; i <= maxBin; i++) bandPower += mag[i] * mag[i];
  const confidence = bandPower > 0 ? (peakMag * peakMag) / bandPower : 0;

  return { bpm, confidence };
}

/**
 * SpO2 estimation via the Ratio-of-Ratios (R) method.
 *
 * R = (AC_red / DC_red) / (AC_ir / DC_ir)
 *
 * Empirical calibration (widely used for consumer-grade sensors):
 *   SpO2 ≈ 110 − 25 × R
 *
 * Note: This calibration is approximate; a device-specific lookup table
 * from the sensor manufacturer will give better accuracy.
 */
function estimateSpO2(irSignal: number[], redSignal: number[]): number | null {
  if (irSignal.length < 20 || redSignal.length < 20) return null;

  const stats = (sig: number[]) => {
    const dc = sig.reduce((s, v) => s + v, 0) / sig.length;
    const variance = sig.reduce((s, v) => s + (v - dc) ** 2, 0) / sig.length;
    const ac = Math.sqrt(variance); // RMS of AC component
    return { ac, dc };
  };

  const ir = stats(irSignal);
  const red = stats(redSignal);

  if (ir.dc < 1 || red.dc < 1 || ir.ac < 1e-6) return null;

  const R = red.ac / red.dc / (ir.ac / ir.dc);
  const spo2 = Math.round(110 - 25 * R);

  if (spo2 < 70 || spo2 > 100) return null;
  return spo2;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

const INITIAL_ANALYSIS: PPGAnalysis = {
  bpm: null,
  spo2: null,
  confidence: 0,
  sampleRate: null,
  isReady: false,
  diagnostics: {
    bufferSamples: 0,
    bufferDurationSec: 0,
    spikesRemovedIR: 0,
    spikesRemovedRed: 0,
    rawFFTBpm: null,
  },
};

/**
 * usePPGAnalyzer
 *
 * @example
 * ```tsx
 * const { addSample, analysis, reset } = usePPGAnalyzer({
 *   windowSeconds: 9,
 *   bpmChannel: 'ir',
 * });
 *
 * // Called from your BLE / sensor data handler:
 * addSample({ ir: 45000, red: 32000, green: 8000, timestamp: Date.now() });
 *
 * console.log(analysis.bpm);   // e.g. 72
 * console.log(analysis.spo2);  // e.g. 98
 * ```
 */
export function usePPGAnalyzer(config: PPGAnalyzerConfig = {}) {
  // Merge user config with defaults (done in a ref so addSample doesn't need
  // to be re-created every time the caller changes config values)
  const configRef = useRef<Required<PPGAnalyzerConfig>>({
    ...DEFAULTS,
    ...config,
  });
  configRef.current = { ...DEFAULTS, ...config };

  // ── Mutable buffers (not state – mutations must not trigger re-renders) ──
  const samplesRef = useRef<PPGSample[]>([]);
  const bpmHistoryRef = useRef<number[]>([]); // accepted BPM estimates
  const confidenceHistoryRef = useRef<number[]>([]); // parallel confidence per estimate
  const spo2HistoryRef = useRef<number[]>([]); // recent valid SpO2 readings
  const lastAnalysisRef = useRef<number>(0); // timestamp of last analysis run
  const consecutiveLowConfRef = useRef<number>(0); // motion / noise run counter

  // ── Exposed state (triggers re-render on new results) ──
  const [analysis, setAnalysis] = useState<PPGAnalysis>(INITIAL_ANALYSIS);

  // ────────────────────────────────────────────────────────────────────────
  // addSample
  // ────────────────────────────────────────────────────────────────────────
  const addSample = useCallback((sample: PPGSample) => {
    const cfg = configRef.current;
    const buf = samplesRef.current;

    // 1. Append new sample
    buf.push(sample);

    // 2. Evict samples outside the sliding window
    const windowMs = cfg.windowSeconds * 1000;
    const cutoffTs = sample.timestamp - windowMs;
    let evictCount = 0;
    while (evictCount < buf.length && buf[evictCount].timestamp < cutoffTs) {
      evictCount++;
    }
    if (evictCount > 0) buf.splice(0, evictCount);

    // 3. Throttle analysis to avoid excess CPU usage
    if (sample.timestamp - lastAnalysisRef.current < cfg.analysisIntervalMs) {
      return;
    }
    lastAnalysisRef.current = sample.timestamp;

    // 4. Guard: need at least 2 samples to measure anything
    if (buf.length < 2) return;

    const firstTs = buf[0].timestamp;
    const lastTs = buf[buf.length - 1].timestamp;
    const durationSec = (lastTs - firstTs) / 1000;

    // 5. Guard: need at least 50 % of the target window before reporting
    const isReady = durationSec >= cfg.windowSeconds * 0.5;
    if (!isReady) {
      setAnalysis((prev) => ({
        ...prev,
        isReady: false,
        sampleRate: durationSec > 0 ? (buf.length - 1) / durationSec : null,
        diagnostics: {
          ...prev.diagnostics,
          bufferSamples: buf.length,
          bufferDurationSec: durationSec,
        },
      }));
      return;
    }

    // 6. Sliding-window sample rate (derived from actual timestamps, not nominal)
    const sampleRate = (buf.length - 1) / durationSec;

    // 7. Extract raw channel arrays
    const irRaw = buf.map((s) => s.ir);
    const redRaw = buf.map((s) => s.red);
    const greenRaw = buf.map((s) => s.green ?? s.ir);

    // 8. Spike removal — skipped when usePPGStream has already cleaned the data
    let irClean: number[];
    let redClean: number[];
    let greenClean: number[];
    let irSpikes = 0;
    let redSpikes = 0;

    if (cfg.skipSpikeFilter) {
      irClean = irRaw;
      redClean = redRaw;
      greenClean = greenRaw;
    } else {
      const irRes = removeSpikesMutating(
        irRaw,
        cfg.spikeRatioThreshold,
        cfg.spikeNeighborRadius,
      );
      const redRes = removeSpikesMutating(
        redRaw,
        cfg.spikeRatioThreshold,
        cfg.spikeNeighborRadius,
      );
      const greenRes = removeSpikesMutating(
        greenRaw,
        cfg.spikeRatioThreshold,
        cfg.spikeNeighborRadius,
      );
      irClean = irRes.cleaned;
      redClean = redRes.cleaned;
      greenClean = greenRes.cleaned;
      irSpikes = irRes.spikeCount;
      redSpikes = redRes.spikeCount;
    }

    // 9. Pick the primary BPM channel
    let bpmSignal: number[];
    if (cfg.bpmChannel === "red") {
      bpmSignal = redClean;
    } else if (cfg.bpmChannel === "green") {
      bpmSignal = greenClean;
    } else {
      bpmSignal = irClean;
    }

    // 10. FFT-based raw BPM estimate
    const fftResult = fftBPM(bpmSignal, sampleRate, cfg.minBPM, cfg.maxBPM);

    // 11. BPM temporal stabilisation
    //
    // Four problems fixed here vs the naive approach:
    //
    // A) Bad early anchor
    //    The FFT window is only partially filled in the first ~4 s.
    //    Frequency resolution is poor — the peak often lands on a subharmonic
    //    (e.g. 46 bpm when real HR is 92). We guard this by requiring the
    //    buffer to be ≥ 80 % full before pushing ANY estimate into history.
    //    Until then we still output the raw FFT estimate so the UI is not
    //    blank, but we do not let it anchor the history.
    //
    // B) Confidence-weighted history
    //    Low-confidence estimates (noisy window, motion) are admitted to
    //    history only if they are close to the current median. High-confidence
    //    estimates are still subject to the jump guard — we raise the
    //    override bar so a single loud-but-wrong FFT peak cannot blow away
    //    a good history.
    //
    // C) Motion recovery flush
    //    We track consecutive low-confidence windows. When confidence returns
    //    after several bad windows we flush the stale history so the jump
    //    guard does not prevent re-locking onto the true post-motion HR.
    //
    // D) Confidence-gated jump guard override
    //    The old override fired when confidence ≥ 0.65 regardless of jump
    //    size — a high-confidence subharmonic peak could replace 87 bpm with
    //    46 bpm. Now the override only fires when confidence ≥ 0.80 AND the
    //    jump is ≤ 2× bpmJumpThreshold (not unlimited).

    const history = bpmHistoryRef.current;
    const confHist = confidenceHistoryRef.current;

    // Is the window mature enough to trust for anchoring?
    const windowFill = durationSec / cfg.windowSeconds;
    const windowIsMature = windowFill >= 0.8;

    let finalBpm: number | null = null;

    if (fftResult) {
      const { bpm: rawBpm, confidence } = fftResult;

      // ── C) Motion / noise run counter ──────────────────────────────────
      const LOW_CONF_THRESHOLD = 0.25;
      if (confidence < LOW_CONF_THRESHOLD) {
        consecutiveLowConfRef.current++;
      } else {
        // Signal quality is returning after a noisy stretch — flush stale
        // history so the jump guard does not block re-lock.
        // Only flush if we actually had several bad windows AND history is
        // anchored far from where the FFT now points.
        const hadLongNoisyStretch = consecutiveLowConfRef.current >= 4;
        const histMedian = history.length > 0 ? median(history) : null;
        const farFromHistory =
          histMedian !== null &&
          Math.abs(rawBpm - histMedian) > cfg.bpmJumpThreshold;

        if (hadLongNoisyStretch && farFromHistory) {
          // Clear history — let the next few estimates re-establish the anchor
          history.length = 0;
          confHist.length = 0;
        }
        consecutiveLowConfRef.current = 0;
      }

      if (history.length >= 2) {
        const recentMedian = median(history);
        const jumpFromMedian = Math.abs(rawBpm - recentMedian);
        const jumpIsSmall = jumpFromMedian <= cfg.bpmJumpThreshold;

        // ── D) Tightened confidence override ───────────────────────────
        // Requires very high confidence AND a moderate jump (not unlimited).
        // Prevents a loud subharmonic from blowing away good history.
        const peakIsStrong =
          confidence >= 0.8 && jumpFromMedian <= cfg.bpmJumpThreshold * 2;

        if (jumpIsSmall || peakIsStrong) {
          finalBpm = rawBpm;
        } else {
          // Suspect estimate — hold the smoothed value, skip history update
          finalBpm = recentMedian;
        }
      } else {
        // Bootstrap: history is empty or has only 1 entry — accept freely
        finalBpm = rawBpm;
      }

      // ── A + B) Gate history writes ──────────────────────────────────────
      // Only push into history when:
      //   • The window is mature (≥ 80 % full) — avoids bad early anchor
      //   • finalBpm was freshly accepted (not a held recentMedian)
      //   • The estimate has meaningful confidence
      const estimateWasAccepted = finalBpm === rawBpm;
      const MIN_CONF_TO_RECORD = 0.2;

      if (
        windowIsMature &&
        estimateWasAccepted &&
        confidence >= MIN_CONF_TO_RECORD
      ) {
        history.push(finalBpm!);
        confHist.push(confidence);
        if (history.length > cfg.bpmHistorySize) {
          history.shift();
          confHist.shift();
        }
      }
    } else if (history.length > 0) {
      // FFT failed — hold last known good value
      finalBpm = median(history);
      consecutiveLowConfRef.current++;
    }

    // 12. Output: confidence-weighted mean of history (more stable than plain median)
    //     Falls back to plain median when all weights are equal.
    let smoothedBpm: number | null = null;
    if (history.length > 0) {
      const totalW = confHist.reduce((s, c) => s + c, 0);
      if (totalW > 0) {
        const weightedSum = history.reduce(
          (s, bpm, i) => s + bpm * confHist[i],
          0,
        );
        smoothedBpm = Math.round(weightedSum / totalW);
      } else {
        smoothedBpm = Math.round(median(history));
      }
    } else if (finalBpm !== null) {
      // Pre-history phase — show raw FFT so UI is not blank
      smoothedBpm = Math.round(finalBpm);
    }

    // 13. SpO2 — with hold-last-good stabilisation
    //
    //  estimateSpO2 returns null when the AC component is too weak or the
    //  computed value is out of physiological range.  Rather than passing
    //  null straight to the UI (causing a flicker every few cycles), we
    //  keep a small rolling history of valid readings and output its median.
    //  The history is capped at SPO2_HISTORY_SIZE so stale readings from
    //  several seconds ago don't drag the output during genuine changes.
    const SPO2_HISTORY_SIZE = 8;
    const rawSpo2 = estimateSpO2(irClean, redClean);
    const spo2History = spo2HistoryRef.current;

    if (rawSpo2 !== null) {
      spo2History.push(rawSpo2);
      if (spo2History.length > SPO2_HISTORY_SIZE) spo2History.shift();
    }
    // Use median of history when available, otherwise null (still filling up)
    const spo2 =
      spo2History.length > 0 ? Math.round(median(spo2History)) : null;

    // 14. Publish result
    setAnalysis({
      bpm: smoothedBpm,
      spo2,
      confidence: fftResult?.confidence ?? 0,
      sampleRate,
      isReady: true,
      diagnostics: {
        bufferSamples: buf.length,
        bufferDurationSec: durationSec,
        spikesRemovedIR: irSpikes,
        spikesRemovedRed: redSpikes,
        rawFFTBpm: fftResult ? Math.round(fftResult.bpm) : null,
      },
    });
  }, []); // config is read from configRef inside, so no dep needed

  // ────────────────────────────────────────────────────────────────────────
  // reset – clear all buffers and output
  // ────────────────────────────────────────────────────────────────────────
  const reset = useCallback(() => {
    samplesRef.current = [];
    bpmHistoryRef.current = [];
    confidenceHistoryRef.current = [];
    spo2HistoryRef.current = [];
    lastAnalysisRef.current = 0;
    consecutiveLowConfRef.current = 0;
    setAnalysis(INITIAL_ANALYSIS);
  }, []);

  return {
    /**
     * Feed a new sensor sample into the analyzer.
     * Call this every time your BLE / ring data handler fires.
     */
    addSample,
    /** Latest analysis result. Triggers a re-render when updated. */
    analysis,
    /** Clear all buffered data and reset output to null. */
    reset,
  } as const;
}
