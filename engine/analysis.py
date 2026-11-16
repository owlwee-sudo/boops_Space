"""Personal in-flight baseline, z-score, stress/sleep scoring, and infection early warning.

All baselines are personal and in-flight (never Earth population norms).
Rows with signal_quality < 0.5 are flagged, never deleted.

Fluid shift (the first weeks in space) is handled by ``ADAPTATION_MODEL``:
    "curve"  : the expected adaptation change is removed from each reading
               before the z-score, and the baseline comes from stable days 15-28.
    "window" : the old behaviour. Baseline from days 1-14, raw z-scores, and the
               risk engine multiplies days 1-14 risk scores by 0.45.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
import pandas as pd

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
BASELINE_DAYS = (1, 14)            # "window" model, and the fallback for "curve"
MIN_SIGNAL_QUALITY = 0.5

# --- Fluid shift / adaptation -------------------------------------------------
ADAPTATION_MODEL = "curve"         # "curve" | "window" (see the module docstring)
STABLE_BASELINE_DAYS = (15, 28)    # "curve" model: baseline window after adaptation
MIN_STABLE_DAYS = 14               # good days needed in that window, else fall back to days 1-14
LANDING_DAY: int | None = None     # mission day of landing; None = still in flight

# Expected adaptation change per metric:  delta(t) = A * exp(-t / tau)
#   A   = size of the change at t = 0, in the metric's own unit (sign = direction)
#   tau = days for the change to fade to 37 % of A
#   t   = mission day (anchor "launch") or days since landing (anchor "landing")
#
# PLACEHOLDER VALUES. They are NOT taken from a paper. A and tau below are the
# same numbers the simulator uses to plant the fluid shift (generate_mission.py
# imports this table), so on simulated data the correction is right by
# construction. The cited sources support only the DIRECTION of each change.
# Replace A and tau with published ranges before trusting this on real crew.
ADAPTATION_CURVES: list[dict[str, Any]] = [
    {
        "id": "fluid_shift",
        "anchor": "launch",
        "source_id": "norsk15",      # direction only: resting HR up, BP down, HRV down
        "placeholder": True,
        "metrics": {
            "rhr_bpm": {"A": 0.9, "tau": 5.0},
            "hrv_rmssd_ms": {"A": -1.5, "tau": 5.0},
            "sbp_mmhg": {"A": -2.5, "tau": 5.0},
            "dbp_mmhg": {"A": -1.8, "tau": 5.0},
        },
    },
    {
        # Space motion sickness in the first days. No values set yet, so this
        # entry changes nothing. Add e.g. "sleep_hours" or "mood_1to5" here.
        "id": "space_motion_sickness",
        "anchor": "launch",
        "source_id": "reentry25",
        "placeholder": True,
        "metrics": {},
    },
    {
        # Re-adaptation to gravity after landing (fluid shifts back, motion
        # sickness returns). Only active when LANDING_DAY is set. No values yet.
        "id": "landing_readaptation",
        "anchor": "landing",
        "source_id": "reentry25",
        "placeholder": True,
        "metrics": {},
    },
]

STRESS_MODEL = "rules"  # "rules" | "wesad" (H3 optional second opinion; default rules)
FACE_WEIGHT = 0.0       # 0.0 = off; H2 opt-in facial-behaviour weight (max 0.15)

STRESS_WEIGHTS: dict[str, float] = {
    "hrv": 0.50,
    "rhr": 0.20,
    "eda": 0.15,
    "mood": 0.15,
}

SLEEP_WEIGHTS: dict[str, float] = {
    "duration": 0.65,
    "quality": 0.35,
}

BASELINE_METRICS = [
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
    "mood_1to5",
]

INFECTION_RHR_Z_THRESHOLD = 2.0
INFECTION_CONSECUTIVE_DAYS = 2
INFECTION_MAX_PLAUSIBLE_RHR = 180.0

# Smallest SD we allow per metric. A very steady baseline (e.g. the same RHR
# every day) would otherwise make a tiny change look like z = 100.
MIN_BASELINE_SD: dict[str, float] = {
    "rhr_bpm": 1.5,
    "hrv_rmssd_ms": 2.0,
    "sleep_hours": 0.4,
    "temp_c": 0.15,
    "radiation_msv": 0.05,
}
DEFAULT_MIN_SD = 1e-3


def _to_float(val: Any) -> float | None:
    """Safely convert a scalar to float, returning None for missing/NaN values."""
    if val is None or pd.isna(val):
        return None
    try:
        out = float(val)
        # inf / -inf are as useless as NaN: drop them before they reach any score.
        return out if np.isfinite(out) else None
    except (TypeError, ValueError, OverflowError):
        return None


def _to_int(val: Any, default: int = 0) -> int:
    """Safely convert a scalar to int (NaN, inf and junk give ``default``)."""
    out = _to_float(val)
    return default if out is None else int(out)


def adaptation_offset(
    metric: str,
    mission_day: Any,
    landing_day: int | None = None,
    model: str | None = None,
) -> float:
    """Expected adaptation change for one metric on one mission day.

    ``delta(t) = A * exp(-t / tau)``, summed over every curve in
    ``ADAPTATION_CURVES`` that lists the metric. Returns 0.0 for the "window"
    model, for metrics with no curve, and for a missing day.

    Worked example (illustrative values, not the config above):
        day 3, A = 8 bpm, tau = 7 days
        delta(3) = 8 * e^(-3/7) = 8 * 0.651 = 5.21 bpm
    """
    if (ADAPTATION_MODEL if model is None else model) != "curve":
        return 0.0
    day = _to_float(mission_day)
    if day is None:
        return 0.0
    landing = LANDING_DAY if landing_day is None else landing_day

    total = 0.0
    for curve in ADAPTATION_CURVES:
        params = curve["metrics"].get(metric)
        if not params:
            continue
        if curve["anchor"] == "landing":
            if landing is None:
                continue
            t = day - landing
        else:
            t = day
        if t < 0:
            continue
        total += float(params["A"]) * math.exp(-t / max(float(params["tau"]), 1e-6))
    return total


def adaptation_fading(mission_day: Any) -> float:
    """Share (0-1) of the launch fluid shift still expected on this day.

    1.0 = full effect, 0.0 = gone. Uses the slowest ``tau`` of the fluid-shift
    curve. The UI can show this instead of a hard "days 1-14" cliff.
    """
    day = _to_float(mission_day)
    if day is None or ADAPTATION_MODEL != "curve":
        return 0.0
    taus = [
        float(p["tau"])
        for curve in ADAPTATION_CURVES
        if curve["id"] == "fluid_shift"
        for p in curve["metrics"].values()
    ]
    if not taus:
        return 0.0
    return round(math.exp(-max(day, 0.0) / max(max(taus), 1e-6)), 3)


def _good_rows(df: pd.DataFrame, astronaut_id: str) -> pd.DataFrame:
    """This astronaut's rows with acceptable signal quality."""
    return df.loc[
        (df["astronaut_id"] == astronaut_id)
        & (df["signal_quality"].fillna(1.0) >= MIN_SIGNAL_QUALITY)
    ]


def _baseline_rows(df: pd.DataFrame, astronaut_id: str) -> tuple[pd.DataFrame, tuple[int, int] | None]:
    """Pick the rows the baseline is built from, and say which days they are.

    "curve"  : stable days 15-28 when at least MIN_STABLE_DAYS good days exist
               there; otherwise days 1-14 (a new "My data" user has no days
               15-28 for weeks).
    "window" : days 1-14.
    Last resort for both: every good reading of this person (returns None days).
    """
    good = _good_rows(df, astronaut_id)
    if ADAPTATION_MODEL == "curve":
        start, end = STABLE_BASELINE_DAYS
        stable = good[(good["mission_day"] >= start) & (good["mission_day"] <= end)]
        if len(stable) >= MIN_STABLE_DAYS:
            return stable, (start, end)

    start, end = BASELINE_DAYS
    early = good[(good["mission_day"] >= start) & (good["mission_day"] <= end)]
    if not early.empty:
        return early, (start, end)
    # No usable baseline days: fall back to all of this person's GOOD readings,
    # never to low-quality glitches.
    return good, None


def baseline_days_used(df: pd.DataFrame, astronaut_id: str) -> tuple[int, int] | None:
    """Mission-day window the baseline came from, or None for the last-resort fallback."""
    return _baseline_rows(df, astronaut_id)[1]


def is_low_quality(row: pd.Series | dict[str, Any]) -> bool:
    """Return True if a row has signal_quality below MIN_SIGNAL_QUALITY (marked, not deleted)."""
    sq = _to_float(row.get("signal_quality"))
    return sq is not None and sq < MIN_SIGNAL_QUALITY


def personal_baseline(df: pd.DataFrame, astronaut_id: str) -> dict[str, dict[str, float]]:
    """Compute the personal in-flight baseline (mean and SD) per metric.

    Which days are used depends on ``ADAPTATION_MODEL`` (see ``_baseline_rows``).
    Only records with signal_quality >= 0.5 are included.

    With the "curve" model the expected adaptation change is subtracted from
    every reading first, so the baseline describes the adapted body even when
    it has to be built from days 1-14. Without this the fallback would remove
    the fluid shift twice: once here (it is inside the mean) and once in
    ``zscores``.
    """
    window, _days = _baseline_rows(df, astronaut_id)

    baseline: dict[str, dict[str, float]] = {}
    for metric in BASELINE_METRICS:
        if metric not in window.columns:
            continue
        series = pd.to_numeric(window[metric], errors="coerce")
        if ADAPTATION_MODEL == "curve" and "mission_day" in window.columns:
            series = series - window["mission_day"].map(lambda d: adaptation_offset(metric, d))
        series = series[np.isfinite(series)]
        if series.empty:
            continue
        mean_val = float(series.mean())
        sd_val = float(series.std(ddof=1)) if len(series) > 1 else 1.0
        baseline[metric] = {
            "mean": round(mean_val, 3),
            "sd": round(max(sd_val, MIN_BASELINE_SD.get(metric, DEFAULT_MIN_SD)), 3),
        }
    return baseline


def zscores(
    row: pd.Series | dict[str, Any],
    baseline: dict[str, dict[str, float]],
) -> dict[str, float]:
    """Compute personal z-scores for all available metrics.

    "window" model:  ``z = (value - mean) / sd``
    "curve" model:   ``z = (value - (mean + delta(t))) / sd``
    where ``delta(t) = A * exp(-t / tau)`` is the expected adaptation change
    on that mission day (``adaptation_offset``). A row without ``mission_day``
    gets no correction.

    Worked example, plain z:
        HRV = 40 ms, personal baseline mean = 50 ms, SD = 5 ms:
        ``z = (40 - 50) / 5 = -2.0``

    Worked example, fluid shift (illustrative values, not the config):
        day 3, resting HR 66 bpm, mean 60, SD 3, A = 8, tau = 7
        delta(3) = 8 * e^(-3/7) = 8 * 0.651 = 5.21
        raw z      = (66 - 60) / 3          =  2.0   (false alarm)
        adjusted z = (66 - 60 - 5.21) / 3   =  0.26  (normal for day 3)
    """
    out: dict[str, float] = {}
    day = row.get("mission_day")
    for metric, stats in baseline.items():
        val = _to_float(row.get(metric) if isinstance(row, dict) else row.get(metric, None))
        if val is None:
            continue
        sd = max(float(stats.get("sd", 1.0)), MIN_BASELINE_SD.get(metric, DEFAULT_MIN_SD))
        mean = float(stats.get("mean", 0.0))
        out[metric] = round((val - adaptation_offset(metric, day) - mean) / sd, 2)
    return out


def stress_score(
    row: pd.Series | dict[str, Any],
    z: dict[str, float],
    baseline: dict[str, dict[str, float]] | None = None,
) -> int:
    """Compute a 0–100 stress score (higher = more physiological stress).

    Primarily driven by inverted HRV z-score, with RHR z, EDA z, and mood rating.
    """
    _ = baseline  # retained for signature compatibility
    hrv_z = z.get("hrv_rmssd_ms", 0.0)
    rhr_z = z.get("rhr_bpm", 0.0)
    eda_z = z.get("eda_mean_us", 0.0)
    mood_val = _to_float(row.get("mood_1to5"))

    # Map z-scores from typical [-3, +3] into [0, 100], centered at 28 on baseline days
    hrv_component = float(np.clip(28.0 + (-hrv_z) * 20.0, 0.0, 100.0))
    rhr_component = float(np.clip(28.0 + min(rhr_z, 5.0) * 14.0, 0.0, 100.0))
    eda_component = float(np.clip(28.0 + eda_z * 16.0, 0.0, 100.0))
    mood_component = (
        float(np.clip((5.0 - mood_val) / 4.0 * 100.0, 0.0, 100.0))
        if mood_val is not None
        else 28.0
    )

    if STRESS_MODEL == "wesad":
        from hard.wesad.stress_model import wesad_stress_score

        score = float(
            wesad_stress_score(
                z.get("rhr_bpm", 0.0),
                z.get("hrv_rmssd_ms", 0.0),
                z.get("eda_mean_us", 0.0),
            )
        )
    else:
        score = (
            STRESS_WEIGHTS["hrv"] * hrv_component
            + STRESS_WEIGHTS["rhr"] * rhr_component
            + STRESS_WEIGHTS["eda"] * eda_component
            + STRESS_WEIGHTS["mood"] * mood_component
        )
    base_score = int(round(float(np.clip(score, 0.0, 100.0))))

    from hard.face.stress_hook import blend_face_into_stress

    return int(
        blend_face_into_stress(
            base_score,
            _to_float(row.get("facial_change_z")),
            bool(row.get("face_opted_in", False)),
            _to_float(row.get("signal_quality")),
            face_weight=FACE_WEIGHT,
        )
    )


def sleep_score(
    row: pd.Series | dict[str, Any],
    z: dict[str, float],
    baseline: dict[str, dict[str, float]] | None = None,
) -> int:
    """Compute a 0–100 sleep score (higher = better sleep recovery)."""
    _ = baseline
    sleep_z = z.get("sleep_hours", 0.0)
    sleep_h = _to_float(row.get("sleep_hours"))
    sleep_q = _to_float(row.get("sleep_quality_1to5"))

    # Baseline sleep is ~6.3–6.5h; reaching 7h+ gives higher score, severe deficit drops rapidly
    duration_from_z = 78.0 + float(np.clip(sleep_z, -4.5, 2.0)) * 14.0
    if sleep_h is not None and sleep_h < 5.5:
        duration_from_z -= (5.5 - sleep_h) * 8.0
    duration_component = float(np.clip(duration_from_z, 0.0, 100.0))

    quality_component = (
        float(np.clip(((sleep_q - 1.0) / 4.0) * 100.0, 0.0, 100.0))
        if sleep_q is not None
        else 70.0
    )

    score = (
        SLEEP_WEIGHTS["duration"] * duration_component
        + SLEEP_WEIGHTS["quality"] * quality_component
    )
    return int(round(float(np.clip(score, 0.0, 100.0))))


def infection_early_warning(
    astronaut_df: pd.DataFrame,
    row_idx: int,
    baseline: dict[str, dict[str, float]],
) -> bool:
    """Detect pre-symptomatic infection risk (Mishra et al. 2020 method).

    Triggers True when resting HR is >= 2 SD above personal baseline for >= 2
    consecutive days, with acceptable signal quality, plausible RHR, and NOT
    explained by a recent EVA (within 2 days) or unusually hard exercise.
    With the "curve" model the expected fluid-shift rise is removed first, so
    the warning also works (and is not dampened) during days 1-14.

    Where the 2 SD / 2 days come from, and what a miss vs a false alarm costs
    at other settings: see ``engine/thresholds.py``.
    """
    ordered = astronaut_df.sort_values("mission_day").reset_index(drop=True)
    if not isinstance(row_idx, (int, np.integer)) or row_idx < 0 or row_idx >= len(ordered):
        return False

    ex_stats = baseline.get("exercise_min", {"mean": 118.0, "sd": 10.0})
    hard_exercise_cutoff = ex_stats["mean"] + 1.5 * max(ex_stats["sd"], 5.0)
    rhr_mean = baseline.get("rhr_bpm", {}).get("mean", 60.0)
    rhr_sd = max(baseline.get("rhr_bpm", {}).get("sd", 2.0), MIN_BASELINE_SD["rhr_bpm"])

    days = pd.to_numeric(ordered["mission_day"], errors="coerce")
    cur_day = _to_float(days.iloc[row_idx])
    if cur_day is None:
        return False
    cur_day = int(cur_day)

    # Look up REAL mission days (cur_day, cur_day - 1, ...), not row positions:
    # a missing day must break the streak, and an EVA 15 days ago must not count.
    consecutive = 0
    for lookback in range(INFECTION_CONSECUTIVE_DAYS):
        day = cur_day - lookback
        same_day = ordered[days == day]
        if same_day.empty:
            break
        rec = same_day.iloc[-1]
        sq = _to_float(rec.get("signal_quality"))
        rhr = _to_float(rec.get("rhr_bpm"))
        ex_min = _to_float(rec.get("exercise_min")) or 0.0

        if sq is None or sq < MIN_SIGNAL_QUALITY:
            break
        if rhr is None or rhr >= INFECTION_MAX_PLAUSIBLE_RHR:
            break

        # Exclude days explained by EVA (that day or the 2 days before) or hard exercise
        eva_window = ordered[(days >= day - 2) & (days <= day)]
        recent_eva = any(_to_int(v) == 1 for v in eva_window.get("eva", pd.Series(dtype=float)))
        if recent_eva or ex_min > hard_exercise_cutoff:
            break

        rhr_z = (rhr - adaptation_offset("rhr_bpm", day) - rhr_mean) / rhr_sd
        if rhr_z >= INFECTION_RHR_Z_THRESHOLD:
            consecutive += 1
        else:
            break

    return consecutive >= INFECTION_CONSECUTIVE_DAYS
