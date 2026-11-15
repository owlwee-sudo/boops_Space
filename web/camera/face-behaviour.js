// face-behaviour.js: opt-in facial-behaviour change check (H2), browser side.
//
// Plugs into the 30-second camera check. OFF until the user agrees on the
// consent card. Measures simple facial behaviour, compares it with the same
// person's first 14 checks, and shows "change vs your baseline: low / medium /
// high". It never names an emotion. Numbers only, stored on this device.
//
// Prototype. Not a medical device.

import { registerPlugin } from "./camera-check.js";
import { currentAstronautId } from "./log-store.js";
import { FACE_CONFIG, baselineStats, createFaceSession, facialChange } from "./face-behaviour-core.js";

// ----------------------------------------------------------------------------
// Config
// ----------------------------------------------------------------------------
export const FACE_STORE = {
  OPT_IN_KEY: "ahm.face_optin", // "1" when the user has agreed
  SESSIONS_KEY: "ahm.face_sessions", // list of {astronaut_id, timestamp, features, signal_quality}
  SIM_SUFFIX: ".sim", // simulated checks are kept apart from real ones
  MAX_SESSIONS: 1000,
};

// ----------------------------------------------------------------------------
// Storage (this device only)
// ----------------------------------------------------------------------------
function storage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function isFaceOptedIn() {
  const s = storage();
  return Boolean(s && s.getItem(FACE_STORE.OPT_IN_KEY) === "1");
}

/** Settings hook: the Settings screen can call this to switch the feature. */
export function setFaceOptIn(on) {
  const s = storage();
  if (!s) return false;
  if (on) s.setItem(FACE_STORE.OPT_IN_KEY, "1");
  else s.removeItem(FACE_STORE.OPT_IN_KEY);
  render();
  return true;
}

function sessionsKey(simulated) {
  return FACE_STORE.SESSIONS_KEY + (simulated ? FACE_STORE.SIM_SUFFIX : "");
}

export function readFaceSessions(simulated = false, astronautId = currentAstronautId()) {
  const s = storage();
  if (!s) return [];
  try {
    const all = JSON.parse(s.getItem(sessionsKey(simulated)) || "[]");
    return Array.isArray(all) ? all.filter((x) => x.astronaut_id === astronautId) : [];
  } catch {
    return [];
  }
}

function appendFaceSession(entry, simulated) {
  const s = storage();
  if (!s) return;
  let all = [];
  try {
    all = JSON.parse(s.getItem(sessionsKey(simulated)) || "[]");
  } catch {
    all = [];
  }
  all.push(entry);
  s.setItem(sessionsKey(simulated), JSON.stringify(all.slice(-FACE_STORE.MAX_SESSIONS)));
}

export function deleteFaceData() {
  const s = storage();
  if (!s) return;
  s.removeItem(sessionsKey(false));
  s.removeItem(sessionsKey(true));
  render();
}

// ----------------------------------------------------------------------------
// Plug-in for the camera check
// ----------------------------------------------------------------------------
let session = null;
let lastOutcome = null; // what to show on the result card

registerPlugin({
  name: "face-behaviour",
  // Blendshapes are only requested from the face model after opt-in.
  wantsBlendshapes: () => isFaceOptedIn(),
  onStart() {
    session = isFaceOptedIn() ? createFaceSession() : null;
    lastOutcome = null;
    renderChip();
  },
  onFrame({ tS, face, pose, frameSize }) {
    if (session) session.addFrame({ tS, blendshapes: face.blendshapes, landmarks: face.landmarks, pose, frameSize });
  },
  /** Returns extra fields for the log entry, or null when there is nothing to add. */
  onFinish(result, { simulated } = {}) {
    if (!session) return null;
    const features = session.finish();
    session = null;
    // Low-quality check or too few frames: ignore the facial input completely.
    if (result.retry || result.signalQuality < FACE_CONFIG.MIN_SIGNAL_QUALITY || !features) {
      lastOutcome = { ignored: true };
      return null;
    }
    const astronautId = currentAstronautId();
    const earlier = readFaceSessions(simulated, astronautId);
    const baseline = baselineStats(earlier);
    const change = facialChange(features, baseline);
    appendFaceSession(
      { astronaut_id: astronautId, timestamp: new Date().toISOString(), features, signal_quality: result.signalQuality, facial_change_z: change.z },
      simulated,
    );
    lastOutcome = { change, baselineCount: Math.min(earlier.length + 1, FACE_CONFIG.BASELINE_SESSIONS), ready: baseline.ready };
    return {
      facial_change_z: change.z, // null while the baseline is still being built
      facial_change_level: change.level,
      facial_features: features,
      facial_baseline_sessions: lastOutcome.baselineCount,
    };
  },
  onResult() {
    renderChip();
    render();
  },
});

// ----------------------------------------------------------------------------
// UI: consent card + result chip
// ----------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);

// Friendly wording. It describes CHANGE only and never names a feeling.
const LEVEL_TEXT = {
  low: "Your face is moving like your usual self today.",
  medium: "A little different from your usual today.",
  high: "Quite different from your usual today. A good moment to check in with yourself.",
};

function renderChip() {
  const chip = $("face-chip");
  if (!chip) return;
  if (!isFaceOptedIn() || !lastOutcome || lastOutcome.ignored) {
    chip.hidden = true;
    return;
  }
  chip.hidden = false;
  const need = FACE_CONFIG.BASELINE_SESSIONS;
  if (lastOutcome.ready && lastOutcome.change.level) {
    const level = lastOutcome.change.level;
    chip.dataset.level = level;
    chip.setAttribute("aria-label", `Facial change vs your baseline: ${level}`);
    $("face-chip-text").textContent = LEVEL_TEXT[level];
  } else {
    const left = need - lastOutcome.baselineCount;
    chip.dataset.level = "building";
    chip.setAttribute("aria-label", `Facial baseline: ${lastOutcome.baselineCount} of ${need} checks done`);
    $("face-chip-text").textContent =
      left > 0
        ? `Still learning your usual: ${lastOutcome.baselineCount} of ${need} checks done. ${left} to go.`
        : "That was check 14. Your usual is now set, so the next check can compare against it.";
  }
}

function render() {
  const on = isFaceOptedIn();
  const state = $("face-state");
  if (!state) return;
  state.textContent = on ? "On" : "Off";
  state.dataset.level = on ? "good" : "fair";
  $("face-sub").textContent = on ? "On for this crew member." : "A little extra insight, only if you want it.";
  $("face-consent").hidden = on;
  $("face-settings").hidden = !on;
  if (!on) return;
  const simulated = new URLSearchParams(window.location.search).has("sim");
  const need = FACE_CONFIG.BASELINE_SESSIONS;
  const count = readFaceSessions(simulated).length;
  const done = Math.min(count, need);
  $("face-progress").textContent =
    count === 0
      ? `Thanks. Your next ${need} camera checks teach the app what is usual for you.`
      : count < need
        ? `Learning your usual: ${done} of ${need} checks done.`
        : "Your usual is set. Each new check is compared with it.";
  // One dot per baseline check, filled as they are done.
  const dots = $("face-dots");
  dots.replaceChildren();
  for (let i = 0; i < need; i++) {
    const dot = document.createElement("i");
    if (i < done) dot.className = "is-done";
    dots.append(dot);
  }
  dots.setAttribute("aria-label", `${done} of ${need} baseline checks done`);
}

if ($("face-on-btn")) {
  let deleteArmed = null; // two taps to delete, no pop-up
  const resetDelete = () => {
    clearTimeout(deleteArmed);
    deleteArmed = null;
    $("face-delete-btn").textContent = "Delete my face data";
  };
  $("face-on-btn").addEventListener("click", () => setFaceOptIn(true));
  $("face-off-btn").addEventListener("click", () => {
    resetDelete();
    $("face-note").textContent = "";
    setFaceOptIn(false);
  });
  $("face-delete-btn").addEventListener("click", () => {
    if (!deleteArmed) {
      $("face-delete-btn").textContent = "Tap again to delete";
      $("face-note").textContent = "This removes the stored numbers from this device. It cannot be undone.";
      deleteArmed = setTimeout(() => {
        resetDelete();
        $("face-note").textContent = "";
      }, 5000);
      return;
    }
    resetDelete();
    deleteFaceData();
    lastOutcome = null;
    renderChip();
    $("face-note").textContent = "Deleted. Your face data is gone from this device.";
  });
  render();
}
