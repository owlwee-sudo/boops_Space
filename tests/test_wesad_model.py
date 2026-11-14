"""Checks for the WESAD stress classifier (H3).

Run:  pytest tests/test_wesad_model.py
The exported model files are in the repo, so most tests need no dataset.
The LOSO re-run test only runs when the feature cache exists (after prepare.py).
"""
import io
import json
import math
import pickle
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "hard" / "wesad"))
from hard.wesad import stress_model  # noqa: E402

MODEL = json.loads((ROOT / "hard" / "wesad" / "model.json").read_text())
NODE = shutil.which("node")


def test_model_json_is_complete_and_copied_to_web():
    assert set(MODEL["models"]) == {"wrist_all", "daily"}
    for spec in MODEL["models"].values():
        n = len(spec["features"])
        assert all(len(spec[k]) == n for k in ["coef", "scaler_mean", "scaler_scale", "impute_missing_with"])
        assert 0.5 < spec["loso"]["accuracy"] <= 1
    assert MODEL["models"]["daily"]["maps_to"] == ["rhr_bpm", "hrv_rmssd_ms", "eda_mean_us"]
    web_copy = json.loads((ROOT / "web" / "models" / "wesad_stress_model.json").read_text())
    assert web_copy == MODEL


def test_plain_python_matches_scikit_learn():
    joblib = pytest.importorskip("joblib")
    bundle = joblib.load(ROOT / "hard" / "wesad" / "model.joblib")
    rng = np.random.default_rng(1)
    x = rng.normal(0, 1.5, size=(50, len(bundle["features"])))
    expected = bundle["pipeline"].predict_proba(x)[:, 1]
    got = [stress_model.predict_proba(list(row), "wrist_all") for row in x]
    assert np.allclose(got, expected, atol=1e-9)


@pytest.mark.skipif(NODE is None, reason="Node.js not installed")
def test_javascript_matches_python():
    runner = str(ROOT / "hard" / "wesad" / "run_model.mjs")
    for z in [(0, 0, 0), (2, -2, 2), (-1, 1, -0.5), (3.5, -0.2, 1.1)]:
        out = subprocess.run([NODE, runner, "daily", *map(str, z)], capture_output=True, text=True, check=True)
        assert math.isclose(json.loads(out.stdout)["p"], stress_model.predict_proba(list(z)), abs_tol=1e-12)
    # A missing value is filled the same way on both sides.
    out = subprocess.run([NODE, runner, "daily", "2", "null", "2"], capture_output=True, text=True, check=True)
    assert math.isclose(json.loads(out.stdout)["p"], stress_model.predict_proba([2, None, 2]), abs_tol=1e-12)


def test_daily_score_moves_the_right_way():
    calm = stress_model.wesad_stress_score(0, 0, 0)
    strained = stress_model.wesad_stress_score(2, -2, 2)
    very = stress_model.wesad_stress_score(3, -3, 3)
    assert calm < 10 < strained < very <= 100
    # Higher resting HR or higher skin conductance alone raises the score.
    assert stress_model.predict_proba([2, 0, 0]) > stress_model.predict_proba([0, 0, 0])
    assert stress_model.predict_proba([0, 0, 2]) > stress_model.predict_proba([0, 0, 0])


def test_unpickler_blocks_code_execution():
    import prepare

    class Evil:
        def __reduce__(self):
            import os

            return (os.system, ("echo should-never-run",))

    with pytest.raises(pickle.UnpicklingError):
        prepare.NumpyOnlyUnpickler(io.BytesIO(pickle.dumps(Evil()))).load()
    # ...but plain numpy data still loads.
    payload = pickle.dumps({"signal": np.arange(5.0), "label": np.array([1, 2])})
    data = prepare.NumpyOnlyUnpickler(io.BytesIO(payload)).load()
    assert data["signal"].tolist() == [0, 1, 2, 3, 4]


def test_heart_features_on_a_perfect_metronome():
    import prepare

    beats = np.arange(0, 60, 0.8)  # exactly 75 bpm, no variation
    f = prepare.heart_features(beats)
    assert abs(f["hr_mean"] - 75) < 1e-6
    assert f["hrv_rmssd"] < 1e-6
    assert f["clean_share"] == 1.0
    # A missed beat and an extra beat are thrown out, not counted as HRV.
    messy = np.delete(beats, 20)
    messy = np.sort(np.append(messy, 40.4))
    g = prepare.heart_features(messy)
    assert g["hrv_rmssd"] < 1e-6 and g["clean_share"] < 1.0


def test_loso_headline_is_reproducible():
    import prepare
    import train

    if not prepare.cache_path(60).exists():
        pytest.skip("feature cache missing: run python hard/wesad/prepare.py first")
    table = train.load_table(60)
    got = train.loso(table, train.FEATURE_SETS["wrist_all"], "subject", "logistic_regression")
    assert math.isclose(got["accuracy"], MODEL["models"]["wrist_all"]["loso"]["accuracy"], abs_tol=1e-9)
