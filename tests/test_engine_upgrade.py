"""Engine upgrade (docs/engine-upgrade-handoff.md): adaptation curve (T1),
mission-day confounding check (T2), harm-weighted thresholds (T3).

All data here is simulated or synthetic.
"""

from __future__ import annotations

import contextlib
import hashlib
import json
import math
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from engine import analysis, confound_check, generate_mission, risk_engine, thresholds  # noqa: E402
from engine.run_all import score_records  # noqa: E402

# Digest of the scores the engine produced BEFORE this upgrade (commit 2bd0504).
# ADAPTATION_MODEL = "window" + FLUID_SHIFT_SHAPE = "linear" must still give it.
LEGACY_DIGEST = "3f29b486b631439848e9d8b5feed5b679df9f97f75f2bb7f09e43b1999df6126"


@contextlib.contextmanager
def config(**values):
    """Temporarily set config values: ``module__NAME=value``."""
    modules = {"analysis": analysis, "generate_mission": generate_mission, "risk_engine": risk_engine}
    saved = []
    try:
        for key, value in values.items():
            module_name, name = key.split("__", 1)
            module = modules[module_name]
            saved.append((module, name, getattr(module, name)))
            setattr(module, name, value)
        yield
    finally:
        for module, name, old in reversed(saved):
            setattr(module, name, old)


def one_curve(metric="rhr_bpm", a=8.0, tau=7.0, anchor="launch"):
    return [{"id": "fluid_shift", "anchor": anchor, "source_id": "norsk15", "placeholder": True,
             "metrics": {metric: {"A": a, "tau": tau}}}]


def synthetic_crew(days=40, a=8.0, tau=5.0, mean=60.0, wobble=1.5):
    """One astronaut whose resting HR is ``mean`` plus a planted fluid shift.

    The day-to-day wobble is a fixed +/- pattern (no randomness), so the true
    mean is exactly ``mean`` over any even number of days.
    """
    rows = []
    for day in range(1, days + 1):
        noise = wobble if day % 2 else -wobble
        rows.append({
            "astronaut_id": "T1", "mission_day": day, "date": f"2026-01-{day:02d}",
            "rhr_bpm": mean + noise + a * math.exp(-day / tau),
            "hrv_rmssd_ms": 50.0 + (2.0 if day % 2 else -2.0),
            "sleep_hours": 6.5 + (0.3 if day % 2 else -0.3), "sleep_quality_1to5": 4,
            "eda_mean_us": 2.4 + (0.2 if day % 2 else -0.2), "spo2_pct": 97.5 + (0.3 if day % 2 else -0.3),
            "sbp_mmhg": 112.0 + (3 if day % 2 else -3), "dbp_mmhg": 72.0 + (2 if day % 2 else -2),
            "temp_c": 36.7 + (0.1 if day % 2 else -0.1),
            "exercise_min": 118.0 + (8 if day % 2 else -8), "resistance_min": 58.0 + (5 if day % 2 else -5),
            "radiation_msv": 0.5 + (0.04 if day % 2 else -0.04), "eva": 0, "symptoms": "",
            "mood_1to5": 4, "signal_quality": 0.95, "source": "simulated",
        })
    return pd.DataFrame(rows)


def mission(model, shape, tmp_path_factory):
    with config(analysis__ADAPTATION_MODEL=model, generate_mission__FLUID_SHIFT_SHAPE=shape):
        df, events = generate_mission.generate_mission_data(output_dir=tmp_path_factory.mktemp(f"{model}_{shape}"))
        outputs = score_records(df)
    return df, events, {(o["astronaut_id"], o["mission_day"]): o for o in outputs}


@pytest.fixture(scope="module")
def curve_run(tmp_path_factory):
    return mission("curve", "exp", tmp_path_factory)


@pytest.fixture(scope="module")
def window_run(tmp_path_factory):
    return mission("window", "exp", tmp_path_factory)


@pytest.fixture(scope="module")
def legacy_run(tmp_path_factory):
    return mission("window", "linear", tmp_path_factory)


def planted(astro, day):
    """True on days where the simulator planted an event (so alerts there are expected)."""
    return (
        92 <= day <= 95
        or (astro == "A1" and (day == 30 or 41 <= day <= 43 or 88 <= day <= 99 or 120 <= day <= 122))
        or (astro == "A2" and (day == 50 or 60 <= day <= 78))
        or (astro == "A3" and day == 110)
    )


# ---------------------------------------------------------------------------
# T1. Adaptation curve
# ---------------------------------------------------------------------------
def test_defaults_are_the_documented_ones():
    assert analysis.ADAPTATION_MODEL == "curve"
    assert analysis.STABLE_BASELINE_DAYS == (15, 28)
    assert analysis.BASELINE_DAYS == (1, 14)
    assert generate_mission.FLUID_SHIFT_SHAPE == "exp"
    assert all(c["placeholder"] for c in analysis.ADAPTATION_CURVES), "curve values are placeholders, say so"


def test_worked_example_from_the_handoff():
    """Day 3, mu 60, sigma 3, A 8, tau 7, observed 66 -> raw z 2.0, adjusted z 0.26."""
    baseline = {"rhr_bpm": {"mean": 60.0, "sd": 3.0}}
    row = {"mission_day": 3, "rhr_bpm": 66.0}
    with config(analysis__ADAPTATION_MODEL="curve", analysis__ADAPTATION_CURVES=one_curve()):
        assert analysis.adaptation_offset("rhr_bpm", 3) == pytest.approx(5.21, abs=0.01)
        assert analysis.zscores(row, baseline)["rhr_bpm"] == pytest.approx(0.26, abs=0.01)
    with config(analysis__ADAPTATION_MODEL="window", analysis__ADAPTATION_CURVES=one_curve()):
        assert analysis.adaptation_offset("rhr_bpm", 3) == 0.0
        assert analysis.zscores(row, baseline)["rhr_bpm"] == pytest.approx(2.0)


def test_offset_fades_and_ignores_other_metrics_and_bad_days():
    with config(analysis__ADAPTATION_MODEL="curve", analysis__ADAPTATION_CURVES=one_curve()):
        assert analysis.adaptation_offset("rhr_bpm", 1) > analysis.adaptation_offset("rhr_bpm", 14) > 0
        assert analysis.adaptation_offset("rhr_bpm", 120) < 0.001
        assert analysis.adaptation_offset("temp_c", 3) == 0.0
        assert analysis.adaptation_offset("rhr_bpm", None) == 0.0
        assert analysis.adaptation_offset("rhr_bpm", float("nan")) == 0.0
        # A row without mission_day gets a plain z-score
        assert analysis.zscores({"rhr_bpm": 66.0}, {"rhr_bpm": {"mean": 60.0, "sd": 3.0}})["rhr_bpm"] == 2.0


def test_landing_curve_only_acts_after_landing():
    curves = one_curve(a=-6.0, tau=4.0, anchor="landing")
    with config(analysis__ADAPTATION_MODEL="curve", analysis__ADAPTATION_CURVES=curves):
        assert analysis.adaptation_offset("rhr_bpm", 100) == 0.0  # LANDING_DAY is None: still in flight
        with config(analysis__LANDING_DAY=180):
            assert analysis.adaptation_offset("rhr_bpm", 179) == 0.0
            assert analysis.adaptation_offset("rhr_bpm", 180) == pytest.approx(-6.0)
            assert analysis.adaptation_offset("rhr_bpm", 184) == pytest.approx(-6.0 * math.exp(-1))


def test_stable_window_baseline_is_not_bent_by_the_fluid_shift():
    df = synthetic_crew(days=40, a=8.0, tau=5.0, mean=60.0)
    with config(analysis__ADAPTATION_MODEL="curve", analysis__ADAPTATION_CURVES=one_curve(a=8.0, tau=5.0)):
        assert analysis.baseline_days_used(df, "T1") == (15, 28)
        curve = analysis.personal_baseline(df, "T1")["rhr_bpm"]
    with config(analysis__ADAPTATION_MODEL="window"):
        assert analysis.baseline_days_used(df, "T1") == (1, 14)
        window = analysis.personal_baseline(df, "T1")["rhr_bpm"]

    assert curve["mean"] == pytest.approx(60.0, abs=0.05)     # the adapted body
    assert window["mean"] > 61.5                              # pulled up by the transient
    assert window["sd"] > curve["sd"] * 1.3                   # and its SD is inflated


def test_fallback_to_days_1_14_does_not_remove_the_shift_twice():
    """A new "My data" user has no days 15-28 yet."""
    df = synthetic_crew(days=20, a=8.0, tau=5.0, mean=60.0)
    with config(analysis__ADAPTATION_MODEL="curve", analysis__ADAPTATION_CURVES=one_curve(a=8.0, tau=5.0)):
        assert analysis.baseline_days_used(df, "T1") == (1, 14)
        baseline = analysis.personal_baseline(df, "T1")
        assert baseline["rhr_bpm"]["mean"] == pytest.approx(60.0, abs=0.05)
        # Day 1 carries the biggest shift (+6.5 bpm) and must still look normal
        z_day1 = analysis.zscores(df.iloc[0], baseline)["rhr_bpm"]
        assert abs(z_day1) < 1.5


def test_one_bad_stable_day_falls_back_instead_of_using_a_short_window():
    df = synthetic_crew(days=40)
    df.loc[df["mission_day"] == 20, "signal_quality"] = 0.2
    with config(analysis__ADAPTATION_MODEL="curve"):
        assert analysis.baseline_days_used(df, "T1") == (1, 14)
    with config(analysis__ADAPTATION_MODEL="curve", analysis__MIN_STABLE_DAYS=10):
        assert analysis.baseline_days_used(df, "T1") == (15, 28)


def test_curve_does_not_hide_a_real_problem_in_the_first_two_weeks():
    """An infection-sized resting-HR jump on days 7-8 must raise the early warning."""
    df = synthetic_crew(days=40, a=8.0, tau=5.0)
    sick = df["mission_day"].isin([7, 8])
    df.loc[sick, "rhr_bpm"] += 9.0
    df.loc[sick, "hrv_rmssd_ms"] -= 14.0
    df.loc[sick, "sleep_hours"] = 4.6
    sub = df.reset_index(drop=True)
    idx = int(sub.index[sub["mission_day"] == 8][0])

    scores = {}
    for model in ("curve", "window"):
        with config(analysis__ADAPTATION_MODEL=model, analysis__ADAPTATION_CURVES=one_curve(a=8.0, tau=5.0)):
            baseline = analysis.personal_baseline(df, "T1")
            warning = analysis.infection_early_warning(sub, idx, baseline)
            z = analysis.zscores(sub.iloc[idx], baseline)
            risk = risk_engine.compute_immune_risk(
                sub.iloc[idx], z, baseline, sub.iloc[: idx + 1], {"infection_early_warning": warning}
            )
            scores[model] = (warning, risk["score"], risk["level"])

    assert scores["curve"][0] is True
    assert scores["curve"][2] in ("watch", "act")
    assert scores["curve"][1] > scores["window"][1], "the old 0.45 multiplier dampened a real problem"


def test_no_cliff_between_day_14_and_day_15():
    """The same abnormal body on day 14 and day 15 scores the same with the curve."""
    def immune_score(day):
        row = {"mission_day": day, "hrv_rmssd_ms": 38.0, "rhr_bpm": 66.0, "sleep_hours": 4.8,
               "radiation_msv": 0.5, "eva": 0, "symptoms": ""}
        baseline = {"hrv_rmssd_ms": {"mean": 50.0, "sd": 4.0}, "rhr_bpm": {"mean": 60.0, "sd": 2.0},
                    "sleep_hours": {"mean": 6.5, "sd": 0.5}, "radiation_msv": {"mean": 0.5, "sd": 0.05}}
        return risk_engine.compute_immune_risk(row, analysis.zscores(row, baseline), baseline)["score"]

    with config(analysis__ADAPTATION_MODEL="curve"):
        assert abs(immune_score(15) - immune_score(14)) <= 2
    with config(analysis__ADAPTATION_MODEL="window"):
        assert immune_score(15) > immune_score(14) * 1.8  # the old hard cutoff


@pytest.mark.parametrize("model", ["curve", "window"])
def test_adaptation_flag_and_driver_stay_in_the_contract(model):
    with config(analysis__ADAPTATION_MODEL=model):
        early = risk_engine.evaluate_risks({"mission_day": 5}, {}, {})
        late = risk_engine.evaluate_risks({"mission_day": 15}, {}, {})
    for risk in early.values():
        assert risk["adaptation_phase"] is True
        driver = next(d for d in risk["drivers"] if d["factor"] == "adaptation_phase")
        assert driver["contribution"] == 0.0
        assert ("dampened" in driver["chain"]) == (model == "window")
    for risk in late.values():
        assert risk["adaptation_phase"] is False
        assert not any(d["factor"] == "adaptation_phase" for d in risk["drivers"])


def test_engine_output_adaptation_block(curve_run, window_run):
    block = curve_run[2][("A1", 3)]["adaptation"]
    assert block["model"] == "curve"
    assert block["baseline_days"] == [15, 28]
    assert 0 < block["fading"] < 1
    assert block["offsets"]["rhr_bpm"] > 0 > block["offsets"]["hrv_rmssd_ms"]
    assert curve_run[2][("A1", 150)]["adaptation"]["offsets"] == {}
    assert curve_run[2][("A1", 150)]["adaptation"]["fading"] < 0.001
    assert "adaptation" not in window_run[2][("A1", 3)]


def test_simulator_plants_the_same_curve_the_engine_removes(curve_run, legacy_run):
    new, old = curve_run[0], legacy_run[0]
    # Same random draws: quiet later days are identical in both shapes
    late_new = new[new["mission_day"] > 45].reset_index(drop=True)
    late_old = old[old["mission_day"] > 45].reset_index(drop=True)
    pd.testing.assert_frame_equal(late_new, late_old)
    # Early days differ, but by less than the planted amplitude
    a = next(c for c in analysis.ADAPTATION_CURVES if c["id"] == "fluid_shift")["metrics"]["rhr_bpm"]["A"]
    early = (new[new["mission_day"] <= 14]["rhr_bpm"].to_numpy() - old[old["mission_day"] <= 14]["rhr_bpm"].to_numpy())
    assert 0 < np.abs(early).max() <= abs(a) + 0.11


# ---------------------------------------------------------------------------
# Acceptance checks on the simulated mission (handoff section 4)
# ---------------------------------------------------------------------------
def test_check2_infection_warning_before_symptoms_and_act_on_97_98(curve_run):
    out = curve_run[2]
    on = [d for d in range(80, 99) if out[("A1", d)]["flags"]["infection_early_warning"]]
    assert on and on[0] in (95, 96), "early warning must start on day 95 or 96, before symptoms on day 97"
    assert out[("A1", 97)]["risks"]["immune"]["level"] == "act"
    assert out[("A1", 98)]["risks"]["immune"]["level"] == "act"


def test_check3_sensor_glitches_still_say_check_device(curve_run):
    for key in (("A1", 30), ("A2", 50), ("A3", 110)):
        assert curve_run[2][key]["data_quality"]["status"] == "check_device"
        assert curve_run[2][key]["risks"]["immune"]["level"] != "act"


def test_check4_skipped_resistance_exercise_raises_bone_and_muscle_risk(curve_run):
    out = curve_run[2]
    assert all(out[("A2", d)]["risks"]["musculoskeletal"]["level"] == "normal" for d in range(40, 60))
    assert all(out[("A2", d)]["risks"]["musculoskeletal"]["level"] in ("watch", "act") for d in range(63, 76))


def test_check5_days_1_14_stay_quiet_without_the_multiplier(curve_run):
    """No Watch/Act and no early warning on healthy adaptation days, with nothing dampened."""
    for (astro, day), o in curve_run[2].items():
        if day <= 14:
            assert all(r["level"] == "normal" for r in o["risks"].values()), (astro, day)
            assert o["flags"]["infection_early_warning"] is False


def test_check5_fewer_false_z_flags_on_healthy_days(curve_run, window_run):
    """The handoff asked for fewer false alerts on days 1-14, but there were none
    to begin with. The measurable harm of the old baseline is biased z-scores on
    healthy days, so that is what must improve."""
    def flags(run, metric=None):
        return sum(
            1
            for (astro, day), o in run[2].items()
            if not planted(astro, day)
            for m, z in o["z"].items()
            if abs(z) >= 2 and (metric is None or m == metric)
        )

    assert flags(curve_run) < flags(window_run)
    assert flags(curve_run, "hrv_rmssd_ms") < flags(window_run, "hrv_rmssd_ms")

    def hrv_bias(run):  # mean HRV z on quiet days after adaptation; 0 = unbiased
        values = [o["z"]["hrv_rmssd_ms"] for (astro, day), o in run[2].items()
                  if day > 28 and not planted(astro, day) and "hrv_rmssd_ms" in o["z"]]
        return abs(float(np.mean(values)))

    assert hrv_bias(curve_run) < hrv_bias(window_run)


def test_check8_window_model_and_old_simulator_reproduce_the_old_output(legacy_run):
    rows = []
    for key in sorted(legacy_run[2]):
        o = legacy_run[2][key]
        assert "adaptation" not in o
        rows.append([
            key[0], key[1], o["stress_score"], o["sleep_score"],
            [[d, o["risks"][d]["score"], o["risks"][d]["level"]] for d in ("immune", "musculoskeletal", "cardio")],
            o["data_quality"]["status"], o["flags"]["infection_early_warning"],
            [a["text"] for a in o["actions"]],
        ])
    digest = hashlib.sha256(json.dumps(rows, ensure_ascii=False).encode("utf-8")).hexdigest()
    assert digest == LEGACY_DIGEST


# ---------------------------------------------------------------------------
# T2. Mission-day confounding check
# ---------------------------------------------------------------------------
def test_shuffle_keeps_the_calendar_and_every_record(curve_run):
    df = curve_run[0]
    shuffled = confound_check.shuffle_days(df, np.random.default_rng(1))
    assert list(shuffled["mission_day"]) == list(df.sort_values(["astronaut_id", "mission_day"])["mission_day"])
    for astro in ("A1", "A2", "A3"):
        before = df[df["astronaut_id"] == astro]
        after = shuffled[shuffled["astronaut_id"] == astro]
        assert sorted(after["record_day"]) == list(range(1, 181))
        assert sorted(before["rhr_bpm"]) == sorted(after["rhr_bpm"])
        moved = after.set_index("mission_day")["record_day"]
        assert (moved.index != moved.to_numpy()).mean() > 0.9
        # each record moves as one block
        one = after.iloc[10]
        origin = before[before["mission_day"] == one["record_day"]].iloc[0]
        assert one["rhr_bpm"] == origin["rhr_bpm"] and one["sleep_hours"] == origin["sleep_hours"]


def test_shuffle_test_catches_a_score_that_only_counts_days(curve_run):
    df = curve_run[0]

    def calendar_only(frame):
        return pd.DataFrame({"astronaut_id": frame["astronaut_id"], "mission_day": frame["mission_day"],
                             "fake": frame["mission_day"] * 0.5})

    def body_only(frame):
        return pd.DataFrame({"astronaut_id": frame["astronaut_id"], "mission_day": frame["mission_day"],
                             "fake": frame["rhr_bpm"].fillna(0.0)})

    confounded = confound_check.shuffle_test(df, calendar_only(df), calendar_only, ["fake"], n_shuffles=2)["fake"]
    assert confounded["follows_the_day_r"] == pytest.approx(1.0)
    assert confounded["shuffle_reproduces_score"] is True
    assert confound_check.r2_on_mission_day(calendar_only(df), "fake") == pytest.approx(1.0)

    honest = confound_check.shuffle_test(df, body_only(df), body_only, ["fake"], n_shuffles=2)["fake"]
    assert honest["follows_the_data_r"] == pytest.approx(1.0)
    assert abs(honest["follows_the_day_r"]) < 0.3
    assert honest["shuffle_reproduces_score"] is False


def test_check7_shuffle_does_not_reproduce_the_real_scores(curve_run):
    pytest.importorskip("sklearn")
    report = confound_check.build_report(curve_run[0], n_shuffles=2)
    assert report["passes"] is True
    assert report["labels"] == ["Simulated"]
    assert {"stress", "sleep", "immune", "musculoskeletal", "cardio", "infection_warning",
            "wesad_stress", "anomaly_score"} <= set(report["scores"])
    for name, entry in report["scores"].items():
        assert entry["shuffle_reproduces_score"] is False, name
        assert entry["mission_day_explains_most"] is False, name
    # Stress and sleep have no mission-day term at all
    assert report["scores"]["stress"]["r2_mission_day"] < 0.05
    assert report["scores"]["stress"]["follows_the_data_r"] > 0.9
    # The time-in-flight driver is reported per risk, with its real weight
    time_driver = report["time_in_flight_driver"]
    assert time_driver["immune"]["weight"] == risk_engine.IMMUNE_WEIGHTS["time_in_flight"]
    assert 0 < time_driver["musculoskeletal"]["share_of_all_risk_points"] < 1
    assert "confounding" in confound_check.to_markdown(report)


# ---------------------------------------------------------------------------
# T3. Harm-weighted thresholds
# ---------------------------------------------------------------------------
def test_pick_threshold_trades_misses_against_false_alarms():
    scores = [0.1, 0.2, 0.35, 0.4, 0.45, 0.6, 0.7, 0.8, 0.9]
    labels = [0, 0, 1, 0, 0, 1, 0, 1, 1]

    equal = thresholds.pick_threshold(scores, labels, miss_cost=1, false_alarm_cost=1)
    careful = thresholds.pick_threshold(scores, labels, miss_cost=5, false_alarm_cost=1)
    assert careful["threshold"] < equal["threshold"], "a costly miss must lower the threshold"
    assert careful["misses"] == 0 and careful["false_alarms"] == 3 and careful["cost"] == 3
    assert careful["threshold"] == pytest.approx(0.35)
    assert careful["sensitivity"] == 1.0

    never = thresholds.pick_threshold(scores, labels, miss_cost=0, false_alarm_cost=1)
    assert never["false_alarms"] == 0 and never["hits"] == 0  # free misses -> never alert


def test_pick_threshold_edge_cases():
    # Tie: the higher threshold wins (same cost, fewer alerts)
    tie = thresholds.pick_threshold([0.2, 0.4, 0.6], [0, 0, 1], miss_cost=1, false_alarm_cost=0)
    assert tie["threshold"] == pytest.approx(0.6)
    # Missing scores are ignored, not counted as alerts
    result = thresholds.pick_threshold([0.2, float("nan"), 0.9], [0, 1, 1])
    assert result["hits"] + result["misses"] == 1
    with pytest.raises(ValueError):
        thresholds.pick_threshold([float("nan")], [1])
    with pytest.raises(ValueError):
        thresholds.pick_threshold([0.5], [1], miss_cost=-1)
    assert thresholds.MISS_COST > thresholds.FALSE_ALARM_COST > 0


def test_infection_warning_sweep_documents_the_current_setting(curve_run):
    df, events, _ = curve_run
    before = (analysis.INFECTION_RHR_Z_THRESHOLD, analysis.INFECTION_CONSECUTIVE_DAYS)
    sweep = thresholds.infection_warning_sweep(df, events)
    assert (analysis.INFECTION_RHR_Z_THRESHOLD, analysis.INFECTION_CONSECUTIVE_DAYS) == before == (2.0, 2)

    assert sweep["planted_infections"] == [{"astronaut_id": "A1", "start_day": 95, "symptom_day": 97, "end_day": 98}]
    assert "tuned to our story" in sweep["warning"]
    rows = {(r["z_threshold"], r["consecutive_days"]): r for r in sweep["rows"]}
    assert len(rows) == len(thresholds.SWEEP_Z_THRESHOLDS) * len(thresholds.SWEEP_CONSECUTIVE_DAYS)

    current = rows[(2.0, 2)]
    assert current["current_setting"] is True
    assert current["misses"] == 0 and current["lead_days"] == [1]
    assert current["cost"] == thresholds.FALSE_ALARM_COST * current["false_alarms"]
    # Waiting for 3 days means the warning comes with the symptoms: that is a miss
    assert rows[(2.0, 3)]["misses"] == 1 and rows[(2.0, 3)]["cost"] >= thresholds.MISS_COST
    # A lower bar never gives fewer false-alarm days
    assert rows[(1.5, 2)]["false_alarms"] >= rows[(2.5, 2)]["false_alarms"]
    assert any(r["cheapest_on_this_simulation"] for r in sweep["rows"])


def test_wesad_threshold_is_stored_and_used():
    from hard.wesad import stress_model

    model = json.loads((ROOT / "hard" / "wesad" / "model.json").read_text())
    for name in ("daily", "wrist_all"):
        decision = model["models"][name]["decision"]
        assert decision["miss_cost"] == thresholds.MISS_COST
        assert decision["false_alarm_cost"] == thresholds.FALSE_ALARM_COST
        assert 0 < decision["threshold"] < 0.5, "a costly miss must move the cut below 0.5"
        assert decision["sensitivity"] >= decision["at_0_5"]["sensitivity"]
        assert decision["cost"] <= decision["at_0_5"]["cost"]
        assert stress_model.decision_threshold(name) == decision["threshold"]
    cut = stress_model.decision_threshold()
    assert stress_model.is_stress(cut) and not stress_model.is_stress(cut - 0.01)
    # The web copy must match
    assert json.loads((ROOT / "web" / "models" / "wesad_stress_model.json").read_text()) == model


def test_anomaly_score_and_flag_agree(curve_run):
    pytest.importorskip("sklearn")
    from hard.anomaly.anomaly import ANOMALY_AT, score_mission

    scores = score_mission(curve_run[0])
    assert ((scores["anomaly_score"] >= ANOMALY_AT) == scores["is_anomaly"]).all()
    assert scores["is_anomaly"].sum() >= 3  # the planted glitches are still found
