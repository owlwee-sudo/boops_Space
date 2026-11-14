// rppg-core.js: camera heart-rate signal processing (H1).
//
// Pure maths, no DOM and no camera code, so it runs both in the browser and in
// Node (see hard/rppg/test_rppg_core.mjs). The same steps are mirrored in
// hard/rppg_reference.py so the two can be cross-checked.
//
// Pipeline:
//   mean R,G,B per frame  ->  resample to a steady 30 Hz  ->  POS projection
//   ->  band-pass 0.7-3.0 Hz  ->  FFT peak = heart rate, peaks = rough HRV
//
// References (also in knowledge/sources.json):
//   POS   Wang, den Brinker, Stuijk, de Haan (2017) "Algorithmic principles of remote PPG"
//   CHROM de Haan & Jeanne (2013), the method POS builds on
//
// Prototype. Not a medical device.

// ----------------------------------------------------------------------------
// Config: every tunable number lives here.
// ----------------------------------------------------------------------------
export const CONFIG = {
  FS: 30, // Hz. All processing happens on a steady 30 Hz grid.
  POS_WINDOW_S: 1.6, // POS sliding window length (Wang 2017 uses 1.6 s)
  BAND_LOW_HZ: 0.7, // 42 bpm
  BAND_HIGH_HZ: 3.0, // 180 bpm
  HR_WINDOW_S: 10, // heart rate is read from the last 10 s
  HR_MIN_WINDOW_S: 6, // do not report a heart rate from less than this
  FFT_SIZE: 4096, // zero-padded FFT: 30 Hz / 4096 = 0.44 bpm per bin
  SNR_HALF_WIDTH_HZ: 0.1, // "signal" = power within +-0.1 Hz of the HR peak
  MAX_GAP_S: 0.5, // a hole in the frames longer than this is not bridged

  // Quality score. Each part is mapped to 0-1 between a "bad" and "good" value.
  // SNR part: share of in-band power that sits at the heart-rate peak.
  //   Pure noise gives 0.2-0.35, a clean pulse gives 0.7 or more
  //   (measured with hard/rppg/explore.mjs).
  SNR_FRACTION_BAD: 0.3,
  SNR_FRACTION_GOOD: 0.65,
  // Stability: a real pulse gives nearly the same heart rate every second,
  // noise jumps around. Measured as the typical jump (median absolute
  // deviation) of the per-second readings, in bpm.
  HR_SPREAD_GOOD: 2.5,
  HR_SPREAD_BAD: 7,
  // Motion part: how fast the face moves, in eye-widths per second
  // (eye-width = distance between the outer eye corners).
  // NOT yet tuned on real faces: see hard/VALIDATION.md.
  MOTION_GOOD: 0.15,
  MOTION_BAD: 0.6,
  // Face part: share of frames in which a face was found.
  FACE_RATIO_BAD: 0.7,
  FACE_RATIO_GOOD: 0.97,
  // Light part: mean brightness (0-255) and share of clipped pixels.
  LUMA_TOO_DARK: 40,
  LUMA_DARK_OK: 80,
  LUMA_BRIGHT_OK: 200,
  LUMA_TOO_BRIGHT: 235,
  CLIPPED_OK: 0.02,
  CLIPPED_BAD: 0.2,
  // Weights of the four parts (sum to 1).
  W_SNR: 0.45,
  W_MOTION: 0.25,
  W_FACE: 0.2,
  W_LIGHT: 0.1,
  // Hard gates: one really bad part caps the whole score below the retry line,
  // so a hidden face or a shaking head can never be "averaged away".
  GATE_FACE: 0.5,
  GATE_MOTION: 0.25,
  GATE_SNR: 0.15,
  GATE_LIGHT: 0.2,
  GATED_MAX: 0.4,
  RETRY_BELOW: 0.5, // quality under this -> ask the user to retry

  // Rough HRV
  IBI_MIN_S: 0.33, // 180 bpm
  IBI_MAX_S: 1.5, // 40 bpm
  IBI_MAX_DEVIATION: 0.3, // drop beats more than 30 % away from the median
  HRV_MIN_BEATS: 12, // need this many clean beats to show an RMSSD estimate
  // Beats are timed in a band centred on the heart rate (0.6x to 1.6x), which
  // keeps beat-to-beat changes but drops noise far from the pulse.
  HRV_BAND_LOW_FACTOR: 0.6,
  HRV_BAND_HIGH_FACTOR: 1.6,
  // RMSSD is only shown when the pulse is very clean; below this the timing
  // error of a 30 fps camera swamps the real beat-to-beat changes.
  HRV_MIN_SNR_FRACTION: 0.75,
};

// ----------------------------------------------------------------------------
// Small helpers
// ----------------------------------------------------------------------------
export function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Map x to 0-1: 0 at `bad`, 1 at `good` (works whichever one is larger). */
export function scoreBetween(x, bad, good) {
  if (!Number.isFinite(x)) return 0;
  return clamp01((x - bad) / (good - bad));
}

export function mean(a) {
  if (a.length === 0) return NaN;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i];
  return s / a.length;
}

export function std(a) {
  if (a.length === 0) return NaN;
  const m = mean(a);
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - m) * (a[i] - m);
  return Math.sqrt(s / a.length);
}

export function median(a) {
  const v = Array.from(a).filter(Number.isFinite).sort((x, y) => x - y);
  if (v.length === 0) return NaN;
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

// ----------------------------------------------------------------------------
// 1. Resample: camera frames arrive unevenly, the maths needs a steady clock.
// ----------------------------------------------------------------------------
/**
 * Linear interpolation of (t, r, g, b) samples onto a steady grid.
 * @param {{t:number[], r:number[], g:number[], b:number[]}} trace  t in seconds, increasing
 * @param {number} fs    target sample rate (Hz)
 * @returns {{t0:number, fs:number, r:Float64Array, g:Float64Array, b:Float64Array,
 *            valid:Uint8Array}} valid[i] = 0 where the sample falls in a long gap
 */
export function resampleTrace(trace, fs = CONFIG.FS, maxGapS = CONFIG.MAX_GAP_S) {
  const n = trace.t.length;
  if (n < 2) {
    return { t0: 0, fs, r: new Float64Array(0), g: new Float64Array(0), b: new Float64Array(0), valid: new Uint8Array(0) };
  }
  const t0 = trace.t[0];
  const count = Math.floor((trace.t[n - 1] - t0) * fs) + 1;
  const r = new Float64Array(count);
  const g = new Float64Array(count);
  const b = new Float64Array(count);
  const valid = new Uint8Array(count);
  let j = 0; // index of the frame at or before the grid time
  for (let i = 0; i < count; i++) {
    const t = t0 + i / fs;
    while (j < n - 2 && trace.t[j + 1] <= t) j++;
    const ta = trace.t[j];
    const tb = trace.t[j + 1];
    const w = tb > ta ? clamp01((t - ta) / (tb - ta)) : 0;
    r[i] = trace.r[j] + w * (trace.r[j + 1] - trace.r[j]);
    g[i] = trace.g[j] + w * (trace.g[j + 1] - trace.g[j]);
    b[i] = trace.b[j] + w * (trace.b[j + 1] - trace.b[j]);
    valid[i] = tb - ta <= maxGapS ? 1 : 0;
  }
  return { t0, fs, r, g, b, valid };
}

// ----------------------------------------------------------------------------
// 2. POS: turn tiny skin-colour changes into one pulse signal.
// ----------------------------------------------------------------------------
/**
 * POS ("plane orthogonal to skin", Wang et al. 2017) with overlap-add.
 * For each 1.6 s window: divide each colour by its own mean (removes skin tone
 * and brightness), project onto two axes that ignore brightness changes, then
 * blend the two so that motion cancels and the pulse stays.
 */
export function posPulse(r, g, b, fs = CONFIG.FS, windowS = CONFIG.POS_WINDOW_S) {
  const n = r.length;
  const l = Math.max(2, Math.ceil(windowS * fs));
  const out = new Float64Array(n);
  const cover = new Uint16Array(n);
  if (n < l) return out;
  const s1 = new Float64Array(l);
  const s2 = new Float64Array(l);
  for (let start = 0; start + l <= n; start++) {
    let mr = 0, mg = 0, mb = 0;
    for (let k = 0; k < l; k++) {
      mr += r[start + k];
      mg += g[start + k];
      mb += b[start + k];
    }
    mr /= l; mg /= l; mb /= l;
    if (!(mr > 0 && mg > 0 && mb > 0)) continue; // black frame: skip
    for (let k = 0; k < l; k++) {
      const rn = r[start + k] / mr;
      const gn = g[start + k] / mg;
      const bn = b[start + k] / mb;
      s1[k] = gn - bn; // projection axis 1: [0, 1, -1]
      s2[k] = -2 * rn + gn + bn; // projection axis 2: [-2, 1, 1]
    }
    const sd1 = std(s1);
    const sd2 = std(s2);
    const alpha = sd2 > 1e-12 ? sd1 / sd2 : 0;
    let hm = 0;
    for (let k = 0; k < l; k++) hm += s1[k] + alpha * s2[k];
    hm /= l;
    for (let k = 0; k < l; k++) {
      out[start + k] += s1[k] + alpha * s2[k] - hm;
      cover[start + k]++;
    }
  }
  // The first and last samples are covered by fewer windows. Divide by the
  // count so the wave keeps the same height right up to the newest frame.
  for (let i = 0; i < n; i++) if (cover[i] > 0) out[i] /= cover[i];
  return out;
}

// ----------------------------------------------------------------------------
// 3. Band-pass 0.7-3.0 Hz: keep only what could be a heartbeat.
// ----------------------------------------------------------------------------
/** Second-order Butterworth section (RBJ "cookbook" formulas). */
export function biquadCoefficients(type, cutoffHz, fs) {
  const w0 = (2 * Math.PI * cutoffHz) / fs;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * Math.SQRT1_2); // Q = 1/sqrt(2) -> Butterworth
  const a0 = 1 + alpha;
  let b0, b1, b2;
  if (type === "lowpass") {
    b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = (1 - cos) / 2;
  } else {
    b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = (1 + cos) / 2;
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: (-2 * cos) / a0, a2: (1 - alpha) / a0 };
}

function runBiquad(x, c) {
  const y = new Float64Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = c.b0 * x[i] + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v;
    y[i] = v;
  }
  return y;
}

/** Run a filter forwards then backwards, so peaks are not shifted in time. */
function zeroPhase(x, c) {
  const n = x.length;
  if (n < 4) return Float64Array.from(x);
  // Mirror the ends so the filter does not "ring" at the start and finish.
  const pad = Math.min(n - 1, 90);
  const ext = new Float64Array(n + 2 * pad);
  for (let i = 0; i < pad; i++) ext[i] = 2 * x[0] - x[pad - i];
  ext.set(x, pad);
  for (let i = 0; i < pad; i++) ext[pad + n + i] = 2 * x[n - 1] - x[n - 2 - i];
  let y = runBiquad(ext, c);
  y.reverse();
  y = runBiquad(y, c);
  y.reverse();
  return y.slice(pad, pad + n);
}

export function bandpass(x, fs = CONFIG.FS, lowHz = CONFIG.BAND_LOW_HZ, highHz = CONFIG.BAND_HIGH_HZ) {
  const hp = biquadCoefficients("highpass", lowHz, fs);
  const lp = biquadCoefficients("lowpass", highHz, fs);
  return zeroPhase(zeroPhase(x, hp), lp);
}

// ----------------------------------------------------------------------------
// 4. Heart rate from the frequency spectrum
// ----------------------------------------------------------------------------
/** In-place radix-2 FFT. `re` and `im` must have a power-of-two length. */
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

/** Power spectrum of a Hann-windowed, zero-padded signal. */
export function powerSpectrum(x, fs = CONFIG.FS, fftSize = CONFIG.FFT_SIZE) {
  let size = fftSize;
  while (size < x.length) size *= 2;
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  const n = x.length;
  const m = mean(x);
  for (let i = 0; i < n; i++) {
    const hann = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    re[i] = (x[i] - m) * hann;
  }
  fft(re, im);
  const half = size / 2;
  const power = new Float64Array(half);
  for (let i = 0; i < half; i++) power[i] = re[i] * re[i] + im[i] * im[i];
  return { power, binHz: fs / size };
}

/**
 * Heart rate = the strongest frequency between 0.7 and 3.0 Hz.
 * Also returns how much of the in-band power sits at that peak (0-1): a clean
 * pulse is one sharp peak, noise is spread out.
 */
export function estimateHeartRate(pulse, fs = CONFIG.FS) {
  const empty = { bpm: NaN, peakHz: NaN, snrFraction: 0, snrDb: -Infinity };
  if (pulse.length < CONFIG.HR_MIN_WINDOW_S * fs) return empty;
  const { power, binHz } = powerSpectrum(pulse, fs);
  const lo = Math.ceil(CONFIG.BAND_LOW_HZ / binHz);
  const hi = Math.min(power.length - 2, Math.floor(CONFIG.BAND_HIGH_HZ / binHz));
  let peak = lo;
  let total = 0;
  for (let i = lo; i <= hi; i++) {
    total += power[i];
    if (power[i] > power[peak]) peak = i;
  }
  if (!(total > 0)) return empty;
  // Fine-tune the peak position with a parabola through its two neighbours.
  let offset = 0;
  if (peak > lo && peak < hi) {
    const a = power[peak - 1], b = power[peak], c = power[peak + 1];
    const denom = a - 2 * b + c;
    if (denom < 0) offset = (0.5 * (a - c)) / denom;
  }
  const peakHz = (peak + offset) * binHz;
  const halfWidth = Math.round(CONFIG.SNR_HALF_WIDTH_HZ / binHz);
  let signal = 0;
  for (let i = Math.max(lo, peak - halfWidth); i <= Math.min(hi, peak + halfWidth); i++) signal += power[i];
  const noise = Math.max(total - signal, 1e-30);
  return { bpm: peakHz * 60, peakHz, snrFraction: signal / total, snrDb: 10 * Math.log10(signal / noise) };
}

// ----------------------------------------------------------------------------
// 5. Rough HRV: beat-to-beat intervals
// ----------------------------------------------------------------------------
/**
 * Time each heartbeat and compute RMSSD.
 *
 * Each beat is timed where the pulse wave crosses zero on its way up. That is
 * the steepest part of the wave, so noise shifts it about half as much as it
 * shifts the (flat) top of a peak. The crossing is placed between two frames
 * by straight-line interpolation, so timing is finer than one 33 ms frame.
 *
 * Still an ESTIMATE: camera noise adds timing error, which pushes RMSSD UP.
 * Always show it with lower confidence than a chest strap or finger sensor.
 *
 * @param rawPulse  POS output BEFORE band-pass filtering
 * @param bpm       heart rate from estimateHeartRate (centres the filter)
 */
export function estimateHrv(rawPulse, fs = CONFIG.FS, bpm = NaN) {
  const result = { rmssdMs: NaN, sdnnMs: NaN, meanIbiMs: NaN, beats: 0, cleanBeats: 0, usable: false, beatTimesS: [] };
  if (rawPulse.length < 3 * fs || !Number.isFinite(bpm) || bpm <= 0) return result;
  const f = bpm / 60;
  const x = bandpass(
    rawPulse,
    fs,
    Math.max(CONFIG.BAND_LOW_HZ * 0.8, CONFIG.HRV_BAND_LOW_FACTOR * f),
    Math.min(CONFIG.BAND_HIGH_HZ, CONFIG.HRV_BAND_HIGH_FACTOR * f),
  );
  const minDistanceS = 0.6 / f;
  const times = [];
  for (let i = 1; i < x.length; i++) {
    if (x[i - 1] < 0 && x[i] >= 0) {
      const t = (i - 1 + -x[i - 1] / (x[i] - x[i - 1])) / fs;
      if (times.length === 0 || t - times[times.length - 1] >= minDistanceS) times.push(t);
    }
  }
  result.beatTimesS = times;
  result.beats = times.length;
  if (times.length < 3) return result;

  const ibis = [];
  for (let i = 1; i < times.length; i++) ibis.push(times[i] - times[i - 1]);
  const med = median(ibis);
  const ok = ibis.map(
    (v) => v >= CONFIG.IBI_MIN_S && v <= CONFIG.IBI_MAX_S && Math.abs(v - med) <= CONFIG.IBI_MAX_DEVIATION * med,
  );
  const clean = ibis.filter((_, i) => ok[i]);
  // RMSSD only uses pairs of neighbouring intervals that are BOTH clean.
  let sumSq = 0, pairs = 0;
  for (let i = 1; i < ibis.length; i++) {
    if (ok[i] && ok[i - 1]) {
      const d = (ibis[i] - ibis[i - 1]) * 1000;
      sumSq += d * d;
      pairs++;
    }
  }
  result.cleanBeats = clean.length;
  if (clean.length > 0) {
    result.meanIbiMs = mean(clean) * 1000;
    result.sdnnMs = std(clean) * 1000;
  }
  if (pairs > 0) result.rmssdMs = Math.sqrt(sumSq / pairs);
  result.usable = clean.length >= CONFIG.HRV_MIN_BEATS && pairs >= CONFIG.HRV_MIN_BEATS - 2;
  return result;
}

// ----------------------------------------------------------------------------
// 6. Signal quality 0-1
// ----------------------------------------------------------------------------
/**
 * Combine the four quality parts into one 0-1 score plus plain-language reasons.
 * @param {{snrFraction:number, hrSpreadBpm:number, motion:number, faceRatio:number, luma:number, clipped:number}} m
 *   snrFraction  share of in-band power at the heart-rate peak (0-1)
 *   hrSpreadBpm  how much the per-second heart-rate readings jump around (bpm)
 *   motion       face movement in face-widths per second
 *   faceRatio    share of frames with a face (0-1)
 *   gapShare     share of the check with no usable frames (dropped frames, 0-1)
 *   luma         mean skin brightness (0-255)
 *   clipped      share of skin pixels that are pure black or blown-out white (0-1)
 */
export function computeQuality(m) {
  const sharpness = scoreBetween(m.snrFraction, CONFIG.SNR_FRACTION_BAD, CONFIG.SNR_FRACTION_GOOD);
  const stability = scoreBetween(m.hrSpreadBpm ?? 0, CONFIG.HR_SPREAD_BAD, CONFIG.HR_SPREAD_GOOD);
  const snr = Math.min(sharpness, stability); // the pulse must be both sharp and steady
  const motion = scoreBetween(m.motion, CONFIG.MOTION_BAD, CONFIG.MOTION_GOOD);
  // Coverage: a face must be found AND frames must keep arriving.
  const coverage = 1 - (m.gapShare ?? 0);
  const face = scoreBetween(Math.min(m.faceRatio, coverage), CONFIG.FACE_RATIO_BAD, CONFIG.FACE_RATIO_GOOD);
  const framesDropped = coverage < m.faceRatio; // the camera, not the face, is the weak link
  const dark = scoreBetween(m.luma, CONFIG.LUMA_TOO_DARK, CONFIG.LUMA_DARK_OK);
  const bright = scoreBetween(m.luma, CONFIG.LUMA_TOO_BRIGHT, CONFIG.LUMA_BRIGHT_OK);
  const clip = scoreBetween(m.clipped, CONFIG.CLIPPED_BAD, CONFIG.CLIPPED_OK);
  const light = Math.min(dark, bright, clip);

  let score = CONFIG.W_SNR * snr + CONFIG.W_MOTION * motion + CONFIG.W_FACE * face + CONFIG.W_LIGHT * light;
  const gated =
    face < CONFIG.GATE_FACE || motion < CONFIG.GATE_MOTION || snr < CONFIG.GATE_SNR || light < CONFIG.GATE_LIGHT;
  if (gated) score = Math.min(score, CONFIG.GATED_MAX);

  // Reasons, worst first, in words a tired crew member can act on.
  const reasons = [];
  if (face < 0.6) {
    reasons.push({
      part: "face",
      score: face,
      text: framesDropped
        ? "Camera frames were dropped. Keep this window in front and close other apps."
        : "Face not fully visible. Uncover your face and look at the camera.",
    });
  }
  if (motion < 0.6) reasons.push({ part: "motion", score: motion, text: "Too much movement. Hold still." });
  if (light < 0.6) {
    reasons.push({
      part: "light",
      score: light,
      text: dark < bright ? "Too dark. Face the light." : "Too bright. Avoid direct glare.",
    });
  }
  if (snr < 0.6) reasons.push({ part: "snr", score: snr, text: "Pulse signal is weak. Hold still, face the light." });
  reasons.sort((a, b) => a.score - b.score);

  return {
    score: clamp01(score),
    retry: score < CONFIG.RETRY_BELOW,
    parts: { snr, motion, face, light },
    reasons,
  };
}

export function qualityLabel(score) {
  if (score >= 0.75) return "Good";
  if (score >= CONFIG.RETRY_BELOW) return "Fair";
  return "Poor";
}

// ----------------------------------------------------------------------------
// 7. Whole pipeline
// ----------------------------------------------------------------------------
/** RGB trace -> clean pulse signal on a steady grid. */
export function extractPulse(trace, fs = CONFIG.FS) {
  const rs = resampleTrace(trace, fs);
  const raw = posPulse(rs.r, rs.g, rs.b, fs);
  const pulse = rs.r.length >= 8 ? bandpass(raw, fs) : raw;
  return { pulse, raw, fs, t0: rs.t0, valid: rs.valid };
}

/**
 * Analyse a whole camera check.
 * @param trace    {t,r,g,b} arrays, one entry per frame WITH a face, t in seconds
 * @param context  {motion, faceRatio, luma, clipped} measured by the camera code
 * @returns heart rate (median of the per-second readings), rough HRV, quality
 */
export function analyseSession(trace, context = {}, fs = CONFIG.FS) {
  const { pulse, raw, valid } = extractPulse(trace, fs);
  const windowN = Math.round(CONFIG.HR_WINDOW_S * fs);
  const minN = Math.round(CONFIG.HR_MIN_WINDOW_S * fs);
  const readings = [];
  // One reading per second, each from the 10 s before it (as the live view does).
  for (let end = minN; end <= pulse.length; end += fs) {
    const start = Math.max(0, end - windowN);
    const hr = estimateHeartRate(pulse.subarray(start, end), fs);
    if (Number.isFinite(hr.bpm)) readings.push({ tS: end / fs, ...hr });
  }
  const bpm = median(readings.map((x) => x.bpm));
  const snrFraction = readings.length ? median(readings.map((x) => x.snrFraction)) : 0;
  const hrSpreadBpm = readings.length ? median(readings.map((x) => Math.abs(x.bpm - bpm))) : Infinity;
  const gapShare = valid.length ? 1 - mean(valid) : 1;
  const hrv = estimateHrv(raw, fs, bpm);
  const badLight = (context.clipped ?? 0) >= CONFIG.CLIPPED_BAD;
  const quality = computeQuality({
    snrFraction,
    hrSpreadBpm,
    motion: context.motion ?? 0,
    faceRatio: context.faceRatio ?? 1,
    // Long holes in the frames lower the score too, unless bad light was the
    // reason the frames were unusable (then the light part reports it).
    gapShare: badLight ? 0 : gapShare,
    luma: context.luma ?? 128,
    clipped: context.clipped ?? 0,
  });
  // HRV is only shown when the whole check is trustworthy AND the pulse is very clean.
  const hrvUsable = hrv.usable && !quality.retry && snrFraction >= CONFIG.HRV_MIN_SNR_FRACTION;
  return {
    hrBpm: Number.isFinite(bpm) ? Math.round(bpm * 10) / 10 : null,
    rmssdMs: hrvUsable ? Math.round(hrv.rmssdMs * 10) / 10 : null,
    hrvConfidence: "low", // camera HRV is always an estimate
    signalQuality: Math.round(quality.score * 100) / 100,
    qualityLabel: qualityLabel(quality.score),
    retry: quality.retry,
    reasons: quality.reasons.map((x) => x.text),
    qualityParts: quality.parts,
    snrFraction,
    hrSpreadBpm,
    rmssdRawMs: hrv.rmssdMs, // before the usability checks, for debugging
    beats: hrv.beats,
    readings,
    pulse,
    durationS: pulse.length / fs,
  };
}
