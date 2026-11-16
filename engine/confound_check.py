"""Mission-day confounding check: is the engine just counting days in space?

Usage:
    python engine/confound_check.py          # writes data/confound_report.json + .md

Everything drifts with mission day, so a score could look clever while only
tracking the calendar. This script asks three questions about every score
(stress, sleep, the three risks, the infection early warning, and the optional
WESAD stress model and Isolation Forest anomaly score):

1. How much of the score does mission day explain on its own?
   R^2 of a straight line "score ~ mission_day", per astronaut.
2. How much of each risk comes from the built-in "time in flight" driver
   (weight 0.10-0.15, value day/180), and how many Watch/Act days exist only
   because of it?
3. Shuffle test. The daily records of each astronaut are shuffled across
   mission days and re-scored. Then:
     - "follows the day":  correlation between the real score on day d and
       the shuffled score on day d. Near 1 would mean the score ignores the
       body and only reads the calendar.
     - "follows the data": correlation between a record's real score and the
       score the same record gets on its new day. Near 1 means the score
       travels with the body readings.

Honest limits:
    - The data is SIMULATED. This shows how the engine behaves, not that it is
      medically valid.
    - Shuffling also breaks the multi-day rules on purpose (2-day resting-HR
      streak, 3-day sleep, 7-day exercise, the baseline window), so "follows
      the data" cannot reach 1.0 for those scores, and the infection early
      warning (a streak rule) mostly disappears after a shuffle.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

import numpy as np
import pandas as pd

from engine import analysis, risk_engine
from engine.run_all import score_records

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
N_SHUFFLES = 20            # shuffled missions per test
SEED = 7
REPRODUCED_R = 0.8         # "follows the day" at or above this = the shuffle reproduced the score
DAY_EXPLAINS_R2 = 0.5      # R^2 at or above this = mission day explains most of the score

DATA_DIR = ROOT_DIR / "data"
RECORDS_CSV = DATA_DIR / "daily_records.csv"
REPORT_JSON = DATA_DIR / "confound_report.json"
REPORT_MD = DATA_DIR / "confound_report.md"

RISK_DOMAINS = ("immune", "musculoskeletal", "cardio")
TIME_WEIGHTS = {
    "immune": risk_engine.IMMUNE_WEIGHTS["time_in_flight"],
    "musculoskeletal": risk_engine.MUSCULOSKELETAL_WEIGHTS["time_in_flight"],
    "cardio": risk_engine.CARDIO_WEIGHTS["time_in_flight"],
}
# Columns that stay with the calendar day when records are shuffled
CALENDAR_COLUMNS = ("astronaut_id", "mission_day", "date")


# ---------------------------------------------------------------------------
# Scoring helpers
# ---------------------------------------------------------------------------
def score_table(df: pd.DataFrame) -> pd.DataFrame:
    """Rules-engine scores, one row per astronaut-day."""
    rows = []
    for out in score_records(df):
        row = {
            "astronaut_id": out["astronaut_id"],
            "mission_day": out["mission_day"],
            "stress": out["stress_score"],
            "sleep": out["sleep_score"],
            "infection_warning": int(out["flags"]["infection_early_warning"]),
        }
        for domain in RISK_DOMAINS:
            row[domain] = out["risks"][domain]["score"]
        rows.append(row)
    return pd.DataFrame(rows)


def wesad_stress_table(df: pd.DataFrame) -> pd.DataFrame:
    """Stress score from the optional WESAD model (STRESS_MODEL = "wesad")."""
    previous = analysis.STRESS_MODEL
    analysis.STRESS_MODEL = "wesad"
    try:
        rows = []
        for astro_id in sorted(df["astronaut_id"].unique(), key=str):
            baseline = analysis.personal_baseline(df, astro_id)
            sub = df[df["astronaut_id"] == astro_id].sort_values("mission_day")
            for _, rec in sub.iterrows():
                z = analysis.zscores(rec, baseline)
                rows.append(
                    {
                        "astronaut_id": astro_id,
                        "mission_day": int(rec["mission_day"]),
                        "wesad_stress": analysis.stress_score(rec, z, baseline),
                    }
                )
        return pd.DataFrame(rows)
    finally:
        analysis.STRESS_MODEL = previous


def anomaly_table(df: pd.DataFrame) -> pd.DataFrame:
    """Isolation Forest anomaly score (H4). Needs scikit-learn."""
    from hard.anomaly.anomaly import score_mission

    scores = score_mission(df)
    return scores[["astronaut_id", "mission_day", "anomaly_score"]].copy()


def shuffle_days(df: pd.DataFrame, rng: np.random.Generator) -> pd.DataFrame:
    """Shuffle each astronaut's daily records across mission days.

    The calendar (astronaut, mission_day, date) stays put; every measurement
    moves as one block, so each record keeps its own internal consistency.
    Adds ``record_day`` = the mission day the record originally came from.
    """
    parts = []
    measure_cols = [c for c in df.columns if c not in CALENDAR_COLUMNS]
    for _, sub in df.groupby("astronaut_id", sort=True):
        sub = sub.sort_values("mission_day").reset_index(drop=True)
        order = rng.permutation(len(sub))
        shuffled = sub.copy()
        shuffled[measure_cols] = sub[measure_cols].to_numpy()[order]
        shuffled["record_day"] = sub["mission_day"].to_numpy()[order]
        parts.append(shuffled)
    return pd.concat(parts, ignore_index=True)


# ---------------------------------------------------------------------------
# Statistics
# ---------------------------------------------------------------------------
def _corr(a: np.ndarray, b: np.ndarray) -> float | None:
    """Pearson correlation, or None when one side never changes."""
    a = np.asarray(a, dtype=float)
    b = np.asarray(b, dtype=float)
    ok = np.isfinite(a) & np.isfinite(b)
    if ok.sum() < 3 or np.std(a[ok]) == 0 or np.std(b[ok]) == 0:
        return None
    return float(np.corrcoef(a[ok], b[ok])[0, 1])


def _mean(values: list[float | None]) -> float | None:
    kept = [v for v in values if v is not None]
    return round(float(np.mean(kept)), 3) if kept else None


def r2_on_mission_day(table: pd.DataFrame, column: str) -> float | None:
    """Share of the score a straight line over mission day explains (mean over astronauts)."""
    per_astronaut = []
    for _, sub in table.groupby("astronaut_id"):
        r = _corr(sub["mission_day"].to_numpy(), sub[column].to_numpy())
        per_astronaut.append(None if r is None else r * r)
    return _mean(per_astronaut)


def time_in_flight_share(table: pd.DataFrame) -> dict[str, dict[str, Any]]:
    """How much of each risk is the "time in flight" driver alone.

    points_from_time = weight * min(day / 180, 1) * 100, times the 0.45
    dampening on days 1-14 when ADAPTATION_MODEL = "window".
    """
    out: dict[str, dict[str, Any]] = {}
    for domain in RISK_DOMAINS:
        points, lost = [], 0
        for _, row in table.iterrows():
            day = int(row["mission_day"])
            time_points = (
                TIME_WEIGHTS[domain] * min(day / 180.0, 1.0) * 100.0
                * risk_engine._adaptation_factor(day)
            )
            points.append(time_points)
            with_time = risk_engine.level_from_score(row[domain])
            without_time = risk_engine.level_from_score(row[domain] - time_points)
            lost += int(with_time != "normal" and without_time != with_time)
        total = float(table[domain].sum())
        alert_days = int((table[domain] >= risk_engine.RISK_THRESHOLDS["watch"]).sum())
        out[domain] = {
            "weight": TIME_WEIGHTS[domain],
            "max_points": round(TIME_WEIGHTS[domain] * 100.0, 1),
            "share_of_all_risk_points": round(float(np.sum(points)) / total, 3) if total else None,
            "watch_or_act_days": alert_days,
            "days_lower_without_time_driver": lost,
        }
    return out


def shuffle_test(
    df: pd.DataFrame,
    real: pd.DataFrame,
    scorer,
    columns: list[str],
    n_shuffles: int = N_SHUFFLES,
    seed: int = SEED,
) -> dict[str, dict[str, Any]]:
    """Shuffle, re-score, and compare with the real scores (see module docstring)."""
    rng = np.random.default_rng(seed)
    real_by_key = real.set_index(["astronaut_id", "mission_day"])
    by_day: dict[str, list[float | None]] = {c: [] for c in columns}
    by_record: dict[str, list[float | None]] = {c: [] for c in columns}

    for _ in range(n_shuffles):
        shuffled = shuffle_days(df, rng)
        scored = scorer(shuffled.drop(columns=["record_day"]))
        scored = scored.merge(
            shuffled[["astronaut_id", "mission_day", "record_day"]],
            on=["astronaut_id", "mission_day"],
        )
        for _, sub in scored.groupby("astronaut_id"):
            astro = sub["astronaut_id"].iloc[0]
            for col in columns:
                same_day = real_by_key.loc[[(astro, d) for d in sub["mission_day"]], col].to_numpy()
                same_record = real_by_key.loc[[(astro, d) for d in sub["record_day"]], col].to_numpy()
                by_day[col].append(_corr(same_day, sub[col].to_numpy()))
                by_record[col].append(_corr(same_record, sub[col].to_numpy()))

    result = {}
    for col in columns:
        day_r = _mean(by_day[col])
        result[col] = {
            "follows_the_day_r": day_r,
            "follows_the_data_r": _mean(by_record[col]),
            "shuffle_reproduces_score": bool(day_r is not None and day_r >= REPRODUCED_R),
        }
    return result


# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------
def build_report(df: pd.DataFrame, n_shuffles: int = N_SHUFFLES, seed: int = SEED) -> dict[str, Any]:
    """Run every check and return the report as a plain dict."""
    rules = score_table(df)
    rule_cols = ["stress", "sleep", "immune", "musculoskeletal", "cardio", "infection_warning"]
    scores: dict[str, dict[str, Any]] = {}

    shuffled_rules = shuffle_test(df, rules, score_table, rule_cols, n_shuffles, seed)
    for col in rule_cols:
        scores[col] = {
            "model": "rules",
            "r2_mission_day": r2_on_mission_day(rules, col),
            **shuffled_rules[col],
        }

    skipped: dict[str, str] = {}
    optional = [
        ("wesad_stress", 'STRESS_MODEL = "wesad"', wesad_stress_table),
        ("anomaly_score", "Isolation Forest (H4)", anomaly_table),
    ]
    for col, model_name, scorer in optional:
        try:
            real = scorer(df)
            shuffled = shuffle_test(df, real, scorer, [col], n_shuffles, seed)
        except Exception as exc:  # optional packages / model files may be missing
            skipped[col] = f"{type(exc).__name__}: {exc}"
            continue
        scores[col] = {
            "model": model_name,
            "r2_mission_day": r2_on_mission_day(real, col),
            **shuffled[col],
        }

    for col, entry in scores.items():
        r2 = entry["r2_mission_day"]
        entry["mission_day_explains_most"] = bool(r2 is not None and r2 >= DAY_EXPLAINS_R2)

    warning_days = int(rules["infection_warning"].sum())
    return {
        "labels": ["Simulated"],
        "note": (
            "Simulated data. Shows that the scores follow the body readings rather than "
            "the calendar. It does not show that the scores are medically valid."
        ),
        "config": {
            "adaptation_model": analysis.ADAPTATION_MODEL,
            "n_shuffles": n_shuffles,
            "seed": seed,
            "reproduced_r": REPRODUCED_R,
            "day_explains_r2": DAY_EXPLAINS_R2,
        },
        "scores": scores,
        "time_in_flight_driver": time_in_flight_share(rules),
        "infection_warning_days_real": warning_days,
        "skipped": skipped,
        "passes": not any(
            e["shuffle_reproduces_score"] or e["mission_day_explains_most"] for e in scores.values()
        ),
    }


def _fmt(value: Any) -> str:
    return "n/a" if value is None else f"{value:.2f}"


def to_markdown(report: dict[str, Any]) -> str:
    """Small readable version of the report."""
    cfg = report["config"]
    lines = [
        "# Mission-day confounding check",
        "",
        f"Simulated data. Adaptation model: `{cfg['adaptation_model']}`. "
        f"{cfg['n_shuffles']} shuffles, seed {cfg['seed']}. "
        "Generated by `python engine/confound_check.py`.",
        "",
        "## Does mission day explain the score?",
        "",
        "| Score | Model | R² from mission day alone | Follows the day (r) | Follows the data (r) |",
        "|---|---|---|---|---|",
    ]
    for name, e in report["scores"].items():
        lines.append(
            f"| {name} | {e['model']} | {_fmt(e['r2_mission_day'])} | "
            f"{_fmt(e['follows_the_day_r'])} | {_fmt(e['follows_the_data_r'])} |"
        )
    lines += [
        "",
        "- **R² from mission day alone**: share of the score a straight line over mission day explains. "
        f"{cfg['day_explains_r2']} or more would mean the calendar explains most of it.",
        "- **Follows the day**: after shuffling the records across days, how well the new score on day d "
        f"matches the real score on day d. {cfg['reproduced_r']} or more would mean the shuffle reproduced the score.",
        "- **Follows the data**: how well a record keeps its score when it moves to another day. "
        "Multi-day rules (streaks, 3-day and 7-day averages, the baseline window) are broken by the shuffle, "
        "so this cannot reach 1.0.",
        "",
        "## The built-in time-in-flight driver",
        "",
        "| Risk | Weight | Max points | Share of all risk points | Watch/Act days | Days that drop a level without it |",
        "|---|---|---|---|---|---|",
    ]
    for domain, t in report["time_in_flight_driver"].items():
        lines.append(
            f"| {domain} | {t['weight']:.2f} | {t['max_points']:.0f} | "
            f"{_fmt(t['share_of_all_risk_points'])} | {t['watch_or_act_days']} | "
            f"{t['days_lower_without_time_driver']} |"
        )
    lines += [
        "",
        f"Infection early warning days in the real run: {report['infection_warning_days_real']}.",
        "",
        f"**Result: {'pass' if report['passes'] else 'FAIL'}** "
        "(no score is reproduced by the shuffle or mostly explained by mission day).",
    ]
    if report["skipped"]:
        lines += ["", "Skipped (optional parts not available):"]
        lines += [f"- {name}: {why}" for name, why in report["skipped"].items()]
    return "\n".join(lines) + "\n"


def main() -> None:
    df = pd.read_csv(RECORDS_CSV)
    report = build_report(df)
    REPORT_JSON.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    REPORT_MD.write_text(to_markdown(report), encoding="utf-8")
    print(to_markdown(report))
    print(f"Wrote {REPORT_JSON} and {REPORT_MD}")


if __name__ == "__main__":
    main()
