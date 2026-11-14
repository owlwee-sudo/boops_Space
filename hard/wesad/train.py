"""train.py: train and honestly evaluate a stress classifier on WESAD (H3).

ONE COMMAND reproduces everything:

    python hard/wesad/train.py

It builds the feature table if it is missing (prepare.py), runs
leave-one-subject-out (LOSO) evaluation, prints the results tables, and writes:

    hard/wesad/results.json   every number in REPORT.md
    hard/wesad/model.json     logistic-regression weights (runs in Python or JS, no libraries)
    hard/wesad/model.joblib   the scikit-learn pipeline, for Python
    web/models/wesad_stress_model.json   copy of model.json for the dashboard

Why LOSO: each person is tested by a model that has NEVER seen that person.
Mixing one person's windows between train and test would look far better than
the model really is on a new crew member.

Trained on REAL labelled data only (WESAD). Never trained on our simulated
mission data.
"""

import argparse
import json
import shutil
import sys
from datetime import date
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingClassifier, RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, balanced_accuracy_score, confusion_matrix, f1_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

sys.path.insert(0, str(Path(__file__).resolve().parent))
import prepare  # noqa: E402

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
HERE = Path(__file__).resolve().parent
WEB_MODEL = HERE.parents[1] / "web" / "models" / "wesad_stress_model.json"
SEED = 0
WINDOWS = [60, 30]  # seconds; 60 is the main one

FEATURE_SETS = {
    # Everything from the wrist sensor (the handoff's list).
    "wrist_all": prepare.FEATURES,
    # Same without movement: in WESAD people stand and talk during the stress
    # task, so movement partly gives the label away.
    "wrist_no_motion": [f for f in prepare.FEATURES if not f.startswith("acc_")],
    # Same again without wrist heart features (they are mostly noise under stress).
    "wrist_eda_temp": [f for f in prepare.FEATURES if f.startswith(("eda_", "temp_"))],
    # Only what our app has every day. Heartbeat from the chest ECG, because our
    # daily HRV is assumed to be a clean resting measurement.
    "daily": ["ecg_hr_mean", "ecg_hrv_rmssd", "eda_tonic_mean"],
}
# How the three "daily" features map to the app's data contract (AGENTS.md).
DAILY_FIELD_MAP = {"ecg_hr_mean": "rhr_bpm", "ecg_hrv_rmssd": "hrv_rmssd_ms", "eda_tonic_mean": "eda_mean_us"}

# Per-person normalisation:
#   none      raw values
#   subject   z-score against all of that person's windows (needs no labels)
#   baseline  z-score against that person's own calm baseline phase. This is
#             what the app does (personal baseline = first 14 days in flight).
NORMALISATIONS = ["none", "subject", "baseline"]
SD_FLOOR_SHARE = 0.1  # a personal SD is never taken smaller than 10 % of the group SD

MAIN = {"feature_set": "wrist_all", "normalisation": "subject", "window": 60}  # headline result
EXPORT_SETS = {"wrist_all": "subject", "daily": "baseline"}  # models written to model.json


def make_models():
    return {
        "logistic_regression": LogisticRegression(C=1.0, class_weight="balanced", max_iter=1000),
        "random_forest": RandomForestClassifier(n_estimators=300, class_weight="balanced", random_state=SEED, n_jobs=-1),
        "gradient_boosting": GradientBoostingClassifier(n_estimators=200, max_depth=3, random_state=SEED),
    }


def make_pipeline_for(model):
    # Empty heart features (too few clean beats) are filled with the training median.
    return make_pipeline(SimpleImputer(strategy="median"), StandardScaler(), model)


# ---------------------------------------------------------------------------
# Per-person normalisation
# ---------------------------------------------------------------------------
def normalise(table, features, how):
    """Return a copy of table[features] normalised within each person."""
    values = table[features].astype(float).copy()
    if how == "none":
        return values
    group_sd = values.std(ddof=0)
    for _, rows in table.groupby("subject"):
        idx = rows.index
        ref = rows if how == "subject" else rows[rows["wesad_label"] == prepare.LABEL_BASELINE]
        mean = values.loc[ref.index].mean()
        sd = values.loc[ref.index].std(ddof=0).clip(lower=SD_FLOOR_SHARE * group_sd).replace(0, 1.0)
        values.loc[idx] = (values.loc[idx] - mean) / sd
    return values


# ---------------------------------------------------------------------------
# Leave-one-subject-out evaluation
# ---------------------------------------------------------------------------
def loso(table, features, how, model_name):
    x = normalise(table, features, how).to_numpy()
    y = table["stress"].to_numpy()
    subjects = table["subject"].to_numpy()
    predicted = np.zeros(len(y), dtype=int)
    for held_out in pd.unique(subjects):
        test = subjects == held_out
        pipe = make_pipeline_for(make_models()[model_name])
        pipe.fit(x[~test], y[~test])
        predicted[test] = pipe.predict(x[test])
    per_subject = {s: float(accuracy_score(y[subjects == s], predicted[subjects == s])) for s in pd.unique(subjects)}
    acc = np.array(list(per_subject.values()))
    tn, fp, fn, tp = confusion_matrix(y, predicted, labels=[0, 1]).ravel()
    return {
        "accuracy": float(accuracy_score(y, predicted)),
        "balanced_accuracy": float(balanced_accuracy_score(y, predicted)),
        "f1_stress": float(f1_score(y, predicted)),
        "per_subject_mean": float(acc.mean()),
        "per_subject_sd": float(acc.std()),
        "per_subject_min": float(acc.min()),
        "per_subject_max": float(acc.max()),
        "per_subject": per_subject,
        "confusion": {"true_nonstress_pred_nonstress": int(tn), "true_nonstress_pred_stress": int(fp),
                      "true_stress_pred_nonstress": int(fn), "true_stress_pred_stress": int(tp)},
    }


def load_table(window):
    path = prepare.cache_path(window)
    if not path.exists():
        print(f"{path.name} not found: building it from the raw WESAD data...")
        if not prepare.DATA_ZIP.exists():
            sys.exit(f"WESAD data not found at {prepare.DATA_ZIP}. See hard/wesad/README.md.")
        prepare.CACHE_DIR.mkdir(exist_ok=True)
        prepare.build_features(prepare.DATA_ZIP, window, window // 2).to_csv(path, index=False)
    return pd.read_csv(path)


# ---------------------------------------------------------------------------
# Data-quality summary: how good is the wrist heartbeat compared with ECG?
# ---------------------------------------------------------------------------
def sensor_quality(table):
    names = {1: "baseline", 2: "stress", 3: "amusement"}
    out = {}
    for label, rows in table.groupby("wesad_label"):
        out[names[label]] = {
            "windows": int(len(rows)),
            "wrist_clean_beat_share": float(rows["bvp_clean_share"].mean()),
            "ecg_clean_beat_share": float(rows["ecg_clean_share"].mean()),
            "wrist_hr": float(rows["hr_mean"].mean()),
            "ecg_hr": float(rows["ecg_hr_mean"].mean()),
            "wrist_rmssd": float(rows["hrv_rmssd"].mean()),
            "ecg_rmssd": float(rows["ecg_hrv_rmssd"].mean()),
            "wrist_heart_features_missing": float(rows["hr_mean"].isna().mean()),
        }
    both = table.dropna(subset=["hr_mean", "ecg_hr_mean"])
    out["wrist_vs_ecg_hr_mean_abs_error_bpm"] = float((both["hr_mean"] - both["ecg_hr_mean"]).abs().mean())
    return out


# ---------------------------------------------------------------------------
# Export: logistic regression as plain numbers
# ---------------------------------------------------------------------------
def export_logistic(table, set_name, how, loso_result):
    features = FEATURE_SETS[set_name]
    x = normalise(table, features, how)
    pipe = make_pipeline_for(make_models()["logistic_regression"])
    pipe.fit(x.to_numpy(), table["stress"].to_numpy())  # final model: all 15 people
    imputer, scaler, logreg = pipe.steps[0][1], pipe.steps[1][1], pipe.steps[2][1]
    return pipe, {
        "features": features,
        "maps_to": [DAILY_FIELD_MAP.get(f) for f in features] if set_name == "daily" else None,
        "input": {
            "none": "raw feature values",
            "subject": "z-score of each feature against all of the same person's windows",
            "baseline": "z-score of each feature against the same person's calm baseline (personal baseline)",
        }[how],
        "normalisation": how,
        "impute_missing_with": [float(v) for v in imputer.statistics_],
        "scaler_mean": [float(v) for v in scaler.mean_],
        "scaler_scale": [float(v) for v in scaler.scale_],
        "coef": [float(v) for v in logreg.coef_[0]],
        "intercept": float(logreg.intercept_[0]),
        "formula": "p_stress = 1 / (1 + exp(-(intercept + sum(coef[i] * (x[i] - scaler_mean[i]) / scaler_scale[i]))))",
        "loso": {k: v for k, v in loso_result.items() if k != "per_subject"},
    }


# ---------------------------------------------------------------------------
def print_table(rows):
    header = f"{'features':16} {'norm':9} {'model':20} {'acc':>6} {'bal':>6} {'F1':>6} {'subj mean':>9} {'sd':>6} {'min':>6}"
    print(header)
    print("-" * len(header))
    for r in rows:
        m = r["metrics"]
        print(f"{r['feature_set']:16} {r['normalisation']:9} {r['model']:20} {m['accuracy']:6.3f} {m['balanced_accuracy']:6.3f} "
              f"{m['f1_stress']:6.3f} {m['per_subject_mean']:9.3f} {m['per_subject_sd']:6.3f} {m['per_subject_min']:6.3f}")


def main():
    parser = argparse.ArgumentParser(description="WESAD stress classifier: LOSO evaluation + export")
    parser.add_argument("--quick", action="store_true", help="60 s windows only")
    args = parser.parse_args()

    results = {"created": date.today().isoformat(), "seed": SEED, "windows": {}}
    tables = {}
    for window in WINDOWS[:1] if args.quick else WINDOWS:
        table = load_table(window)
        tables[window] = table
        y = table["stress"]
        print(f"\n=== {window} s windows: {len(table)} windows, {table['subject'].nunique()} people, "
              f"{int(y.sum())} stress / {int((1 - y).sum())} non-stress ===")
        rows = []
        for set_name, features in FEATURE_SETS.items():
            for how in NORMALISATIONS:
                for model_name in make_models():
                    rows.append({"feature_set": set_name, "normalisation": how, "model": model_name,
                                 "metrics": loso(table, features, how, model_name)})
        print_table(rows)
        results["windows"][str(window)] = {
            "n_windows": int(len(table)),
            "n_subjects": int(table["subject"].nunique()),
            "n_stress": int(y.sum()),
            "n_nonstress": int((1 - y).sum()),
            "majority_class_accuracy": float(max(y.mean(), 1 - y.mean())),
            "sensor_quality": sensor_quality(table),
            "runs": rows,
        }

    # ---- export (60 s windows) ----
    table = tables[60]
    runs = results["windows"]["60"]["runs"]
    find = lambda s, h, m: next(r["metrics"] for r in runs if (r["feature_set"], r["normalisation"], r["model"]) == (s, h, m))  # noqa: E731
    model_json = {
        "name": "WESAD stress classifier (logistic regression)",
        "created": results["created"],
        "trained_on": "WESAD (Schmidt et al. 2018): 15 people, lab stress. Real labelled data, not simulated.",
        "target": "stress (WESAD label 2) vs non-stress (baseline 1 + amusement 3)",
        "window_s": 60,
        "evaluation": "leave-one-subject-out",
        "warning": "Lab stress in 15 young adults on Earth. Not validated for spaceflight. Risk indicator, not a diagnosis.",
        "models": {},
    }
    main_pipe = None
    for set_name, how in EXPORT_SETS.items():
        pipe, spec = export_logistic(table, set_name, how, find(set_name, how, "logistic_regression"))
        model_json["models"][set_name] = spec
        if set_name == MAIN["feature_set"]:
            main_pipe = pipe
    (HERE / "model.json").write_text(json.dumps(model_json, indent=2) + "\n")
    WEB_MODEL.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(HERE / "model.json", WEB_MODEL)
    joblib.dump({"pipeline": main_pipe, "features": FEATURE_SETS[MAIN["feature_set"]],
                 "normalisation": MAIN["normalisation"], "note": "input = per-person z-scores, see train.py"},
                HERE / "model.joblib")
    (HERE / "results.json").write_text(json.dumps(results, indent=2) + "\n")

    headline = find(MAIN["feature_set"], MAIN["normalisation"], "logistic_regression")
    print(f"\nHeadline (wrist, per-person z-score, logistic regression, LOSO): "
          f"accuracy {headline['accuracy']:.3f}, balanced {headline['balanced_accuracy']:.3f}, F1 {headline['f1_stress']:.3f}")
    print(f"Majority-class accuracy (always say 'not stressed'): {results['windows']['60']['majority_class_accuracy']:.3f}")
    print("Wrote results.json, model.json, model.joblib and web/models/wesad_stress_model.json")


if __name__ == "__main__":
    main()
