// Tests for the camera heart-rate maths. Run:  node --test hard/rppg/test_rppg_core.mjs
// All inputs are SIMULATED traces with a known answer (see synthetic.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import {
  CONFIG, analyseSession, bandpass, computeQuality, estimateHeartRate, fft, posPulse, resampleTrace, std,
} from "../../web/camera/rppg-core.js";
import { makeTrace } from "./synthetic.mjs";

const STILL = { motion: 0.05, faceRatio: 1, luma: 130, clipped: 0 };

test("fft finds a known sine wave", () => {
  const n = 256;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = Math.sin((2 * Math.PI * 10 * i) / n);
  fft(re, im);
  const mag = Array.from(re, (v, i) => Math.hypot(v, im[i]));
  const peak = mag.indexOf(Math.max(...mag.slice(0, n / 2)));
  assert.equal(peak, 10);
  assert.ok(Math.abs(mag[10] - n / 2) < 1e-6);
});

test("band-pass keeps 1.2 Hz and removes 0.1 Hz drift and 6 Hz noise", () => {
  const fs = 30;
  const make = (hz) => Float64Array.from({ length: 600 }, (_, i) => Math.sin((2 * Math.PI * hz * i) / fs));
  const kept = std(bandpass(make(1.2), fs)) / std(make(1.2));
  const drift = std(bandpass(make(0.1), fs)) / std(make(0.1));
  const fast = std(bandpass(make(6), fs)) / std(make(6));
  assert.ok(kept > 0.85, `kept ${kept}`);
  assert.ok(drift < 0.05, `drift ${drift}`);
  assert.ok(fast < 0.1, `fast ${fast}`);
});

test("resampling gives a steady 30 Hz grid and marks long gaps", () => {
  const t = [0, 0.03, 0.07, 0.1, 1.0, 1.03]; // 0.9 s hole in the middle
  const rs = resampleTrace({ t, r: t.map(() => 100), g: t.map(() => 100), b: t.map(() => 100) });
  assert.equal(rs.r.length, Math.floor(1.03 * 30) + 1);
  assert.equal(rs.valid[1], 1);
  assert.equal(rs.valid[15], 0); // inside the hole
});

test("heart rate is within 2 bpm from 48 to 170 bpm", () => {
  for (const bpm of [48, 60, 72, 90, 110, 140, 170]) {
    const { trace, truth } = makeTrace({ bpm, rmssdMs: 30, seed: bpm });
    const res = analyseSession(trace, STILL);
    assert.ok(Math.abs(res.hrBpm - truth.bpm) <= 2, `${bpm} bpm: got ${res.hrBpm}, true ${truth.bpm}`);
    assert.equal(res.retry, false);
    assert.ok(res.signalQuality >= 0.75);
  }
});

test("heart rate survives a slow camera, jitter and a weak pulse", () => {
  const cases = [
    { bpm: 72, fps: 15, seed: 13 },
    { bpm: 72, fps: 24, jitterMs: 10, seed: 14 },
    { bpm: 72, pulseAmp: 0.0015, seed: 9 },
    { bpm: 72, noise: 0.6, seed: 7 },
  ];
  for (const c of cases) {
    const { trace, truth } = makeTrace(c);
    const res = analyseSession(trace, STILL);
    assert.ok(Math.abs(res.hrBpm - truth.bpm) <= 2, `${JSON.stringify(c)}: got ${res.hrBpm}`);
  }
});

test("POS ignores brightness flicker that hits all colours equally", () => {
  // 10 % lamp flicker at 2 Hz (120 bpm) is 20x larger than the pulse.
  const { trace, truth } = makeTrace({ bpm: 72, flickerAmp: 0.1, flickerHz: 2.0, seed: 11 });
  const res = analyseSession(trace, STILL);
  assert.ok(Math.abs(res.hrBpm - truth.bpm) <= 2, `got ${res.hrBpm}`);
  // The green channel alone would be fooled: its strongest rhythm is the flicker.
  const rs = resampleTrace(trace);
  const green = estimateHeartRate(bandpass(rs.g), 30);
  assert.ok(Math.abs(green.bpm - 120) < 3, `green-only read ${green.bpm}`);
});

test("noise with no pulse always asks for a retry", () => {
  for (let seed = 1; seed <= 30; seed++) {
    const { trace } = makeTrace({ pulseAmp: 0, seed });
    const res = analyseSession(trace, STILL);
    assert.equal(res.retry, true, `seed ${seed}: quality ${res.signalQuality}`);
    assert.ok(res.signalQuality < CONFIG.RETRY_BELOW);
    assert.equal(res.rmssdMs, null);
  }
});

test("head shaking or a covered face forces a retry even with a clean pulse", () => {
  const { trace } = makeTrace({ bpm: 72, seed: 3 });
  const shaking = analyseSession(trace, { ...STILL, motion: 0.8 });
  assert.equal(shaking.retry, true);
  assert.match(shaking.reasons.join(" "), /Hold still/);
  const covered = analyseSession(trace, { ...STILL, faceRatio: 0.6 });
  assert.equal(covered.retry, true);
  assert.match(covered.reasons.join(" "), /Face not fully visible/);
  const dark = analyseSession(trace, { ...STILL, luma: 30 });
  assert.equal(dark.retry, true);
  assert.match(dark.reasons.join(" "), /Too dark/);
  const fine = analyseSession(trace, STILL);
  assert.equal(fine.retry, false);
});

test("dropped camera frames force a retry with the right reason", () => {
  // Keep only 1 s of frames out of every 2 s: the face is always found, but
  // half of the check has no data.
  const { trace } = makeTrace({ bpm: 72, seed: 5 });
  const keep = trace.t.map((t) => Math.floor(t) % 2 === 0);
  const holed = { t: [], r: [], g: [], b: [] };
  trace.t.forEach((_, i) => {
    if (keep[i]) for (const k of ["t", "r", "g", "b"]) holed[k].push(trace[k][i]);
  });
  const res = analyseSession(holed, STILL);
  assert.equal(res.retry, true);
  assert.match(res.reasons.join(" "), /frames were dropped/);
});

test("quality score stays inside 0-1 and is capped when one part fails", () => {
  const q = computeQuality({ snrFraction: 0.9, hrSpreadBpm: 0.5, motion: 0.02, faceRatio: 1, luma: 130, clipped: 0 });
  assert.ok(q.score > 0.999 && q.score <= 1);
  const gated = computeQuality({ snrFraction: 0.9, hrSpreadBpm: 0.5, motion: 0.02, faceRatio: 0.5, luma: 130, clipped: 0 });
  assert.ok(gated.score <= CONFIG.GATED_MAX);
});

test("rough HRV: shown only for a very clean pulse, and in the right range", () => {
  // Very clean signal: estimate should land near the planted value.
  const errors = [];
  for (let seed = 1; seed <= 12; seed++) {
    const { trace, truth } = makeTrace({ bpm: 66, rmssdMs: 35, noise: 0.04, seed });
    const res = analyseSession(trace, STILL);
    assert.notEqual(res.rmssdMs, null, `seed ${seed} gave no RMSSD`);
    assert.equal(res.hrvConfidence, "low");
    errors.push(res.rmssdMs - truth.rmssdMs);
  }
  const meanAbs = errors.reduce((a, b) => a + Math.abs(b), 0) / errors.length;
  assert.ok(meanAbs < 15, `mean abs RMSSD error ${meanAbs.toFixed(1)} ms`);
  // Noisy but usable pulse: heart rate is shown, RMSSD is withheld.
  const noisy = analyseSession(makeTrace({ bpm: 72, noise: 0.6, seed: 7 }).trace, STILL);
  assert.equal(noisy.retry, false);
  assert.equal(noisy.rmssdMs, null);
});

test("POS output is zero for a constant colour", () => {
  const flat = new Float64Array(200).fill(120);
  const out = posPulse(flat, flat, flat, 30);
  assert.ok(Math.max(...out.map(Math.abs)) < 1e-12);
});
