// run_core.mjs: run the browser rPPG maths on a trace file from the command line.
//   node hard/rppg/run_core.mjs trace.json        analyse a trace ({t,r,g,b})
//   node hard/rppg/run_core.mjs --make 72 7       print a SIMULATED trace (bpm, seed)
// Used by tests/test_rppg_reference.py to compare JavaScript against Python.
import { readFileSync } from "node:fs";
import { analyseSession } from "../../web/camera/rppg-core.js";
import { makeTrace } from "./synthetic.mjs";

const [a, b, c] = process.argv.slice(2);
if (a === "--make") {
  const { trace, truth } = makeTrace({ bpm: Number(b) || 72, seed: Number(c) || 1, rmssdMs: 30 });
  console.log(JSON.stringify({ ...trace, truth_bpm: truth.bpm }));
} else {
  const trace = JSON.parse(readFileSync(a, "utf8"));
  const res = analyseSession(trace, { motion: 0.05, faceRatio: 1, luma: 130, clipped: 0 });
  console.log(JSON.stringify({ hr_bpm: res.hrBpm, snr_fraction: res.snrFraction, signal_quality: res.signalQuality, retry: res.retry }));
}
