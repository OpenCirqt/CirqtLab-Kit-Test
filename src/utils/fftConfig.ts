/**
 * FFT Configuration
 * Settings for Fast Fourier Transform operations on sensor data
 */

export interface FFTConfig {
  /**
   * FFT size - must be a power of 2 (e.g., 128, 256, 512, 1024, 2048)
   * Larger sizes provide better frequency resolution but require more computation
   */
  fftSize: number;

  /**
   * Sampling rate in Hz
   * Should match the actual sampling rate of your sensor data
   */
  samplingRate: number;

  /**
   * Window function to apply before FFT
   * Reduces spectral leakage
   */
  windowFunction: "hanning" | "hamming" | "blackman" | "none";

  /**
   * Whether to apply logarithmic scale to magnitude
   * Useful for visualizing signals with large dynamic range
   */
  useLogScale: boolean;

  /**
   * Minimum frequency to display (Hz)
   */
  minFrequency: number;

  /**
   * Maximum frequency to display (Hz)
   * Should not exceed samplingRate / 2 (Nyquist frequency)
   */
  maxFrequency: number;

  /**
   * Overlap percentage for successive FFT windows (0-99)
   * Higher overlap provides smoother results but requires more computation
   */
  overlapPercent: number;
}

/**
 * Default FFT configuration
 */
export const defaultFFTConfig: FFTConfig = {
  fftSize: 512,
  samplingRate: 100, // Adjust based on your actual sampling rate
  windowFunction: "hanning",
  useLogScale: true,
  minFrequency: 0,
  maxFrequency: 50, // Nyquist frequency = samplingRate / 2
  overlapPercent: 50,
};

/**
 * Preset configurations for different use cases
 */
export const FFTPresets = {
  /**
   * High resolution - better frequency resolution, slower computation
   */
  highResolution: {
    ...defaultFFTConfig,
    fftSize: 2048,
    overlapPercent: 75,
  } as FFTConfig,

  /**
   * Fast computation - lower resolution, faster updates
   */
  fastComputation: {
    ...defaultFFTConfig,
    fftSize: 256,
    overlapPercent: 25,
  } as FFTConfig,

  /**
   * Balanced - good compromise between resolution and speed
   */
  balanced: {
    ...defaultFFTConfig,
    fftSize: 512,
    overlapPercent: 50,
  } as FFTConfig,

  /**
   * PPG signal analysis - optimized for heart rate and SpO2
   */
  ppgAnalysis: {
    ...defaultFFTConfig,
    fftSize: 1024,
    samplingRate: 100,
    minFrequency: 0.5, // ~30 bpm
    maxFrequency: 5, // ~300 bpm
    overlapPercent: 50,
  } as FFTConfig,

  /**
   * Accelerometer analysis - optimized for motion detection
   */
  accelerometerAnalysis: {
    ...defaultFFTConfig,
    fftSize: 512,
    samplingRate: 50,
    minFrequency: 0,
    maxFrequency: 25,
    overlapPercent: 50,
  } as FFTConfig,
};
