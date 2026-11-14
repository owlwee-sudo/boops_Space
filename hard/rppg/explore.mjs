// explore.mjs: print how the rPPG core behaves on simulated traces.
// Run:  node hard/rppg/explore.mjs
// Used to pick the thresholds in web/camera/rppg-core.js and to fill the
// "simulated signal" table in hard/VALIDATION.md.
import { analyseSession } from "../../web/camera/rppg-core.js";
import { makeTrace } from "./synthetic.mjs";

const still = { motion: 0.05, faceRatio: 1, luma: 130, clipped: 0 };
const fmt = (x, d = 1) => (x === null || !Number.isFinite(x) ? "  -  " : x.toFixed(d).padStart(5));

function row(label, opts, ctx = still) {
  const { trace, truth } = makeTrace(opts);
  const res = analyseSession(trace, ctx);
  console.log(
    `${label.padEnd(34)} true ${fmt(truth.bpm)}  est ${fmt(res.hrBpm)}  err ${fmt(res.hrBpm - truth.bpm)}` +
      `  rmssd true ${fmt(truth.rmssdMs)} est ${fmt(res.rmssdMs)} raw ${fmt(res.rmssdRawMs)}  snrFrac ${fmt(res.snrFraction, 2)}  q ${fmt(res.signalQuality, 2)} ${res.retry ? "RETRY" : "ok"}`,
  );
  return { truth, res };
}

console.log("--- heart rates, normal noise ---");
for (const bpm of [48, 60, 72, 90, 110, 140, 170]) row(`bpm ${bpm}`, { bpm, rmssdMs: 30, seed: bpm });
console.log("--- noise level (pulse 0.6 %) ---");
for (const noise of [0.05, 0.15, 0.3, 0.6, 1.0, 2.0]) row(`noise ${noise}`, { bpm: 72, noise, rmssdMs: 30, seed: 7 });
console.log("--- pulse size (noise 0.15) ---");
for (const pulseAmp of [0.01, 0.006, 0.003, 0.0015, 0.0008, 0]) row(`pulseAmp ${pulseAmp}`, { bpm: 72, pulseAmp, rmssdMs: 30, seed: 9 });
console.log("--- lamp flicker / brightness wobble at 2 Hz ---");
for (const flickerAmp of [0, 0.01, 0.03, 0.1]) row(`flicker ${flickerAmp}`, { bpm: 72, flickerAmp, rmssdMs: 30, seed: 11 });
console.log("--- frame rate and jitter ---");
row("15 fps", { bpm: 72, fps: 15, rmssdMs: 30, seed: 13 });
row("24 fps, 10 ms jitter", { bpm: 72, fps: 24, jitterMs: 10, rmssdMs: 30, seed: 14 });
console.log("--- planted HRV (noise 0.1) ---");
for (const rmssdMs of [0, 15, 30, 50, 80]) row(`rmssd ${rmssdMs}`, { bpm: 66, rmssdMs, noise: 0.1, seed: 20 + rmssdMs });
console.log("--- noise only, 20 seeds: snrFraction and quality ---");
const fr = [];
let retries = 0;
for (let seed = 1; seed <= 20; seed++) {
  const { trace } = makeTrace({ pulseAmp: 0, seed });
  const res = analyseSession(trace, still);
  fr.push(res.snrFraction);
  if (res.retry) retries++;
}
console.log(`snrFraction min ${Math.min(...fr).toFixed(2)} max ${Math.max(...fr).toFixed(2)}  retry asked ${retries}/20`);
