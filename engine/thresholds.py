"""Harm-weighted thresholds: a missed warning costs more than a false alarm.

Usage:
    python engine/thresholds.py              # writes data/threshold_report.json + .md

The idea
    Every alert threshold trades two mistakes:
      - a MISS         (a real problem with no warning)
      - a FALSE ALARM  (a warning with no problem)
    Missing an infection is worse than one extra warning. But too many false
    alarms and the crew stops trusting the app. ``MISS_COST`` and
    ``FALSE_ALARM_COST`` say how much worse a miss is, and ``pick_threshold``
    chooses the threshold with the lowest total cost:

        cost = MISS_COST * misses + FALSE_ALARM_COST * false alarms

    Worked example (10 stressed windows, 20 calm ones, MISS_COST 5, FALSE_ALARM_COST 1):
        threshold 0.5 -> 3 misses, 1 false alarm  -> 5*3 + 1*1 = 16
        threshold 0.3 -> 1 miss,   4 false alarms -> 5*1 + 1*4 =  9   <- chosen

Where it is used
    1. WESAD stress model (real labelled data): ``hard/wesad/thresholds.py``
       picks the probability threshold from leave-one-person-out predictions
       and stores it in ``hard/wesad/model.json``.
    2. Infection early warning: ``infection_warning_sweep`` shows what other
       settings of "resting HR >= 2 SD for >= 2 days" would cost.

Be honest about the infection warning
    The only "labels" for it are the events WE planted in the simulated
    mission (one infection, A1 days 95-98). Picking the cheapest setting on
    that table is tuning the app to its own story, not validation. So the sweep
    only documents the choice. The setting itself stays at 2 SD / 2 days, the
    rule taken from Mishra et al. 2020 (source ``mishra2020``).

The cost ratio is a starting value, not a clinically validated number.
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

from engine import analysis

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
MISS_COST = 5.0           # cost of a real problem with no warning
FALSE_ALARM_COST = 1.0    # cost of a warning with no problem
# -> a miss counts as much as MISS_COST / FALSE_ALARM_COST = 5 false alarms.

# Infection-warning settings compared in the sweep
SWEEP_Z_THRESHOLDS = (1.5, 2.0, 2.5, 3.0)
SWEEP_CONSECUTIVE_DAYS = (1, 2, 3)

DATA_DIR = ROOT_DIR / "data"
RECORDS_CSV = DATA_DIR / "daily_records.csv"
EVENTS_JSON = DATA_DIR / "events.json"
WESAD_MODEL_JSON = ROOT_DIR / "hard" / "wesad" / "model.json"
REPORT_JSON = DATA_DIR / "threshold_report.json"
REPORT_MD = DATA_DIR / "threshold_report.md"


# ---------------------------------------------------------------------------
# Generic: pick a threshold from scores + true labels
# ---------------------------------------------------------------------------
def confusion_at(scores: Any, labels: Any, threshold: float) -> dict[str, Any]:
    """Counts and rates when "score >= threshold" raises the alert."""
    s = np.asarray(scores, dtype=float)
    y = np.asarray(labels).astype(bool)
    alert = s >= threshold
    hits = int((alert & y).sum())
    misses = int((~alert & y).sum())
    false_alarms = int((alert & ~y).sum())
    correct_quiet = int((~alert & ~y).sum())
    return {
        "threshold": round(float(threshold), 4),
        "hits": hits,
        "misses": misses,
        "false_alarms": false_alarms,
        "correct_quiet": correct_quiet,
        "sensitivity": round(hits / max(hits + misses, 1), 4),
        "false_alarm_rate": round(false_alarms / max(false_alarms + correct_quiet, 1), 4),
    }


def pick_threshold(
    scores: Any,
    labels: Any,
    miss_cost: float = MISS_COST,
    false_alarm_cost: float = FALSE_ALARM_COST,
) -> dict[str, Any]:
    """Threshold with the lowest ``miss_cost * misses + false_alarm_cost * false alarms``.

    Every distinct score is tried as a threshold (that is the whole ROC curve),
    plus one above the top score ("never alert"). On a tie the HIGHER threshold
    wins: same cost with fewer alerts. Missing scores are ignored.
    """
    if miss_cost < 0 or false_alarm_cost < 0:
        raise ValueError("Costs must not be negative")
    s = np.asarray(scores, dtype=float)
    y = np.asarray(labels).astype(bool)
    ok = np.isfinite(s)
    s, y = s[ok], y[ok]
    if len(s) == 0:
        raise ValueError("No usable scores")

    candidates = sorted(set(s.tolist())) + [float(np.nextafter(s.max(), np.inf))]
    best: dict[str, Any] | None = None
    for threshold in candidates:
        result = confusion_at(s, y, threshold)
        result["cost"] = round(miss_cost * result["misses"] + false_alarm_cost * result["false_alarms"], 4)
        if best is None or result["cost"] <= best["cost"]:
            best = result
    assert best is not None
    best["miss_cost"] = miss_cost
    best["false_alarm_cost"] = false_alarm_cost
    return best


# ---------------------------------------------------------------------------
# Infection early warning: document the 2 SD / 2 days setting
# ---------------------------------------------------------------------------
def _warning_days(df: pd.DataFrame) -> set[tuple[str, int]]:
    """Every (astronaut, mission_day) with the infection early warning on."""
    on: set[tuple[str, int]] = set()
    for astro_id in sorted(df["astronaut_id"].unique(), key=str):
        baseline = analysis.personal_baseline(df, astro_id)
        sub = df[df["astronaut_id"] == astro_id].sort_values("mission_day").reset_index(drop=True)
        for idx in range(len(sub)):
            if analysis.infection_early_warning(sub, idx, baseline):
                on.add((astro_id, int(sub.loc[idx, "mission_day"])))
    return on


def _episodes(days: list[int]) -> int:
    """Number of separate runs of consecutive days (3, 4, 9 -> 2 episodes)."""
    days = sorted(days)
    return sum(1 for i, d in enumerate(days) if i == 0 or d != days[i - 1] + 1)


def planted_infections(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Planted infections from events.json: first sick day, first symptom day, last day."""
    out = []
    for pre in (e for e in events if e.get("type") == "infection_early_warning"):
        astro = pre["astronaut_id"]
        symptoms = [
            e for e in events
            if e.get("type") == "symptoms" and e["astronaut_id"] == astro and e["start_day"] > pre["start_day"]
        ]
        symptom_day = min((e["start_day"] for e in symptoms), default=pre["end_day"] + 1)
        last_day = max((e["end_day"] for e in symptoms), default=pre["end_day"])
        out.append({"astronaut_id": astro, "start_day": pre["start_day"], "symptom_day": symptom_day, "end_day": last_day})
    return out


def infection_warning_sweep(
    df: pd.DataFrame,
    events: list[dict[str, Any]],
    miss_cost: float = MISS_COST,
    false_alarm_cost: float = FALSE_ALARM_COST,
) -> dict[str, Any]:
    """Cost of each "resting HR >= z SD for >= n days" setting on the planted story.

    miss        = a planted infection with no warning BEFORE its first symptom day
    false alarm = a run of warning days outside every planted infection
    """
    infections = planted_infections(events)
    saved = (analysis.INFECTION_RHR_Z_THRESHOLD, analysis.INFECTION_CONSECUTIVE_DAYS)
    rows = []
    try:
        for z in SWEEP_Z_THRESHOLDS:
            for n_days in SWEEP_CONSECUTIVE_DAYS:
                analysis.INFECTION_RHR_Z_THRESHOLD = z
                analysis.INFECTION_CONSECUTIVE_DAYS = n_days
                on = _warning_days(df)

                misses, lead_days = 0, []
                inside: set[tuple[str, int]] = set()
                for inf in infections:
                    window = {(inf["astronaut_id"], d) for d in range(inf["start_day"], inf["end_day"] + 1)}
                    inside |= window
                    early = sorted(d for (a, d) in on & window if d < inf["symptom_day"])
                    if early:
                        lead_days.append(inf["symptom_day"] - early[0])
                    else:
                        misses += 1

                outside = on - inside
                false_alarm_days: dict[str, list[int]] = {}
                for astro, day in sorted(outside):
                    false_alarm_days.setdefault(astro, []).append(day)
                false_alarms = sum(_episodes(days) for days in false_alarm_days.values())

                rows.append(
                    {
                        "z_threshold": z,
                        "consecutive_days": n_days,
                        "misses": misses,
                        "lead_days": lead_days,
                        "false_alarms": false_alarms,
                        "false_alarm_days": false_alarm_days,
                        "cost": round(miss_cost * misses + false_alarm_cost * false_alarms, 2),
                        "current_setting": (z, n_days) == saved,
                    }
                )
    finally:
        analysis.INFECTION_RHR_Z_THRESHOLD, analysis.INFECTION_CONSECUTIVE_DAYS = saved

    cheapest = min(r["cost"] for r in rows)
    for r in rows:
        r["cheapest_on_this_simulation"] = r["cost"] == cheapest
    return {
        "labels": ["Simulated"],
        "warning": (
            "The only labels are the events planted in our own simulated mission "
            f"({len(infections)} infection). The cheapest row is tuned to our story, not validated. "
            "The setting stays at 2 SD / 2 days (Mishra et al. 2020)."
        ),
        "planted_infections": infections,
        "current_setting": {"z_threshold": saved[0], "consecutive_days": saved[1], "source_id": "mishra2020"},
        "rows": rows,
    }


# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------
def wesad_decisions(path: Path = WESAD_MODEL_JSON) -> dict[str, Any]:
    """The harm-weighted WESAD thresholds stored in model.json (empty if not computed)."""
    if not path.exists():
        return {}
    with open(path, encoding="utf-8") as f:
        models = json.load(f).get("models", {})
    return {name: spec["decision"] for name, spec in models.items() if "decision" in spec}


def build_report(df: pd.DataFrame, events: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "config": {
            "miss_cost": MISS_COST,
            "false_alarm_cost": FALSE_ALARM_COST,
            "ratio": MISS_COST / FALSE_ALARM_COST,
            "note": "Starting values, not clinically validated.",
            "adaptation_model": analysis.ADAPTATION_MODEL,
        },
        "infection_early_warning": infection_warning_sweep(df, events),
        "wesad_stress_model": wesad_decisions(),
    }


def to_markdown(report: dict[str, Any]) -> str:
    cfg = report["config"]
    iew = report["infection_early_warning"]
    lines = [
        "# Harm-weighted thresholds",
        "",
        f"A miss costs {cfg['miss_cost']:g}, a false alarm costs {cfg['false_alarm_cost']:g} "
        f"(ratio {cfg['ratio']:g}). Starting values, not clinically validated. "
        "Generated by `python engine/thresholds.py`.",
        "",
        "## Infection early warning (simulated data)",
        "",
        iew["warning"],
        "",
        "| Resting HR at least | For at least | Misses | Days of warning before symptoms | False alarms | Cost | |",
        "|---|---|---|---|---|---|---|",
    ]
    for r in iew["rows"]:
        tags = []
        if r["current_setting"]:
            tags.append("**current**")
        if r["cheapest_on_this_simulation"]:
            tags.append("cheapest on this simulation")
        lead = ", ".join(str(d) for d in r["lead_days"]) or "none"
        where = "; ".join(f"{a} day {', '.join(map(str, d))}" for a, d in r["false_alarm_days"].items())
        false_alarms = f"{r['false_alarms']}" + (f" ({where})" if where else "")
        lines.append(
            f"| {r['z_threshold']:g} SD | {r['consecutive_days']} day(s) | {r['misses']} | {lead} | "
            f"{false_alarms} | {r['cost']:g} | {', '.join(tags)} |"
        )
    lines += ["", "## WESAD stress model (real labelled lab data)", ""]
    if report["wesad_stress_model"]:
        lines += [
            "| Model | Threshold | Catches stress | False alarm rate | Cost | At 0.5: catches / false alarm rate / cost |",
            "|---|---|---|---|---|---|",
        ]
        for name, d in report["wesad_stress_model"].items():
            half = d["at_0_5"]
            lines.append(
                f"| {name} | {d['threshold']:.2f} | {d['sensitivity']:.0%} | {d['false_alarm_rate']:.0%} | "
                f"{d['cost']:g} | {half['sensitivity']:.0%} / {half['false_alarm_rate']:.0%} / {half['cost']:g} |"
            )
        lines += [
            "",
            "Thresholds come from leave-one-person-out predictions on WESAD (15 people, lab stress on Earth). "
            "Not validated for spaceflight. `STRESS_MODEL` stays `\"rules\"` by default.",
        ]
    else:
        lines.append("Not computed yet. Run `python hard/wesad/thresholds.py` (needs the WESAD feature cache).")
    return "\n".join(lines) + "\n"


def main() -> None:
    df = pd.read_csv(RECORDS_CSV)
    with open(EVENTS_JSON, encoding="utf-8") as f:
        events = json.load(f)
    report = build_report(df, events)
    REPORT_JSON.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    REPORT_MD.write_text(to_markdown(report), encoding="utf-8")
    print(to_markdown(report))
    print(f"Wrote {REPORT_JSON} and {REPORT_MD}")


if __name__ == "__main__":
    main()
