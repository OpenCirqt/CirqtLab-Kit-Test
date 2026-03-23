// usePPGAnalyzer.ts
import { useCallback, useRef } from "react";
import { PPGSample } from "./usePPGFilter";

// ─── constants ────────────────────────────────────────────────────────────────

const BUFFER_DURATION_SEC = 10; // seconds of samples to keep in the analysis window
const MIN_PEAK_DISTANCE_SEC = 0.3; // minimum RR interval (= max ~200 BPM)
const MAX_PEAK_DISTANCE_SEC = 2.0; // maximum RR interval (= min ~30 BPM)
const RR_MEDIAN_COUNT = 8; // median over last N RR intervals for BPM
const MIN_PEAKS_REQUIRED = 3; // need this many peaks before reporting BPM
const MIN_SAMPLES_FOR_SPO2 = 50; // need enough samples to compute stable AC/DC
const SPO2_CALIBRATION_A = 110; // linear calibration: SpO2 = A - B * R
const SPO2_CALIBRATION_B = 25; // empirical constants (Maxim AN6142)
const BPM_VALID_RANGE = [30, 220] as const;
const SPO2_VALID_RANGE = [70, 100] as const;

// ─── types ────────────────────────────────────────────────────────────────────

export interface PPGAnalysisResult {
  bpm: number | null; // null until enough peaks detected
  spo2: number | null; // null until enough samples accumulated
  confidence: "high" | "medium" | "low" | "acquiring";
  peakCount: number;
  sampleCount: number;
}

// ─── DSP helpers ──────────────────────────────────────────────────────────────

/**
 * Simple IIR band-pass filter (cascaded high-pass + low-pass).
 * 0.5–4 Hz retains the cardiac fundamental + harmonics,
 * rejects baseline wander (< 0.5 Hz) and high-freq noise (> 4 Hz).
 */
class BandPassFilter {
  // High-pass (0.5 Hz) state
  private hpX = 0;
  private hpY = 0;
  // Low-pass (4 Hz) state
  private lpY = 0;

  constructor(private sampleRate: number) {}

  update(sampleRate: number) {
    this.sampleRate = sampleRate;
  }

  process(x: number): number {
    const hpAlpha = 1 / (1 + 2 * Math.PI * (0.5 / this.sampleRate));
    const lpAlpha = 1 - 1 / (1 + 2 * Math.PI * (4.0 / this.sampleRate));

    // High-pass
    const hpOut = hpAlpha * (this.hpY + x - this.hpX);
    this.hpX = x;
    this.hpY = hpOut;

    // Low-pass
    this.lpY = this.lpY + lpAlpha * (hpOut - this.lpY);
    return this.lpY;
  }

  reset() {
    this.hpX = 0;
    this.hpY = 0;
    this.lpY = 0;
  }
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function clamp(value: number, [min, max]: readonly [number, number]): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Local peak detection with adaptive threshold.
 * A sample is a peak if it exceeds `threshold * localMax` and
 * is greater than both its neighbours.
 */
function findPeaks(
  signal: number[],
  minDistanceSamples: number,
  threshold = 0.4,
): number[] {
  if (signal.length < 3) return [];

  const localMax = Math.max(...signal);
  if (localMax <= 0) return [];

  const peaks: number[] = [];
  let lastPeak = -minDistanceSamples;

  for (let i = 1; i < signal.length - 1; i++) {
    if (
      signal[i] > signal[i - 1] &&
      signal[i] > signal[i + 1] &&
      signal[i] > threshold * localMax &&
      i - lastPeak >= minDistanceSamples
    ) {
      peaks.push(i);
      lastPeak = i;
    }
  }

  return peaks;
}

/**
 * Compute AC (pulsatile) and DC (mean) components for SpO2.
 * AC = RMS of the band-passed signal.
 * DC = mean of the raw signal (represents ambient + venous absorption).
 */
function computeAcDc(
  rawSamples: number[],
  filteredSamples: number[],
): { ac: number; dc: number } {
  if (rawSamples.length === 0) return { ac: 0, dc: 1 };

  const dc = rawSamples.reduce((s, v) => s + v, 0) / rawSamples.length;
  const rms = Math.sqrt(
    filteredSamples.reduce((s, v) => s + v * v, 0) / filteredSamples.length,
  );

  return { ac: rms, dc: Math.max(dc, 1) }; // guard against div-by-zero
}

// ─── analyzer state ───────────────────────────────────────────────────────────

interface AnalyzerState {
  rawIr: number[];
  rawRed: number[];
  filteredIr: number[];
  filteredRed: number[];
  timestamps: number[];
  rrIntervals: number[]; // ms between successive peaks
  irFilter: BandPassFilter;
  redFilter: BandPassFilter;
}

function makeAnalyzerState(sampleRate: number): AnalyzerState {
  return {
    rawIr: [],
    rawRed: [],
    filteredIr: [],
    filteredRed: [],
    timestamps: [],
    rrIntervals: [],
    irFilter: new BandPassFilter(sampleRate),
    redFilter: new BandPassFilter(sampleRate),
  };
}

// ─── hook ─────────────────────────────────────────────────────────────────────

export function usePPGAnalyzer() {
  const stateRef = useRef<AnalyzerState | null>(null);

  function getState(sampleRate: number): AnalyzerState {
    if (!stateRef.current) {
      stateRef.current = makeAnalyzerState(sampleRate);
    }
    return stateRef.current;
  }

  const analyze = useCallback((sample: PPGSample): PPGAnalysisResult => {
    const hz = sample.sampleRateHz;
    const state = getState(hz);

    // Update filter coefficients if sample rate drifted
    state.irFilter.update(hz);
    state.redFilter.update(hz);

    // ── 1. Buffer incoming sample ─────────────────────────────────────────────
    const maxSamples = Math.round(BUFFER_DURATION_SEC * hz);

    state.rawIr.push(sample.ir);
    state.rawRed.push(sample.red);
    state.filteredIr.push(state.irFilter.process(sample.ir));
    state.filteredRed.push(state.redFilter.process(sample.red));
    state.timestamps.push(sample.timestamp);

    // Trim to rolling window
    if (state.rawIr.length > maxSamples) {
      state.rawIr.shift();
      state.rawRed.shift();
      state.filteredIr.shift();
      state.filteredRed.shift();
      state.timestamps.shift();
    }

    const n = state.filteredIr.length;

    // ── 2. BPM — peak detection on filtered IR ────────────────────────────────
    const minDistSamples = Math.round(MIN_PEAK_DISTANCE_SEC * hz);
    const peaks = findPeaks(state.filteredIr, minDistSamples);

    // Convert peak indices → timestamps → RR intervals (ms)
    if (peaks.length >= 2) {
      const newRR: number[] = [];
      for (let i = 1; i < peaks.length; i++) {
        const dt = state.timestamps[peaks[i]] - state.timestamps[peaks[i - 1]];
        const minRR = MIN_PEAK_DISTANCE_SEC * 1000;
        const maxRR = MAX_PEAK_DISTANCE_SEC * 1000;
        if (dt >= minRR && dt <= maxRR) {
          newRR.push(dt);
        }
      }
      // Replace stored RR intervals — peaks are re-detected over the full window
      state.rrIntervals = newRR.slice(-RR_MEDIAN_COUNT);
    }

    let bpm: number | null = null;
    if (state.rrIntervals.length >= MIN_PEAKS_REQUIRED) {
      const medianRR = median(state.rrIntervals);
      const rawBpm = 60000 / medianRR;
      if (rawBpm >= BPM_VALID_RANGE[0] && rawBpm <= BPM_VALID_RANGE[1]) {
        bpm = Math.round(rawBpm);
      }
    }

    // ── 3. SpO2 — ratio-of-ratios ─────────────────────────────────────────────
    let spo2: number | null = null;
    if (n >= MIN_SAMPLES_FOR_SPO2) {
      const { ac: acIr, dc: dcIr } = computeAcDc(state.rawIr, state.filteredIr);
      const { ac: acRed, dc: dcRed } = computeAcDc(
        state.rawRed,
        state.filteredRed,
      );

      const ratio = acRed / dcRed / (acIr / dcIr);

      if (isFinite(ratio) && ratio > 0) {
        const raw = SPO2_CALIBRATION_A - SPO2_CALIBRATION_B * ratio;
        const clamped = clamp(Math.round(raw), SPO2_VALID_RANGE);
        spo2 = clamped;
      }
    }

    // ── 4. Confidence ─────────────────────────────────────────────────────────
    const confidence = computeConfidence(
      state.rrIntervals,
      peaks.length,
      n,
      sample.hasSpike ?? false,
    );

    return {
      bpm,
      spo2,
      confidence,
      peakCount: peaks.length,
      sampleCount: n,
    };
  }, []);

  const reset = useCallback(() => {
    stateRef.current = null;
  }, []);

  return { analyze, reset };
}

// ─── confidence scoring ───────────────────────────────────────────────────────

function computeConfidence(
  rrIntervals: number[],
  peakCount: number,
  sampleCount: number,
  hasSpike: boolean,
): PPGAnalysisResult["confidence"] {
  if (sampleCount < MIN_SAMPLES_FOR_SPO2 || peakCount < MIN_PEAKS_REQUIRED) {
    return "acquiring";
  }

  if (hasSpike) return "low";

  // RR variability: high spread = motion artifact or arrhythmia
  if (rrIntervals.length >= 2) {
    const med = median(rrIntervals);
    const maxDeviation = Math.max(
      ...rrIntervals.map((rr) => Math.abs(rr - med)),
    );
    const variability = maxDeviation / med;

    if (variability > 0.25) return "low";
    if (variability > 0.12) return "medium";
  }

  return "high";
}
