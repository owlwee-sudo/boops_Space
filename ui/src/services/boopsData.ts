/**
 * Offline BOOPS data loader, local state store, and privacy-respecting export helpers.
 * Reads `window.BOOPS_DATA` (when opened via file:// with data_bundle.js) or `./data/boops_bundle.json`.
 */

import { type BleReading, type HealthSyncRecord, saveFileWithNativeBridge } from "./nativeBridge";

export type RiskLevel = "normal" | "watch" | "act";
export type DataQualityStatus = "ok" | "check_device" | "check_yourself" | "act_now";

export interface CrewProfile {
  id: "A1" | "A2" | "A3";
  name: string;
  role: string;
  email: string;
  medicalLeadPriority: number;
}

export const CREW_PROFILES: CrewProfile[] = [
  { id: "A1", name: "Amara Okafor", role: "Commander", email: "a.okafor@boops.local", medicalLeadPriority: 2 },
  { id: "A2", name: "Jun Park", role: "Pilot", email: "j.park@boops.local", medicalLeadPriority: 3 },
  { id: "A3", name: "Lena Fischer", role: "Flight Engineer", email: "l.fischer@boops.local", medicalLeadPriority: 1 },
];

export const DEMO_JUMPS: Array<{ label: string; astronautId: "A1" | "A2" | "A3"; missionDay: number; note: string }> = [
  { label: "Day 8 Adaptation", astronautId: "A1", missionDay: 8, note: "Fluid-shift adaptation window (alerts dampened)" },
  { label: "Day 30 Glitch", astronautId: "A1", missionDay: 30, note: "Optical HR spike 220 bpm -> Check device" },
  { label: "Day 41 EVA", astronautId: "A1", missionDay: 41, note: "EVA workload raises stress + RHR" },
  { label: "Day 43 Post-EVA", astronautId: "A1", missionDay: 43, note: "Post-EVA recovery Watch window" },
  { label: "Day 68 No Exercise", astronautId: "A2", missionDay: 68, note: "A2 skips ARED resistance -> Musculoskeletal Watch" },
  { label: "Day 90 Bad Sleep", astronautId: "A1", missionDay: 90, note: "Multi-day sleep deficit lowers immune reserve" },
  { label: "Day 92 Solar Storm", astronautId: "A1", missionDay: 92, note: "Solar Particle Event -> Shelter alert banner" },
  { label: "Day 96 Early Warning", astronautId: "A1", missionDay: 96, note: "Resting HR >= 2 SD for 2d before symptoms" },
  { label: "Day 97 Immune Act", astronautId: "A1", missionDay: 97, note: "Symptoms + saliva confirmation -> Immune Act" },
];

export interface DriverEntry {
  factor: string;
  z: number;
  contribution: number;
  chain: string;
  evidence_stars: 1 | 2 | 3;
  source_id: string;
}

export interface RiskSummary {
  level: RiskLevel;
  score: number;
  drivers: DriverEntry[];
}

export interface ActionEntry {
  rank: number;
  text: string;
  targets: string;
  evidence_stars: 1 | 2 | 3;
}

export interface EngineDayOutput {
  astronaut_id: string;
  mission_day: number;
  stress_score: number;
  sleep_score: number;
  baseline: Record<string, { mean: number; sd: number }>;
  z: Record<string, number>;
  risks: {
    immune: RiskSummary;
    musculoskeletal: RiskSummary;
    cardio: RiskSummary;
  };
  actions: ActionEntry[];
  data_quality: {
    status: DataQualityStatus;
    reasons: string[];
    suggested_step: string;
    anomaly_score?: number;
    anomaly_kind?: string;
  };
  flags: {
    infection_early_warning: boolean;
  };
  labels: string[];
}

export interface DailyRecordRow {
  astronaut_id: string;
  mission_day: number;
  date: string;
  rhr_bpm: number;
  hrv_rmssd_ms: number;
  sleep_hours: number;
  sleep_quality_1to5: number;
  eda_mean_us: number;
  spo2_pct: number;
  sbp_mmhg: number;
  dbp_mmhg: number;
  temp_c: number;
  exercise_min: number;
  resistance_min: number;
  radiation_msv: number;
  eva: number;
  symptoms: string;
  mood_1to5: number;
  signal_quality: number;
  source: string;
}

export interface PlantedEvent {
  id: string;
  astronaut_id: string;
  start_day: number;
  end_day: number;
  type: string;
  title: string;
  description: string;
  expected_signal: string;
}

export interface EmergencyProtocol {
  id: string;
  title: string;
  severity: string;
  first_screen_message: string;
  steps: string[];
  why_this_happens: string;
  when_to_escalate: string;
  related_tool_guides: string[];
  disclaimer: string;
}

export interface ToolGuide {
  id: string;
  title: string;
  steps: string[];
  why_it_matters: string;
  common_mistakes: string[];
  how_to_fix_bad_reading: string[];
  linked_log_fields: string[];
}

export interface SourceEntry {
  id: string;
  group?: string;
  title: string;
  url: string;
  layer?: string;
  citation?: string;
}

export interface BoopsBundle {
  engineOutput: EngineDayOutput[];
  dailyRecords: DailyRecordRow[];
  events: PlantedEvent[];
  emergencyProtocols: EmergencyProtocol[];
  toolGuides: ToolGuide[];
  sources: SourceEntry[];
  links?: unknown[];
}

export interface SharingSettings {
  daily_summary: boolean;
  raw_data: boolean;
  emergency_events: true;
  risk_detail_share: Record<string, boolean>;
}

export interface PersistedContext {
  astronautId: "A1" | "A2" | "A3";
  missionDay: number;
}

export interface ManualLogEntry {
  id?: string;
  astronaut_id: string;
  mission_day: number;
  screen: string;
  fields: Record<string, string>;
  saved_at: string;
}

export interface UserSettings {
  watch_alerts: boolean;
  act_now_alerts: boolean;
  quiet_hours: string;
  units: "metric" | "imperial";
  language: string;
  baseline_calibrated_day: number;
  profile_notes: Record<string, string>;
}

export interface EmergencyLogEntry {
  id: string;
  astronaut_id: string;
  mission_day: number;
  protocol_id: string;
  severity: string;
  summary: string;
  created_utc: string;
}

const STORAGE_PREFIX = "boops_v1_";

/** Reads a value from localStorage safely without throwing in restricted origins. */
export function safeStorageGet(key: string): string | null {
  try {
    return window.localStorage.getItem(STORAGE_PREFIX + key);
  } catch {
    return null;
  }
}

/** Writes a value to localStorage safely without throwing in restricted origins. */
export function safeStorageSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + key, value);
  } catch {
    // Ignore storage quota or private-browsing failures.
  }
}

/** Loads persisted sharing preferences with crew-first defaults. */
export function loadSharingSettings(): SharingSettings {
  const raw = safeStorageGet("sharing_settings");
  const defaults: SharingSettings = {
    daily_summary: true,
    raw_data: false,
    emergency_events: true,
    risk_detail_share: {
      immune: false,
      musculoskeletal: false,
      cardio: false,
    },
  };
  if (!raw) return defaults;
  try {
    const parsed = JSON.parse(raw) as Partial<SharingSettings>;
    return {
      daily_summary: typeof parsed.daily_summary === "boolean" ? parsed.daily_summary : true,
      raw_data: typeof parsed.raw_data === "boolean" ? parsed.raw_data : false,
      emergency_events: true,
      risk_detail_share: {
        immune: Boolean(parsed.risk_detail_share?.immune),
        musculoskeletal: Boolean(parsed.risk_detail_share?.musculoskeletal),
        cardio: Boolean(parsed.risk_detail_share?.cardio),
      },
    };
  } catch {
    return defaults;
  }
}

let localApiState: "unknown" | "available" | "unavailable" = "unknown";
let localApiProbe: Promise<boolean> | null = null;

async function hasLocalApiServer(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (!window.location.protocol.startsWith("http")) {
    localApiState = "unavailable";
    return false;
  }
  if (localApiState !== "unknown") return localApiState === "available";
  if (!localApiProbe) {
    localApiProbe = fetch("./", { method: "HEAD" })
      .then((resp) => {
        const enabled = resp.headers.get("X-Boops-Local-Api") === "1";
        localApiState = enabled ? "available" : "unavailable";
        return enabled;
      })
      .catch(() => {
        localApiState = "unavailable";
        return false;
      });
  }
  return localApiProbe;
}

/** Best-effort non-blocking sync to local SQLite server when running over BOOPS API server. */
function postLocalApi(path: string, payload: unknown): void {
  try {
    if (typeof window === "undefined") return;
    if (!window.location.protocol.startsWith("http")) return;
    void hasLocalApiServer().then((available) => {
      if (!available) return;
      return fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).catch(() => {
        // Offline file:// mode or static preview without local API server stays in localStorage.
      });
    });
  } catch {
    // Ignore storage/network restrictions when running standalone.
  }
}

/** Persists sharing preferences while locking emergency_events to true. */
export function saveSharingSettings(
  next: SharingSettings,
  astronautId = "A1"
): SharingSettings {
  const normalized: SharingSettings = {
    daily_summary: Boolean(next.daily_summary),
    raw_data: Boolean(next.raw_data),
    emergency_events: true,
    risk_detail_share: {
      immune: Boolean(next.risk_detail_share?.immune),
      musculoskeletal: Boolean(next.risk_detail_share?.musculoskeletal),
      cardio: Boolean(next.risk_detail_share?.cardio),
    },
  };
  safeStorageSet("sharing_settings", JSON.stringify(normalized));
  postLocalApi("./api/sharing", {
    astronaut_id: astronautId,
    daily_summary: normalized.daily_summary,
    raw_data: normalized.raw_data,
  });
  return normalized;
}

/** Returns true when BOOPS is running in Demo / Debug UI mode instead of clean Crew App mode. */
export function isDebugUiMode(): boolean {
  if (typeof window === "undefined") return false;
  const docMode = document.documentElement.dataset.boopsMode;
  if (docMode === "debug" || docMode === "app") {
    return docMode === "debug";
  }
  const params = new URLSearchParams(window.location.search);
  const param = (params.get("mode") || params.get("boops_mode") || "").toLowerCase();
  if (
    param === "debug" ||
    params.get("debug") === "1" ||
    params.get("debug") === "true" ||
    window.location.pathname.endsWith("/debug.html")
  ) {
    return true;
  }
  if ((window as unknown as { __BOOPS_DEFAULT_MODE?: string }).__BOOPS_DEFAULT_MODE === "debug") {
    return true;
  }
  try {
    return window.sessionStorage?.getItem("boops_ui_mode") === "debug";
  } catch {
    return false;
  }
}

/** Formats source attribution badge text based on record source and active UI mode. */
export function formatSourceLabel(
  record?: Pick<DailyRecordRow, "source"> | null,
  fallbackAppLabel = "On-device sync",
  debug = isDebugUiMode(),
): string {
  if (record?.source === "manual") return "Manual entry";
  if (record?.source === "camera") return "Camera rPPG";
  if (record?.source === "wearable") return "Wearable sync";
  return debug ? "Simulated" : fallbackAppLabel;
}

/** Loads the active astronaut and mission day selection. */
export function loadSelectedContext(): PersistedContext {
  const defaultDay = isDebugUiMode() ? 96 : 45;
  const raw = safeStorageGet("context");
  const fallback: PersistedContext = { astronautId: "A1", missionDay: defaultDay };
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedContext>;
    const astronautId =
      parsed.astronautId === "A1" || parsed.astronautId === "A2" || parsed.astronautId === "A3"
        ? parsed.astronautId
        : "A1";
    const missionDay =
      typeof parsed.missionDay === "number" && parsed.missionDay >= 1 && parsed.missionDay <= 180
        ? Math.round(parsed.missionDay)
        : defaultDay;
    return { astronautId, missionDay };
  } catch {
    return fallback;
  }
}

/** Saves the active astronaut and mission day selection. */
export function saveSelectedContext(ctx: PersistedContext): void {
  safeStorageSet("context", JSON.stringify(ctx));
  try {
    window.localStorage.setItem("ahm.current_astronaut", ctx.astronautId);
  } catch {
    // Ignore storage quota or private-browsing failures.
  }
}

/** Loads emergency checklist timestamps keyed by `${protocolId}:${stepIdx}`. */
export function loadChecklistTimestamps(protocolId: string): Record<string, string> {
  const raw = safeStorageGet(`checklist_${protocolId}`);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

/** Records or clears a timestamp when an emergency checklist step is toggled. */
export function toggleChecklistTimestamp(
  protocolId: string,
  stepKey: string,
  checked: boolean,
): Record<string, string> {
  const current = loadChecklistTimestamps(protocolId);
  if (checked) {
    current[stepKey] = new Date().toISOString().slice(11, 19) + " UTC";
  } else {
    delete current[stepKey];
  }
  safeStorageSet(`checklist_${protocolId}`, JSON.stringify(current));
  return current;
}

/** Converts a stored H1 camera check entry from `ahm.log_entries` into a dashboard log row. */
function mapCameraLogEntry(item: Record<string, unknown>, fallbackDay: number): ManualLogEntry | null {
  if (item.entry_type !== "camera_check") return null;
  const fields: Record<string, string> = {
    "Resting HR": item.rhr_bpm != null ? `${String(item.rhr_bpm)} bpm` : "withheld",
    "Signal quality": item.signal_quality != null ? Number(item.signal_quality).toFixed(2) : "—",
    Source: String(item.source ?? "camera"),
  };
  if (item.hrv_rmssd_ms != null) {
    fields["Rough HRV (low conf.)"] = `${String(item.hrv_rmssd_ms)} ms`;
  }
  if (item.facial_change_level) {
    fields["Facial change"] = String(item.facial_change_level);
  }
  return {
    astronaut_id: String(item.astronaut_id ?? "A1"),
    mission_day: typeof item.mission_day === "number" ? item.mission_day : fallbackDay,
    screen: "Camera Check (rPPG)",
    fields,
    saved_at: String(item.timestamp ?? item.date ?? ""),
  };
}

/** Reads only manual entries saved in boops_v1_manual_logs. */
function readStoredManualLogs(): ManualLogEntry[] {
  const raw = safeStorageGet("manual_logs");
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ManualLogEntry[]) : [];
  } catch {
    return [];
  }
}

/** Loads manual and H1 camera check log submissions persisted in localStorage. */
export function loadManualLogs(): ManualLogEntry[] {
  const entries: ManualLogEntry[] = [...readStoredManualLogs()];

  try {
    const camRaw = window.localStorage.getItem("ahm.log_entries");
    if (camRaw) {
      const camParsed = JSON.parse(camRaw);
      if (Array.isArray(camParsed)) {
        const fallbackDay = loadSelectedContext().missionDay;
        for (const item of camParsed) {
          if (item && typeof item === "object") {
            const mapped = mapCameraLogEntry(item as Record<string, unknown>, fallbackDay);
            if (mapped) entries.push(mapped);
          }
        }
      }
    }
  } catch {
    // Ignore restricted/corrupt camera storage.
  }

  entries.sort((a, b) => String(b.saved_at || "").localeCompare(String(a.saved_at || "")));
  return entries.slice(0, 80);
}

/** Appends a manual log entry to localStorage and syncs opportunistically to local SQLite. */
export function appendManualLog(entry: ManualLogEntry): ManualLogEntry[] {
  const withId: ManualLogEntry = {
    ...entry,
    id: entry.id || `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  };
  const current = readStoredManualLogs();
  const next = [withId, ...current].slice(0, 60);
  safeStorageSet("manual_logs", JSON.stringify(next));
  postLocalApi("./api/log", {
    astronaut_id: withId.astronaut_id,
    mission_day: withId.mission_day,
    category: withId.screen,
    payload: withId,
    created_utc: withId.saved_at,
  });
  return loadManualLogs();
}

/** Updates an existing manual log entry (or prepends it if no match is found). */
export function updateManualLog(entry: ManualLogEntry): ManualLogEntry[] {
  const current = readStoredManualLogs();
  const idx = current.findIndex(
    (item) =>
      (entry.id && item.id === entry.id) ||
      (!entry.id && item.saved_at === entry.saved_at && item.screen === entry.screen),
  );
  const updated: ManualLogEntry = {
    ...entry,
    id: entry.id || `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  };
  const next =
    idx >= 0
      ? current.map((item, i) => (i === idx ? updated : item))
      : [updated, ...current].slice(0, 60);
  safeStorageSet("manual_logs", JSON.stringify(next));
  postLocalApi("./api/log", {
    astronaut_id: updated.astronaut_id,
    mission_day: updated.mission_day,
    category: updated.screen,
    payload: updated,
    created_utc: updated.saved_at,
  });
  return loadManualLogs();
}

/** Loads persisted notification, baseline calibration, and display preferences. */
export function loadUserSettings(): UserSettings {
  const defaults: UserSettings = {
    watch_alerts: true,
    act_now_alerts: true,
    quiet_hours: "22:00–06:00",
    units: "metric",
    language: "English",
    baseline_calibrated_day: 14,
    profile_notes: {},
  };
  const raw = safeStorageGet("user_settings");
  if (!raw) return defaults;
  try {
    const parsed = JSON.parse(raw) as Partial<UserSettings>;
    return {
      watch_alerts: typeof parsed.watch_alerts === "boolean" ? parsed.watch_alerts : true,
      act_now_alerts: typeof parsed.act_now_alerts === "boolean" ? parsed.act_now_alerts : true,
      quiet_hours: typeof parsed.quiet_hours === "string" && parsed.quiet_hours ? parsed.quiet_hours : defaults.quiet_hours,
      units: parsed.units === "imperial" ? "imperial" : "metric",
      language: typeof parsed.language === "string" && parsed.language ? parsed.language : "English",
      baseline_calibrated_day:
        typeof parsed.baseline_calibrated_day === "number" && parsed.baseline_calibrated_day >= 1
          ? Math.round(parsed.baseline_calibrated_day)
          : 14,
      profile_notes:
        parsed.profile_notes && typeof parsed.profile_notes === "object"
          ? { ...parsed.profile_notes }
          : {},
    };
  } catch {
    return defaults;
  }
}

/** Persists notification, baseline calibration, and display preferences. */
export function saveUserSettings(next: UserSettings): UserSettings {
  safeStorageSet("user_settings", JSON.stringify(next));
  return next;
}

/** Loads locally logged emergency events. */
export function loadEmergencyEvents(): EmergencyLogEntry[] {
  const raw = safeStorageGet("emergency_events");
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as EmergencyLogEntry[]) : [];
  } catch {
    return [];
  }
}

/** Appends an emergency event to localStorage and syncs to local SQLite when running ./api/emergency. */
export function appendEmergencyEvent(
  event: Omit<EmergencyLogEntry, "id" | "created_utc">,
): EmergencyLogEntry[] {
  const entry: EmergencyLogEntry = {
    ...event,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    created_utc: new Date().toISOString().slice(0, 19).replace("T", " ") + " UTC",
  };
  const current = loadEmergencyEvents();
  const next = [entry, ...current].slice(0, 40);
  safeStorageSet("emergency_events", JSON.stringify(next));
  postLocalApi("./api/emergency", {
    astronaut_id: entry.astronaut_id,
    mission_day: entry.mission_day,
    protocol_id: entry.protocol_id,
    severity: entry.severity,
    summary: entry.summary,
    created_utc: entry.created_utc,
  });
  return next;
}

/** Loads the BOOPS offline data bundle from window.BOOPS_DATA or relative JSON. */
export async function loadBoopsBundle(): Promise<BoopsBundle | null> {
  const win = window as unknown as { BOOPS_DATA?: BoopsBundle };
  if (win.BOOPS_DATA && Array.isArray(win.BOOPS_DATA.engineOutput)) {
    return win.BOOPS_DATA;
  }
  try {
    const resp = await fetch("./data/boops_bundle.json");
    if (!resp.ok) return null;
    localApiState = resp.headers.get("X-Boops-Local-Api") === "1" ? "available" : "unavailable";
    const data = (await resp.json()) as BoopsBundle;
    win.BOOPS_DATA = data;
    return data;
  } catch {
    return null;
  }
}

function clampNum(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function parseFirstFloat(raw?: string): number | null {
  if (!raw) return null;
  const m = /-?\d+(?:\.\d+)?/.exec(raw);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

function parseClockMinutes(raw?: string): number | null {
  if (!raw) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

function groupManualLogsByDay(astronautId: string): Map<number, ManualLogEntry[]> {
  const map = new Map<number, ManualLogEntry[]>();
  const all = loadManualLogs();
  // Traverse oldest -> newest so latest submission for a day overrides earlier ones cleanly.
  for (let i = all.length - 1; i >= 0; i--) {
    const entry = all[i];
    if (entry.astronaut_id !== astronautId) continue;
    const day = Number(entry.mission_day);
    if (!Number.isFinite(day)) continue;
    const list = map.get(day);
    if (list) list.push(entry);
    else map.set(day, [entry]);
  }
  return map;
}

function applyEntriesToRecord(base: DailyRecordRow, entries: ManualLogEntry[] | undefined): DailyRecordRow {
  if (!entries || entries.length === 0) return base;
  const rec: DailyRecordRow = { ...base };
  let applied = false;

  for (const entry of entries) {
    const f = entry.fields || {};
    if (entry.screen === "Camera Check (rPPG)") {
      const src = (f["Source"] || "").toLowerCase();
      if (src === "simulated") continue;
      const rhr = parseFirstFloat(f["Resting HR"]);
      const sq = parseFirstFloat(f["Signal quality"]);
      if (rhr != null && rhr >= 35 && rhr <= 220 && (sq == null || sq >= 0.5)) {
        rec.rhr_bpm = Math.round(rhr);
        if (sq != null) rec.signal_quality = clampNum(sq, 0, 1);
        rec.source = "camera";
        applied = true;
      }
      continue;
    }

    if (entry.screen === "Wearable Sync" || entry.screen === "BLE Sensor") {
      const rhr = parseFirstFloat(f["Resting HR"]);
      if (rhr != null && rhr >= 30 && rhr <= 240) rec.rhr_bpm = Math.round(rhr);
      const hrvMetric = (f["HRV metric"] || "").toLowerCase();
      const hrvRmssd = parseFirstFloat(f["HRV (RMSSD)"]);
      if (hrvRmssd != null && hrvRmssd >= 5 && hrvRmssd <= 250 && hrvMetric !== "sdnn") {
        rec.hrv_rmssd_ms = Number(hrvRmssd.toFixed(1));
      }
      const sleepH = parseFirstFloat(f["Sleep hours"]);
      if (sleepH != null && sleepH >= 0 && sleepH <= 18) rec.sleep_hours = Number(sleepH.toFixed(1));
      const spo2 = parseFirstFloat(f["SpO2"]);
      if (spo2 != null && spo2 >= 50 && spo2 <= 100) rec.spo2_pct = Number(spo2.toFixed(1));
      const bpMatch = /(\d{2,3})\s*\/\s*(\d{2,3})/.exec(f["Blood pressure"] || "");
      if (bpMatch) {
        rec.sbp_mmhg = Number(bpMatch[1]);
        rec.dbp_mmhg = Number(bpMatch[2]);
      }
      const temp = parseFirstFloat(f["Body temperature"]);
      if (temp != null && temp >= 34 && temp <= 43) rec.temp_c = Number(temp.toFixed(1));
      const ex = parseFirstFloat(f["Exercise"]);
      if (ex != null && ex >= 0 && ex <= 360) rec.exercise_min = Math.round(ex);
      const sq = parseFirstFloat(f["Signal quality"]);
      if (sq != null) rec.signal_quality = clampNum(sq, 0, 1);
      else rec.signal_quality = Math.max(rec.signal_quality, 0.94);
      rec.source = "wearable";
      applied = true;
      continue;
    }

    if (entry.screen.startsWith("LogVitals")) {
      const rhr = parseFirstFloat(f["Resting heart rate"]);
      if (rhr != null && rhr >= 30 && rhr <= 240) rec.rhr_bpm = Math.round(rhr);
      const bpMatch = /(\d{2,3})\s*\/\s*(\d{2,3})/.exec(f["Blood pressure"] || "");
      if (bpMatch) {
        rec.sbp_mmhg = Number(bpMatch[1]);
        rec.dbp_mmhg = Number(bpMatch[2]);
      }
      const temp = parseFirstFloat(f["Body temperature"]);
      if (temp != null && temp >= 34 && temp <= 43) rec.temp_c = Number(temp.toFixed(1));
      if (typeof f["Tags"] === "string") {
        const cleaned = f["Tags"]
          .split(",")
          .map((t) => t.trim())
          .filter((t) => t && t.toLowerCase() !== "none");
        rec.symptoms = cleaned.join(";");
      }
      rec.signal_quality = Math.max(rec.signal_quality, 0.92);
      rec.source = "manual";
      applied = true;
    } else if (entry.screen === "LogSleep") {
      let hours = parseFirstFloat(f["Hours slept"]);
      if (hours == null) {
        const bed = parseClockMinutes(f["Bedtime"]);
        const wake = parseClockMinutes(f["Wake time"]);
        if (bed != null && wake != null) {
          hours = ((wake - bed + 1440) % 1440) / 60;
        }
      }
      if (hours != null && hours >= 0 && hours <= 18) rec.sleep_hours = Number(hours.toFixed(1));
      const rating = /([1-5])\s*\/\s*5/.exec(f["Rating"] || "");
      if (rating) rec.sleep_quality_1to5 = Number(rating[1]);
      rec.source = "manual";
      applied = true;
    } else if (entry.screen === "LogEnvironment" || entry.screen === "LogEnvironmentRadiation") {
      const rad = parseFirstFloat(f["Radiation dose (dosimeter)"] || f["Personal dosimeter reading"]);
      if (rad != null && rad >= 0 && rad <= 500) rec.radiation_msv = Number(rad.toFixed(2));
      rec.source = "manual";
      applied = true;
    } else if (entry.screen === "LogEnvironmentGravity") {
      const dur = parseFirstFloat(f["Duration"]);
      if (dur != null && dur >= 0 && dur <= 360) {
        const tagText = (f["Tags"] || "").toLowerCase();
        const isCardioOnly = (tagText.includes("treadmill") || tagText.includes("cycle")) && !tagText.includes("ared");
        if (!isCardioOnly) {
          rec.resistance_min = Math.round(dur);
        }
        rec.exercise_min = Math.max(rec.exercise_min, Math.round(dur));
      }
      rec.source = "manual";
      applied = true;
    } else if (entry.screen === "LogMindfulness") {
      const rating = /([1-5])\s*\/\s*5/.exec(f["Rating"] || "");
      if (rating) rec.mood_1to5 = Number(rating[1]);
      const mins = parseFirstFloat(f["Minutes of practice"]);
      if (mins != null && mins >= 10) {
        rec.eda_mean_us = Number(Math.max(1.2, rec.eda_mean_us * 0.92).toFixed(2));
      }
      rec.source = "manual";
      applied = true;
    } else if (entry.screen === "LogNutrition") {
      rec.source = "manual";
      applied = true;
    }
  }

  return applied ? rec : base;
}

function levelFromScore(score: number): RiskLevel {
  if (score > 70) return "act";
  if (score >= 40) return "watch";
  return "normal";
}

function recomputeEngineFromRecord(
  baseEngine: EngineDayOutput,
  baseRec: DailyRecordRow | undefined,
  rec: DailyRecordRow | undefined,
): EngineDayOutput {
  if (!rec || !baseRec || (rec.source !== "manual" && rec.source !== "camera" && rec.source !== "wearable")) {
    return baseEngine;
  }

  const nextZ: Record<string, number> = { ...baseEngine.z };
  const recordLookup: Record<string, number> = {
    rhr_bpm: rec.rhr_bpm,
    hrv_rmssd_ms: rec.hrv_rmssd_ms,
    sleep_hours: rec.sleep_hours,
    sleep_quality_1to5: rec.sleep_quality_1to5,
    eda_mean_us: rec.eda_mean_us,
    spo2_pct: rec.spo2_pct,
    sbp_mmhg: rec.sbp_mmhg,
    dbp_mmhg: rec.dbp_mmhg,
    temp_c: rec.temp_c,
    exercise_min: rec.exercise_min,
    resistance_min: rec.resistance_min,
    radiation_msv: rec.radiation_msv,
    mood_1to5: rec.mood_1to5,
  };
  for (const [metric, stats] of Object.entries(baseEngine.baseline)) {
    const val = recordLookup[metric];
    if (typeof val === "number" && Number.isFinite(val)) {
      const sd = Math.max(Number(stats.sd) || 1, 1e-3);
      nextZ[metric] = Number(((val - Number(stats.mean)) / sd).toFixed(2));
    }
  }

  // Exact rules formulas from engine/analysis.py
  const hrvComp = clampNum(28 + -(nextZ.hrv_rmssd_ms ?? 0) * 20, 0, 100);
  const rhrComp = clampNum(28 + Math.min(nextZ.rhr_bpm ?? 0, 5) * 14, 0, 100);
  const edaComp = clampNum(28 + (nextZ.eda_mean_us ?? 0) * 16, 0, 100);
  const moodComp = clampNum(((5 - rec.mood_1to5) / 4) * 100, 0, 100);
  const nextStress = Math.round(clampNum(0.5 * hrvComp + 0.2 * rhrComp + 0.15 * edaComp + 0.15 * moodComp, 0, 100));

  let durFromZ = 78 + clampNum(nextZ.sleep_hours ?? 0, -4.5, 2) * 14;
  if (rec.sleep_hours < 5.5) durFromZ -= (5.5 - rec.sleep_hours) * 8;
  const durComp = clampNum(durFromZ, 0, 100);
  const qualComp = clampNum(((rec.sleep_quality_1to5 - 1) / 4) * 100, 0, 100);
  const nextSleep = Math.round(clampNum(0.65 * durComp + 0.35 * qualComp, 0, 100));

  const sleepDelta = (baseEngine.sleep_score - nextSleep) * 0.35;
  const stressDelta = nextStress - baseEngine.stress_score;
  const rhrDelta = clampNum(((nextZ.rhr_bpm ?? 0) - (baseEngine.z.rhr_bpm ?? 0)) * 8, -12, 22);
  const radDelta = clampNum(((nextZ.radiation_msv ?? 0) - (baseEngine.z.radiation_msv ?? 0)) * 6, -8, 18);
  const symHad = Boolean(baseRec.symptoms && baseRec.symptoms.trim());
  const symNow = Boolean(rec.symptoms && rec.symptoms.trim());
  const symDelta = !symHad && symNow ? 18 : symHad && !symNow ? -15 : 0;
  const feverDelta = rec.temp_c >= 38.0 ? 15 : rec.temp_c <= 37.3 && baseRec.temp_c >= 38.0 ? -12 : 0;
  const resDelta = clampNum((baseRec.resistance_min - rec.resistance_min) * 0.45, -18, 25);
  const exDelta = clampNum((baseRec.exercise_min - rec.exercise_min) * 0.35, -15, 22);

  const immuneScore = Math.round(clampNum(baseEngine.risks.immune.score + sleepDelta + stressDelta * 0.28 + rhrDelta + radDelta + symDelta + feverDelta, 0, 100));
  const muscScore = Math.round(clampNum(baseEngine.risks.musculoskeletal.score + resDelta + stressDelta * 0.2 + radDelta * 0.6, 0, 100));
  const cardioScore = Math.round(clampNum(baseEngine.risks.cardio.score + exDelta + stressDelta * 0.25 + rhrDelta * 0.7 + radDelta * 0.6, 0, 100));

  let dqStatus = baseEngine.data_quality.status;
  const dqReasons = [...baseEngine.data_quality.reasons];
  if (rec.rhr_bpm > 180 || rec.rhr_bpm < 35) {
    dqStatus = "check_device";
    if (!dqReasons.some((r) => r.includes("implausible"))) {
      dqReasons.unshift(`Entered RHR (${rec.rhr_bpm} bpm) outside plausible resting range`);
    }
  } else if (rec.spo2_pct < 90 || rec.temp_c >= 39.0) {
    dqStatus = "act_now";
  } else if (symNow && dqStatus === "ok") {
    dqStatus = "check_yourself";
  }

  return {
    ...baseEngine,
    stress_score: nextStress,
    sleep_score: nextSleep,
    z: nextZ,
    risks: {
      immune: { ...baseEngine.risks.immune, score: immuneScore, level: levelFromScore(immuneScore) },
      musculoskeletal: {
        ...baseEngine.risks.musculoskeletal,
        score: muscScore,
        level: levelFromScore(muscScore),
      },
      cardio: { ...baseEngine.risks.cardio, score: cardioScore, level: levelFromScore(cardioScore) },
    },
    data_quality: {
      ...baseEngine.data_quality,
      status: dqStatus,
      reasons: dqReasons,
    },
    flags: {
      infection_early_warning:
        baseEngine.flags.infection_early_warning ||
        ((nextZ.rhr_bpm ?? 0) >= 2.0 && rec.rhr_bpm <= 180 && rec.temp_c >= 37.6),
    },
    labels: rec.source === "manual" ? ["Manual entry"] : rec.source === "wearable" ? ["Wearable sync"] : ["Camera rPPG"],
  };
}

/** Looks up the engine output for a specific astronaut and mission day (including user log overrides). */
export function getEngineDay(
  bundle: BoopsBundle | null,
  astronautId: string,
  missionDay: number,
): EngineDayOutput | null {
  if (!bundle) return null;
  const baseEngine =
    bundle.engineOutput.find(
      (item) => item.astronaut_id === astronautId && Number(item.mission_day) === Number(missionDay),
    ) ?? null;
  if (!baseEngine) return null;
  const entries = groupManualLogsByDay(astronautId).get(Number(missionDay));
  if (!entries || entries.length === 0) return baseEngine;
  const baseRec = bundle.dailyRecords.find(
    (row) => row.astronaut_id === astronautId && Number(row.mission_day) === Number(missionDay),
  );
  if (!baseRec) return baseEngine;
  const nextRec = applyEntriesToRecord(baseRec, entries);
  return recomputeEngineFromRecord(baseEngine, baseRec, nextRec);
}

/** Looks up the daily record row for a specific astronaut and mission day (including user log overrides). */
export function getDailyRecord(
  bundle: BoopsBundle | null,
  astronautId: string,
  missionDay: number,
): DailyRecordRow | null {
  if (!bundle) return null;
  const base =
    bundle.dailyRecords.find(
      (row) => row.astronaut_id === astronautId && Number(row.mission_day) === Number(missionDay),
    ) ?? null;
  if (!base) return null;
  const entries = groupManualLogsByDay(astronautId).get(Number(missionDay));
  return applyEntriesToRecord(base, entries);
}

/** Returns paired daily records + engine outputs over [startDay, endDay] (with user log overrides). */
export function getRangeSeries(
  bundle: BoopsBundle | null,
  astronautId: string,
  startDay: number,
  endDay: number,
): Array<{ record: DailyRecordRow | undefined; engine: EngineDayOutput }> {
  if (!bundle) return [];
  const logMap = groupManualLogsByDay(astronautId);
  const baseRecMap = new Map<number, DailyRecordRow>();
  const recMap = new Map<number, DailyRecordRow>();
  for (const r of bundle.dailyRecords) {
    if (r.astronaut_id === astronautId && r.mission_day >= startDay && r.mission_day <= endDay) {
      const d = Number(r.mission_day);
      baseRecMap.set(d, r);
      recMap.set(d, applyEntriesToRecord(r, logMap.get(d)));
    }
  }
  return bundle.engineOutput
    .filter((e) => e.astronaut_id === astronautId && e.mission_day >= startDay && e.mission_day <= endDay)
    .sort((a, b) => a.mission_day - b.mission_day)
    .map((engine) => {
      const d = Number(engine.mission_day);
      const baseRec = baseRecMap.get(d);
      const rec = recMap.get(d);
      return {
        record: rec,
        engine: recomputeEngineFromRecord(engine, baseRec, rec),
      };
    });
}

/** Looks up a source citation by source_id from knowledge/sources.json. */
export function getSourceCitation(bundle: BoopsBundle | null, sourceId: string): SourceEntry | null {
  if (!bundle) return null;
  return bundle.sources.find((s) => s.id === sourceId) ?? null;
}

/** Returns the crew profile for a given astronaut ID. */
export function getCrewProfile(astronautId: string): CrewProfile {
  return CREW_PROFILES.find((c) => c.id === astronautId) ?? CREW_PROFILES[0];
}

/** Computes cumulative radiation dose through missionDay (including user dosimeter overrides). */
export function getCumulativeRadiation(
  bundle: BoopsBundle | null,
  astronautId: string,
  missionDay: number,
): number {
  if (!bundle) return 0;
  const logMap = groupManualLogsByDay(astronautId);
  let total = 0;
  for (const row of bundle.dailyRecords) {
    if (row.astronaut_id === astronautId && row.mission_day <= missionDay) {
      const effective = applyEntriesToRecord(row, logMap.get(Number(row.mission_day)));
      total += Number(effective.radiation_msv) || 0;
    }
  }
  return Math.round(total * 10) / 10;
}

/** Filters exportable rows strictly according to crew-first sharing toggles. */
export function buildExportPayload(
  bundle: BoopsBundle,
  astronautId: string,
  startDay: number,
  endDay: number,
  sharing: SharingSettings,
): {
  metadata: {
    app: string;
    astronaut_id: string;
    start_day: number;
    end_day: number;
    sharing_settings: SharingSettings;
    disclaimer: string;
    labels: string[];
  };
  rows: Array<Record<string, unknown>>;
} {
  const debugMode = isDebugUiMode();
  const series = getRangeSeries(bundle, astronautId, startDay, endDay);
  const rows: Array<Record<string, unknown>> = [];

  for (const { record, engine } of series) {
    const isEmergencyDay =
      Boolean(engine.flags.infection_early_warning) ||
      engine.data_quality.status === "act_now" ||
      (record ? record.radiation_msv >= 1.5 : false);

    if (!sharing.daily_summary && !sharing.raw_data && !isEmergencyDay) {
      continue;
    }

    const rowLabels =
      record?.source === "manual" || record?.source === "camera" || record?.source === "wearable"
        ? engine.labels
        : debugMode
          ? engine.labels
          : ["On-device sync"];

    const row: Record<string, unknown> = {
      astronaut_id: engine.astronaut_id,
      mission_day: engine.mission_day,
      date: record?.date ?? "",
      labels: rowLabels.join(";"),
      is_emergency_event: isEmergencyDay,
    };

    if (sharing.daily_summary || isEmergencyDay) {
      row.stress_score = engine.stress_score;
      row.sleep_score = engine.sleep_score;
      row.immune_level = engine.risks.immune.level;
      row.immune_score = engine.risks.immune.score;
      row.musculoskeletal_level = engine.risks.musculoskeletal.level;
      row.musculoskeletal_score = engine.risks.musculoskeletal.score;
      row.cardio_level = engine.risks.cardio.level;
      row.cardio_score = engine.risks.cardio.score;
      row.data_quality_status = engine.data_quality.status;
      row.infection_early_warning = engine.flags.infection_early_warning;
      row.top_action = engine.actions[0]?.text ?? "";
    }

    if (sharing.raw_data && record) {
      row.rhr_bpm = record.rhr_bpm;
      row.hrv_rmssd_ms = record.hrv_rmssd_ms;
      row.sleep_hours = record.sleep_hours;
      row.sleep_quality_1to5 = record.sleep_quality_1to5;
      row.eda_mean_us = record.eda_mean_us;
      row.spo2_pct = record.spo2_pct;
      row.sbp_mmhg = record.sbp_mmhg;
      row.dbp_mmhg = record.dbp_mmhg;
      row.temp_c = record.temp_c;
      row.exercise_min = record.exercise_min;
      row.resistance_min = record.resistance_min;
      row.radiation_msv = record.radiation_msv;
      row.eva = record.eva;
      row.symptoms = record.symptoms;
      row.mood_1to5 = record.mood_1to5;
      row.signal_quality = record.signal_quality;
      row.source = record.source;
    }

    rows.push(row);
  }

  return {
    metadata: {
      app: "BOOPS (Biobehavioral Observation & Offline Predictive System)",
      astronaut_id: astronautId,
      start_day: startDay,
      end_day: endDay,
      sharing_settings: sharing,
      disclaimer: debugMode
        ? "Prototype · Not a medical device · All sample telemetry labeled Simulated"
        : "Prototype · Not a medical device · Offline crew export",
      labels: debugMode ? ["Simulated"] : ["On-device"],
    },
    rows,
  };
}

/** Formats export payload as CSV text. */
export function formatExportCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) {
    return "astronaut_id,mission_day,notice\n,,No shareable rows for selected sharing toggles\n";
  }
  const headers = Object.keys(rows[0]);
  const esc = (val: unknown) => {
    const str = val == null ? "" : String(val);
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push(headers.map((h) => esc(r[h])).join(","));
  }
  return lines.join("\n") + "\n";
}

/** Persists synced Health Connect / Apple HealthKit records into the active astronaut's offline logs. */
export function ingestWearableSyncRecords(
  astronautId: string,
  missionDay: number,
  provider: string,
  records: HealthSyncRecord[],
): number {
  if (!Array.isArray(records) || records.length === 0) return 0;
  const sorted = [...records].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const total = sorted.length;
  let savedCount = 0;

  sorted.forEach((rec, idx) => {
    const offset = total - 1 - idx;
    const targetDay = Math.max(1, Math.min(180, Math.round(missionDay) - offset));
    const fields: Record<string, string> = {
      Provider: provider === "apple_healthkit" ? "Apple HealthKit" : provider === "health_connect" ? "Health Connect" : provider,
      Date: rec.date,
      "Signal quality": String(rec.signal_quality ?? 0.95),
    };
    if (typeof rec.rhr_bpm === "number" && Number.isFinite(rec.rhr_bpm)) {
      fields["Resting HR"] = `${Math.round(rec.rhr_bpm)} bpm`;
    }
    if (typeof rec.hrv_rmssd_ms === "number" && Number.isFinite(rec.hrv_rmssd_ms)) {
      if (rec.hrv_metric === "sdnn") {
        fields["HRV (SDNN)"] = `${rec.hrv_rmssd_ms.toFixed(1)} ms`;
        fields["HRV metric"] = "sdnn";
      } else {
        fields["HRV (RMSSD)"] = `${rec.hrv_rmssd_ms.toFixed(1)} ms`;
        fields["HRV metric"] = "rmssd";
      }
    }
    if (typeof rec.sleep_hours === "number" && Number.isFinite(rec.sleep_hours)) {
      fields["Sleep hours"] = `${rec.sleep_hours.toFixed(1)} h`;
    }
    if (typeof rec.spo2_pct === "number" && Number.isFinite(rec.spo2_pct)) {
      fields["SpO2"] = `${rec.spo2_pct.toFixed(1)} %`;
    }
    if (typeof rec.sbp_mmhg === "number" && typeof rec.dbp_mmhg === "number") {
      fields["Blood pressure"] = `${Math.round(rec.sbp_mmhg)}/${Math.round(rec.dbp_mmhg)} mmHg`;
    }
    if (typeof rec.temp_c === "number" && Number.isFinite(rec.temp_c)) {
      fields["Body temperature"] = `${rec.temp_c.toFixed(1)} °C`;
    }
    if (typeof rec.exercise_min === "number" && Number.isFinite(rec.exercise_min)) {
      fields["Exercise"] = `${Math.round(rec.exercise_min)} min`;
    }
    if (Object.keys(fields).length <= 3) return;
    updateManualLog({
      id: `wearable-${provider}-${astronautId}-${rec.date}`,
      astronaut_id: astronautId,
      mission_day: targetDay,
      screen: "Wearable Sync",
      fields,
      saved_at: new Date().toISOString().slice(0, 19).replace("T", " ") + " UTC",
    });
    savedCount += 1;
  });

  return savedCount;
}

/** Persists a live BLE sensor reading into the active astronaut's offline logs. */
export function ingestBleReading(
  astronautId: string,
  missionDay: number,
  reading: BleReading,
): void {
  const fields: Record<string, string> = {
    Device: reading.deviceName || reading.deviceId,
    "Signal quality": String(reading.signal_quality ?? 0.94),
  };
  if (typeof reading.rhr_bpm === "number" && Number.isFinite(reading.rhr_bpm)) {
    fields["Resting HR"] = `${Math.round(reading.rhr_bpm)} bpm`;
  }
  if (typeof reading.hrv_rmssd_ms === "number" && Number.isFinite(reading.hrv_rmssd_ms)) {
    fields["HRV (RMSSD)"] = `${reading.hrv_rmssd_ms.toFixed(1)} ms`;
    fields["HRV metric"] = "rmssd";
  }
  if (typeof reading.spo2_pct === "number" && Number.isFinite(reading.spo2_pct)) {
    fields["SpO2"] = `${reading.spo2_pct.toFixed(1)} %`;
  }
  if (typeof reading.sbp_mmhg === "number" && typeof reading.dbp_mmhg === "number") {
    fields["Blood pressure"] = `${Math.round(reading.sbp_mmhg)}/${Math.round(reading.dbp_mmhg)} mmHg`;
  }
  if (typeof reading.temp_c === "number" && Number.isFinite(reading.temp_c)) {
    fields["Body temperature"] = `${reading.temp_c.toFixed(1)} °C`;
  }
  if (typeof reading.batteryPct === "number" && Number.isFinite(reading.batteryPct)) {
    fields["Battery"] = `${Math.round(reading.batteryPct)}%`;
  }

  appendManualLog({
    astronaut_id: astronautId,
    mission_day: missionDay,
    screen: "BLE Sensor",
    fields,
    saved_at: new Date().toISOString().slice(0, 19).replace("T", " ") + " UTC",
  });
}

/** Triggers an offline export via Android/Apple native file-saver bridge or browser Blob download. */
export function downloadTextFile(filename: string, content: string, mimeType: string): boolean {
  const nativeSaved = saveFileWithNativeBridge(filename, content, mimeType);
  if (nativeSaved !== null) {
    return nativeSaved;
  }
  try {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.style.display = "none";
    document.body.append(link);
    link.click();
    window.setTimeout(() => {
      link.remove();
      URL.revokeObjectURL(url);
    }, 300);
    return true;
  } catch {
    return false;
  }
}

/** Formats evidence star count cleanly for display. */
export function formatStars(stars: number): string {
  const count = Math.max(1, Math.min(3, Math.round(stars)));
  const label = count === 3 ? "Human data" : count === 2 ? "Animal + some human" : "Hypothesis";
  return `${"★".repeat(count)} ${label}`;
}

/** Capitalizes risk levels cleanly for UI badges. */
export function formatRiskLevel(level: string): string {
  if (level === "act") return "Act";
  if (level === "watch") return "Watch";
  return "Normal";
}

/** Returns asset dot filename for risk or status levels. */
export function dotForLevel(level: string): string {
  if (level === "act" || level === "act_now") return "./assets/figma/imgDotAlert.svg";
  if (level === "watch" || level === "check_device" || level === "check_yourself") {
    return "./assets/figma/imgDotWatch.svg";
  }
  return "./assets/figma/imgDotNormal.svg";
}
