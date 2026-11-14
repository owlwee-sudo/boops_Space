//! Simulated crew vitals for the dashboard.
//!
//! Every reading is a pure function of time, so the UI can poll as often as it
//! likes and nothing is stored between calls. `ui/src/services/simulator.ts` is
//! a line-for-line TypeScript port used when the UI runs in a plain browser;
//! the tests at the bottom pin both to the same reference numbers.
//!
//! Swap `sample` for real sensor input when hardware data is available.

use serde::Serialize;
use std::f64::consts::PI;

pub const MISSION_NAME: &str = "Expedition 07";
/// 2026-06-25T00:00:00Z
pub const MISSION_START_UNIX: i64 = 1_782_345_600;
const CAREER_LIMIT_MSV: f64 = 600.0;
const MISSION_LENGTH_DAYS: f64 = 180.0;
const SLEEP_TARGET_MIN: u32 = 480;
const SHORT_SLEEP_MIN: u32 = 360;

// ---------------------------------------------------------------------------
// Types sent to the UI (mirrors ui/src/types.ts)
// ---------------------------------------------------------------------------

/// Declaration order matters: `Ord` makes `Alert` the "worst".
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Nominal,
    Watch,
    Alert,
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum VitalKey {
    HeartRate,
    Spo2,
    Temperature,
    BloodPressure,
    Respiration,
}

const KEYS: [VitalKey; 5] = [
    VitalKey::HeartRate,
    VitalKey::Spo2,
    VitalKey::Temperature,
    VitalKey::BloodPressure,
    VitalKey::Respiration,
];

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SpaceWeather {
    Quiet,
    Elevated,
    Storm,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Vital {
    pub key: VitalKey,
    pub value: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub secondary: Option<f64>,
    pub status: Status,
    pub history: Vec<f64>,
    pub delta_vs_hour: f64,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TrendSeries {
    pub key: VitalKey,
    pub values: Vec<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub secondary: Option<Vec<f64>>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CrewMember {
    pub id: &'static str,
    pub name: &'static str,
    pub role: &'static str,
    pub initials: &'static str,
    pub module: &'static str,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Radiation {
    pub cumulative_msv: f64,
    pub career_limit_msv: f64,
    pub today_msv: f64,
    pub daily_avg_msv: f64,
    pub projected_mission_msv: f64,
    pub space_weather: SpaceWeather,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct SleepStages {
    pub deep: u32,
    pub light: u32,
    pub rem: u32,
    pub awake: u32,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Sleep {
    pub last_minutes: u32,
    pub target_minutes: u32,
    pub stages: SleepStages,
    pub last7: Vec<u32>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CrewHealth {
    pub member: CrewMember,
    pub status: Status,
    pub vitals: Vec<Vital>,
    pub trend24h: Vec<TrendSeries>,
    pub radiation: Radiation,
    pub sleep: Sleep,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Alert {
    pub id: String,
    pub crew_id: String,
    pub severity: Status,
    pub title: String,
    pub detail: String,
    pub minutes_ago: i64,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MissionSnapshot {
    pub mission_name: &'static str,
    pub mission_day: i64,
    pub met_seconds: i64,
    pub source: &'static str,
    pub crew: Vec<CrewHealth>,
    pub alerts: Vec<Alert>,
}

// ---------------------------------------------------------------------------
// Crew and signal model
// ---------------------------------------------------------------------------

const CREW: [CrewMember; 4] = [
    CrewMember { id: "okafor", name: "Amara Okafor", role: "Commander", initials: "AO", module: "Airlock" },
    CrewMember { id: "park", name: "Jun Park", role: "Pilot", initials: "JP", module: "Node 1" },
    CrewMember { id: "fischer", name: "Lena Fischer", role: "Flight engineer", initials: "LF", module: "Lab" },
    CrewMember { id: "ramos", name: "Diego Ramos", role: "Mission specialist", initials: "DR", module: "Habitat" },
];

// Channels: heart rate, SpO2, temperature, systolic, diastolic, respiration.
const HR: usize = 0;
const SPO2: usize = 1;
const TEMP: usize = 2;
const SYS: usize = 3;
const DIA: usize = 4;
const RESP: usize = 5;

const BASELINE: [[f64; 6]; 4] = [
    [74.0, 97.6, 36.8, 118.0, 76.0, 15.0],
    [64.0, 98.2, 36.6, 114.0, 72.0, 15.0],
    [70.0, 95.6, 37.2, 121.0, 79.0, 16.0],
    [63.0, 98.4, 36.7, 116.0, 74.0, 14.5],
];
/// Decimals shown in the UI; status is judged on the value as displayed.
const PRECISION: [i32; 6] = [0, 0, 1, 0, 0, 0];
const CIRCADIAN_AMP: [f64; 6] = [6.0, 0.3, 0.3, 6.0, 4.0, 1.2];
const WAVE_AMP: [f64; 6] = [3.0, 0.4, 0.08, 3.0, 2.0, 0.8];
const NOISE_AMP: [f64; 6] = [2.0, 0.4, 0.05, 2.0, 1.5, 0.6];
/// (low, high, watch margin) per channel.
const LIMITS: [(f64, f64, f64); 6] = [
    (50.0, 100.0, 20.0),
    (95.0, 100.0, 3.0),
    (36.1, 37.5, 0.5),
    (90.0, 130.0, 10.0),
    (60.0, 85.0, 7.0),
    (12.0, 20.0, 4.0),
];
const DAILY_DOSE_MSV: [f64; 4] = [0.68, 0.56, 0.6, 0.58];
const SLEEP_BASE_MIN: [f64; 4] = [430.0, 312.0, 405.0, 455.0];

/// lowbias32 integer hash → [0, 1). Must match `hash01` in simulator.ts.
pub fn hash01(seed: u32) -> f64 {
    let mut x = seed;
    x ^= x >> 16;
    x = x.wrapping_mul(0x7feb_352d);
    x ^= x >> 15;
    x = x.wrapping_mul(0x846c_a68b);
    x ^= x >> 16;
    x as f64 / 4_294_967_296.0
}

fn seed(crew: usize, channel: usize, bucket: i64) -> u32 {
    (crew as u32)
        .wrapping_mul(1_000_003)
        .wrapping_add((channel as u32).wrapping_mul(7919))
        .wrapping_add(bucket as u32)
}

/// Simulated reading for one crew member and channel at unix time `t` (seconds).
pub fn sample(crew: usize, ch: usize, t: i64) -> f64 {
    let tf = t as f64;
    let hours = (tf / 3600.0) % 24.0;
    let circadian = (2.0 * PI * (hours - 15.0) / 24.0).cos();
    let wave = (2.0 * PI * tf / 660.0 + crew as f64 * 1.7 + ch as f64 * 0.9).sin();
    let noise = hash01(seed(crew, ch, t.div_euclid(15))) * 2.0 - 1.0;

    let mut v = BASELINE[crew][ch]
        + CIRCADIAN_AMP[ch] * circadian
        + WAVE_AMP[ch] * wave
        + NOISE_AMP[ch] * noise;

    // The commander trains for an EVA: a 3-hour exercise block every 6 hours.
    if crew == 0 {
        let load = (2.0 * PI * tf / 21_600.0).sin().max(0.0).powi(2);
        match ch {
            HR => v += 30.0 * load,
            SYS => v += 8.0 * load,
            RESP => v += 5.0 * load,
            _ => {}
        }
    }
    if ch == SPO2 {
        v = v.min(100.0);
    }
    v
}

fn round_to(v: f64, decimals: i32) -> f64 {
    let f = 10f64.powi(decimals);
    (v * f).round() / f
}

pub fn channel_status(ch: usize, raw: f64) -> Status {
    let (lo, hi, margin) = LIMITS[ch];
    let v = round_to(raw, PRECISION[ch]);
    if v >= lo && v <= hi {
        Status::Nominal
    } else if v >= lo - margin && v <= hi + margin {
        Status::Watch
    } else {
        Status::Alert
    }
}

fn channels_for(key: VitalKey) -> (usize, Option<usize>) {
    match key {
        VitalKey::HeartRate => (HR, None),
        VitalKey::Spo2 => (SPO2, None),
        VitalKey::Temperature => (TEMP, None),
        VitalKey::BloodPressure => (SYS, Some(DIA)),
        VitalKey::Respiration => (RESP, None),
    }
}

fn vital_status_at(crew: usize, key: VitalKey, t: i64) -> Status {
    let (primary, secondary) = channels_for(key);
    let mut status = channel_status(primary, sample(crew, primary, t));
    if let Some(ch) = secondary {
        status = status.max(channel_status(ch, sample(crew, ch, t)));
    }
    status
}

fn build_vital(crew: usize, key: VitalKey, t: i64) -> Vital {
    let (primary, secondary) = channels_for(key);
    let value = sample(crew, primary, t);
    let history = (0..40).map(|k| sample(crew, primary, t - (39 - k) * 15)).collect();
    let hour_avg = (1..=12).map(|k| sample(crew, primary, t - k * 300)).sum::<f64>() / 12.0;
    Vital {
        key,
        value,
        secondary: secondary.map(|ch| sample(crew, ch, t)),
        status: vital_status_at(crew, key, t),
        history,
        delta_vs_hour: value - hour_avg,
    }
}

fn build_trend(crew: usize, key: VitalKey, t: i64) -> TrendSeries {
    let (primary, secondary) = channels_for(key);
    let at = |ch: usize| -> Vec<f64> { (0..48).map(|k| sample(crew, ch, t - (47 - k) * 1800)).collect() };
    TrendSeries { key, values: at(primary), secondary: secondary.map(at) }
}

pub fn space_weather_for(day: i64) -> SpaceWeather {
    let r = hash01((day as u32).wrapping_mul(31).wrapping_add(7));
    if r < 0.7 {
        SpaceWeather::Quiet
    } else if r < 0.93 {
        SpaceWeather::Elevated
    } else {
        SpaceWeather::Storm
    }
}

fn build_radiation(crew: usize, met_seconds: i64, weather: SpaceWeather) -> Radiation {
    let days = met_seconds as f64 / 86_400.0;
    let rate = DAILY_DOSE_MSV[crew];
    let factor = match weather {
        SpaceWeather::Storm => 2.5,
        SpaceWeather::Elevated => 1.3,
        SpaceWeather::Quiet => 1.0,
    };
    Radiation {
        cumulative_msv: days * rate,
        career_limit_msv: CAREER_LIMIT_MSV,
        today_msv: rate * days.fract() * factor,
        daily_avg_msv: rate,
        projected_mission_msv: MISSION_LENGTH_DAYS * rate,
        space_weather: weather,
    }
}

fn build_sleep(crew: usize, mission_day: i64) -> Sleep {
    let c = crew as u32;
    let last7: Vec<u32> = (0..7)
        .map(|i| {
            let night = (mission_day - 6 + i) as u32;
            let jitter = (hash01(c.wrapping_mul(977).wrapping_add(night.wrapping_mul(13)).wrapping_add(5)) * 2.0 - 1.0) * 35.0;
            (SLEEP_BASE_MIN[crew] + jitter).round() as u32
        })
        .collect();
    let last = last7[6];
    let h = |salt: u32| hash01(c.wrapping_mul(131).wrapping_add((mission_day as u32).wrapping_mul(17)).wrapping_add(salt));
    let share = |base: f64, spread: f64, salt: u32| (last as f64 * (base + spread * h(salt))).round() as u32;
    let awake = share(0.05, 0.03, 1);
    let deep = share(0.17, 0.05, 2);
    let rem = share(0.2, 0.05, 3);
    Sleep {
        last_minutes: last,
        target_minutes: SLEEP_TARGET_MIN,
        stages: SleepStages { deep, light: last - awake - deep - rem, rem, awake },
        last7,
    }
}

fn vital_label(key: VitalKey) -> (&'static str, &'static str) {
    match key {
        VitalKey::HeartRate => ("Heart rate", "bpm"),
        VitalKey::Spo2 => ("Blood oxygen", "%"),
        VitalKey::Temperature => ("Body temperature", "°C"),
        VitalKey::BloodPressure => ("Blood pressure", "mmHg"),
        VitalKey::Respiration => ("Respiration rate", "br/min"),
    }
}

fn vital_alert(crew: usize, member: &CrewMember, vital: &Vital, t: i64) -> Alert {
    let (label, unit) = vital_label(vital.key);
    let (primary, secondary) = channels_for(vital.key);
    let decimals = if vital.key == VitalKey::Temperature { 1 } else { 0 };

    // For blood pressure, report whichever of systolic/diastolic is out of range.
    let (out_ch, out_value) = match (secondary, vital.secondary) {
        (Some(ch), Some(v)) if channel_status(primary, vital.value) == Status::Nominal => (ch, v),
        _ => (primary, vital.value),
    };
    let direction = if out_value > LIMITS[out_ch].1 { "above" } else { "below" };

    let reading = match vital.secondary {
        Some(dia) => format!("{:.0}/{:.0}", vital.value, dia),
        None => format!("{:.*}", decimals, vital.value),
    };
    let range_of = |ch: usize| format!("{:.*}–{:.*}", decimals, LIMITS[ch].0, decimals, LIMITS[ch].1);
    let normal = match secondary {
        Some(ch) => format!("{}/{}", range_of(primary), range_of(ch)),
        None => range_of(primary),
    };

    let mut minutes = 0;
    while minutes < 180 && vital_status_at(crew, vital.key, t - (minutes + 1) * 60) != Status::Nominal {
        minutes += 1;
    }

    Alert {
        id: format!("{}-{}", member.id, key_id(vital.key)),
        crew_id: member.id.to_string(),
        severity: if vital.status == Status::Alert { Status::Alert } else { Status::Watch },
        title: format!("{label} {direction} normal"),
        detail: format!("{} · {reading} {unit} (normal {normal})", member.name),
        minutes_ago: minutes,
    }
}

fn key_id(key: VitalKey) -> &'static str {
    match key {
        VitalKey::HeartRate => "heartRate",
        VitalKey::Spo2 => "spo2",
        VitalKey::Temperature => "temperature",
        VitalKey::BloodPressure => "bloodPressure",
        VitalKey::Respiration => "respiration",
    }
}

/// Full dashboard snapshot at unix time `now_unix` (seconds).
pub fn snapshot(now_unix: i64) -> MissionSnapshot {
    let t = now_unix;
    let met_seconds = t - MISSION_START_UNIX;
    let mission_day = met_seconds.div_euclid(86_400) + 1;
    let weather = space_weather_for(mission_day);
    let minute_of_day = t.rem_euclid(86_400) / 60;
    let mut alerts = Vec::new();

    let crew = CREW
        .iter()
        .enumerate()
        .map(|(i, member)| {
            let vitals: Vec<Vital> = KEYS.iter().map(|&key| build_vital(i, key, t)).collect();
            let sleep = build_sleep(i, mission_day);
            let radiation = build_radiation(i, met_seconds, weather);

            for vital in vitals.iter().filter(|v| v.status != Status::Nominal) {
                alerts.push(vital_alert(i, member, vital, t));
            }

            let short_nights = sleep.last7.iter().rev().take_while(|&&m| m < SHORT_SLEEP_MIN).count();
            let sleep_status = if sleep.last_minutes < SHORT_SLEEP_MIN { Status::Watch } else { Status::Nominal };
            if sleep_status == Status::Watch {
                alerts.push(Alert {
                    id: format!("{}-sleep-{}", member.id, mission_day),
                    crew_id: member.id.to_string(),
                    severity: Status::Watch,
                    title: "Short sleep".to_string(),
                    detail: format!(
                        "{} · {}h {:02}m last rest · {} short night{} in a row",
                        member.name,
                        sleep.last_minutes / 60,
                        sleep.last_minutes % 60,
                        short_nights,
                        if short_nights == 1 { "" } else { "s" }
                    ),
                    minutes_ago: (minute_of_day - 360).rem_euclid(1440),
                });
            }

            let status = vitals.iter().map(|v| v.status).fold(sleep_status, Status::max);
            CrewHealth {
                member: member.clone(),
                status,
                trend24h: KEYS.iter().map(|&key| build_trend(i, key, t)).collect(),
                vitals,
                radiation,
                sleep,
            }
        })
        .collect();

    if weather != SpaceWeather::Quiet {
        let storm = weather == SpaceWeather::Storm;
        alerts.push(Alert {
            id: format!("space-weather-{mission_day}"),
            crew_id: "all".to_string(),
            severity: if storm { Status::Alert } else { Status::Watch },
            title: if storm { "Solar particle event" } else { "Solar activity elevated" }.to_string(),
            detail: if storm {
                "All crew · Move to the storm shelter, suspend EVAs"
            } else {
                "All crew · Limit EVA time and watch dose rate"
            }
            .to_string(),
            minutes_ago: minute_of_day,
        });
    }

    alerts.sort_by(|a, b| b.severity.cmp(&a.severity).then(a.minutes_ago.cmp(&b.minutes_ago)));

    MissionSnapshot { mission_name: MISSION_NAME, mission_day, met_seconds, source: "rust", crew, alerts }
}

// ---------------------------------------------------------------------------
// Tests: reference numbers come from the TypeScript simulator, so a failure
// here means the two implementations have drifted apart.
// ---------------------------------------------------------------------------
#[cfg(test)]
mod tests {
    use super::*;

    /// MISSION_START_UNIX + 142 days + 08:20:34
    const T: i64 = 1_794_644_434;

    fn close(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-9
    }

    #[test]
    fn hash_matches_typescript() {
        assert!(close(hash01(1), 0.408_349_081_873_893_74));
        assert!(close(hash01(12_345), 0.567_123_232_176_527_4));
        assert!(close(hash01(4_000_000_000), 0.785_181_886_050_850_2));
    }

    #[test]
    fn samples_match_typescript() {
        assert!(close(sample(0, HR, T), 89.867_279_683_434_93));
        assert!(close(sample(2, SPO2, T), 95.661_999_337_017_86));
        assert!(close(sample(0, SYS, T), 115.933_554_498_858_53));
    }

    #[test]
    fn snapshot_matches_typescript() {
        let snap = snapshot(T);
        assert_eq!(snap.mission_day, 143);
        assert_eq!(snap.crew.len(), 4);

        let park = &snap.crew[1];
        assert_eq!(park.sleep.last7, vec![303, 280, 309, 291, 312, 314, 336]);
        assert_eq!(park.sleep.stages, SleepStages { deep: 60, light: 177, rem: 77, awake: 22 });

        let statuses: Vec<Status> = snap.crew.iter().map(|c| c.status).collect();
        assert_eq!(statuses, vec![Status::Nominal, Status::Watch, Status::Nominal, Status::Nominal]);

        assert_eq!(snap.alerts.len(), 1);
        assert_eq!(snap.alerts[0].id, "park-sleep-143");
        assert_eq!(snap.alerts[0].minutes_ago, 140);
    }

    #[test]
    fn snapshot_shape() {
        let snap = snapshot(T);
        for crew in &snap.crew {
            assert_eq!(crew.vitals.len(), 5);
            assert_eq!(crew.trend24h.len(), 5);
            for vital in &crew.vitals {
                assert_eq!(vital.history.len(), 40);
                assert_eq!(vital.secondary.is_some(), vital.key == VitalKey::BloodPressure);
            }
            for series in &crew.trend24h {
                assert_eq!(series.values.len(), 48);
            }
        }
    }

    #[test]
    fn status_thresholds() {
        assert_eq!(channel_status(HR, 72.0), Status::Nominal);
        assert_eq!(channel_status(HR, 100.4), Status::Nominal); // shows as 100
        assert_eq!(channel_status(HR, 110.0), Status::Watch);
        assert_eq!(channel_status(HR, 125.0), Status::Alert);
        assert_eq!(channel_status(SPO2, 93.0), Status::Watch);
        assert_eq!(channel_status(SPO2, 90.0), Status::Alert);
        assert_eq!(channel_status(TEMP, 37.54), Status::Nominal); // shows as 37.5
        assert_eq!(channel_status(TEMP, 37.56), Status::Watch); // shows as 37.6
    }

    #[test]
    fn json_uses_camel_case_like_the_ui() {
        let json = serde_json::to_string(&snapshot(T)).unwrap();
        for field in ["\"missionDay\"", "\"metSeconds\"", "\"deltaVsHour\"", "\"heartRate\"", "\"cumulativeMsv\"", "\"trend24h\"", "\"last7\"", "\"minutesAgo\"", "\"crewId\""] {
            assert!(json.contains(field), "missing {field}");
        }
        assert!(json.contains("\"source\":\"rust\""));
        assert!(json.contains("\"status\":\"watch\""));
    }
}
