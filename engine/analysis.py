"""Personal in-flight baseline, z-score, stress/sleep scoring, and infection early warning.

All baselines are computed from in-flight days 1–14 for each astronaut individually
(never Earth population norms). Rows with signal_quality < 0.5 are flagged, never deleted.
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
BASELINE_DAYS = (1, 14)
MIN_SIGNAL_QUALITY = 0.5

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


def _to_float(val: Any) -> float | None:
    """Safely convert a scalar to float, returning None for missing/NaN values."""
    if val is None or pd.isna(val):
        return None
    try:
        out = float(val)
        return None if np.isnan(out) else out
    except (TypeError, ValueError):
        return None


def is_low_quality(row: pd.Series | dict[str, Any]) -> bool:
    """Return True if a row has signal_quality below MIN_SIGNAL_QUALITY (marked, not deleted)."""
    sq = _to_float(row.get("signal_quality") if isinstance(row, dict) else row["signal_quality"])
    return sq is not None and sq < MIN_SIGNAL_QUALITY


def personal_baseline(df: pd.DataFrame, astronaut_id: str) -> dict[str, dict[str, float]]:
    """Compute personal in-flight baseline (mean and SD) from days 1–14.

    Only records with signal_quality >= 0.5 are included in the baseline window.
    """
    start_day, end_day = BASELINE_DAYS
    mask = (
        (df["astronaut_id"] == astronaut_id)
        & (df["mission_day"] >= start_day)
        & (df["mission_day"] <= end_day)
        & (df["signal_quality"].fillna(1.0) >= MIN_SIGNAL_QUALITY)
    )
    window = df.loc[mask]
    if window.empty:
        window = df.loc[df["astronaut_id"] == astronaut_id]

    baseline: dict[str, dict[str, float]] = {}
    for metric in BASELINE_METRICS:
        if metric not in window.columns:
            continue
        series = pd.to_numeric(window[metric], errors="coerce").dropna()
        if series.empty:
            continue
        mean_val = float(series.mean())
        sd_val = float(series.std(ddof=1)) if len(series) > 1 else 1.0
        baseline[metric] = {
            "mean": round(mean_val, 3),
            "sd": round(max(sd_val, 1e-3), 3),
        }
    return baseline


def zscores(
    row: pd.Series | dict[str, Any],
    baseline: dict[str, dict[str, float]],
) -> dict[str, float]:
    """Compute personal z-scores ``z = (value - mean) / sd`` for all available metrics.

    Worked example:
        HRV = 40 ms, personal baseline mean = 50 ms, SD = 5 ms:
        ``z = (40 - 50) / 5 = -2.0``
    """
    out: dict[str, float] = {}
    for metric, stats in baseline.items():
        val = _to_float(row.get(metric) if isinstance(row, dict) else row.get(metric, None))
        if val is None:
            continue
        sd = max(float(stats.get("sd", 1.0)), 1e-3)
        mean = float(stats.get("mean", 0.0))
        out[metric] = round((val - mean) / sd, 2)
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

    score = (
        STRESS_WEIGHTS["hrv"] * hrv_component
        + STRESS_WEIGHTS["rhr"] * rhr_component
        + STRESS_WEIGHTS["eda"] * eda_component
        + STRESS_WEIGHTS["mood"] * mood_component
    )
    return int(round(float(np.clip(score, 0.0, 100.0))))


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
    """
    ordered = astronaut_df.sort_values("mission_day").reset_index(drop=True)
    if row_idx < 0 or row_idx >= len(ordered):
        return False

    ex_stats = baseline.get("exercise_min", {"mean": 118.0, "sd": 10.0})
    hard_exercise_cutoff = ex_stats["mean"] + 1.5 * max(ex_stats["sd"], 5.0)
    rhr_mean = baseline.get("rhr_bpm", {}).get("mean", 60.0)
    rhr_sd = max(baseline.get("rhr_bpm", {}).get("sd", 2.0), 1e-3)

    consecutive = 0
    for lookback in range(INFECTION_CONSECUTIVE_DAYS):
        idx = row_idx - lookback
        if idx < 0:
            break
        rec = ordered.iloc[idx]
        sq = _to_float(rec.get("signal_quality"))
        rhr = _to_float(rec.get("rhr_bpm"))
        ex_min = _to_float(rec.get("exercise_min")) or 0.0

        if sq is None or sq < MIN_SIGNAL_QUALITY:
            break
        if rhr is None or rhr >= INFECTION_MAX_PLAUSIBLE_RHR:
            break

        # Exclude days explained by EVA (on that day or within previous 2 days) or hard exercise
        recent_eva = False
        for eva_back in range(3):
            if idx - eva_back >= 0 and int(ordered.iloc[idx - eva_back].get("eva", 0)) == 1:
                recent_eva = True
                break
        if recent_eva or ex_min > hard_exercise_cutoff:
            break

        rhr_z = (rhr - rhr_mean) / rhr_sd
        if rhr_z >= INFECTION_RHR_Z_THRESHOLD:
            consecutive += 1
        else:
            break

    return consecutive >= INFECTION_CONSECUTIVE_DAYS
