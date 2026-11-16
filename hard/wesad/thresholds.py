"""thresholds.py: harm-weighted decision threshold for the WESAD stress model.

Usage:
    python hard/wesad/thresholds.py     # needs hard/wesad/cache/ (run prepare.py first)

The exported logistic regression gives a probability of stress (0-1). The
usual cut is 0.5, which treats a missed stress window and a false alarm as
equally bad. Here the cut is chosen from the ROC curve with the app's cost
ratio (``engine/thresholds.py``: ``MISS_COST`` / ``FALSE_ALARM_COST``).

How: leave-one-person-out. Each person's windows are scored by a model that
never saw that person, so the threshold is not fitted to the people it is
tested on. The result is written into model.json as
``models[<name>]["decision"]`` and copied to web/models/.

Limits (see REPORT.md): 15 young adults, lab stress on Earth, 60-second
windows. The threshold applies to those windows. It is NOT calibrated for the
app's daily averages in space, so ``STRESS_MODEL`` stays "rules" by default.
"""

import json
import shutil
import sys
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parents[1]))

import train  # noqa: E402
from engine.thresholds import FALSE_ALARM_COST, MISS_COST, confusion_at, pick_threshold  # noqa: E402

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
MODEL_JSON = HERE / "model.json"
WINDOW_S = 60
DEFAULT_THRESHOLD = 0.5


def loso_probabilities(table, features, how, model_name="logistic_regression"):
    """Probability of stress for every window, from a model that never saw that person."""
    x = train.normalise(table, features, how).to_numpy()
    y = table["stress"].to_numpy()
    subjects = table["subject"].to_numpy()
    proba = np.zeros(len(y), dtype=float)
    for held_out in pd.unique(subjects):
        test = subjects == held_out
        pipe = train.make_pipeline_for(train.make_models()[model_name])
        pipe.fit(x[~test], y[~test])
        proba[test] = pipe.predict_proba(x[test])[:, 1]
    return proba, y


def decision_for(table, set_name, how, miss_cost=MISS_COST, false_alarm_cost=FALSE_ALARM_COST):
    """Harm-weighted threshold for one exported model, next to the plain 0.5 cut."""
    proba, y = loso_probabilities(table, train.FEATURE_SETS[set_name], how)
    best = pick_threshold(proba, y, miss_cost, false_alarm_cost)
    half = confusion_at(proba, y, DEFAULT_THRESHOLD)
    half["cost"] = round(miss_cost * half["misses"] + false_alarm_cost * half["false_alarms"], 4)
    return {
        "threshold": round(best["threshold"], 3),
        "miss_cost": miss_cost,
        "false_alarm_cost": false_alarm_cost,
        "sensitivity": best["sensitivity"],
        "false_alarm_rate": best["false_alarm_rate"],
        "misses": best["misses"],
        "false_alarms": best["false_alarms"],
        "cost": best["cost"],
        "at_0_5": {k: half[k] for k in ("sensitivity", "false_alarm_rate", "misses", "false_alarms", "cost")},
        "evaluation": "leave-one-subject-out probabilities, 60 s windows",
        "note": "Chosen for WESAD lab windows. Not calibrated for daily averages in space. "
                "The rates at the chosen threshold are slightly optimistic: it was picked on the same predictions.",
    }


def add_decisions(model_json, table):
    """Add a "decision" block to every exported model (also called by train.py)."""
    for set_name, how in train.EXPORT_SETS.items():
        if set_name in model_json.get("models", {}):
            model_json["models"][set_name]["decision"] = decision_for(table, set_name, how)
    return model_json


def main():
    table = train.load_table(WINDOW_S)
    model_json = add_decisions(json.loads(MODEL_JSON.read_text()), table)
    MODEL_JSON.write_text(json.dumps(model_json, indent=2) + "\n")
    train.WEB_MODEL.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(MODEL_JSON, train.WEB_MODEL)
    for name, spec in model_json["models"].items():
        d = spec.get("decision")
        if not d:
            continue
        print(f"{name:10} threshold {d['threshold']:.3f}: catches {d['sensitivity']:.1%} of stress windows, "
              f"false alarm rate {d['false_alarm_rate']:.1%}, cost {d['cost']:g} "
              f"(at 0.5: {d['at_0_5']['sensitivity']:.1%} / {d['at_0_5']['false_alarm_rate']:.1%} / cost {d['at_0_5']['cost']:g})")
    print(f"Wrote the decision thresholds to {MODEL_JSON} and {train.WEB_MODEL}")


if __name__ == "__main__":
    main()
