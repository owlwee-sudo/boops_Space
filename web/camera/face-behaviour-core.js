// face-behaviour-core.js: facial-behaviour CHANGE features (H2).
//
// What this is: a few simple, physical measurements of the face during the
// 30-second camera check (blinks, eye openness, brow lowering, how much the
// face moves), compared with the SAME PERSON's own earlier checks.
//
// What this is NOT: emotion recognition. Facial movements are not reliable
// signs of emotion (Barrett et al. 2019), so this code never outputs words
// like "angry" or "sad", only "change vs your baseline: low / medium / high".
// Micro-expressions are not used.
//
// Opt-in, on-device, numbers only. Pure maths: no DOM, runs in Node for tests.
// Prototype. Not a medical device.

// ----------------------------------------------------------------------------
// Config
// ----------------------------------------------------------------------------
export const FACE_CONFIG = {
  BASELINE_SESSIONS: 14, // the first 14 checks define "your normal"
  MIN_FRAMES: 150, // about 5 s of face frames, or the session is not used
  BLINK_ON: 0.5, // eye-blink blendshape above this = eyes closed
  BLINK_OFF: 0.3, // ...and below this = open again
  BLINK_MIN_GAP_S: 0.15,
  // Level of "change vs your baseline" from the mean |z| over the features.
  // A normal session scores about 0.8 (that is what random variation gives).
  LEVEL_MEDIUM: 1.3,
  LEVEL_HIGH: 2.0,
  Z_CAP: 4, // one wild feature cannot dominate
  // Smallest SD used for a z-score, per feature, so a very steady baseline
  // does not turn tiny changes into huge z-scores.
  SD_FLOOR: { blink_rate_per_min: 2, eye_openness: 0.03, brow_lowering: 0.02, expressivity: 0.15, head_motion: 0.02 },
  // Stress-score hook. 0 = off. The engine may raise it only after opt-in,
  // and never above FACE_WEIGHT_MAX.
  FACE_WEIGHT: 0,
  FACE_WEIGHT_MAX: 0.15,
  MIN_SIGNAL_QUALITY: 0.5, // low-quality check -> facial input ignored
};

export const FEATURE_NAMES = ["blink_rate_per_min", "eye_openness", "brow_lowering", "expressivity", "head_motion"];

// Landmarks whose movement counts as "the face changing shape": brows, mouth
// corners, lips, chin (MediaPipe face-mesh numbers).
const SHAPE_LANDMARKS = [105, 334, 107, 336, 61, 291, 13, 14, 152];

// ----------------------------------------------------------------------------
// One camera check
// ----------------------------------------------------------------------------
/** Collects per-frame values during a check and turns them into 5 features. */
export function createFaceSession() {
  const frames = { t: [], blink: [], brow: [], shape: [] };
  let motionSum = 0;
  let motionCount = 0;
  let prev = null;

  return {
    /**
     * @param tS           time in seconds
     * @param blendshapes  MediaPipe categories [{categoryName, score}] (or a {name: score} map)
     * @param landmarks    MediaPipe landmarks (normalised x, y)
     * @param pose         from facePose(): {cx, cy, size, ax, ay, bx, by} in pixels
     * @param frameSize    {width, height} of the video frame
     */
    addFrame({ tS, blendshapes, landmarks, pose, frameSize }) {
      const b = toMap(blendshapes);
      if (!b) return;
      frames.t.push(tS);
      frames.blink.push(((b.eyeBlinkLeft ?? 0) + (b.eyeBlinkRight ?? 0)) / 2);
      frames.brow.push(((b.browDownLeft ?? 0) + (b.browDownRight ?? 0)) / 2);
      // Landmark positions in "face coordinates" (centre between the eyes,
      // eye-width = 1), so moving the whole head does not count as expression.
      if (landmarks && pose && frameSize) {
        const row = [];
        for (const i of SHAPE_LANDMARKS) {
          const p = landmarks[i];
          if (!p) continue;
          const dx = p.x * frameSize.width - pose.cx;
          const dy = p.y * frameSize.height - pose.cy;
          row.push((dx * pose.ax + dy * pose.ay) / pose.size, (dx * pose.bx + dy * pose.by) / pose.size);
        }
        frames.shape.push(row);
        if (prev && tS > prev.tS && tS - prev.tS < 0.5) {
          const shift = Math.hypot(pose.cx - prev.cx, pose.cy - prev.cy) / pose.size;
          motionSum += shift / (tS - prev.tS);
          motionCount++;
        }
        prev = { cx: pose.cx, cy: pose.cy, tS };
      }
    },
    frameCount() {
      return frames.t.length;
    },
    /** @returns the 5 features, or null if there were too few frames */
    finish() {
      const n = frames.t.length;
      if (n < FACE_CONFIG.MIN_FRAMES) return null;
      const durationS = frames.t[n - 1] - frames.t[0];
      if (!(durationS > 0)) return null;
      return {
        blink_rate_per_min: round((countBlinks(frames.t, frames.blink) / durationS) * 60, 1),
        eye_openness: round(1 - mean(frames.blink), 3),
        brow_lowering: round(mean(frames.brow), 3),
        expressivity: round(100 * shapeVariation(frames.shape), 3),
        head_motion: round(motionCount ? motionSum / motionCount : 0, 3),
      };
    },
  };
}

function toMap(blendshapes) {
  if (!blendshapes) return null;
  if (!Array.isArray(blendshapes)) return blendshapes;
  const map = {};
  for (const c of blendshapes) map[c.categoryName] = c.score;
  return map;
}

/** Count closed-then-open events in the eye-blink signal. */
export function countBlinks(t, blink) {
  let count = 0;
  let closed = false;
  let lastBlinkT = -Infinity;
  for (let i = 0; i < blink.length; i++) {
    if (!closed && blink[i] >= FACE_CONFIG.BLINK_ON) {
      closed = true;
      if (t[i] - lastBlinkT >= FACE_CONFIG.BLINK_MIN_GAP_S) {
        count++;
        lastBlinkT = t[i];
      }
    } else if (closed && blink[i] <= FACE_CONFIG.BLINK_OFF) {
      closed = false;
    }
  }
  return count;
}

/** Average spread (SD over time) of the face-shape landmarks, in eye-widths. */
function shapeVariation(rows) {
  if (rows.length < 2 || rows[0].length === 0) return 0;
  const k = rows[0].length;
  let total = 0;
  for (let j = 0; j < k; j++) {
    let s = 0, s2 = 0, n = 0;
    for (const row of rows) {
      if (row.length !== k) continue;
      s += row[j];
      s2 += row[j] * row[j];
      n++;
    }
    if (n > 1) total += Math.sqrt(Math.max(0, s2 / n - (s / n) ** 2));
  }
  return total / k;
}

// ----------------------------------------------------------------------------
// Baseline and change score
// ----------------------------------------------------------------------------
/**
 * Mean and SD of each feature over the person's FIRST 14 sessions.
 * @param sessions  list of {features}, oldest first
 * @returns {{ready:boolean, count:number, stats?:{[name]:{mean,sd}}}}
 */
export function baselineStats(sessions) {
  const base = sessions.slice(0, FACE_CONFIG.BASELINE_SESSIONS);
  if (base.length < FACE_CONFIG.BASELINE_SESSIONS) return { ready: false, count: base.length };
  const stats = {};
  for (const name of FEATURE_NAMES) {
    const values = base.map((s) => s.features[name]);
    const m = mean(values);
    const sd = Math.sqrt(mean(values.map((v) => (v - m) ** 2)));
    stats[name] = { mean: m, sd: Math.max(sd, FACE_CONFIG.SD_FLOOR[name]) };
  }
  return { ready: true, count: base.length, stats };
}

/**
 * facial_change_z = mean |z| across the features: "how different is the face
 * behaviour today from this person's own normal", with no direction and no
 * emotion meaning.
 */
export function facialChange(features, baseline) {
  if (!baseline.ready) return { z: null, level: null, perFeature: null };
  const perFeature = {};
  let total = 0;
  for (const name of FEATURE_NAMES) {
    const { mean: m, sd } = baseline.stats[name];
    const z = Math.max(-FACE_CONFIG.Z_CAP, Math.min(FACE_CONFIG.Z_CAP, (features[name] - m) / sd));
    perFeature[name] = round(z, 2);
    total += Math.abs(z);
  }
  const z = round(total / FEATURE_NAMES.length, 2);
  return { z, level: changeLevel(z), perFeature };
}

export function changeLevel(z) {
  if (z === null || !Number.isFinite(z)) return null;
  if (z >= FACE_CONFIG.LEVEL_HIGH) return "high";
  if (z >= FACE_CONFIG.LEVEL_MEDIUM) return "medium";
  return "low";
}

// ----------------------------------------------------------------------------
// INTEGRATION HOOK: optional, low-weight input to the stress score
// ----------------------------------------------------------------------------
/**
 * Blend facial change into a 0-100 stress score. Returns the score UNCHANGED
 * unless the user opted in, the weight is above 0, the baseline exists and the
 * camera check was good quality. The weight can never exceed 0.15.
 */
export function blendFaceIntoStress(stressScore, { facialChangeZ, optedIn, signalQuality, weight = FACE_CONFIG.FACE_WEIGHT } = {}) {
  const w = Math.min(Math.max(weight || 0, 0), FACE_CONFIG.FACE_WEIGHT_MAX);
  const usable =
    optedIn === true && w > 0 && Number.isFinite(facialChangeZ) && Number.isFinite(signalQuality) && signalQuality >= FACE_CONFIG.MIN_SIGNAL_QUALITY;
  if (!usable) return stressScore;
  // 0.8 = an ordinary session, 3 or more = very different from normal.
  const faceScore = 100 * Math.min(1, Math.max(0, (facialChangeZ - 0.8) / (3 - 0.8)));
  return Math.round((1 - w) * stressScore + w * faceScore);
}

function mean(a) {
  if (a.length === 0) return 0;
  let s = 0;
  for (const v of a) s += v;
  return s / a.length;
}

function round(x, d) {
  const k = 10 ** d;
  return Math.round(x * k) / k;
}
