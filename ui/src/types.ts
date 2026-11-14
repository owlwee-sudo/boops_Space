// Shapes shared by the Rust core (src-tauri/src/vitals.rs) and the UI.
// Keep both sides in sync: Rust serialises these with camelCase field names.

export type Status = "nominal" | "watch" | "alert";

export type VitalKey = "heartRate" | "spo2" | "temperature" | "bloodPressure" | "respiration";

export interface Vital {
  key: VitalKey;
  /** Primary reading (systolic for blood pressure). */
  value: number;
  /** Diastolic for blood pressure, absent for other vitals. */
  secondary?: number;
  status: Status;
  /** Last 10 minutes, one sample every 15 s, oldest first. */
  history: number[];
  /** Current value minus the average of the past hour. */
  deltaVsHour: number;
}

export interface TrendSeries {
  key: VitalKey;
  /** Last 24 h, one sample every 30 min, oldest first. */
  values: number[];
  secondary?: number[];
}

export interface CrewMember {
  id: string;
  name: string;
  role: string;
  initials: string;
  module: string;
}

export type SpaceWeather = "quiet" | "elevated" | "storm";

export interface Radiation {
  cumulativeMsv: number;
  careerLimitMsv: number;
  todayMsv: number;
  dailyAvgMsv: number;
  /** Expected total at the end of the mission at the current daily average. */
  projectedMissionMsv: number;
  spaceWeather: SpaceWeather;
}

export interface SleepStages {
  deep: number;
  light: number;
  rem: number;
  awake: number;
}

export interface Sleep {
  lastMinutes: number;
  targetMinutes: number;
  /** Minutes in each stage during the last rest period. */
  stages: SleepStages;
  /** Total minutes for the last 7 rest periods, oldest first. */
  last7: number[];
}

export interface CrewHealth {
  member: CrewMember;
  status: Status;
  vitals: Vital[];
  trend24h: TrendSeries[];
  radiation: Radiation;
  sleep: Sleep;
}

export interface Alert {
  id: string;
  crewId: string;
  severity: Exclude<Status, "nominal">;
  title: string;
  detail: string;
  minutesAgo: number;
}

export interface MissionSnapshot {
  missionName: string;
  missionDay: number;
  metSeconds: number;
  source: "rust" | "browser";
  crew: CrewHealth[];
  alerts: Alert[];
}
