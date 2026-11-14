/**
 * Offline B.O.O.P.S. data loader, local state store, and privacy-respecting export helpers.
 * Reads `window.BOOPS_DATA` (when opened via file:// with data_bundle.js) or `./data/boops_bundle.json`.
 */

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
  astronaut_id: string;
  mission_day: number;
  screen: string;
  fields: Record<string, string>;
  saved_at: string;
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

/** Persists sharing preferences while locking emergency_events to true. */
export function saveSharingSettings(next: SharingSettings): SharingSettings {
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
  return normalized;
}

/** Loads the active astronaut and mission day selection. */
export function loadSelectedContext(): PersistedContext {
  const raw = safeStorageGet("context");
  const fallback: PersistedContext = { astronautId: "A1", missionDay: 96 };
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
        : 96;
    return { astronautId, missionDay };
  } catch {
    return fallback;
  }
}

/** Saves the active astronaut and mission day selection. */
export function saveSelectedContext(ctx: PersistedContext): void {
  safeStorageSet("context", JSON.stringify(ctx));
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

/** Loads manual log submissions persisted in localStorage. */
export function loadManualLogs(): ManualLogEntry[] {
  const raw = safeStorageGet("manual_logs");
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ManualLogEntry[]) : [];
  } catch {
    return [];
  }
}

/** Appends a manual log entry to localStorage. */
export function appendManualLog(entry: ManualLogEntry): ManualLogEntry[] {
  const current = loadManualLogs();
  const next = [entry, ...current].slice(0, 60);
  safeStorageSet("manual_logs", JSON.stringify(next));
  return next;
}

/** Loads the B.O.O.P.S. offline data bundle from window.BOOPS_DATA or relative JSON. */
export async function loadBoopsBundle(): Promise<BoopsBundle | null> {
  const win = window as unknown as { BOOPS_DATA?: BoopsBundle };
  if (win.BOOPS_DATA && Array.isArray(win.BOOPS_DATA.engineOutput)) {
    return win.BOOPS_DATA;
  }
  try {
    const resp = await fetch("./data/boops_bundle.json");
    if (!resp.ok) return null;
    const data = (await resp.json()) as BoopsBundle;
    win.BOOPS_DATA = data;
    return data;
  } catch {
    return null;
  }
}

/** Looks up the engine output for a specific astronaut and mission day. */
export function getEngineDay(
  bundle: BoopsBundle | null,
  astronautId: string,
  missionDay: number,
): EngineDayOutput | null {
  if (!bundle) return null;
  return (
    bundle.engineOutput.find(
      (item) => item.astronaut_id === astronautId && Number(item.mission_day) === Number(missionDay),
    ) ?? null
  );
}

/** Looks up the daily record row for a specific astronaut and mission day. */
export function getDailyRecord(
  bundle: BoopsBundle | null,
  astronautId: string,
  missionDay: number,
): DailyRecordRow | null {
  if (!bundle) return null;
  return (
    bundle.dailyRecords.find(
      (row) => row.astronaut_id === astronautId && Number(row.mission_day) === Number(missionDay),
    ) ?? null
  );
}

/** Returns paired daily records + engine outputs over [startDay, endDay]. */
export function getRangeSeries(
  bundle: BoopsBundle | null,
  astronautId: string,
  startDay: number,
  endDay: number,
): Array<{ record: DailyRecordRow | undefined; engine: EngineDayOutput }> {
  if (!bundle) return [];
  const recMap = new Map<number, DailyRecordRow>();
  for (const r of bundle.dailyRecords) {
    if (r.astronaut_id === astronautId && r.mission_day >= startDay && r.mission_day <= endDay) {
      recMap.set(Number(r.mission_day), r);
    }
  }
  return bundle.engineOutput
    .filter((e) => e.astronaut_id === astronautId && e.mission_day >= startDay && e.mission_day <= endDay)
    .sort((a, b) => a.mission_day - b.mission_day)
    .map((engine) => ({ record: recMap.get(Number(engine.mission_day)), engine }));
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

/** Computes cumulative radiation dose through missionDay (simulated baseline for demo). */
export function getCumulativeRadiation(
  bundle: BoopsBundle | null,
  astronautId: string,
  missionDay: number,
): number {
  if (!bundle) return 0;
  let total = 0;
  for (const row of bundle.dailyRecords) {
    if (row.astronaut_id === astronautId && row.mission_day <= missionDay) {
      total += Number(row.radiation_msv) || 0;
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

    const row: Record<string, unknown> = {
      astronaut_id: engine.astronaut_id,
      mission_day: engine.mission_day,
      date: record?.date ?? "",
      labels: engine.labels.join(";"),
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
      app: "B.O.O.P.S. (Biobehavioral Observation & Offline Predictive System)",
      astronaut_id: astronautId,
      start_day: startDay,
      end_day: endDay,
      sharing_settings: sharing,
      disclaimer: "Prototype · Not a medical device · All sample telemetry labeled Simulated",
      labels: ["Simulated"],
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

/** Triggers an offline browser Blob download without any network call. */
export function downloadTextFile(filename: string, content: string, mimeType: string): boolean {
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
