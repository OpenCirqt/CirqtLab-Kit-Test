import FFT from "fft.js";
import { FFTConfig } from "./fftConfig";

/**
 * Apply window function to data
 */
export const applyWindow = (
  data: number[],
  windowType: "hanning" | "hamming" | "blackman" | "none"
): number[] => {
  const N = data.length;

  if (windowType === "none") {
    return [...data];
  }

  return data.map((value, i) => {
    let windowValue = 1;

    switch (windowType) {
      case "hanning":
        windowValue = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (N - 1)));
        break;
      case "hamming":
        windowValue = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (N - 1));
        break;
      case "blackman":
        windowValue =
          0.42 -
          0.5 * Math.cos((2 * Math.PI * i) / (N - 1)) +
          0.08 * Math.cos((4 * Math.PI * i) / (N - 1));
        break;
    }

    return value * windowValue;
  });
};

/**
 * Compute FFT and return magnitude spectrum
 */
export const computeFFT = (
  data: number[],
  config: FFTConfig
): { frequencies: number[]; magnitudes: number[] } => {
  const { fftSize, samplingRate, windowFunction, useLogScale, minFrequency, maxFrequency } = config;

  // Need at least some data
  if (data.length === 0) {
    return { frequencies: [], magnitudes: [] };
  }

  // Ensure data length matches FFT size
  let processData = [...data];
  
  if (processData.length < fftSize) {
    // Zero-pad if data is shorter than FFT size
    processData = [...processData, ...new Array(fftSize - processData.length).fill(0)];
  } else if (processData.length > fftSize) {
    // Take the most recent samples if data is longer than FFT size
    processData = processData.slice(-fftSize);
  }

  // Apply window function
  const windowedData = applyWindow(processData, windowFunction);

  // Initialize FFT
  const fft = new FFT(fftSize);
  const out = fft.createComplexArray();
  const input = fft.createComplexArray();

  // Convert to format expected by fft.js (real and imaginary pairs)
  fft.toComplexArray(windowedData, input);

  // Compute FFT
  fft.transform(out, input);

  // Compute magnitude spectrum
  const halfSize = fftSize / 2;
  const frequencies: number[] = [];
  const magnitudes: number[] = [];

  for (let i = 0; i < halfSize; i++) {
    const freq = (i * samplingRate) / fftSize;
    
    // Only include frequencies within the specified range
    if (freq >= minFrequency && freq <= maxFrequency) {
      const real = out[2 * i];
      const imag = out[2 * i + 1];
      let magnitude = Math.sqrt(real * real + imag * imag);

      // Normalize by FFT size
      magnitude = magnitude / fftSize;

      // Apply logarithmic scale if requested
      if (useLogScale && magnitude > 0) {
        magnitude = 20 * Math.log10(magnitude);
      } else if (useLogScale && magnitude === 0) {
        // Handle log of zero
        magnitude = -100; // Very small value in dB
      }

      frequencies.push(freq);
      magnitudes.push(magnitude);
    }
  }

  return { frequencies, magnitudes };
};

/**
 * Transform time-series data to frequency domain for visualization
 */
export const transformToFrequencyDomain = (
  timeSeriesData: number[][],
  columnIndex: number,
  config: FFTConfig
): { x: number; y: number }[] => {
  if (timeSeriesData.length === 0) {
    return [];
  }

  // Extract the specific column data
  const columnData = timeSeriesData.map((row) => row[columnIndex] || 0);

  // Compute FFT
  const { frequencies, magnitudes } = computeFFT(columnData, config);

  // Convert to chart format
  return frequencies.map((freq, i) => ({
    x: freq,
    y: magnitudes[i],
  }));
};
