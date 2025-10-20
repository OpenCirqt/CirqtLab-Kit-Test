# FFT Transform Feature - Usage Guide

## Overview
The Dashboard now supports Fast Fourier Transform (FFT) to visualize sensor data in the frequency domain. This is useful for analyzing periodic signals, detecting frequencies, and understanding signal characteristics.

**Note**: FFT analysis is performed on the complete collected dataset after you stop data collection, providing more accurate frequency analysis than real-time FFT.

## How to Use

### Basic Usage
1. Connect your BLE device
2. **Start data collection** - Data is collected and displayed in time domain
3. **Stop data collection** - Collection must be stopped before FFT analysis
4. Click the **"Frequency Domain (FFT)"** button to toggle between:
   - **Time Domain**: Shows raw sensor values over time (default)
   - **Frequency Domain (FFT)**: Shows frequency components and their magnitudes from the complete dataset
5. Toggle back to **"Time Domain"** to view raw data again

### What You'll See

#### Time Domain (Default)
- X-axis: Sample index (time)
- Y-axis: Sensor value (e.g., acceleration, PPG signal)

#### Frequency Domain (FFT)
- X-axis: Frequency (Hz)
- Y-axis: Magnitude (signal strength at that frequency)

## Configuration

### Default FFT Settings
Located in `src/utils/fftConfig.ts`:

```typescript
{
  fftSize: 512,              // FFT window size (power of 2)
  samplingRate: 100,         // Sampling rate in Hz
  windowFunction: "hanning", // Window function to reduce spectral leakage
  useLogScale: true,         // Logarithmic magnitude scale
  minFrequency: 0,           // Minimum frequency to display
  maxFrequency: 50,          // Maximum frequency (Nyquist = samplingRate/2)
  overlapPercent: 50         // Overlap between FFT windows
}
```

### Presets Available
The system includes several presets optimized for different use cases:

1. **High Resolution**: Better frequency detail, slower computation
   - `fftSize: 2048`
   - `overlapPercent: 75`

2. **Fast Computation**: Lower resolution, faster updates
   - `fftSize: 256`
   - `overlapPercent: 25`

3. **Balanced**: Good compromise (default)
   - `fftSize: 512`
   - `overlapPercent: 50`

4. **PPG Analysis**: Optimized for heart rate detection
   - `fftSize: 1024`
   - `samplingRate: 100`
   - `minFrequency: 0.5` (~30 bpm)
   - `maxFrequency: 5` (~300 bpm)

5. **Accelerometer Analysis**: Optimized for motion
   - `fftSize: 512`
   - `samplingRate: 50`
   - `maxFrequency: 25`

## Customizing FFT Settings

To change FFT configuration programmatically, use the `setFftConfig` function:

```typescript
import { FFTPresets } from "../utils/fftConfig";

// Use a preset
setFftConfig(FFTPresets.ppgAnalysis);

// Or create custom configuration
setFftConfig({
  fftSize: 1024,
  samplingRate: 200,
  windowFunction: "hamming",
  useLogScale: true,
  minFrequency: 0,
  maxFrequency: 100,
  overlapPercent: 50,
});
```

## Understanding FFT Parameters

### FFT Size
- Must be a power of 2 (128, 256, 512, 1024, 2048)
- Larger = better frequency resolution but slower computation
- Frequency resolution = `samplingRate / fftSize`

### Sampling Rate
- Should match your actual sensor sampling rate
- Determines the maximum frequency you can detect (Nyquist = samplingRate / 2)

### Window Functions
- **Hanning**: Good general-purpose window
- **Hamming**: Better for narrowband signals
- **Blackman**: Best sidelobe suppression, wider main lobe
- **None**: No windowing (not recommended, causes spectral leakage)

### Log Scale
- `true`: Displays magnitude in dB (20 * log10(magnitude))
- `false`: Linear scale
- Log scale is useful for signals with large dynamic range

## Use Cases

### Heart Rate Detection (PPG)
1. Select PPG data points
2. Enable FFT mode
3. Use `ppgAnalysis` preset
4. Look for peak in 0.5-5 Hz range (30-300 bpm)

### Motion Analysis (Accelerometer)
1. Select ACC data points
2. Enable FFT mode
3. Use `accelerometerAnalysis` preset
4. Identify dominant motion frequencies

### Signal Quality Assessment
- Check for noise in unexpected frequency ranges
- Identify periodic interference
- Validate sensor performance

## Technical Details

### Implementation
- Uses `fft.js` library (already installed)
- Applies window function before FFT to reduce spectral leakage
- Computes magnitude spectrum from complex FFT output
- Filters results to display only specified frequency range

### Files
- `src/utils/fftConfig.ts`: Configuration and presets
- `src/utils/fftUtils.ts`: FFT computation utilities
- `src/screens/DashboardScreen.tsx`: UI integration

## Future Enhancements

You can extend this feature by:
1. Adding UI controls to adjust FFT settings in real-time
2. Implementing peak detection for automatic frequency identification
3. Adding spectral averaging for smoother results
4. Supporting waterfall/spectrogram visualization
5. Exporting frequency domain data to CSV

## Troubleshooting

**Issue**: No data showing in FFT mode
- **Solution**: Ensure you have enough data collected (at least `fftSize` samples)

**Issue**: Frequencies don't look right
- **Solution**: Verify `samplingRate` matches your actual sensor rate

**Issue**: Too much noise in FFT
- **Solution**: Try a different window function or increase `fftSize`

**Issue**: Missing high frequencies
- **Solution**: Check `maxFrequency` doesn't exceed `samplingRate / 2`
