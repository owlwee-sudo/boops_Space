// synthetic.mjs: make a fake "mean skin colour per frame" trace with a known
// heart rate, so the rPPG maths can be tested without a camera.
//
// SIMULATED data. It checks the signal processing only. It says nothing about
// accuracy on real faces: that is what hard/VALIDATION.md is for.

/** Small seeded random generator so tests give the same numbers every run. */
export function makeRng(seed = 1) {
  let s = seed >>> 0;
  const uniform = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const normal = () => {
    const u = Math.max(uniform(), 1e-12);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * uniform());
  };
  return { uniform, normal };
}

/**
 * @param {object} o
 *   bpm            true mean heart rate
 *   durationS      length of the recording
 *   fps            camera frame rate
 *   jitterMs       random error on each frame time
 *   pulseAmp       pulse size as a share of skin brightness (real faces: ~0.002-0.01)
 *   noise          camera noise per frame, in 0-255 colour levels (after averaging the ROI)
 *   rmssdMs        beat-to-beat variation to plant (0 = metronome)
 *   flickerAmp     share of brightness wobble hitting all colours equally (lamp flicker, small motion)
 *   flickerHz      frequency of that wobble
 *   seed           random seed
 * @returns {{trace:{t:number[],r:number[],g:number[],b:number[]}, truth:{bpm:number, rmssdMs:number, beatTimes:number[]}}}
 */
export function makeTrace(o = {}) {
  const {
    bpm = 72, durationS = 30, fps = 30, jitterMs = 3, pulseAmp = 0.006, noise = 0.15,
    rmssdMs = 0, flickerAmp = 0, flickerHz = 2.0, seed = 1,
  } = o;
  const rng = makeRng(seed);
  // Beat times. Successive-difference SD of `rmssdMs` comes from independent
  // interval noise with SD = rmssd / sqrt(2).
  const meanIbi = 60 / bpm;
  const beatTimes = [];
  let tBeat = -2 * meanIbi + rng.uniform() * meanIbi;
  while (tBeat < durationS + 2 * meanIbi) {
    beatTimes.push(tBeat);
    tBeat += meanIbi + (rng.normal() * (rmssdMs / 1000)) / Math.SQRT2;
  }
  // Heart phase at time t: whole beats so far + the fraction of the current one.
  const phaseAt = (t) => {
    let i = 0;
    while (i < beatTimes.length - 2 && beatTimes[i + 1] <= t) i++;
    return i + (t - beatTimes[i]) / (beatTimes[i + 1] - beatTimes[i]);
  };
  // Typical skin colour and how strongly the pulse shows in each colour
  // (green strongest; values from Wang et al. 2017).
  const skin = [182, 128, 104];
  const pulseVec = [0.33, 0.77, 0.53];
  const trace = { t: [], r: [], g: [], b: [] };
  for (let k = 0; k < Math.floor(durationS * fps); k++) {
    const t = k / fps + (rng.normal() * jitterMs) / 1000;
    const ph = 2 * Math.PI * phaseAt(t);
    // A pulse wave is not a pure sine: add a small second harmonic.
    const wave = Math.cos(ph) + 0.25 * Math.cos(2 * ph + 0.6);
    const flicker = 1 + flickerAmp * Math.sin(2 * Math.PI * flickerHz * t);
    const c = skin.map((base, ch) => base * flicker * (1 - pulseAmp * pulseVec[ch] * wave) + rng.normal() * noise);
    trace.t.push(t);
    trace.r.push(c[0]);
    trace.g.push(c[1]);
    trace.b.push(c[2]);
  }
  // Keep frame times increasing even with jitter.
  for (let k = 1; k < trace.t.length; k++) if (trace.t[k] <= trace.t[k - 1]) trace.t[k] = trace.t[k - 1] + 1e-4;

  const inside = beatTimes.filter((t) => t >= 0 && t <= durationS);
  const ibis = inside.slice(1).map((t, i) => t - inside[i]);
  let sumSq = 0;
  for (let i = 1; i < ibis.length; i++) sumSq += ((ibis[i] - ibis[i - 1]) * 1000) ** 2;
  return {
    trace,
    truth: {
      bpm: ibis.length ? 60 / (ibis.reduce((a, b) => a + b, 0) / ibis.length) : bpm,
      rmssdMs: ibis.length > 1 ? Math.sqrt(sumSq / (ibis.length - 1)) : 0,
      beatTimes: inside,
    },
  };
}

/** A trace with no pulse at all: only camera noise. */
export function makeNoiseTrace(o = {}) {
  return makeTrace({ ...o, pulseAmp: 0 });
}
