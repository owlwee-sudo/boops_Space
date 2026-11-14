"""stress_model.py: INTEGRATION HOOK for the WESAD stress classifier (H3).

Runs the exported logistic regression from model.json with plain Python
(json + math only: no numpy, no scikit-learn), so the engine stays lightweight.

How analysis.py uses it (flag defaults to "rules", so nothing changes unless
someone turns it on):

    STRESS_MODEL = "rules"          # "rules" | "wesad"

    if STRESS_MODEL == "wesad":
        from hard.wesad.stress_model import wesad_stress_score
        stress_score = wesad_stress_score(z["rhr_bpm"], z["hrv_rmssd_ms"], z["eda_mean_us"])

Inputs are the app's personal-baseline z-scores (value - baseline mean) / baseline SD.

READ hard/wesad/REPORT.md BEFORE TRUSTING THE OUTPUT. In short: the model
learned 60-second lab stress in 15 young adults. Our data are daily averages in
space. The direction of each signal carries over, the calibration does not.
It is a risk indicator, never a diagnosis.
"""

import json
import math
from pathlib import Path

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
MODEL_PATH = Path(__file__).resolve().parent / "model.json"
DAILY_MODEL = "daily"  # the 3-feature model that matches our daily data
# Daily features the WESAD model does NOT get (they do not exist in daily_records):
MISSING_IN_DAILY_DATA = [
    "eda_scr_count", "eda_scr_amp_mean",  # fast sweat responses need raw EDA
    "temp_slope",  # needs within-day temperature
    "acc_mag_mean", "acc_mag_sd",  # movement
    "hrv_sdnn", "hrv_pnn50",  # only RMSSD is stored per day
]

_cache = {}


def load_model(path=MODEL_PATH):
    """Read model.json once and keep it in memory."""
    key = str(path)
    if key not in _cache:
        with open(path) as f:
            _cache[key] = json.load(f)
    return _cache[key]


def predict_proba(values, model_name=DAILY_MODEL, path=MODEL_PATH):
    """Probability of stress (0-1) for one row.

    values: list of numbers in the order of model["models"][model_name]["features"],
            already normalised the way the model expects (see its "input" text).
            Use None for a missing value: it is replaced by the training median.
    """
    spec = load_model(path)["models"][model_name]
    if len(values) != len(spec["features"]):
        raise ValueError(f"{model_name} needs {len(spec['features'])} values: {spec['features']}")
    total = spec["intercept"]
    for i, value in enumerate(values):
        if value is None or (isinstance(value, float) and math.isnan(value)):
            value = spec["impute_missing_with"][i]
        total += spec["coef"][i] * (value - spec["scaler_mean"][i]) / spec["scaler_scale"][i]
    return 1.0 / (1.0 + math.exp(-total))


def wesad_stress_score(z_rhr, z_hrv, z_eda, path=MODEL_PATH):
    """Stress score 0-100 from the app's daily personal-baseline z-scores.

    z_rhr  z-score of rhr_bpm        (higher = more stress)
    z_hrv  z-score of hrv_rmssd_ms   (the model gives it almost no weight, see REPORT.md)
    z_eda  z-score of eda_mean_us    (higher = more stress)
    """
    return round(100 * predict_proba([z_rhr, z_hrv, z_eda], DAILY_MODEL, path))


if __name__ == "__main__":
    # Tiny demo:  python hard/wesad/stress_model.py
    for name, z in [("calm day", (0, 0, 0)), ("a bit off", (1, -1, 1)), ("strained", (2, -2, 2)), ("very strained", (3, -3, 3))]:
        print(f"{name:14} z = {z}  ->  stress score {wesad_stress_score(*z)}")
