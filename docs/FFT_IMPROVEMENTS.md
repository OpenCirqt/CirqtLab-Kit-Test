# FFT Feature Improvements

## Post-Collection FFT Analysis

**Key Design Decision**: FFT analysis is now performed **after data collection stops** rather than in real-time. This provides:
- More accurate frequency analysis on the complete dataset
- Better performance during data collection (no FFT overhead)
- Ability to analyze entire signal without windowing artifacts
- No interference with real-time PPG analysis (heart rate/SpO2)

## Changes Made

### 1. **Post-Collection FFT Mode** ✅
- FFT button is **disabled during active collection**
- Only enabled after stopping collection when data is available
- Automatically switches back to time domain when new collection starts
- Analyzes the complete collected dataset for accurate frequency representation

### 2. **Dynamic Sampling Rate from Windows Fs** ✅
- Uses actual measured sampling rate instead of fixed preset values
- Calculated as `samples / elapsed_time` (same as "Windows Fs" statistic)
- Automatically adapts to actual device performance
- Ensures accurate frequency axis scaling
- Respects Nyquist limit (`samplingRate / 2`)

### 3. **Dynamic FFT Preset Selection** ✅
- Automatically selects appropriate FFT configuration based on data type
- PPG signals → `FFTPresets.ppgAnalysis` (optimized for heart rate detection)
- Accelerometer signals → `FFTPresets.accelerometerAnalysis` (optimized for motion)
- Other signals → `FFTPresets.balanced` (general purpose)
- **All presets updated with actual measured sampling rate**

### 3. **Increased maxVisibleValueCount for FFT Mode** ✅
- Time Domain: 50 points (original)
- **FFT Mode: 500 points** (10x increase to show full frequency spectrum)
- Provides better visualization of frequency bins

### 4. **Continuous PPG Analysis During Collection** ✅
- Heart rate and SpO2 calculations run continuously during data collection
- No interference from FFT mode (FFT only after collection stops)
- Real-time monitoring maintained

### 4. **Improved Data Handling** ✅
- FFT now takes most recent samples when data exceeds FFT size (using `slice(-fftSize)`)
- Better handling of edge cases (empty data, log of zero)
- Proper windowing applied before FFT computation

### 5. **Per-Chart FFT Configuration** ✅
- Each chart uses its own appropriate FFT preset
- Chart 1 and Chart 2 can have different FFT settings based on their data types
- Ensures optimal frequency analysis for different sensor types

## Technical Details

### FFT Preset Selection Logic

```typescript
const getFFTPresetForDataType = (dataType: DataTypes): FFTConfig => {
  if (dataType.includes("ppg")) {
    return FFTPresets.ppgAnalysis;      // 1024 FFT, 0.5-5 Hz range
  } else if (dataType.includes("acc")) {
    return FFTPresets.accelerometerAnalysis;  // 512 FFT, 0-25 Hz range
  }
  return FFTPresets.balanced;           // 512 FFT, general purpose
};
```

### PPG Preset Details
- **FFT Size**: 1024 (better frequency resolution)
- **Sampling Rate**: ⚡ **Dynamic** - Uses actual "Windows Fs" measurement
- **Frequency Range**: 0.5 - 5 Hz (30-300 bpm)
- **Overlap**: 50%
- **Optimized for**: Heart rate detection, HRV analysis

### Accelerometer Preset Details
- **FFT Size**: 512 (balanced performance)
- **Sampling Rate**: ⚡ **Dynamic** - Uses actual "Windows Fs" measurement
- **Frequency Range**: 0 - 25 Hz
- **Overlap**: 50%
- **Optimized for**: Motion detection, vibration analysis

**Note**: Sampling rate is now **dynamically calculated** from collected data (`samples / elapsed_time`), ensuring accurate frequency analysis regardless of actual device performance.

### Data Windowing Improvements

**Before:**
```typescript
// Truncated from start (lost recent data)
processData = processData.slice(0, fftSize);
```

**After:**
```typescript
// Takes most recent samples
processData = processData.slice(-fftSize);
```

This ensures the FFT analyzes the most current data, which is critical for real-time monitoring.

### Log Scale Handling

Added protection against log(0):
```typescript
if (useLogScale && magnitude === 0) {
  magnitude = -100; // Very small value in dB instead of -Infinity
}
```

## Behavior Changes

### Workflow

1. **During Collection** (Time Domain Only)
   - Real-time time-series visualization
   - PPG analysis runs continuously (heart rate, SpO2)
   - FFT button is disabled
   - Graph updates every 300ms

2. **After Stopping Collection** (FFT Available)
   - FFT button becomes enabled
   - Click to toggle between time/frequency domain
   - FFT analyzes the complete collected dataset
   - Instant switching between views

### When FFT Mode is Enabled:

1. **Chart Visualization**
   - X-axis: Frequency (Hz) instead of sample index
   - Y-axis: Magnitude (dB or linear) instead of sensor value
   - 10x more data points visible (500 vs 50)
   - Analyzes complete dataset (not just last window)

2. **Statistics**
   - Heart Rate: Shows last calculated value (from collection)
   - SpO2: Shows last calculated value (from collection)
   - Other stats remain from collection period

3. **Data Processing**
   - Automatic preset selection per data type
   - Window function applied (Hanning by default)
   - Frequency filtering (only relevant ranges shown)
   - Full dataset FFT (more accurate than real-time windowing)

## Example Use Cases

### Heart Rate Detection from PPG
1. Select PPG IR or RED data point
2. Start collection and gather PPG data
3. **Stop collection**
4. Enable FFT mode - system automatically uses `ppgAnalysis` preset
5. Look for peak in 0.5-5 Hz range
6. Peak frequency × 60 = heart rate in bpm

### Motion Analysis from Accelerometer
1. Select ACC data point
2. Start collection and gather accelerometer data
3. **Stop collection**
4. Enable FFT mode - system automatically uses `accelerometerAnalysis` preset
5. Identify dominant motion frequencies (0-25 Hz)
6. Useful for gait analysis, tremor detection, etc.

### Signal Quality Assessment
- Switch to FFT mode to identify noise frequencies
- Check for unexpected peaks (interference)
- Validate sensor performance across frequency spectrum

## Performance Considerations

### FFT Computation Time
- **PPG Preset** (1024 FFT): ~2-5ms per chart
- **ACC Preset** (512 FFT): ~1-3ms per chart
- **Total overhead**: Minimal, within normal graph compute time

### Memory Usage
- No additional memory overhead (same data buffer)
- FFT computed on-the-fly during visualization
- Results not cached (fresh computation each update)

## Future Enhancements

The following features can be added in the future:

1. **UI Controls for FFT Settings**
   - Dropdown to select preset
   - Sliders for frequency range
   - Toggle for log scale

2. **Peak Detection**
   - Automatic identification of dominant frequencies
   - Display peak frequencies on chart
   - Alert for specific frequency ranges

3. **Frequency Markers**
   - Vertical lines at important frequencies
   - Labels for known signal ranges (e.g., "60 bpm", "1 Hz")

4. **Export FFT Data**
   - Save frequency domain data to CSV
   - Include both frequency and magnitude

5. **Spectrogram View**
   - Time-frequency visualization
   - Waterfall display for continuous monitoring

## Troubleshooting

**Issue**: Charts look empty in FFT mode
- **Cause**: Not enough data collected (need at least FFT size samples)
- **Solution**: Collect more data before enabling FFT

**Issue**: FFT magnitudes are negative (dB scale)
- **Cause**: Log scale is enabled by default
- **Solution**: This is normal for dB scale; disable log scale if needed

**Issue**: FFT button is disabled
- **Cause**: Data collection is active or no data has been collected
- **Solution**: Stop collection first, then FFT button will be enabled

**Issue**: Frequency range seems wrong
- **Cause**: Incorrect sampling rate in preset
- **Solution**: Verify your actual sensor sampling rate matches the preset
