# Dynamic Sampling Rate for FFT

## Overview

The FFT implementation now uses the **actual measured sampling rate** from the collected data (the "Windows Fs" statistic) instead of fixed preset values. This ensures accurate frequency analysis regardless of the actual data collection rate.

## Why Dynamic Sampling Rate?

### The Problem with Fixed Rates

Previously, FFT presets used fixed sampling rates:
- PPG Analysis: 100 Hz (assumed)
- Accelerometer: 50 Hz (assumed)
- Balanced: 100 Hz (assumed)

**Issue**: If the actual sampling rate differs from these assumptions:
- Frequency axis would be incorrectly scaled
- Peak detection would identify wrong frequencies
- Heart rate calculations would be inaccurate

### The Solution

Now, the system:
1. Measures actual sampling rate during collection: `samples / elapsed_time`
2. Uses this **measured rate** for FFT configuration
3. Automatically adjusts Nyquist frequency limit

## Implementation

### Calculation

```typescript
const getActualSamplingRate = (): number => {
  if (elapsedTimeRef.current > 0 && cachedData.current.length > 0) {
    return cachedData.current.length / elapsedTimeRef.current;
  }
  return 100; // fallback default
};
```

This matches exactly what's displayed in the "Windows Fs" stat card:
```typescript
<StatCard
  title="Windows Fs"
  value={cachedData.current.length / elapsedTimeRef.current || 0}
  decimal={2}
  unit="Hz"
/>
```

### FFT Configuration

When FFT mode is enabled, the system:

1. **Gets the base preset** for the data type:
   ```typescript
   const baseConfig = getFFTPresetForDataType(dataType);
   ```

2. **Overrides with actual sampling rate**:
   ```typescript
   const fftConfig = {
     ...baseConfig,
     samplingRate: actualSamplingRate,  // ← Uses measured rate
     maxFrequency: Math.min(
       baseConfig.maxFrequency,
       actualSamplingRate / 2            // ← Respects Nyquist limit
     ),
   };
   ```

3. **Respects Nyquist limit**: Max frequency = `samplingRate / 2`

## Examples

### Example 1: PPG at 95 Hz (Slower than expected)

**Collected Data:**
- Samples: 950
- Elapsed Time: 10 seconds
- **Measured Fs: 95 Hz** ✓

**FFT Configuration:**
```javascript
{
  fftSize: 1024,
  samplingRate: 95,        // ← Actual measured rate, not 100
  minFrequency: 0.5,
  maxFrequency: 5,         // Still 5 Hz (within Nyquist limit of 47.5)
  windowFunction: "hanning",
  useLogScale: true,
  overlapPercent: 50
}
```

**Result:** Accurate frequency axis, correct heart rate detection

### Example 2: Accelerometer at 62 Hz (Faster than expected)

**Collected Data:**
- Samples: 620
- Elapsed Time: 10 seconds
- **Measured Fs: 62 Hz** ✓

**FFT Configuration:**
```javascript
{
  fftSize: 512,
  samplingRate: 62,        // ← Actual measured rate, not 50
  minFrequency: 0,
  maxFrequency: 25,        // Still 25 Hz (within Nyquist limit of 31)
  windowFunction: "hanning",
  useLogScale: true,
  overlapPercent: 50
}
```

**Result:** Accurate motion frequency analysis

### Example 3: Variable Rate System

**Collected Data:**
- Samples: 1337
- Elapsed Time: 12.5 seconds
- **Measured Fs: 106.96 Hz** ✓

**FFT Configuration:**
```javascript
{
  fftSize: 512,
  samplingRate: 106.96,    // ← Adapts to actual rate
  minFrequency: 0,
  maxFrequency: 50,        // Still 50 Hz (within Nyquist limit of 53.48)
  windowFunction: "hanning",
  useLogScale: true,
  overlapPercent: 50
}
```

**Result:** Works correctly regardless of variations

## Advantages

### ✅ Accuracy
- Frequency axis always correctly scaled
- No assumptions about sampling rate
- Matches real hardware behavior

### ✅ Flexibility
- Works with any BLE device
- Adapts to different sensor configurations
- Handles variable sampling rates

### ✅ Reliability
- Nyquist limit automatically enforced
- Prevents aliasing from incorrect assumptions
- Self-correcting for rate variations

### ✅ Transparency
- Sampling rate visible in UI ("Windows Fs")
- User can verify the rate used for FFT
- No hidden assumptions

## Technical Details

### Nyquist Frequency

The maximum frequency that can be detected is:
```
f_max = samplingRate / 2
```

This is enforced in the code:
```typescript
maxFrequency: Math.min(
  baseConfig.maxFrequency,  // Preset's intended max
  actualSamplingRate / 2     // Nyquist limit
)
```

### Frequency Resolution

The frequency resolution is:
```
Δf = samplingRate / fftSize
```

**Example:**
- Sampling Rate: 100 Hz
- FFT Size: 512
- Resolution: 100 / 512 = **0.195 Hz**

This means frequency bins are spaced 0.195 Hz apart.

### Edge Cases

#### Case 1: No Data Collected
```typescript
const actualSamplingRate = getActualSamplingRate();
// Returns: 100 (fallback default)
```

#### Case 2: Very Short Collection (< 1 second)
```typescript
// samples: 50, elapsed: 0.5s
const actualSamplingRate = 50 / 0.5;
// Returns: 100 Hz (correct!)
```

#### Case 3: Very Long Collection
```typescript
// samples: 10000, elapsed: 100s
const actualSamplingRate = 10000 / 100;
// Returns: 100 Hz (averaged over long period)
```

## Comparison: Fixed vs Dynamic

| Scenario | Fixed Rate | Dynamic Rate |
|----------|-----------|--------------|
| Ideal conditions | ✅ Works | ✅ Works |
| Rate variations | ❌ Incorrect | ✅ Adapts |
| Different devices | ❌ May fail | ✅ Works |
| Unknown rate | ❌ Guess | ✅ Measures |
| User confidence | ⚠️ Uncertain | ✅ Visible in UI |

## User Benefits

### For Analysis

1. **Heart Rate from PPG**
   - Frequency axis is accurate
   - Peak at correct Hz value
   - Multiply by 60 for accurate BPM

2. **Motion Analysis**
   - Correct frequency identification
   - Accurate gait/tremor frequency
   - No calibration needed

3. **Signal Quality**
   - True frequency content
   - Accurate noise identification
   - Correct bandwidth assessment

### For Debugging

1. **Verify Sampling Rate**
   - Check "Windows Fs" stat during collection
   - Compare with expected rate
   - Identify rate issues

2. **Understand Variations**
   - See actual achieved rate
   - Not just design specification
   - Real-world performance

## Implementation Notes

### When is Sampling Rate Calculated?

**During Collection:**
- Continuously updated in `elapsedTimeRef.current`
- Displayed in "Windows Fs" stat card
- Available for post-collection analysis

**After Collection:**
- Final value frozen when collection stops
- Used for FFT configuration
- Consistent for multiple FFT toggles

### Does it Change?

Once collection stops:
- Sampling rate is **fixed** for that dataset
- Toggling FFT on/off uses same rate
- New collection = new rate measurement

## Best Practices

### For Users

1. **Check Windows Fs**
   - Verify sampling rate during collection
   - Ensure it's reasonable for your sensor
   - Typical: 50-200 Hz

2. **Collect Sufficient Duration**
   - Longer collection = more accurate rate
   - Minimum: 3-5 seconds
   - Recommended: 10+ seconds

3. **Stable Connection**
   - BLE connection quality affects rate
   - Maintain good signal
   - Avoid interference

### For Developers

1. **Trust the Measurement**
   - Don't hardcode sampling rates
   - Let the system measure
   - Use presets only for other parameters

2. **Fallback is Conservative**
   - 100 Hz default if measurement fails
   - Safe for most scenarios
   - Better than crashing

3. **Nyquist is Enforced**
   - `maxFrequency` automatically limited
   - Prevents aliasing
   - No manual checks needed

## Future Enhancements

### Potential Improvements

1. **Rate Stability Indicator**
   - Show variance in sampling rate
   - Warn if rate is unstable
   - Quality metric

2. **Multi-Window Analysis**
   - Measure rate per window
   - Detect rate changes
   - Adaptive FFT size

3. **Rate History**
   - Plot sampling rate over time
   - Identify BLE issues
   - Performance monitoring

4. **Automatic FFT Size Selection**
   - Choose FFT size based on rate
   - Optimize resolution vs computation
   - Power-of-2 constraint

## Conclusion

Using the actual measured sampling rate (Windows Fs) for FFT provides:

- ✅ **Accuracy**: Correct frequency axis scaling
- ✅ **Flexibility**: Works with any device
- ✅ **Reliability**: Self-correcting for variations
- ✅ **Transparency**: Visible to user

This ensures FFT analysis is accurate regardless of the actual data collection rate, making the feature robust and trustworthy for real-world biosensor applications.
