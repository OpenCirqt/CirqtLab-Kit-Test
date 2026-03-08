import FFT from "fft.js";

export type PPGSample = {
  ir: number;
  red: number;
  green: number;
  // Optional; if not provided we assume fixed fs
  timestampMs?: number;
};

export type HRResult = {
  bpm: number | null;
  peakHz: number | null;
  snrDb: number | null;
  quality: "good" | "low-snr" | "insufficient-data";
};

export type SpO2Result = {
  spo2: number | null; // 0–100 (%)
  ratioR: number | null; // (ACred/DCred)/(ACir/DCir)
  perfusionIndexPct: number | null; // 100 * ACir/DCir
  quality: "good" | "low-snr" | "insufficient-data";
};

export type AnalysisResult = {
  fs: number; // inferred or configured sampling rate (Hz)
  windowSec: number; // analysis window length (s)
  hr: HRResult;
  spo2: SpO2Result;
};

type SpO2Coeffs = { A: number; B: number }; // SpO2 ≈ A − B*R

/**
 * A simple sliding-window analyzer for PPG streams.
 * - Maintains last `windowSec` of samples
 * - Detrends + windows + FFT
 * - HR from green-channel peak (0.7–3.5 Hz)
 * - SpO2 from ratio-of-ratios on red/IR around HR peak
 */
export class PPGAnalyzer {
  private windowSec: number;
  private targetFs: number | null;
  private spo2Coeffs: SpO2Coeffs;

  // Buffers (simple arrays for clarity; ring-buffer optimizations are easy later)
  private ir: number[] = [];
  private red: number[] = [];
  private green: number[] = [];
  private tms: number[] = []; // timestamps ms (optional)

  // Config
  private HR_BAND_HZ: [number, number] = [0.7, 3.5]; // 42–210 BPM
  private MIN_SAMPLES = 256; // minimum samples to attempt analysis

  constructor(
    opts: {
      windowSec?: number; // default 10 s
      sampleRateHz?: number; // if omitted, will infer from timestamps
      spo2Coeffs?: SpO2Coeffs; // default {A:110, B:25}
    } = {},
  ) {
    this.windowSec = opts.windowSec ?? 10;
    this.targetFs = opts.sampleRateHz ?? null;
    this.spo2Coeffs = opts.spo2Coeffs ?? { A: 110, B: 25 };
  }

  /** Push one sample (call this in your BLE notification callback) */
  push(sample: PPGSample) {
    this.ir.push(sample.ir);
    this.red.push(sample.red);
    this.green.push(sample.green);
    this.tms.push(
      sample.timestampMs ??
        (this.tms.length
          ? this.tms[this.tms.length - 1] + 1000 / (this.targetFs ?? 100)
          : 0),
    );
    this.trimToWindow();
  }

  reset() {
    this.ir.length = 0;
    this.red.length = 0;
    this.green.length = 0;
    this.tms.length = 0;
  }

  /** Alternative: push arrays when you batch samples */
  pushBatch(samples: PPGSample[]) {
    for (const s of samples) this.push(s);
  }

  /** Perform analysis on current window */
  analyze(): AnalysisResult {
    const fs = this.resolveFs();
    const need = Math.max(
      this.MIN_SAMPLES,
      Math.round(this.windowSec * fs * 0.8),
    );

    if (this.green.length < need) {
      return {
        fs,
        windowSec: this.windowSec,
        hr: {
          bpm: null,
          peakHz: null,
          snrDb: null,
          quality: "insufficient-data",
        },
        spo2: {
          spo2: null,
          ratioR: null,
          perfusionIndexPct: null,
          quality: "insufficient-data",
        },
      };
    }

    // Select the last windowSec worth of samples (by count, using fs)
    const Nwin = Math.min(this.green.length, Math.round(this.windowSec * fs));
    const ir = this.ir.slice(-Nwin);
    const red = this.red.slice(-Nwin);
    const green = this.green.slice(-Nwin);

    // Preprocess each channel
    const greenProc = this.preprocess(green);
    const irProc = this.preprocess(ir);
    const redProc = this.preprocess(red);

    // Zero-pad to power of two for FFT
    const Nfft = nextPow2(Nwin);
    const freqs = freqAxis(Nfft, fs);

    // FFT each channel
    const specGreen = this.realFFT(greenProc, Nfft);
    const specIR = this.realFFT(irProc, Nfft);
    const specRed = this.realFFT(redProc, Nfft);

    // Magnitudes up to Nyquist
    const magGreen = spectrumMag(specGreen, Nfft);
    const magIR = spectrumMag(specIR, Nfft);
    const magRed = spectrumMag(specRed, Nfft);

    // Find HR peak in HR band on green channel
    const [fLow, fHigh] = this.HR_BAND_HZ;
    const i0 = Math.max(1, Math.floor((fLow * Nfft) / fs));
    const i1 = Math.min(Nfft / 2 - 1, Math.ceil((fHigh * Nfft) / fs));

    const peak = peakWithParabolicInterpolation(magGreen, freqs, i0, i1);
    const peakHz = peak?.freq ?? null;
    const bpm = peakHz ? peakHz * 60 : null;

    // SNR around peak (exclude ±2 bins from noise)
    const snrDb = peak ? estimateSNRdB(magGreen, peak.bin, i0, i1, 2) : null;

    // AC/DC around HR peak for SpO2
    // Use a narrow ±0.2 Hz (≈12 bpm) band to sum amplitude
    const bandHz = 0.2;
    const acIR = peakHz ? bandPowerAround(specIR, freqs, peakHz, bandHz) : null;
    const acRed = peakHz
      ? bandPowerAround(specRed, freqs, peakHz, bandHz)
      : null;

    // DC is the mean of *raw* signal over window
    const dcIR = mean(ir);
    const dcRed = mean(red);

    // Ratio-of-ratios R = (ACred/DCred) / (ACir/DCir)
    let ratioR: number | null = null;
    let spo2: number | null = null;
    let piPct: number | null = null;

    if (acIR && acRed && dcIR !== 0 && dcRed !== 0) {
      ratioR = acRed / dcRed / (acIR / dcIR);
      spo2 = clamp(this.spo2Coeffs.A - this.spo2Coeffs.B * ratioR, 0, 100);
      piPct = 100 * (acIR / dcIR);
    }

    const hrQuality = !bpm
      ? "insufficient-data"
      : snrDb !== null && snrDb < 6
        ? "low-snr"
        : "good";

    const spo2Quality =
      !spo2 || !bpm
        ? "insufficient-data"
        : snrDb !== null && snrDb < 6
          ? "low-snr"
          : "good";

    return {
      fs,
      windowSec: this.windowSec,
      hr: {
        bpm: bpm ? round1(bpm) : null,
        peakHz: peakHz ? round3(peakHz) : null,
        snrDb: snrDb !== null ? round1(snrDb) : null,
        quality: hrQuality,
      },
      spo2: {
        spo2: spo2 !== null ? Math.round(spo2) : null,
        ratioR: ratioR !== null ? round3(ratioR) : null,
        perfusionIndexPct: piPct !== null ? round1(piPct) : null,
        quality: spo2Quality,
      },
    };
  }

  /** Estimate/lock the sampling rate */
  private resolveFs(): number {
    if (this.targetFs) return this.targetFs;
    if (this.tms.length < 2) return 100; // fallback default
    // robust median-delta from last ~2 seconds
    const N = Math.min(this.tms.length, 2 * 100); // assume ~100 Hz
    const t = this.tms.slice(-N);
    const d = deltas(t);
    const medianDt = median(d);
    const fs = medianDt > 0 ? 1000 / medianDt : 100;
    return Math.max(10, Math.min(400, fs)); // clamp to plausible range
  }

  /** Basic preprocessing: remove mean + linear trend, high-pass via moving-average subtraction, Hann window */
  private preprocess(x: number[]): Float64Array {
    const y = detrendLinear(x);
    // high-pass by subtracting a short moving average (~0.5 s); avoids DC/very low drift
    const hp = highpassByMA(y, Math.max(3, Math.round(0.5 * this.resolveFs())));
    // apply Hann window to reduce spectral leakage
    const w = hann(hp.length);
    const out = new Float64Array(hp.length);
    for (let i = 0; i < hp.length; i++) out[i] = hp[i] * w[i];
    return out;
  }

  /** Real FFT using fft.js */
  private realFFT(x: Float64Array, Nfft: number): Float64Array {
    const fft = new FFT(Nfft);
    const spec = fft.createComplexArray() as unknown as Float64Array;
    const buf = new Float64Array(Nfft);
    buf.set(x);
    // zero-padding done by default initialization of buf
    fft.realTransform(spec, buf);
    fft.completeSpectrum(spec);
    return spec;
  }

  /** Keep only the last windowSec of data (by timestamps if available; else by count using estimated fs) */
  private trimToWindow() {
    const fs = this.resolveFs();
    const maxCount = Math.round(this.windowSec * fs * 1.5); // extra slack vs jitter
    // Prefer timestamp-based trim for accuracy
    const haveTime =
      this.tms.length && Number.isFinite(this.tms[this.tms.length - 1]);
    if (haveTime) {
      const now = this.tms[this.tms.length - 1]!;
      const cutoff = now - this.windowSec * 1000;
      while (this.tms.length && this.tms[0]! < cutoff) {
        this.tms.shift();
        this.ir.shift();
        this.red.shift();
        this.green.shift();
      }
    } else {
      while (this.green.length > maxCount) {
        this.tms.shift();
        this.ir.shift();
        this.red.shift();
        this.green.shift();
      }
    }
  }
}

/* ---------- Helpers ---------- */

function mean(x: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i]!;
  return s / x.length;
}

function deltas(t: number[]): number[] {
  const d: number[] = [];
  for (let i = 1; i < t.length; i++) d.push(t[i]! - t[i - 1]!);
  return d;
}

function median(x: number[]): number {
  if (!x.length) return 0;
  const a = [...x].sort((a, b) => a - b);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m]! : 0.5 * (a[m - 1]! + a[m]!);
}

function nextPow2(n: number): number {
  return 1 << (32 - Math.clz32(n - 1));
}

function freqAxis(Nfft: number, fs: number): Float64Array {
  const out = new Float64Array(Nfft / 2 + 1);
  for (let i = 0; i < out.length; i++) out[i] = (i * fs) / Nfft;
  return out;
}

function hann(N: number): Float64Array {
  const w = new Float64Array(N);
  const denom = N - 1;
  for (let n = 0; n < N; n++) {
    w[n] = 0.5 * (1 - Math.cos((2 * Math.PI * n) / denom));
  }
  return w;
}

function detrendLinear(x: number[]): Float64Array {
  const N = x.length;
  let sumX = 0,
    sumN = 0,
    sumNX = 0,
    sumNN = 0;
  for (let n = 0; n < N; n++) {
    const xn = x[n]!;
    sumX += xn;
    sumN += n;
    sumNX += n * xn;
    sumNN += n * n;
  }
  const denom = N * sumNN - sumN * sumN;
  const m = denom !== 0 ? (N * sumNX - sumN * sumX) / denom : 0;
  const b = (sumX - m * sumN) / N;

  const y = new Float64Array(N);
  for (let n = 0; n < N; n++) y[n] = x[n]! - (m * n + b);
  return y;
}

function movingAverage(x: ArrayLike<number>, win: number): Float64Array {
  const N = x.length;
  const w = Math.max(1, win | 0);
  const y = new Float64Array(N);
  let s = 0;
  for (let i = 0; i < N; i++) {
    s += x[i]!;
    if (i >= w) s -= x[i - w]!;
    y[i] = s / Math.min(i + 1, w);
  }
  return y;
}

function highpassByMA(x: ArrayLike<number>, win: number): Float64Array {
  const ma = movingAverage(x, win);
  const y = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) y[i] = x[i]! - ma[i]!;
  return y;
}

/** FFT magnitude for bins [0..Nfft/2] */
function spectrumMag(spec: Float64Array, Nfft: number): Float64Array {
  const out = new Float64Array(Nfft / 2 + 1);
  for (let i = 0; i < out.length; i++) {
    const re = spec[2 * i]!;
    const im = spec[2 * i + 1]!;
    out[i] = Math.hypot(re, im);
  }
  return out;
}

function peakWithParabolicInterpolation(
  mag: Float64Array,
  freqs: Float64Array,
  i0: number,
  i1: number,
): { bin: number; freq: number; mag: number } | null {
  if (i1 - i0 < 3) return null;
  let k = i0;
  let max = -Infinity;
  for (let i = i0; i <= i1; i++) {
    const v = mag[i]!;
    if (v > max) {
      max = v;
      k = i;
    }
  }
  // Guard edges
  const k0 = Math.max(k - 1, i0);
  const k2 = Math.min(k + 1, i1);
  const m1 = mag[k0]!,
    m0 = mag[k]!,
    p1 = mag[k2]!;
  const denom = m1 - 2 * m0 + p1;
  const delta = denom !== 0 ? (0.5 * (m1 - p1)) / denom : 0;
  const kInterp = k + delta;
  const freq = interp(freqs, kInterp);
  const magInterp = m0 - 0.25 * (m1 - p1) * delta;
  return { bin: k, freq, mag: magInterp };
}

function interp(arr: Float64Array, x: number): number {
  const i = Math.floor(x);
  const t = x - i;
  const a = arr[Math.max(0, Math.min(arr.length - 1, i))]!;
  const b = arr[Math.max(0, Math.min(arr.length - 1, i + 1))]!;
  return a + t * (b - a);
}

function estimateSNRdB(
  mag: Float64Array,
  peakBin: number,
  i0: number,
  i1: number,
  guard: number,
): number {
  const peak = mag[peakBin]!;
  let noiseSum = 0,
    count = 0;
  for (let i = i0; i <= i1; i++) {
    if (Math.abs(i - peakBin) <= guard) continue;
    const v = mag[i]!;
    noiseSum += v * v;
    count++;
  }
  const noise = count > 0 ? Math.sqrt(noiseSum / count) : 1e-9;
  const snr = 20 * Math.log10(peak / (noise || 1e-9));
  return snr;
}

function bandPowerAround(
  spec: Float64Array,
  freqs: Float64Array,
  centerHz: number,
  halfBandHz: number,
): number {
  // Sum magnitudes (or power) across bins whose freq within [center±halfBand]
  // Here we return "AC amplitude proxy" as sum of magnitudes.
  let sum = 0;
  for (let i = 0; i < freqs.length; i++) {
    const f = freqs[i]!;
    if (Math.abs(f - centerHz) <= halfBandHz) {
      const re = spec[2 * i]!;
      const im = spec[2 * i + 1]!;
      sum += Math.hypot(re, im);
    }
  }
  return sum;
}

function clamp(x: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, x));
}

function round1(x: number) {
  return Math.round(x * 10) / 10;
}
function round3(x: number) {
  return Math.round(x * 1000) / 1000;
}
