// log-store.js: INTEGRATION HOOK for the camera check (H1).
//
// "Save to log" writes one reading here. It uses the field names from the
// data contract in AGENTS.md (rhr_bpm, hrv_rmssd_ms, signal_quality, source),
// so the data-quality checker (F4) can compare camera vs wearable heart rate.
//
// Only numbers are saved. No image or video ever reaches this file.

export const LOG_CONFIG = {
  STORAGE_KEY: "ahm.log_entries", // same localStorage list the Log forms use
  ASTRONAUT_KEY: "ahm.current_astronaut",
  DEFAULT_ASTRONAUT: "A1",
  // Optional local Python API (db.insert_log_entry). Leave null when it does
  // not exist: the app must work as a plain offline static site.
  API_URL: null, // e.g. "http://localhost:8000/api/log_entries"
  MAX_ENTRIES: 2000,
};

function safeStorage() {
  try {
    return window.localStorage;
  } catch {
    return null; // private mode or blocked storage
  }
}

export function currentAstronautId() {
  const fromUrl = new URLSearchParams(window.location.search).get("astronaut");
  if (fromUrl) return fromUrl;
  const store = safeStorage();
  return (store && store.getItem(LOG_CONFIG.ASTRONAUT_KEY)) || LOG_CONFIG.DEFAULT_ASTRONAUT;
}

/**
 * Turn a finished camera check into a log entry.
 * @param result  output of analyseSession() in rppg-core.js
 * @param extra   optional extra fields (the facial-behaviour feature, H2, adds its own here)
 */
export function buildCameraLogEntry(result, { astronautId, simulated = false, extra = {} } = {}) {
  const now = new Date();
  return {
    id: `cam-${now.getTime()}`,
    entry_type: "camera_check",
    astronaut_id: astronautId || currentAstronautId(),
    timestamp: now.toISOString(),
    date: now.toISOString().slice(0, 10),
    // Data-contract fields. The check is done sitting still, so the heart rate
    // is logged as a resting heart rate.
    rhr_bpm: result.hrBpm,
    hrv_rmssd_ms: result.rmssdMs, // null when the pulse was not clean enough
    signal_quality: result.signalQuality, // 0-1
    source: simulated ? "simulated" : "camera",
    // Extra context for the "device or astronaut?" checker.
    hrv_confidence: "low", // camera HRV is an estimate, never use it as a baseline
    method: "rPPG POS, 30 fps webcam",
    duration_s: Math.round(result.durationS),
    quality_parts: result.qualityParts,
    labels: simulated ? ["Simulated"] : [],
    ...extra,
  };
}

export function readLogEntries() {
  const store = safeStorage();
  if (!store) return [];
  try {
    const list = JSON.parse(store.getItem(LOG_CONFIG.STORAGE_KEY) || "[]");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/**
 * Save one entry. Returns {saved, where[]} so the UI can tell the truth about
 * what happened.
 */
export async function saveLogEntry(entry) {
  const where = [];
  const store = safeStorage();
  if (store) {
    try {
      const list = readLogEntries();
      list.push(entry);
      store.setItem(LOG_CONFIG.STORAGE_KEY, JSON.stringify(list.slice(-LOG_CONFIG.MAX_ENTRIES)));
      where.push("device log");
    } catch (err) {
      console.warn("Could not write the log entry to localStorage.", err);
    }
  }
  if (LOG_CONFIG.API_URL) {
    try {
      const res = await fetch(LOG_CONFIG.API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entry),
      });
      if (res.ok) where.push("mission database");
    } catch (err) {
      console.warn("Local API not reachable, kept the entry in the device log.", err);
    }
  }
  return { saved: where.length > 0, where };
}
