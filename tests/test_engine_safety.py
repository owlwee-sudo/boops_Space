"""Regression checks for the Phase 0 engine fixes in docs/fix-plan/02-engine-health-and-ml.md.

Run:  pytest tests/test_engine_safety.py
All data here is SIMULATED and built inline.
"""
import math
import sqlite3
import sys
from pathlib import Path

import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from engine import db  # noqa: E402
from engine.analysis import (  # noqa: E402
    _to_float,
    infection_early_warning,
    personal_baseline,
    zscores,
)
from engine.data_quality import check_reading  # noqa: E402
from engine.risk_engine import evaluate_risks, recommend_actions  # noqa: E402

BASELINE = {
    "rhr_bpm": {"mean": 60.0, "sd": 2.0},
    "hrv_rmssd_ms": {"mean": 50.0, "sd": 5.0},
    "temp_c": {"mean": 36.6, "sd": 0.2},
    "spo2_pct": {"mean": 98.0, "sd": 0.8},
    "exercise_min": {"mean": 118.0, "sd": 10.0},
    "resistance_min": {"mean": 58.0, "sd": 5.0},
    "radiation_msv": {"mean": 0.5, "sd": 0.05},
}


def reading(**over):
    row = {
        "astronaut_id": "A1", "mission_day": 50, "rhr_bpm": 60.0, "hrv_rmssd_ms": 50.0,
        "temp_c": 36.6, "spo2_pct": 98.0, "sbp_mmhg": 115.0, "dbp_mmhg": 75.0,
        "exercise_min": 118.0, "resistance_min": 58.0, "radiation_msv": 0.5,
        "eva": 0, "symptoms": "", "signal_quality": 0.95, "source": "simulated",
    }
    row.update(over)
    return row


# --- data_quality.py: step 0 vs step 2 -------------------------------------

@pytest.mark.parametrize("temp", [65.0, 999.0])
def test_impossible_temperature_is_a_device_problem_not_a_fever(temp):
    assert check_reading(reading(temp_c=temp), BASELINE)["status"] == "check_device"


def test_real_fever_is_still_act_now():
    assert check_reading(reading(temp_c=39.0), BASELINE)["status"] == "act_now"


def test_very_low_spo2_with_symptoms_is_act_now():
    res = check_reading(reading(spo2_pct=65.0, symptoms="dyspnea"), BASELINE)
    assert res["status"] == "act_now"


def test_very_low_spo2_without_symptoms_is_check_device():
    assert check_reading(reading(spo2_pct=65.0), BASELINE)["status"] == "check_device"


@pytest.mark.parametrize(
    "over",
    [
        {"sbp_mmhg": 400.0},
        {"dbp_mmhg": 250.0},
        {"sbp_mmhg": 80.0, "dbp_mmhg": 90.0},
        {"spo2_pct": 150.0},
        {"hrv_rmssd_ms": 500.0},
        {"hrv_rmssd_ms": 1.0},
    ],
)
def test_implausible_values_point_to_the_device(over):
    assert check_reading(reading(**over), BASELINE)["status"] == "check_device"


def test_nan_symptoms_text_is_not_a_symptom():
    assert check_reading(reading(symptoms="nan"), BASELINE)["status"] == "ok"


def test_missing_signal_quality_on_a_sensor_reading_is_flagged():
    assert check_reading(reading(signal_quality=None), BASELINE)["status"] == "check_device"


def test_infinite_eva_and_mission_day_do_not_crash():
    res = check_reading(reading(eva=math.inf, mission_day=-math.inf), BASELINE)
    assert res["status"] in ("ok", "check_device", "check_yourself", "act_now")


# --- analysis.py ------------------------------------------------------------

@pytest.mark.parametrize("val", [math.inf, -math.inf, float("nan"), None, "junk"])
def test_non_finite_values_are_dropped(val):
    assert _to_float(val) is None


def test_constant_baseline_does_not_explode_z():
    rows = [reading(mission_day=d, rhr_bpm=60.0) for d in range(1, 15)]
    base = personal_baseline(pd.DataFrame(rows), "A1")
    assert base["rhr_bpm"]["sd"] >= 1.5
    assert abs(zscores({"rhr_bpm": 60.1}, base)["rhr_bpm"]) < 1.0


def test_baseline_fallback_skips_low_quality_glitches():
    # No usable days 1-14, one glitched day 30 and normal later days.
    rows = [reading(mission_day=d, rhr_bpm=60.0 + (d % 3)) for d in range(20, 30)]
    rows.append(reading(mission_day=30, rhr_bpm=250.0, signal_quality=0.2))
    base = personal_baseline(pd.DataFrame(rows), "A1")
    assert base["rhr_bpm"]["mean"] < 70


def _iew_frame(days, high_days, eva_days=()):
    rows = []
    for d in days:
        rows.append(reading(mission_day=d, rhr_bpm=70.0 if d in high_days else 60.0, eva=1 if d in eva_days else 0))
    return pd.DataFrame(rows).sort_values("mission_day").reset_index(drop=True)


def test_iew_needs_consecutive_mission_days_not_rows():
    # Day 95 is missing: days 94 and 96 must not count as "2 days in a row".
    df = _iew_frame([92, 93, 94, 96], high_days={94, 96})
    assert infection_early_warning(df, len(df) - 1, BASELINE) is False


def test_iew_triggers_on_two_real_consecutive_days():
    df = _iew_frame([93, 94, 95, 96], high_days={95, 96})
    assert infection_early_warning(df, len(df) - 1, BASELINE) is True


def test_old_eva_does_not_hide_iew_across_missing_rows():
    # EVA on day 80, rows 81-94 missing: it is 15 days old and must not count.
    df = _iew_frame([80, 95, 96], high_days={95, 96}, eva_days={80})
    assert infection_early_warning(df, len(df) - 1, BASELINE) is True


# --- risk_engine.py ---------------------------------------------------------

def test_all_nan_exercise_window_does_not_crash():
    hist = pd.DataFrame([reading(mission_day=d, exercise_min=float("nan"), resistance_min=float("nan")) for d in range(44, 51)])
    row = hist.iloc[-1]
    risks = evaluate_risks(row, zscores(row, BASELINE), BASELINE, hist, {"infection_early_warning": False}, {"status": "ok"})
    for r in risks.values():
        assert 0 <= r["score"] <= 100


def test_adaptation_phase_is_kept_on_days_1_to_14():
    row = reading(mission_day=5, hrv_rmssd_ms=30.0, rhr_bpm=68.0, radiation_msv=1.0, eva=1, symptoms="fatigue")
    risks = evaluate_risks(row, zscores(row, BASELINE), BASELINE, None, {"infection_early_warning": True}, {"status": "ok"})
    for r in risks.values():
        assert r["adaptation_phase"] is True
        assert any(d["factor"] == "adaptation_phase" for d in r["drivers"])
        assert len(r["drivers"]) <= 4


def test_shelter_action_uses_physical_dose():
    def actions_for(rad):
        row = reading(radiation_msv=rad)
        risks = evaluate_risks(row, zscores(row, BASELINE), BASELINE, None, {}, {"status": "ok"})
        return [a["text"] for a in recommend_actions(risks, row, {}, {"status": "ok"})]

    assert not any("shielded" in t for t in actions_for(1.49))
    assert any("shielded" in t for t in actions_for(4.6))


# --- db.py ------------------------------------------------------------------

def test_save_engine_output_keeps_crew_emergency_events(tmp_path):
    path = tmp_path / "m.db"
    db.init_db(path)
    db.save_emergency_event("A2", 50, "fainting_dizziness", "high", "Crew logged fainting", db_path=path)
    db.save_engine_output([], db_path=path)
    with sqlite3.connect(path) as conn:
        rows = conn.execute("SELECT protocol_id FROM emergency_events").fetchall()
    assert ("fainting_dizziness",) in rows


def test_insert_daily_records_handles_nan_eva(tmp_path):
    path = tmp_path / "m.db"
    db.init_db(path)
    row = reading(mission_day=1, eva=float("nan"))
    row.update({"date": "2026-05-01", "sleep_hours": 6.5, "sleep_quality_1to5": 3, "eda_mean_us": 2.0, "mood_1to5": 4})
    assert db.insert_daily_records(pd.DataFrame([row]), db_path=path) == 1
