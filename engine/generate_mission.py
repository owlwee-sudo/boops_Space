"""Generate deterministic 180-day simulated mission telemetry for 3 astronauts.

Outputs:
    - data/daily_records.csv (540 rows: A1, A2, A3 x 180 mission days)
    - data/events.json (manifest of planted adaptation, EVA, sleep, SPE, infection, and glitch events)

All simulated records are explicitly labeled with source="simulated".
Optional live solar-proton curve loading is disabled by default so the pipeline runs 100% offline.
"""

from __future__ import annotations

import json
from datetime import date, timedelta
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
SEED = 42
MISSION_DAYS = 180
START_DATE = date(2026, 5, 18)
ALLOW_NETWORK_RADIATION = False  # Offline-first default (no runtime internet)
NOAA_GOES_PROTON_URL = (
    "https://services.swpc.noaa.gov/json/goes/primary/integral-protons-1-day.json"
)

ROOT_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT_DIR / "data"

CSV_COLUMNS = [
    "astronaut_id",
    "mission_day",
    "date",
    "rhr_bpm",
    "hrv_rmssd_ms",
    "sleep_hours",
    "sleep_quality_1to5",
    "eda_mean_us",
    "spo2_pct",
    "sbp_mmhg",
    "dbp_mmhg",
    "temp_c",
    "exercise_min",
    "resistance_min",
    "radiation_msv",
    "eva",
    "symptoms",
    "mood_1to5",
    "signal_quality",
    "source",
]

# Personal in-flight parameters per astronaut (each crew member has a distinct baseline)
ASTRONAUT_PROFILES: dict[str, dict[str, Any]] = {
    "A1": {
        "name": "Amara Okafor",
        "role": "Commander",
        "rhr_mean": 60.0,
        "rhr_sd": 1.8,
        "hrv_mean": 50.0,
        "hrv_sd": 4.2,
        "sleep_mean": 6.5,
        "sleep_sd": 0.48,
        "eda_mean": 2.4,
        "eda_sd": 0.3,
        "spo2_mean": 97.6,
        "sbp_mean": 112.0,
        "dbp_mean": 72.0,
        "temp_mean": 36.7,
        "exercise_mean": 118.0,
        "resistance_mean": 58.0,
        "radiation_mean": 0.52,
    },
    "A2": {
        "name": "Jun Park",
        "role": "Pilot",
        "rhr_mean": 55.0,
        "rhr_sd": 1.7,
        "hrv_mean": 58.0,
        "hrv_sd": 4.8,
        "sleep_mean": 6.2,
        "sleep_sd": 0.38,
        "eda_mean": 2.1,
        "eda_sd": 0.28,
        "spo2_mean": 98.1,
        "sbp_mean": 109.0,
        "dbp_mean": 69.0,
        "temp_mean": 36.6,
        "exercise_mean": 122.0,
        "resistance_mean": 60.0,
        "radiation_mean": 0.49,
    },
    "A3": {
        "name": "Lena Fischer",
        "role": "Flight Engineer",
        "rhr_mean": 64.0,
        "rhr_sd": 1.9,
        "hrv_mean": 45.0,
        "hrv_sd": 3.8,
        "sleep_mean": 6.4,
        "sleep_sd": 0.34,
        "eda_mean": 2.6,
        "eda_sd": 0.32,
        "spo2_mean": 97.4,
        "sbp_mean": 115.0,
        "dbp_mean": 74.0,
        "temp_mean": 36.8,
        "exercise_mean": 115.0,
        "resistance_mean": 55.0,
        "radiation_mean": 0.51,
    },
}

PLANTED_EVENTS: list[dict[str, Any]] = [
    {
        "id": "adaptation_phase",
        "astronaut_id": "all",
        "start_day": 1,
        "end_day": 14,
        "type": "adaptation",
        "title": "Microgravity fluid-shift adaptation",
        "description": "Cephalad fluid shift causes slightly higher RHR, ~10 mmHg lower BP, and lower HRV; forms personal in-flight baseline.",
        "expected_signal": "Alerts dampened; labeled adaptation phase.",
    },
    {
        "id": "a1_glitch_rhr",
        "astronaut_id": "A1",
        "start_day": 30,
        "end_day": 30,
        "type": "sensor_glitch",
        "title": "Wearable optical spike while asleep",
        "description": "Implausible HR=220 bpm reading with low signal quality (0.20) and no symptoms.",
        "expected_signal": "data_quality.status = check_device (not Act).",
    },
    {
        "id": "a1_eva_41",
        "astronaut_id": "A1",
        "start_day": 41,
        "end_day": 43,
        "type": "eva",
        "title": "EVA #1 (Day 41) + 48h recovery window",
        "description": "EVA on day 41 causes HRV drop, RHR bump, and shorter sleep through day 43.",
        "expected_signal": "Stress ↑, Immune Watch on day 41–43.",
    },
    {
        "id": "a2_glitch_temp",
        "astronaut_id": "A2",
        "start_day": 50,
        "end_day": 50,
        "type": "sensor_glitch",
        "title": "Thermometer contact failure",
        "description": "Implausible body temperature 25.0 °C with signal quality 0.30.",
        "expected_signal": "data_quality.status = check_device.",
    },
    {
        "id": "a2_resistance_skip",
        "astronaut_id": "A2",
        "start_day": 60,
        "end_day": 75,
        "type": "inactivity",
        "title": "Skipped ARED resistance exercise",
        "description": "A2 skips resistance exercise for 16 days (resistance_min ≈ 0) with elevated stress.",
        "expected_signal": "Musculoskeletal risk rises into Watch/Act.",
    },
    {
        "id": "a1_bad_sleep",
        "astronaut_id": "A1",
        "start_day": 88,
        "end_day": 94,
        "type": "sleep_deficit",
        "title": "7-day sleep deficiency streak",
        "description": "Operational workload limits A1 sleep to ≤ 5 h/night from day 88 to 94.",
        "expected_signal": "Sleep score drops; immune risk climbs.",
    },
    {
        "id": "solar_particle_event",
        "astronaut_id": "all",
        "start_day": 92,
        "end_day": 93,
        "type": "solar_particle_event",
        "title": "Solar Particle Event (SPE)",
        "description": "Radiation dose spikes on days 92–93 (modeled after NOAA SWPC GOES / NASA OSDR RadLab SPE curves).",
        "expected_signal": "Alert banner + shelter emergency protocol.",
    },
    {
        "id": "a1_infection_presymptomatic",
        "astronaut_id": "A1",
        "start_day": 95,
        "end_day": 96,
        "type": "infection_early_warning",
        "title": "Pre-symptomatic infection onset",
        "description": "A1 resting HR jumps +6 to +8 bpm (≥ 2 SD above baseline) with no logged symptoms and no EVA/hard exercise.",
        "expected_signal": "infection_early_warning = true before symptoms on day 97; Immune = Act.",
    },
    {
        "id": "a1_infection_symptomatic",
        "astronaut_id": "A1",
        "start_day": 97,
        "end_day": 98,
        "type": "symptoms",
        "title": "Viral reactivation / clinical symptoms",
        "description": "Fatigue and sore throat logged on day 97, followed by cold sore on day 98.",
        "expected_signal": "Immune = Act; Fix sleep first + take saliva test.",
    },
    {
        "id": "a3_glitch_hrv_spo2",
        "astronaut_id": "A3",
        "start_day": 110,
        "end_day": 110,
        "type": "sensor_glitch",
        "title": "Missing HRV + SpO2 drop-out",
        "description": "Wearable signal drop-out: HRV missing (NaN), SpO2=65%, signal_quality=0.25, no symptoms.",
        "expected_signal": "data_quality.status = check_device.",
    },
    {
        "id": "a1_eva_120",
        "astronaut_id": "A1",
        "start_day": 120,
        "end_day": 122,
        "type": "eva",
        "title": "EVA #2 (Day 120) + 48h recovery window",
        "description": "Second EVA triggers transient HRV drop, RHR bump, and shorter sleep on days 120–122.",
        "expected_signal": "Stress ↑, Immune Watch.",
    },
]


def _load_spe_multipliers() -> tuple[float, float]:
    """Return (day92_msv, day93_msv) shaped from NOAA SWPC GOES or offline fallback."""
    if ALLOW_NETWORK_RADIATION:
        try:
            import requests

            resp = requests.get(NOAA_GOES_PROTON_URL, timeout=2.0)
            resp.raise_for_status()
            rows = resp.json()
            fluxes = [float(r.get("flux", 0.0)) for r in rows if r.get("energy") == ">=10 MeV"]
            if fluxes:
                peak = max(fluxes)
                scale = float(np.clip(np.log10(max(peak, 10.0)), 1.0, 6.0))
                return round(3.8 + 0.35 * scale, 2), round(2.6 + 0.25 * scale, 2)
        except Exception:
            pass
    # Deterministic RadLab / GOES-shaped fallback SPE dose (mSv/day)
    return 4.85, 3.45


def generate_mission_data(
    seed: int = SEED,
    output_dir: Path | None = None,
) -> tuple[pd.DataFrame, list[dict[str, Any]]]:
    """Generate the 540-row simulated mission dataframe and save CSV + events.json."""
    rng = np.random.default_rng(seed)
    target_dir = output_dir or DATA_DIR
    target_dir.mkdir(parents=True, exist_ok=True)

    spe_d92, spe_d93 = _load_spe_multipliers()
    records: list[dict[str, Any]] = []

    for astro_id, p in ASTRONAUT_PROFILES.items():
        for day in range(1, MISSION_DAYS + 1):
            cur_date = (START_DATE + timedelta(days=day - 1)).isoformat()

            # Baseline physiological draws (bounded on healthy days so normal variance never triggers false positives)
            rhr_cap = 1.6 * p["rhr_sd"] if day <= 14 else 1.25 * p["rhr_sd"]
            hrv_cap = 1.6 * p["hrv_sd"] if day <= 14 else 1.35 * p["hrv_sd"]
            rhr = float(
                np.clip(
                    rng.normal(p["rhr_mean"], p["rhr_sd"]),
                    p["rhr_mean"] - rhr_cap,
                    p["rhr_mean"] + rhr_cap,
                )
            )
            hrv = float(
                np.clip(
                    rng.normal(p["hrv_mean"], p["hrv_sd"]),
                    p["hrv_mean"] - hrv_cap,
                    p["hrv_mean"] + hrv_cap,
                )
            )
            sleep_h = float(
                np.clip(
                    rng.normal(p["sleep_mean"], p["sleep_sd"]),
                    p["sleep_mean"] - 1.9 * p["sleep_sd"],
                    p["sleep_mean"] + 1.9 * p["sleep_sd"],
                )
            )
            eda = float(rng.normal(p["eda_mean"], p["eda_sd"]))
            spo2 = float(np.clip(rng.normal(p["spo2_mean"], 0.4), 95.0, 99.8))
            sbp = float(rng.normal(p["sbp_mean"], 3.5))
            dbp = float(rng.normal(p["dbp_mean"], 2.5))
            temp = float(rng.normal(p["temp_mean"], 0.14))
            exercise_min = float(np.clip(rng.normal(p["exercise_mean"], 10.0), 60.0, 150.0))
            resistance_min = float(np.clip(rng.normal(p["resistance_mean"], 6.0), 35.0, 80.0))
            radiation = float(np.clip(rng.normal(p["radiation_mean"], 0.05), 0.38, 0.72))
            eva = 0
            symptoms = ""
            signal_quality = float(np.clip(rng.normal(0.95, 0.03), 0.85, 0.99))

            # Adaptation phase (days 1-14): fluid shift shifts RHR slightly up, BP down, HRV slightly down
            if day <= 14:
                decay = (15 - day) / 14.0
                rhr += 0.9 * decay
                hrv -= 1.5 * decay
                sbp -= 2.5 * decay
                dbp -= 1.8 * decay

            # Solar particle event (days 92-93 for all crew, slight decay days 94-95)
            if day == 92:
                radiation = float(round(spe_d92 + rng.normal(0.0, 0.12), 2))
            elif day == 93:
                radiation = float(round(spe_d93 + rng.normal(0.0, 0.10), 2))
            elif day == 94:
                radiation = float(round(1.05 + rng.normal(0.0, 0.05), 2))
            elif day == 95:
                radiation = float(round(0.72 + rng.normal(0.0, 0.04), 2))

            # A1 planted storyline
            if astro_id == "A1":
                # EVAs on day 41 and day 120 (+ next 2 days recovery)
                if day in (41, 120):
                    eva = 1
                    hrv = p["hrv_mean"] - 10.5 + float(rng.normal(0.0, 0.8))
                    rhr = p["rhr_mean"] + 5.2 + float(rng.normal(0.0, 0.5))
                    sleep_h = 5.1 + float(rng.normal(0.0, 0.12))
                    exercise_min = 148.0
                elif day in (42, 43, 121, 122):
                    offset = 1 if day in (42, 121) else 2
                    hrv = p["hrv_mean"] - (9.8 - 0.8 * offset) + float(rng.normal(0.0, 0.6))
                    rhr = p["rhr_mean"] + (4.2 - 0.6 * offset) + float(rng.normal(0.0, 0.4))
                    sleep_h = 5.2 + 0.1 * offset + float(rng.normal(0.0, 0.1))

                # Bad sleep streak days 88-94 (sleep loss + stress; RHR still < +2 SD so early warning fires on day 95/96)
                if 88 <= day <= 94:
                    sleep_h = float(np.clip(4.65 + rng.normal(0.0, 0.15), 4.2, 5.0))
                    hrv = p["hrv_mean"] - (8.2 + 0.45 * (day - 88)) + float(rng.normal(0.0, 0.5))
                    rhr = float(
                        np.clip(
                            p["rhr_mean"] + (1.0 + 0.14 * (day - 88)) + rng.normal(0.0, 0.3),
                            p["rhr_mean"] + 0.4,
                            p["rhr_mean"] + 2.2,
                        )
                    )
                    eda = p["eda_mean"] + 0.55 + float(rng.normal(0.0, 0.1))

                # Infection pre-symptomatic days 95-96 (no symptoms yet, normal exercise, no EVA)
                if day == 95:
                    rhr = p["rhr_mean"] + 6.2
                    hrv = p["hrv_mean"] - 11.5
                    sleep_h = 4.95
                    eda = p["eda_mean"] + 0.75
                    exercise_min = 90.0
                    resistance_min = 45.0
                elif day == 96:
                    rhr = p["rhr_mean"] + 7.4
                    hrv = p["hrv_mean"] - 12.6
                    sleep_h = 4.85
                    eda = p["eda_mean"] + 0.85
                    exercise_min = 85.0
                    resistance_min = 40.0
                elif day == 97:
                    rhr = p["rhr_mean"] + 7.8
                    hrv = p["hrv_mean"] - 13.0
                    sleep_h = 4.9
                    temp = 37.6
                    eda = p["eda_mean"] + 0.90
                    exercise_min = 50.0
                    resistance_min = 15.0
                    symptoms = "fatigue;sore throat"
                elif day == 98:
                    rhr = p["rhr_mean"] + 8.1
                    hrv = p["hrv_mean"] - 13.2
                    sleep_h = 4.8
                    temp = 37.8
                    eda = p["eda_mean"] + 0.95
                    exercise_min = 40.0
                    resistance_min = 10.0
                    symptoms = "fatigue;sore throat;cold sore"

            # A2 planted storyline: skips resistance exercise days 60-75
            if astro_id == "A2" and 60 <= day <= 75:
                resistance_min = float(np.clip(rng.normal(1.0, 0.8), 0.0, 3.0))
                exercise_min = float(np.clip(rng.normal(28.0, 5.0), 15.0, 38.0))
                hrv = p["hrv_mean"] - 8.5 + float(rng.normal(0.0, 0.8))
                rhr = p["rhr_mean"] + 2.8 + float(rng.normal(0.0, 0.5))

            # Derive coherent subjective ratings (1..5)
            sleep_delta = sleep_h - p["sleep_mean"]
            sleep_q = int(np.clip(round(3.6 + 1.1 * sleep_delta), 1, 5))
            hrv_delta = (hrv - p["hrv_mean"]) / p["hrv_sd"]
            mood = int(np.clip(round(3.8 + 0.45 * hrv_delta + 0.4 * sleep_delta), 1, 5))
            if symptoms:
                mood = min(mood, 2)

            # 3 planted sensor glitches (one per astronaut on distinct days)
            if astro_id == "A1" and day == 30:
                rhr = 220.0
                signal_quality = 0.20
                symptoms = ""
            elif astro_id == "A2" and day == 50:
                temp = 25.0
                signal_quality = 0.30
                symptoms = ""
            elif astro_id == "A3" and day == 110:
                hrv = float("nan")
                spo2 = 65.0
                signal_quality = 0.25
                symptoms = ""

            records.append(
                {
                    "astronaut_id": astro_id,
                    "mission_day": day,
                    "date": cur_date,
                    "rhr_bpm": round(rhr, 1),
                    "hrv_rmssd_ms": round(hrv, 1) if not np.isnan(hrv) else np.nan,
                    "sleep_hours": round(sleep_h, 2),
                    "sleep_quality_1to5": sleep_q,
                    "eda_mean_us": round(max(eda, 0.4), 2),
                    "spo2_pct": round(spo2, 1),
                    "sbp_mmhg": round(sbp, 1),
                    "dbp_mmhg": round(dbp, 1),
                    "temp_c": round(temp, 2),
                    "exercise_min": round(exercise_min, 1),
                    "resistance_min": round(resistance_min, 1),
                    "radiation_msv": round(radiation, 3),
                    "eva": int(eva),
                    "symptoms": symptoms,
                    "mood_1to5": mood,
                    "signal_quality": round(signal_quality, 2),
                    "source": "simulated",
                }
            )

    df = pd.DataFrame(records, columns=CSV_COLUMNS)
    df.to_csv(target_dir / "daily_records.csv", index=False)
    with open(target_dir / "events.json", "w", encoding="utf-8") as f:
        json.dump(PLANTED_EVENTS, f, indent=2, ensure_ascii=False)
        f.write("\n")

    return df, PLANTED_EVENTS


if __name__ == "__main__":
    df_out, events_out = generate_mission_data()
    print(f"Generated {len(df_out)} rows and {len(events_out)} planted events in {DATA_DIR}")
