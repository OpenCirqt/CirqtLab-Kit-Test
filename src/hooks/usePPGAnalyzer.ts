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

  /**
   * Peak-to-noise ratio threshold for the FFT result to be trusted.
   * The dominant spectral peak must be at least this many times stronger
   * than the median noise floor of the BPM band.
   *
   * Higher → stricter, fewer nulls but may miss weak signals.
   * Lower  → more permissive, fewer nulls but may accept noisy estimates.
   *
   * Android BLE burst delivery degrades spectral quality, so use a lower
   * value on Android (2.5–3.0) vs iOS (3.0–3.5).
   *
   * Default: 3.0
   */
  fftPnrThreshold?: number;
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
  fftPnrThreshold: 3.0,
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
 * Resample a non-uniformly sampled signal onto a uniform time grid using
 * linear interpolation.
 *
 * Android BLE delivers packets in bursts (e.g. 8 packets every 200 ms rather
 * than 1 every 25 ms).  The resulting timestamp clustering means the signal
 * is NOT uniformly sampled — FFT assumes it is, so spectral quality degrades.
 * Resampling onto a uniform grid fixes this before the FFT runs.
 *
 * @param values     Raw signal values
 * @param timestamps Corresponding hardware timestamps (ms), same length
 * @param targetRate Desired uniform sample rate (Hz) — use the sliding-window
 *                   average sample rate so no information is invented or lost
 * @returns          Uniformly resampled signal
 */
function resampleUniform(
  values: number[],
  timestamps: number[],
  targetRate: number,
): number[] {
  const n = values.length;
  if (n < 2) return [...values];

  const tStart = timestamps[0];
  const tEnd = timestamps[n - 1];
  const duration = (tEnd - tStart) / 1000; // seconds
  const nOut = Math.max(2, Math.round(duration * targetRate));
  const out = new Array<number>(nOut);

  for (let i = 0; i < nOut; i++) {
    const t = tStart + (i / (nOut - 1)) * (tEnd - tStart); // target time (ms)

    // Binary search for the surrounding pair in the original timestamps
    let lo = 0;
    let hi = n - 2;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (timestamps[mid + 1] < t) lo = mid + 1;
      else hi = mid;
    }

    const t0 = timestamps[lo];
    const t1 = timestamps[lo + 1];
    const dt = t1 - t0;
    const alpha = dt > 0 ? (t - t0) / dt : 0;
    out[i] = values[lo] + alpha * (values[lo + 1] - values[lo]);
  }

  return out;
}

/**
 * FFT-based dominant frequency in the BPM band.
 *
 * Returns { bpm, confidence } or null when the window is too noisy.
 *
 * Takes an optional `anchorBpm` — the last known good BPM from the
 * stabilisation layer.  Used to make harmonic promotion context-aware.
 */
function fftBPM(
  signal: number[],
  timestamps: number[], // hardware timestamps (ms), parallel to signal
  sampleRateHz: number, // sliding-window average sample rate
  minBPM: number,
  maxBPM: number,
  anchorBpm: number | null = null,
  pnrThreshold: number = 3.0,
): { bpm: number; confidence: number } | null {
  if (signal.length < 8) return null;

  // ── Uniform resampling ────────────────────────────────────────────────────
  // Corrects for Android BLE burst delivery and any other source of uneven
  // packet timing.  The target rate is the measured sliding-window average —
  // this preserves the actual information content without inventing samples.
  const resampled = resampleUniform(signal, timestamps, sampleRateHz);
  const n = resampled.length;
  if (n < 8) return null;

  const fftSize = Math.max(nextPow2(n) * 4, 1024);

  // DC removal + Hann window
  const dcMean = resampled.reduce((s, v) => s + v, 0) / n;
  const padded = new Array<number>(fftSize).fill(0);
  for (let i = 0; i < n; i++) {
    const hann = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
    padded[i] = (resampled[i] - dcMean) * hann;
  }

  const fft = new FFT(fftSize);
  const complexOut = fft.createComplexArray();
  fft.realTransform(complexOut, padded);
  fft.completeSpectrum(complexOut);

  const halfSize = fftSize / 2;
  const mag = new Float64Array(halfSize);
  for (let i = 0; i < halfSize; i++) {
    const re = complexOut[2 * i];
    const im = complexOut[2 * i + 1];
    mag[i] = Math.sqrt(re * re + im * im);
  }

  const freqResHz = sampleRateHz / fftSize;
  const minBin = Math.max(1, Math.ceil(minBPM / 60 / freqResHz));
  const maxBin = Math.min(halfSize - 2, Math.floor(maxBPM / 60 / freqResHz));
  if (minBin >= maxBin) return null;

  // ── 1. Dominant peak ─────────────────────────────────────────────────────
  let peakBin = minBin;
  let peakMag = mag[minBin];
  for (let i = minBin + 1; i <= maxBin; i++) {
    if (mag[i] > peakMag) {
      peakMag = mag[i];
      peakBin = i;
    }
  }

  // ── 2. Peak-to-noise ratio guard ─────────────────────────────────────────
  // Exclude ±4 bins around the peak when computing the noise floor so the
  // peak itself does not inflate the estimate.
  const PEAK_EXCLUSION = 4;
  const noiseSamples: number[] = [];
  for (let i = minBin; i <= maxBin; i++) {
    if (Math.abs(i - peakBin) > PEAK_EXCLUSION) noiseSamples.push(mag[i]);
  }
  const noiseFloor = noiseSamples.length > 0 ? median(noiseSamples) : 0;

  // Raised from 2.5 → 3.5.  Requires a cleaner, more unambiguous peak.
  // This is the primary gate against the noisy 89→40→180 oscillation:
  // borderline windows now return null and the stabiliser holds the last
  // good value instead of accepting a wandering peak.
  const PNR_MIN = pnrThreshold;
  if (noiseFloor > 0 && peakMag / noiseFloor < PNR_MIN) return null;

  // ── 3. Context-aware harmonic promotion ──────────────────────────────────
  //
  // The fundamental problem with unconditional promotion:
  //   If the real HR is 89 bpm and the FFT peak happens to land there,
  //   promotion checks 178 bpm (2×89). If 178 also has some energy it gets
  //   promoted — turning a correct 89 into a wrong 178.
  //
  // Fix: promotion is only attempted when the raw candidate looks like a
  // subharmonic relative to the anchor.
  //
  //   "Looks like a subharmonic" means:
  //     candidate × 2 (or × 3) is within ANCHOR_TOLERANCE of anchorBpm
  //     AND candidate itself is far from anchorBpm (> SUBHARMONIC_GAP)
  //
  // If there is no anchor yet (bootstrap), fall back to energy-only promotion
  // but with a stricter ratio (harmonic must dominate, not just be close).

  const ANCHOR_TOLERANCE = 15; // bpm — how close harmonic must be to anchor
  const SUBHARMONIC_GAP = 20; // bpm — how far candidate must be from anchor
  const HARMONIC_RATIO_ANCHORED = 0.6; // harmonic needs 60% of candidate energy (anchor mode)
  const HARMONIC_RATIO_BOOTSTRAP = 1.1; // harmonic must EXCEED candidate energy (no anchor)

  let finalPeakBin = peakBin;

  for (const multiplier of [2, 3]) {
    const harmonicBin = Math.round(peakBin * multiplier);
    if (harmonicBin < minBin || harmonicBin > maxBin) continue;

    // Local max within ±2 bins
    let hBin = harmonicBin;
    let hMag = mag[harmonicBin];
    for (let d = -2; d <= 2; d++) {
      const b = harmonicBin + d;
      if (b >= minBin && b <= maxBin && mag[b] > hMag) {
        hMag = mag[b];
        hBin = b;
      }
    }

    const hPNR = noiseFloor > 0 ? hMag / noiseFloor : 0;
    if (hPNR < PNR_MIN) continue; // harmonic itself must be above noise floor

    const rawCandidateBpm = peakBin * freqResHz * 60;
    const harmonicBpm = hBin * freqResHz * 60;

    if (anchorBpm !== null) {
      // Anchor-guided mode: only promote when candidate looks like a subharmonic
      const candidateIsFarFromAnchor =
        Math.abs(rawCandidateBpm - anchorBpm) > SUBHARMONIC_GAP;
      const harmonicIsCloseToAnchor =
        Math.abs(harmonicBpm - anchorBpm) < ANCHOR_TOLERANCE;
      const harmonicHasEnoughEnergy = hMag >= peakMag * HARMONIC_RATIO_ANCHORED;

      if (
        candidateIsFarFromAnchor &&
        harmonicIsCloseToAnchor &&
        harmonicHasEnoughEnergy
      ) {
        finalPeakBin = hBin;
        peakMag = hMag;
        break;
      }
    } else {
      // Bootstrap mode (no anchor): only promote if the harmonic genuinely
      // dominates — prevents accidental promotion of correct fundamentals.
      if (hMag >= peakMag * HARMONIC_RATIO_BOOTSTRAP) {
        finalPeakBin = hBin;
        peakMag = hMag;
        break;
      }
    }
  }

  // ── 4. Parabolic interpolation ───────────────────────────────────────────
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
  if (bpm < minBPM || bpm > maxBPM) return null;

  // ── 5. Confidence ────────────────────────────────────────────────────────
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
  // Provisional re-lock buffer: new estimates after a noisy stretch must
  // agree N times before displacing the existing anchor.
  const provisionalBufRef = useRef<number[]>([]); // candidate values accumulating
  const PROVISIONAL_REQUIRED = 3; // agreements needed to commit

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

    // 10. FFT — pass timestamps for uniform resampling, anchor for harmonic promotion
    const anchorBpm =
      bpmHistoryRef.current.length >= 2 ? median(bpmHistoryRef.current) : null;
    const bpmTimestamps = buf.map((s) => s.timestamp);
    const fftResult = fftBPM(
      bpmSignal,
      bpmTimestamps,
      sampleRate,
      cfg.minBPM,
      cfg.maxBPM,
      anchorBpm,
      cfg.fftPnrThreshold,
    );

    // 11. BPM temporal stabilisation
    //
    // A) Bad early anchor     — require 80 % window fill before writing to history.
    // B) Confidence-weighted  — output is weighted mean of history.
    // C) Noisy-stretch hold   — FFT null → hold last good value, increment counter.
    //                           NO flush: destroying good history was the root cause
    //                           of the 89→40→89 bounce (flush → bootstrap → 40
    //                           accepted freely → harmonic check rejects real 89).
    // D) Harmonic artefact    — reject estimates that are ½×, 2×, ⅓×, 3× of anchor.
    // E) Provisional re-lock  — large jumps that are NOT artefacts accumulate in a
    //                           provisional buffer. They displace the anchor only
    //                           after PROVISIONAL_REQUIRED consecutive agreeing
    //                           estimates. One bad FFT cycle can never hijack the
    //                           anchor on its own.
    // F) Jump guard           — small jumps (≤ threshold) are always accepted directly.

    const history = bpmHistoryRef.current;
    const confHist = confidenceHistoryRef.current;
    const provBuf = provisionalBufRef.current;

    const windowFill = durationSec / cfg.windowSeconds;
    const windowIsMature = windowFill >= 0.8;

    // ── D) Harmonic artefact check ───────────────────────────────────────
    // Returns true when candidate is a harmonic/subharmonic of anchor.
    // Ratios checked: ½ (sub), ⅓ (sub), 2× (2nd harmonic), 3× (3rd harmonic).
    const HARMONIC_TOLERANCE = 12; // bpm
    function isHarmonicArtefact(candidate: number, anchor: number): boolean {
      for (const ratio of [0.5, 2.0, 1 / 3, 3.0]) {
        if (Math.abs(candidate - anchor * ratio) < HARMONIC_TOLERANCE)
          return true;
      }
      return false;
    }

    let finalBpm: number | null = null;

    if (fftResult) {
      const { bpm: rawBpm, confidence } = fftResult;

      // ── C) Track noisy stretches (no flush) ──────────────────────────
      const LOW_CONF_THRESHOLD = 0.25;
      if (confidence < LOW_CONF_THRESHOLD) {
        consecutiveLowConfRef.current++;
        // Clear provisional buffer — noisy cycle breaks the agreement run
        provBuf.length = 0;
      } else {
        consecutiveLowConfRef.current = 0;
      }

      if (history.length >= 2) {
        const recentMedian = median(history);
        const jumpFromMedian = Math.abs(rawBpm - recentMedian);
        const jumpIsSmall = jumpFromMedian <= cfg.bpmJumpThreshold;

        // ── D) Harmonic artefact? → always hold, clear provisional ───
        if (isHarmonicArtefact(rawBpm, recentMedian)) {
          finalBpm = recentMedian;
          provBuf.length = 0; // artefact breaks any accumulating re-lock

          // ── F) Small jump → accept directly ──────────────────────────
        } else if (jumpIsSmall) {
          finalBpm = rawBpm;
          provBuf.length = 0; // small jump means we're at the anchor; reset

          // ── E) Large non-artefact jump → provisional re-lock ─────────
        } else {
          // Could be a real HR change or a stray FFT result.
          // Accumulate in provisional buffer. The buffer resets whenever:
          //   • a different value arrives (disagreement)
          //   • an artefact or noisy cycle arrives (above)
          //   • a small jump arrives (we're back at anchor)
          const lastProv =
            provBuf.length > 0 ? provBuf[provBuf.length - 1] : null;
          const provAgrees =
            lastProv !== null &&
            Math.abs(rawBpm - lastProv) <= cfg.bpmJumpThreshold;

          if (provAgrees || provBuf.length === 0) {
            provBuf.push(rawBpm);
          } else {
            // New disagreeing value — restart the provisional run
            provBuf.length = 0;
            provBuf.push(rawBpm);
          }

          if (provBuf.length >= PROVISIONAL_REQUIRED) {
            // Enough agreeing estimates — commit the new anchor
            finalBpm = median(provBuf);
            provBuf.length = 0;
            // Evict the oldest history entries to accelerate re-anchoring
            const evict = Math.min(3, history.length);
            history.splice(0, evict);
            confHist.splice(0, evict);
          } else {
            // Not enough agreement yet — hold current anchor
            finalBpm = recentMedian;
          }
        }
      } else {
        // ── Bootstrap (history empty / 1 entry) ──────────────────────
        // Even here, reject obvious artefacts relative to the single
        // existing entry so a stray early reading can't anchor badly.
        if (history.length === 1 && isHarmonicArtefact(rawBpm, history[0])) {
          finalBpm = history[0];
        } else {
          finalBpm = rawBpm;
        }
      }

      // ── A + B) Gate history writes ──────────────────────────────────
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
      // ── C) FFT null — hold last known good, clear provisional ────────
      finalBpm = median(history);
      provBuf.length = 0;
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
    provisionalBufRef.current = [];
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
