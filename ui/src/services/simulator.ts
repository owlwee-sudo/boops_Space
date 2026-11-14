// Browser fallback for the Rust core. This is a line-for-line port of
// src-tauri/src/vitals.rs so `npm run dev` shows the same data without Rust.
// Every reading is a pure function of time, so no state is kept between calls.

import type {
  Alert,
  CrewHealth,
  CrewMember,
  MissionSnapshot,
  Radiation,
  Sleep,
  SpaceWeather,
  Status,
  TrendSeries,
  Vital,
  VitalKey,
} from "../types";

export const MISSION_NAME = "Expedition 07";
/** 2026-06-25T00:00:00Z */
export const MISSION_START_UNIX = 1_782_345_600;
const CAREER_LIMIT_MSV = 600;
const MISSION_LENGTH_DAYS = 180;
const SLEEP_TARGET_MIN = 480;
const SHORT_SLEEP_MIN = 360;

const CREW: CrewMember[] = [
  { id: "okafor", name: "Amara Okafor", role: "Commander", initials: "AO", module: "Airlock" },
  { id: "park", name: "Jun Park", role: "Pilot", initials: "JP", module: "Node 1" },
  { id: "fischer", name: "Lena Fischer", role: "Flight engineer", initials: "LF", module: "Lab" },
  { id: "ramos", name: "Diego Ramos", role: "Mission specialist", initials: "DR", module: "Habitat" },
];

// Channel order: heart rate, SpO2, temperature, systolic, diastolic, respiration.
const HR = 0, SPO2 = 1, TEMP = 2, SYS = 3, DIA = 4, RESP = 5;
type Channel = number;

const BASELINE: number[][] = [
  [74, 97.6, 36.8, 118, 76, 15],
  [64, 98.2, 36.6, 114, 72, 15],
  [70, 95.6, 37.2, 121, 79, 16],
  [63, 98.4, 36.7, 116, 74, 14.5],
];
/** Decimals shown in the UI; status is judged on the value as displayed. */
const PRECISION = [0, 0, 1, 0, 0, 0];
const CIRCADIAN_AMP = [6, 0.3, 0.3, 6, 4, 1.2];
const WAVE_AMP = [3, 0.4, 0.08, 3, 2, 0.8];
const NOISE_AMP = [2, 0.4, 0.05, 2, 1.5, 0.6];
/** [low, high, watch margin] per channel. */
const LIMITS: [number, number, number][] = [
  [50, 100, 20],
  [95, 100, 3],
  [36.1, 37.5, 0.5],
  [90, 130, 10],
  [60, 85, 7],
  [12, 20, 4],
];
const DAILY_DOSE_MSV = [0.68, 0.56, 0.6, 0.58];
const SLEEP_BASE_MIN = [430, 312, 405, 455];

const VITAL_LABEL: Record<VitalKey, [string, string]> = {
  heartRate: ["Heart rate", "bpm"],
  spo2: ["Blood oxygen", "%"],
  temperature: ["Body temperature", "°C"],
  bloodPressure: ["Blood pressure", "mmHg"],
  respiration: ["Respiration rate", "br/min"],
};

/** lowbias32 integer hash → [0, 1). Matches `hash01` in vitals.rs. */
export function hash01(seed: number): number {
  let x = seed >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

function seed(crew: number, channel: number, bucket: number): number {
  return (Math.imul(crew, 1_000_003) + Math.imul(channel, 7919) + (bucket >>> 0)) >>> 0;
}

/** Simulated reading for one crew member and channel at unix time `t` (seconds). */
export function sample(crew: number, ch: Channel, t: number): number {
  const hours = (t / 3600) % 24;
  const circadian = Math.cos((2 * Math.PI * (hours - 15)) / 24);
  const wave = Math.sin((2 * Math.PI * t) / 660 + crew * 1.7 + ch * 0.9);
  const noise = hash01(seed(crew, ch, Math.floor(t / 15))) * 2 - 1;

  let v = BASELINE[crew][ch] + CIRCADIAN_AMP[ch] * circadian + WAVE_AMP[ch] * wave + NOISE_AMP[ch] * noise;

  // The commander trains for an EVA: a 3-hour exercise block every 6 hours.
  if (crew === 0) {
    const load = Math.max(0, Math.sin((2 * Math.PI * t) / 21600)) ** 2;
    if (ch === HR) v += 30 * load;
    if (ch === SYS) v += 8 * load;
    if (ch === RESP) v += 5 * load;
  }
  if (ch === SPO2) v = Math.min(v, 100);
  return v;
}

export function channelStatus(ch: Channel, raw: number): Status {
  const [lo, hi, margin] = LIMITS[ch];
  const v = Number(raw.toFixed(PRECISION[ch]));
  if (v >= lo && v <= hi) return "nominal";
  if (v >= lo - margin && v <= hi + margin) return "watch";
  return "alert";
}

const RANK: Record<Status, number> = { nominal: 0, watch: 1, alert: 2 };
export function worst(...statuses: Status[]): Status {
  return statuses.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), "nominal");
}

function channelsFor(key: VitalKey): Channel[] {
  switch (key) {
    case "heartRate": return [HR];
    case "spo2": return [SPO2];
    case "temperature": return [TEMP];
    case "bloodPressure": return [SYS, DIA];
    case "respiration": return [RESP];
  }
}

const KEYS: VitalKey[] = ["heartRate", "spo2", "temperature", "bloodPressure", "respiration"];

function vitalStatusAt(crew: number, key: VitalKey, t: number): Status {
  return worst(...channelsFor(key).map((ch) => channelStatus(ch, sample(crew, ch, t))));
}

function buildVital(crew: number, key: VitalKey, t: number): Vital {
  const [primary, secondary] = channelsFor(key);
  const value = sample(crew, primary, t);
  const history = Array.from({ length: 40 }, (_, k) => sample(crew, primary, t - (39 - k) * 15));
  let hourSum = 0;
  for (let k = 1; k <= 12; k++) hourSum += sample(crew, primary, t - k * 300);
  return {
    key,
    value,
    secondary: secondary != null ? sample(crew, secondary, t) : undefined,
    status: vitalStatusAt(crew, key, t),
    history,
    deltaVsHour: value - hourSum / 12,
  };
}

function buildTrend(crew: number, key: VitalKey, t: number): TrendSeries {
  const [primary, secondary] = channelsFor(key);
  const at = (ch: Channel) => Array.from({ length: 48 }, (_, k) => sample(crew, ch, t - (47 - k) * 1800));
  return { key, values: at(primary), secondary: secondary != null ? at(secondary) : undefined };
}

export function spaceWeatherFor(day: number): SpaceWeather {
  const r = hash01(Math.imul(day, 31) + 7);
  if (r < 0.7) return "quiet";
  if (r < 0.93) return "elevated";
  return "storm";
}

function buildRadiation(crew: number, metSeconds: number, weather: SpaceWeather): Radiation {
  const days = metSeconds / 86400;
  const rate = DAILY_DOSE_MSV[crew];
  const factor = weather === "storm" ? 2.5 : weather === "elevated" ? 1.3 : 1;
  return {
    cumulativeMsv: days * rate,
    careerLimitMsv: CAREER_LIMIT_MSV,
    todayMsv: rate * (days % 1) * factor,
    dailyAvgMsv: rate,
    projectedMissionMsv: MISSION_LENGTH_DAYS * rate,
    spaceWeather: weather,
  };
}

function buildSleep(crew: number, missionDay: number): Sleep {
  const last7 = Array.from({ length: 7 }, (_, i) => {
    const night = missionDay - 6 + i;
    const jitter = (hash01(Math.imul(crew, 977) + Math.imul(night, 13) + 5) * 2 - 1) * 35;
    return Math.round(SLEEP_BASE_MIN[crew] + jitter);
  });
  const last = last7[6];
  const h = (salt: number) => hash01(Math.imul(crew, 131) + Math.imul(missionDay, 17) + salt);
  const awake = Math.round(last * (0.05 + 0.03 * h(1)));
  const deep = Math.round(last * (0.17 + 0.05 * h(2)));
  const rem = Math.round(last * (0.2 + 0.05 * h(3)));
  return {
    lastMinutes: last,
    targetMinutes: SLEEP_TARGET_MIN,
    stages: { deep, light: last - awake - deep - rem, rem, awake },
    last7,
  };
}

function formatFixed(v: number, decimals: number) {
  return v.toFixed(decimals);
}

function vitalAlert(crew: number, member: CrewMember, vital: Vital, t: number): Alert {
  const [label, unit] = VITAL_LABEL[vital.key];
  const [primary, secondary] = channelsFor(vital.key);
  const outOfRangeCh =
    secondary != null && channelStatus(primary, vital.value) === "nominal" ? secondary : primary;
  const outValue = outOfRangeCh === primary ? vital.value : vital.secondary!;
  const direction = outValue > LIMITS[outOfRangeCh][1] ? "above" : "below";
  const decimals = vital.key === "temperature" ? 1 : 0;
  const reading =
    vital.secondary != null
      ? `${formatFixed(vital.value, 0)}/${formatFixed(vital.secondary, 0)}`
      : formatFixed(vital.value, decimals);
  const rangeOf = (ch: Channel) => `${formatFixed(LIMITS[ch][0], decimals)}–${formatFixed(LIMITS[ch][1], decimals)}`;
  const normal = secondary != null ? `${rangeOf(primary)}/${rangeOf(secondary)}` : rangeOf(primary);

  let minutes = 0;
  while (minutes < 180 && vitalStatusAt(crew, vital.key, t - (minutes + 1) * 60) !== "nominal") minutes++;

  return {
    id: `${member.id}-${vital.key}`,
    crewId: member.id,
    severity: vital.status === "alert" ? "alert" : "watch",
    title: `${label} ${direction} normal`,
    detail: `${member.name} · ${reading} ${unit} (normal ${normal})`,
    minutesAgo: minutes,
  };
}

function formatDurationShort(min: number) {
  return `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, "0")}m`;
}

export function simulateSnapshot(nowUnix: number): MissionSnapshot {
  const t = Math.floor(nowUnix);
  const metSeconds = t - MISSION_START_UNIX;
  const missionDay = Math.floor(metSeconds / 86400) + 1;
  const weather = spaceWeatherFor(missionDay);
  const minuteOfDay = Math.floor((t % 86400) / 60);
  const alerts: Alert[] = [];

  const crew: CrewHealth[] = CREW.map((member, i) => {
    const vitals = KEYS.map((key) => buildVital(i, key, t));
    const sleep = buildSleep(i, missionDay);
    const radiation = buildRadiation(i, metSeconds, weather);

    for (const vital of vitals) {
      if (vital.status !== "nominal") alerts.push(vitalAlert(i, member, vital, t));
    }

    let shortNights = 0;
    for (let k = 6; k >= 0 && sleep.last7[k] < SHORT_SLEEP_MIN; k--) shortNights++;
    const sleepStatus: Status = sleep.lastMinutes < SHORT_SLEEP_MIN ? "watch" : "nominal";
    if (sleepStatus === "watch") {
      alerts.push({
        id: `${member.id}-sleep-${missionDay}`,
        crewId: member.id,
        severity: "watch",
        title: "Short sleep",
        detail: `${member.name} · ${formatDurationShort(sleep.lastMinutes)} last rest · ${shortNights} short night${shortNights === 1 ? "" : "s"} in a row`,
        minutesAgo: (minuteOfDay - 360 + 1440) % 1440,
      });
    }

    return {
      member,
      status: worst(sleepStatus, ...vitals.map((v) => v.status)),
      vitals,
      trend24h: KEYS.map((key) => buildTrend(i, key, t)),
      radiation,
      sleep,
    };
  });

  if (weather !== "quiet") {
    alerts.push({
      id: `space-weather-${missionDay}`,
      crewId: "all",
      severity: weather === "storm" ? "alert" : "watch",
      title: weather === "storm" ? "Solar particle event" : "Solar activity elevated",
      detail:
        weather === "storm"
          ? "All crew · Move to the storm shelter, suspend EVAs"
          : "All crew · Limit EVA time and watch dose rate",
      minutesAgo: minuteOfDay,
    });
  }

  alerts.sort((a, b) => RANK[b.severity] - RANK[a.severity] || a.minutesAgo - b.minutesAgo);

  return { missionName: MISSION_NAME, missionDay, metSeconds, source: "browser", crew, alerts };
}
