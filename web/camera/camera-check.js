// camera-check.js: the 30-second "Camera check" screen (H1).
//
// Flow:  Start -> load face model -> 3 s "get ready" -> 30 s measuring -> result
//        (or "retry" when signal quality is under 0.5).
//
// Privacy: every frame is analysed in memory and then dropped. Only the final
// numbers can be saved, and only when the user presses "Save to log".
//
// Prototype. Not a medical device.

import { CONFIG, analyseSession, estimateHeartRate, extractPulse, computeQuality, qualityLabel } from "./rppg-core.js";
import { createFaceTracker, createMotionMeter, facePose, samplePatches, skinPatches } from "./face-tracker.js";
import { createCameraSource, createSimulatedSource } from "./sources.js";
import { buildCameraLogEntry, currentAstronautId, saveLogEntry } from "./log-store.js";

// ----------------------------------------------------------------------------
// Config
// ----------------------------------------------------------------------------
const UI_CONFIG = {
  CHECK_SECONDS: 30,
  SETTLE_SECONDS: 3, // lets the camera finish adjusting exposure before we measure
  LIVE_UPDATE_S: 1, // heart rate on screen refreshes once per second
  WAVE_SECONDS: 6, // how much pulse wave to draw
};

// ----------------------------------------------------------------------------
// Plug-ins: other features can listen to the same camera check.
// The facial-behaviour feature (H2) uses this. A plug-in is an object with any of:
//   wantsBlendshapes: true | () => bool   ask the face model for blendshapes
//   onStart()                         a new check begins
//   onFrame({tS, face, pose, frameSize})   every frame that has a face
//   onFinish(result, {simulated}) -> object|null   extra fields to store with the log entry
//   onResult(lastResult)              the result card was just shown
// ----------------------------------------------------------------------------
const plugins = [];
export function registerPlugin(plugin) {
  plugins.push(plugin);
}

// ----------------------------------------------------------------------------
// Page elements
// ----------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const el = {
  stage: $("stage"),
  video: $("video"),
  simCanvas: $("sim-canvas"),
  overlay: $("overlay"),
  placeholder: $("placeholder"),
  liveGuide: $("live-guide"),
  ring: $("ring"),
  ringArc: $("ring-arc"),
  ringText: $("ring-text"),
  status: $("status"),
  startBtn: $("start-btn"),
  stopBtn: $("stop-btn"),
  liveHr: $("live-hr"),
  wave: $("wave"),
  meters: { snr: $("meter-snr"), motion: $("meter-motion"), face: $("meter-face"), light: $("meter-light") },
  resultCard: $("result-card"),
  resultTitle: $("result-title"),
  resultHr: $("result-hr"),
  resultRmssd: $("result-rmssd"),
  resultRmssdNote: $("result-rmssd-note"),
  qualityBadge: $("quality-badge"),
  resultReasons: $("result-reasons"),
  saveBtn: $("save-btn"),
  retryBtn: $("retry-btn"),
  saveNote: $("save-note"),
  simBanner: $("sim-banner"),
  astronaut: $("astronaut-id"),
};

const params = new URLSearchParams(window.location.search);
const simMode = params.get("sim"); // steady | shake | cover | dark
const checkSeconds = Math.min(60, Math.max(10, Number(params.get("seconds")) || UI_CONFIG.CHECK_SECONDS));
const RING_LENGTH = 2 * Math.PI * 26;

// One camera check = one of these.
let session = null;
let tracker = null; // face model, loaded once and reused
let trackerBlendshapes = false; // was it loaded with blendshapes?
let lastResult = null;

// ----------------------------------------------------------------------------
// Small UI helpers
// ----------------------------------------------------------------------------
function setStatus(text, tone = "") {
  el.status.textContent = text;
  el.status.dataset.tone = tone;
}

function setRing(fraction, label) {
  el.ringArc.style.strokeDashoffset = String(RING_LENGTH * (1 - Math.min(1, Math.max(0, fraction))));
  el.ringText.textContent = label;
  // The tick ring around the face fills in with the same progress.
  el.liveGuide?.firstElementChild?.style.setProperty("--progress", String(Math.min(1, Math.max(0, fraction))));
}

function setMeter(node, score) {
  const pct = Math.round(100 * Math.min(1, Math.max(0, score || 0)));
  node.style.width = pct + "%";
  node.parentElement.setAttribute("aria-valuenow", String(pct));
  node.dataset.level = pct >= 60 ? "good" : pct >= 30 ? "fair" : "poor";
}

function show(node, visible) {
  node.hidden = !visible;
}

function drawOverlay(patches) {
  const c = el.overlay;
  const ctx = c.getContext("2d");
  ctx.clearRect(0, 0, c.width, c.height);
  if (!patches) return;
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(255,255,255,0.95)";
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  for (const p of patches) {
    ctx.beginPath();
    p.corners.forEach((pt, i) => (i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y)));
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}

function drawWave(pulse, fs) {
  const c = el.wave;
  const ctx = c.getContext("2d");
  const w = c.width;
  const h = c.height;
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = "#e5e7eb";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, h / 2);
  ctx.lineTo(w, h / 2);
  ctx.stroke();
  if (!pulse || pulse.length < 2) return;
  const n = Math.min(pulse.length, Math.round(UI_CONFIG.WAVE_SECONDS * fs));
  const seg = pulse.subarray(pulse.length - n);
  let peak = 1e-9;
  for (const v of seg) peak = Math.max(peak, Math.abs(v));
  ctx.strokeStyle = "#111827";
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * w;
    const y = h / 2 - (seg[i] / peak) * (h / 2 - 8);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

// ----------------------------------------------------------------------------
// One camera check
// ----------------------------------------------------------------------------
async function startCheck() {
  if (session) return;
  lastResult = null;
  show(el.resultCard, false);
  show(el.placeholder, false);
  el.startBtn.disabled = true;
  show(el.stopBtn, true);
  el.liveHr.textContent = "--";
  drawWave(null);
  Object.values(el.meters).forEach((m) => setMeter(m, 0));
  setRing(0, "");

  const source = simMode ? createSimulatedSource(el.simCanvas, simMode) : createCameraSource(el.video);
  show(el.video, !source.simulated);
  show(el.simCanvas, source.simulated);
  show(el.simBanner, source.simulated);

  session = {
    source,
    phase: "loading",
    trace: { t: [], r: [], g: [], b: [] },
    frames: 0, // frames seen while measuring
    faceFrames: 0, // ...of which had a face
    lumaSum: 0,
    clippedSum: 0,
    motion: createMotionMeter(),
    t0: null, // time the measuring phase started (ms)
    settleStart: null,
    lastLive: 0,
    sampler: document.createElement("canvas"), // off-screen, never shown or saved
  };
  const s = session;

  try {
    setStatus(source.simulated ? "Starting simulated signal..." : "Starting camera...");
    await source.start();
    // Blendshapes are only computed when a plug-in asks (facial-behaviour opt-in).
    const needBlendshapes = plugins.some((p) => (typeof p.wantsBlendshapes === "function" ? p.wantsBlendshapes() : p.wantsBlendshapes));
    if (tracker && trackerBlendshapes !== needBlendshapes) {
      tracker.close();
      tracker = null;
    }
    if (!source.simulated && !tracker) {
      setStatus("Loading face model (stored on this device)...");
      tracker = await createFaceTracker({ blendshapes: needBlendshapes });
      trackerBlendshapes = needBlendshapes;
    }
  } catch (err) {
    console.error(err);
    const denied = err && (err.name === "NotAllowedError" || err.name === "SecurityError");
    const missing = err && (err.name === "NotFoundError" || err.name === "OverconstrainedError");
    endSession();
    show(el.placeholder, true);
    setStatus(
      denied
        ? "Camera access was blocked. Allow the camera for this page, then press Start."
        : missing
          ? "No camera found on this device."
          : "Could not start the camera check. " + (err && err.message ? err.message : ""),
      "bad",
    );
    return;
  }
  if (session !== s) return; // stopped while loading

  el.overlay.width = s.sampler.width = source.width;
  el.overlay.height = s.sampler.height = source.height;
  s.samplerCtx = s.sampler.getContext("2d", { willReadFrequently: true });
  show(el.liveGuide, true);
  s.phase = "settling";
  plugins.forEach((p) => p.onStart && p.onStart());
  source.onFrame((now) => onFrame(s, now));
}

function onFrame(s, nowMs) {
  if (session !== s) return;
  const { source } = s;
  const width = source.width;
  const height = source.height;
  if (!width || !height) return;

  // 1. Find the face.
  const face = source.simulated ? source.landmarks() : tracker.detect(source.el, nowMs);
  const pose = face ? facePose(face.landmarks, width, height) : null;
  const patches = pose ? skinPatches(pose) : null;
  drawOverlay(patches);

  // 2. Read the skin colour (frame is drawn to an off-screen canvas, read, then overwritten).
  let sample = null;
  if (patches) {
    s.samplerCtx.drawImage(source.el, 0, 0, width, height);
    sample = samplePatches(s.samplerCtx, patches, width, height);
  }
  const tS = nowMs / 1000;
  const liveMotion = pose ? s.motion.update(pose, tS) : (s.motion.lostFace(), s.motion.recent());

  // 3. Phase handling.
  if (s.phase === "settling") {
    if (s.settleStart === null) s.settleStart = nowMs;
    const left = UI_CONFIG.SETTLE_SECONDS - (nowMs - s.settleStart) / 1000;
    setRing(0, String(Math.max(1, Math.ceil(left))));
    setStatus(face ? "Get ready. Sit still and look at the camera." : "No face found. Move into the frame.", face ? "" : "warn");
    if (left <= 0) {
      s.phase = "measuring";
      s.t0 = nowMs;
      s.motion = createMotionMeter();
    }
    return;
  }
  if (s.phase !== "measuring") return;

  const elapsed = (nowMs - s.t0) / 1000;
  s.frames++;
  if (sample) {
    s.faceFrames++;
    s.lumaSum += sample.luma;
    s.clippedSum += sample.clipped;
  }
  if (sample && sample.pixels > 0) {
    s.trace.t.push(elapsed);
    s.trace.r.push(sample.r);
    s.trace.g.push(sample.g);
    s.trace.b.push(sample.b);
    plugins.forEach((p) => p.onFrame && p.onFrame({ tS: elapsed, face, pose, frameSize: { width, height } }));
  }

  setRing(elapsed / checkSeconds, String(Math.max(0, Math.ceil(checkSeconds - elapsed))));

  // 4. Live read-out once per second.
  if (elapsed - s.lastLive >= UI_CONFIG.LIVE_UPDATE_S) {
    s.lastLive = elapsed;
    updateLive(s, face !== null, liveMotion);
  }

  // 5. Done?
  if (elapsed >= checkSeconds) finishCheck(s);
}

function sessionContext(s) {
  return {
    motion: s.motion.mean(),
    faceRatio: s.frames ? s.faceFrames / s.frames : 0,
    luma: s.faceFrames ? s.lumaSum / s.faceFrames : 0,
    clipped: s.faceFrames ? s.clippedSum / s.faceFrames : 0,
  };
}

function updateLive(s, hasFace, liveMotion) {
  const ctx = sessionContext(s);
  let snrFraction = 0;
  let pulse = null;
  if (s.trace.t.length > CONFIG.FS * 2) {
    // Only the last ~12 s are needed for a live reading.
    const from = s.trace.t.findIndex((t) => t >= s.trace.t[s.trace.t.length - 1] - (CONFIG.HR_WINDOW_S + 2));
    const recent = { t: s.trace.t.slice(from), r: s.trace.r.slice(from), g: s.trace.g.slice(from), b: s.trace.b.slice(from) };
    pulse = extractPulse(recent).pulse;
    const windowN = Math.round(CONFIG.HR_WINDOW_S * CONFIG.FS);
    const hr = estimateHeartRate(pulse.subarray(Math.max(0, pulse.length - windowN)));
    snrFraction = hr.snrFraction;
    el.liveHr.textContent = Number.isFinite(hr.bpm) ? String(Math.round(hr.bpm)) : "--";
    drawWave(pulse, CONFIG.FS);
  }
  const q = computeQuality({ ...ctx, snrFraction, motion: liveMotion });
  setMeter(el.meters.snr, q.parts.snr);
  setMeter(el.meters.motion, q.parts.motion);
  setMeter(el.meters.face, q.parts.face);
  setMeter(el.meters.light, q.parts.light);
  // Coach the user with the most urgent fix first.
  if (!hasFace) setStatus("No face found. Uncover your face and look at the camera.", "warn");
  else if (q.parts.motion < 0.5) setStatus("Hold still.", "warn");
  else if (q.parts.light < 0.5) setStatus(ctx.luma < CONFIG.LUMA_DARK_OK ? "Too dark. Face the light." : "Too bright. Avoid glare.", "warn");
  else setStatus("Measuring. Keep still and breathe normally.");
}

function finishCheck(s) {
  const context = sessionContext(s);
  const result = analyseSession(s.trace, context);
  const simulated = s.source.simulated;
  // Plug-ins may add fields to the log entry (H2 facial-behaviour).
  const extra = {};
  for (const p of plugins) Object.assign(extra, (p.onFinish && p.onFinish(result, { simulated })) || {});
  endSession();
  // The colour trace is ~900 numbers per channel (no image data). It is kept
  // in memory only, so the result can be checked with hard/rppg_reference.py.
  lastResult = { result, simulated, extra, context, trace: s.trace };
  showResult(lastResult);
  plugins.forEach((p) => p.onResult && p.onResult(lastResult));
}

function endSession() {
  if (session) session.source.stop();
  session = null;
  drawOverlay(null);
  show(el.liveGuide, false);
  el.startBtn.disabled = false;
  show(el.stopBtn, false);
}

function stopCheck() {
  if (!session) return;
  endSession();
  setRing(0, "");
  show(el.placeholder, true);
  show(el.video, false);
  show(el.simCanvas, false);
  setStatus("Stopped. Nothing was saved.");
}

// ----------------------------------------------------------------------------
// Result card
// ----------------------------------------------------------------------------
function showResult({ result, simulated }) {
  show(el.placeholder, true);
  show(el.video, false);
  show(el.simCanvas, false);
  setRing(1, "");
  show(el.resultCard, true);
  el.resultCard.dataset.state = result.retry ? "retry" : "ok";
  el.qualityBadge.textContent = `${qualityLabel(result.signalQuality)} · ${result.signalQuality.toFixed(2)}`;
  el.qualityBadge.dataset.level = result.retry ? "poor" : result.signalQuality >= 0.75 ? "good" : "fair";
  el.resultReasons.replaceChildren();
  el.saveNote.textContent = "";

  if (result.retry) {
    // Poor signal: do not show a number that could be wrong.
    el.resultTitle.textContent = "Let's try again";
    el.resultHr.textContent = "--";
    el.resultRmssd.textContent = "--";
    el.resultRmssdNote.textContent = "";
    const reasons = result.reasons.length ? result.reasons : ["Hold still, face the light."];
    for (const text of reasons) {
      const li = document.createElement("li");
      li.textContent = text;
      el.resultReasons.append(li);
    }
    show(el.saveBtn, false);
    el.retryBtn.textContent = "Retry";
    setStatus("Signal quality too low. Hold still, face the light.", "warn");
  } else {
    el.resultTitle.textContent = simulated ? "Result (Simulated)" : "Result";
    el.resultHr.textContent = String(Math.round(result.hrBpm));
    if (result.rmssdMs !== null) {
      el.resultRmssd.textContent = String(Math.round(result.rmssdMs));
      el.resultRmssdNote.textContent = "Estimate · lower confidence. Camera timing is coarse and tends to read high.";
    } else {
      el.resultRmssd.textContent = "--";
      el.resultRmssdNote.textContent = "Pulse not clean enough for an HRV estimate. Heart rate is still valid.";
    }
    show(el.saveBtn, true);
    el.saveBtn.disabled = false;
    el.retryBtn.textContent = "Measure again";
    setStatus("Done. Review the result, then save it or measure again.", "good");
  }
  el.resultCard.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

async function saveResult() {
  if (!lastResult || lastResult.result.retry) return;
  el.saveBtn.disabled = true;
  const entry = buildCameraLogEntry(lastResult.result, { simulated: lastResult.simulated, extra: lastResult.extra });
  const outcome = await saveLogEntry(entry);
  if (outcome.saved) {
    el.saveNote.textContent = `Saved to ${outcome.where.join(" + ")} for ${entry.astronaut_id} (source: ${entry.source}, signal quality ${entry.signal_quality.toFixed(2)}).`;
  } else {
    el.saveNote.textContent = "Could not save: storage is blocked in this browser.";
    el.saveBtn.disabled = false;
  }
}

// ----------------------------------------------------------------------------
// Wire up
// ----------------------------------------------------------------------------
el.startBtn.addEventListener("click", startCheck);
el.retryBtn.addEventListener("click", startCheck);
el.stopBtn.addEventListener("click", stopCheck);
el.saveBtn.addEventListener("click", saveResult);
el.astronaut.textContent = currentAstronautId();
const selfNavLink = document.querySelector('.nav-sub[aria-current="page"]');
if (selfNavLink && window.location.search) {
  selfNavLink.setAttribute("href", `./index.html${window.location.search}`);
}
el.ringArc.style.strokeDasharray = String(RING_LENGTH);
setRing(0, "");
if (simMode) show(el.simBanner, true);
if (!simMode && !(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) {
  setStatus("This browser cannot use the camera here. Open the page from http://localhost (see README).", "bad");
  el.startBtn.disabled = true;
}
// Stop the camera if the page is hidden or closed.
window.addEventListener("pagehide", () => session && endSession());

// For debugging in the console and for tests.
window.cameraCheck = {
  registerPlugin,
  getLastResult: () => lastResult,
  getLastTrace: () => (lastResult ? lastResult.trace : null),
  config: UI_CONFIG,
};
