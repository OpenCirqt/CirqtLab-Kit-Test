// usePPGFilter.ts
import { useCallback, useRef } from "react";

const MEDIAN_WINDOW = 5;
const ZSCORE_THRESHOLD = 3.0;
const BASELINE_DURATION_MS = 1000;
const MIN_SPIKE_DURATION_MS = 30;
const FALLBACK_RATE_HZ = 60;

interface ChannelState {
  window: number[];
  rolling: number[];
  lastClean: number;
  consecutiveSpikes: number;
}

function makeChannelState(): ChannelState {
  return { window: [], rolling: [], lastClean: 0, consecutiveSpikes: 0 };
}

function median(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function rollingStats(buffer: number[]): { mean: number; std: number } {
  if (buffer.length === 0) return { mean: 0, std: 1 };
  const mean = buffer.reduce((s, v) => s + v, 0) / buffer.length;
  const variance =
    buffer.reduce((s, v) => s + (v - mean) ** 2, 0) / buffer.length;
  return { mean, std: Math.sqrt(variance) || 1 };
}

function deriveConstants(hz: number) {
  return {
    rollingWindow: Math.round((BASELINE_DURATION_MS / 1000) * hz),
    consecutiveThreshold: Math.max(
      2,
      Math.round((MIN_SPIKE_DURATION_MS / 1000) * hz),
    ),
  };
}

function filterSample(
  raw: number,
  state: ChannelState,
  rollingWindow: number,
  consecutiveThreshold: number,
): { value: number; isSpike: boolean } {
  // Step 1 — median filter over sliding window
  state.window.push(raw);
  if (state.window.length > MEDIAN_WINDOW * 2 + 1) state.window.shift();
  const medFiltered = state.window.length >= 3 ? median(state.window) : raw;

  // Step 2 — Z-score check against rolling baseline
  const { mean, std } = rollingStats(state.rolling);
  const zScore = Math.abs((medFiltered - mean) / std);
  const isOutlier =
    state.rolling.length >= rollingWindow / 2 && zScore > ZSCORE_THRESHOLD;

  // Step 3 — consecutive spike guard (~30ms must pass before flagging)
  state.consecutiveSpikes = isOutlier ? state.consecutiveSpikes + 1 : 0;
  const isSpike = state.consecutiveSpikes >= consecutiveThreshold;

  if (!isSpike) {
    state.rolling.push(medFiltered);
    if (state.rolling.length > rollingWindow) state.rolling.shift();
    state.lastClean = medFiltered;
    return { value: medFiltered, isSpike: false };
  }

  // Spike — hold last clean value (interpolation)
  return { value: state.lastClean, isSpike: true };
}

export interface PPGSample {
  ir: number;
  red: number;
  green: number;
  timestamp: number;
  sampleRateHz: number;
  hasSpike?: boolean;
}

export function usePPGFilter() {
  const sampleRateRef = useRef<number>(FALLBACK_RATE_HZ);
  const irState = useRef<ChannelState>(makeChannelState());
  const redState = useRef<ChannelState>(makeChannelState());
  const greenState = useRef<ChannelState>(makeChannelState());

  const updateSampleRate = useCallback((hz: number) => {
    sampleRateRef.current = hz;
  }, []);

  const filter = useCallback((raw: number[]): PPGSample | null => {
    if (raw.length < 3) return null;

    const { rollingWindow, consecutiveThreshold } = deriveConstants(
      sampleRateRef.current,
    );

    const ir = filterSample(
      raw[0],
      irState.current,
      rollingWindow,
      consecutiveThreshold,
    );
    const red = filterSample(
      raw[1],
      redState.current,
      rollingWindow,
      consecutiveThreshold,
    );
    const green = filterSample(
      raw[2],
      greenState.current,
      rollingWindow,
      consecutiveThreshold,
    );

    return {
      ir: ir.value,
      red: red.value,
      green: green.value,
      timestamp: Date.now(),
      sampleRateHz: sampleRateRef.current,
      hasSpike: ir.isSpike || red.isSpike || green.isSpike,
    };
  }, []);

  const reset = useCallback(() => {
    irState.current = makeChannelState();
    redState.current = makeChannelState();
    greenState.current = makeChannelState();
    sampleRateRef.current = FALLBACK_RATE_HZ;
  }, []);

  return { filter, updateSampleRate, reset };
}
