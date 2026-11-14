"""Checks for the Isolation Forest anomaly detector (H4).

Run:  pytest tests/test_anomaly.py
Uses the SIMULATED fixture in tests/fixtures/demo_mission.py. The planted
events are used only here, to check results. The detector never sees them.
"""
import json
import sys
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from hard.anomaly import anomaly as A  # noqa: E402
from hard.anomaly import run_anomaly  # noqa: E402
from tests.fixtures.demo_mission import make_mission, normal_day_mask  # noqa: E402


@pytest.fixture(scope="module")
def scored():
    table, events = make_mission(seed=7)
    scores = A.score_mission(table)
    return table, events, scores.set_index(["astronaut_id", "mission_day"]), scores


def test_planted_glitches_are_check_device(scored):
    _, events, by_day, _ = scored
    for g in events["glitches"]:
        row = by_day.loc[(g["astronaut_id"], g["mission_day"])]
        assert row["is_anomaly"], g
        assert row["suggested_status"] == "check_device", (g, row["suggested_status"])
        assert row["anomaly_score"] >= 0.6


def test_infection_days_are_never_called_device_errors(scored):
    _, events, by_day, _ = scored
    statuses = [by_day.loc[("A1", d)]["suggested_status"] for d in events["infection"]["days"]]
    assert "check_device" not in statuses
    # The early days (no symptoms yet) are caught as a trend in the body...
    assert by_day.loc[("A1", 95)]["suggested_status"] == "check_yourself"
    assert by_day.loc[("A1", 95)]["point_vs_trend"] == "trend"
    # ...and a flagged day with symptoms is act_now.
    assert "act_now" in statuses


def test_false_alarms_on_normal_days_stay_under_5_percent(scored):
    table, _, _, scores = scored
    normal = normal_day_mask(table)
    assert scores["is_anomaly"].to_numpy()[normal].mean() < 0.05


def test_holds_across_other_random_missions():
    rates = []
    for seed in range(1, 6):
        table, events = make_mission(seed)
        scores = A.score_mission(table)
        by_day = scores.set_index(["astronaut_id", "mission_day"])
        rates.append(scores["is_anomaly"].to_numpy()[normal_day_mask(table)].mean())
        for g in events["glitches"]:
            assert by_day.loc[(g["astronaut_id"], g["mission_day"])]["suggested_status"] == "check_device"
        for d in events["infection"]["days"]:
            assert by_day.loc[("A1", d)]["suggested_status"] != "check_device"
    assert np.mean(rates) < 0.05


def test_baseline_days_are_never_flagged(scored):
    _, _, _, scores = scored
    assert not scores[scores["mission_day"] <= 14]["is_anomaly"].any()


def test_suggest_status_rules():
    assert A.suggest_status(0.2, 0.9, "") == (None, "")
    assert A.suggest_status(0.8, 0.3, "point")[0] == "check_device"  # low signal quality
    assert A.suggest_status(0.8, 0.9, "point")[0] == "check_device"  # single-day spike
    assert A.suggest_status(0.8, 0.9, "trend")[0] == "check_yourself"  # several days
    assert A.suggest_status(0.8, 0.9, "trend", "fatigue;sore throat")[0] == "act_now"
    assert A.suggest_status(0.8, 0.9, "point", "fatigue")[0] == "check_yourself"  # symptoms beat "device"
    assert A.suggest_status(0.8, 0.9, "new")[0] == "check_yourself"  # latest day: stay on the safe side
    assert A.suggest_status(0.8, 0.9, "point", eva=1)[0] is None  # a spacewalk explains it


def test_missing_values_do_not_crash_or_alarm():
    table, _ = make_mission(seed=7)
    table.loc[(table["astronaut_id"] == "A2") & (table["mission_day"] == 80), ["rhr_bpm", "temp_c"]] = np.nan
    scores = A.score_mission(table).set_index(["astronaut_id", "mission_day"])
    assert not scores.loc[("A2", 80)]["is_anomaly"]


def test_merge_only_adds_optional_fields(tmp_path, scored):
    _, _, _, scores = scored
    engine = [
        {"astronaut_id": "A2", "mission_day": 30, "data_quality": {"status": "ok", "reasons": []}},
        {"astronaut_id": "A9", "mission_day": 1, "data_quality": {"status": "ok", "reasons": []}},
    ]
    path = tmp_path / "engine_output.json"
    path.write_text(json.dumps(engine))
    updated = run_anomaly.merge_into_engine_output(run_anomaly.to_records(scores), path)
    out = json.loads(path.read_text())
    assert updated == 1
    assert out[0]["data_quality"]["status"] == "ok"  # untouched: F4 stays in charge
    assert out[0]["data_quality"]["anomaly_score"] >= 0.6
    assert out[0]["data_quality"]["anomaly_kind"] == "point"
    assert "anomaly_score" not in out[1]["data_quality"]
