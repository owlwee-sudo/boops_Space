// Tests for the facial-behaviour maths (H2). Run:  node --test hard/face/test_face_core.mjs
// All inputs are SIMULATED blendshape series.
import test from "node:test";
import assert from "node:assert/strict";
import {
  FACE_CONFIG, FEATURE_NAMES, baselineStats, blendFaceIntoStress, changeLevel, countBlinks, createFaceSession, facialChange,
} from "../../web/camera/face-behaviour-core.js";

const POSE = { cx: 320, cy: 240, size: 150, ax: 1, ay: 0, bx: 0, by: 1 };
const SIZE = { width: 640, height: 480 };

/** A 30 s session at 30 fps with a blink every `blinkEveryS` seconds. */
function runSession({ blinkEveryS = 4, brow = 0.1, mouthWobble = 0, seconds = 30 } = {}) {
  const session = createFaceSession();
  for (let k = 0; k < seconds * 30; k++) {
    const tS = k / 30;
    const inBlink = tS % blinkEveryS < 0.2 && tS > 0.5;
    const landmarks = [];
    const put = (i, x, y) => (landmarks[i] = { x: x / 640, y: y / 480 });
    put(61, 290 + mouthWobble * Math.sin(tS * 3), 340);
    put(291, 350 - mouthWobble * Math.sin(tS * 3), 340);
    put(13, 320, 335);
    put(14, 320, 345 + mouthWobble * Math.sin(tS * 5));
    session.addFrame({
      tS,
      blendshapes: [
        { categoryName: "eyeBlinkLeft", score: inBlink ? 0.9 : 0.05 },
        { categoryName: "eyeBlinkRight", score: inBlink ? 0.85 : 0.05 },
        { categoryName: "browDownLeft", score: brow },
        { categoryName: "browDownRight", score: brow },
      ],
      landmarks,
      pose: POSE,
      frameSize: SIZE,
    });
  }
  return session.finish();
}

test("blinks are counted once each", () => {
  const t = [], b = [];
  for (let k = 0; k < 300; k++) {
    t.push(k / 30);
    b.push(k % 100 < 6 ? 0.9 : 0.05); // 3 blinks of 0.2 s
  }
  assert.equal(countBlinks(t, b), 3);
  // A half-closed flicker below the threshold is not a blink.
  assert.equal(countBlinks(t, b.map((v) => (v > 0.5 ? 0.45 : v))), 0);
});

test("a session gives the five features with sensible values", () => {
  const f = runSession({ blinkEveryS: 4, brow: 0.1 });
  assert.deepEqual(Object.keys(f), FEATURE_NAMES);
  assert.ok(Math.abs(f.blink_rate_per_min - 15) <= 2.5, `blink rate ${f.blink_rate_per_min}`);
  assert.ok(f.eye_openness > 0.85 && f.eye_openness < 1);
  assert.ok(Math.abs(f.brow_lowering - 0.1) < 1e-6);
  assert.equal(f.expressivity, 0); // nothing moved
  assert.equal(f.head_motion, 0);
  // A moving mouth raises expressivity only.
  const g = runSession({ mouthWobble: 6 });
  assert.ok(g.expressivity > 0.5);
  assert.equal(g.head_motion, 0);
});

test("too few frames gives no features", () => {
  assert.equal(runSession({ seconds: 3 }), null);
});

test("baseline needs 14 sessions, then change is scored against it", () => {
  const sessions = [];
  for (let i = 0; i < 13; i++) sessions.push({ features: runSession({ blinkEveryS: 4 + (i % 3) * 0.3, brow: 0.1 + (i % 4) * 0.01 }) });
  assert.equal(baselineStats(sessions).ready, false);
  assert.equal(facialChange(sessions[0].features, baselineStats(sessions)).z, null);
  sessions.push({ features: runSession({ blinkEveryS: 4.2, brow: 0.11 }) });
  const base = baselineStats(sessions);
  assert.equal(base.ready, true);
  // A session like the baseline scores "low"...
  const same = facialChange(runSession({ blinkEveryS: 4.1, brow: 0.11 }), base);
  assert.equal(same.level, "low");
  // ...a very different one (twice the blinking, tense brows, moving face) scores "high".
  const different = facialChange(runSession({ blinkEveryS: 1.5, brow: 0.45, mouthWobble: 8 }), base);
  assert.equal(different.level, "high");
  assert.ok(different.z > same.z);
  // Later sessions never change the baseline: it is the FIRST 14.
  sessions.push({ features: runSession({ blinkEveryS: 1.5, brow: 0.45 }) });
  assert.deepEqual(baselineStats(sessions).stats, base.stats);
});

test("levels use plain words only", () => {
  assert.equal(changeLevel(0.8), "low");
  assert.equal(changeLevel(1.5), "medium");
  assert.equal(changeLevel(2.4), "high");
  assert.equal(changeLevel(null), null);
});

test("stress score changes only when opted in, weighted, good quality", () => {
  const input = { facialChangeZ: 3, optedIn: true, signalQuality: 0.9, weight: 0.15 };
  assert.equal(blendFaceIntoStress(40, input), Math.round(0.85 * 40 + 0.15 * 100));
  assert.equal(blendFaceIntoStress(40, { ...input, optedIn: false }), 40); // not opted in
  assert.equal(blendFaceIntoStress(40, { ...input, weight: 0 }), 40); // weight off
  assert.equal(blendFaceIntoStress(40, { ...input, weight: undefined }), 40); // default weight is 0
  assert.equal(blendFaceIntoStress(40, { ...input, signalQuality: 0.3 }), 40); // poor check
  assert.equal(blendFaceIntoStress(40, { ...input, facialChangeZ: null }), 40); // no baseline yet
  // The weight is capped at 0.15 whatever is passed in.
  assert.equal(blendFaceIntoStress(40, { ...input, weight: 0.9 }), blendFaceIntoStress(40, input));
  assert.equal(FACE_CONFIG.FACE_WEIGHT, 0);
});
