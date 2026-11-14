"""4-step 'device or astronaut?' odd-reading funnel and safety classifier.

Funnel steps:
    0. Safety rule: never delete readings; dangerous-if-real + symptoms/corroboration -> act_now.
    1. Signal quality: signal_quality < 0.5 or missing core sensor channel -> check_device.
    2. Plausibility: physiologically impossible single values (HR > 200 asleep, temp < 30C,
       SpO2 < 70% without symptoms) -> check_device.
    3. Cross-sensor agreement: single-sensor isolated 1-day jump vs multi-sensor/multi-day trend.
    4. Context + ask the human: explained by EVA/exercise -> ok; otherwise -> check_yourself.
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from engine.analysis import MIN_SIGNAL_QUALITY, _to_float, zscores

# ---------------------------------------------------------------------------
# Configuration thresholds
# ---------------------------------------------------------------------------
PLAUSIBLE_LIMITS: dict[str, tuple[float, float]] = {
    "rhr_bpm": (30.0, 200.0),
    "temp_c": (30.0, 42.0),
    "spo2_pct": (70.0, 100.0),
    "hrv_rmssd_ms": (5.0, 250.0),
    "sbp_mmhg": (65.0, 220.0),
    "dbp_mmhg": (35.0, 130.0),
}

DANGEROUS_THRESHOLDS: dict[str, Any] = {
    "rhr_high": 115.0,
    "temp_high": 38.3,
    "spo2_low": 90.0,
}

ISOLATED_SPIKE_Z = 4.0


def _has_symptoms(row: pd.Series | dict[str, Any]) -> bool:
    raw = row.get("symptoms")
    if raw is None or (isinstance(raw, float) and np.isnan(raw)):
        return False
    return bool(str(raw).strip())


def check_reading(
    row: pd.Series | dict[str, Any],
    baseline: dict[str, dict[str, float]],
    history_df: pd.DataFrame | None = None,
    z: dict[str, float] | None = None,
) -> dict[str, Any]:
    """Run the 4-step odd-reading funnel and return {status, reasons, suggested_step}."""
    z_map = z if z is not None else zscores(row, baseline)
    reasons: list[str] = []

    sq = _to_float(row.get("signal_quality"))
    rhr = _to_float(row.get("rhr_bpm"))
    hrv = _to_float(row.get("hrv_rmssd_ms"))
    temp = _to_float(row.get("temp_c"))
    spo2 = _to_float(row.get("spo2_pct"))
    eva = int(_to_float(row.get("eva")) or 0)
    symptoms_present = _has_symptoms(row)

    # 0. Safety rule: dangerous-if-real values corroborated by symptoms or severe multi-channel agreement
    severe_reasons: list[str] = []
    if rhr is not None and DANGEROUS_THRESHOLDS["rhr_high"] < rhr <= 200.0 and symptoms_present:
        severe_reasons.append(f"Critically elevated resting HR ({rhr:.0f} bpm) with logged symptoms")
    if temp is not None and temp >= DANGEROUS_THRESHOLDS["temp_high"] and (symptoms_present or (sq is not None and sq >= 0.7)):
        severe_reasons.append(f"High fever ({temp:.1f} °C)")
    if spo2 is not None and 70.0 <= spo2 < DANGEROUS_THRESHOLDS["spo2_low"] and (symptoms_present or (sq is not None and sq >= 0.7)):
        severe_reasons.append(f"Low blood oxygen SpO2 ({spo2:.1f}%)")
    if severe_reasons:
        return {
            "status": "act_now",
            "reasons": severe_reasons,
            "suggested_step": "Follow the matching emergency protocol immediately and notify the crew medical officer.",
        }

    # 1. Signal quality check
    device_reasons: list[str] = []
    if sq is not None and sq < MIN_SIGNAL_QUALITY:
        device_reasons.append(f"Low sensor signal quality ({sq:.2f} < {MIN_SIGNAL_QUALITY})")
    if hrv is None:
        device_reasons.append("Missing HRV (RMSSD) measurement")
    if rhr is None:
        device_reasons.append("Missing resting heart rate measurement")

    # 2. Plausibility check (impossible values point to device/contact fault)
    if rhr is not None and (rhr > PLAUSIBLE_LIMITS["rhr_bpm"][1] or rhr < PLAUSIBLE_LIMITS["rhr_bpm"][0]):
        device_reasons.append(f"Implausible resting/sleeping HR ({rhr:.0f} bpm)")
    if temp is not None and (temp < PLAUSIBLE_LIMITS["temp_c"][0] or temp > PLAUSIBLE_LIMITS["temp_c"][1]):
        device_reasons.append(f"Implausible body temperature ({temp:.1f} °C)")
    if spo2 is not None and spo2 < PLAUSIBLE_LIMITS["spo2_pct"][0] and not symptoms_present:
        device_reasons.append(f"Implausible SpO2 ({spo2:.1f}%) without symptoms")

    if device_reasons:
        return {
            "status": "check_device",
            "reasons": device_reasons,
            "suggested_step": "Check wearable strap fit, warm skin contact, and re-measure using the Tool Guide. Reading retained.",
        }

    # 3. Cross-sensor agreement & single-day isolated spike check
    abnormal_metrics = [
        k for k in ("rhr_bpm", "hrv_rmssd_ms", "temp_c", "spo2_pct", "eda_mean_us")
        if k in z_map and abs(z_map[k]) >= 2.0
    ]
    extreme_metrics = [
        k for k in ("rhr_bpm", "hrv_rmssd_ms", "temp_c", "spo2_pct")
        if k in z_map and abs(z_map[k]) >= ISOLATED_SPIKE_Z
    ]

    prior_abnormal = False
    if history_df is not None and not history_df.empty:
        cur_day = int(_to_float(row.get("mission_day")) or 0)
        prev = history_df[history_df["mission_day"] == cur_day - 1]
        if not prev.empty:
            prev_z = zscores(prev.iloc[-1], baseline)
            prior_abnormal = any(abs(prev_z.get(m, 0.0)) >= 1.5 for m in ("rhr_bpm", "hrv_rmssd_ms", "sleep_hours"))

    if len(extreme_metrics) == 1 and len(abnormal_metrics) == 1 and not prior_abnormal and not symptoms_present and eva == 0:
        m = extreme_metrics[0]
        return {
            "status": "check_device",
            "reasons": [f"Isolated single-sensor 1-day jump in {m} (z={z_map[m]:+.2f}) without cross-sensor agreement"],
            "suggested_step": "Re-seat sensor and take a manual confirmation reading using the Tool Guide.",
        }

    # 4. Context + human check
    ex_mean = baseline.get("exercise_min", {}).get("mean", 118.0)
    ex_sd = max(baseline.get("exercise_min", {}).get("sd", 10.0), 5.0)
    ex_min = _to_float(row.get("exercise_min")) or 0.0

    recent_eva = eva == 1
    if not recent_eva and history_df is not None and not history_df.empty:
        cur_day = int(_to_float(row.get("mission_day")) or 0)
        recent_rows = history_df[history_df["mission_day"].between(cur_day - 2, cur_day)]
        recent_eva = bool((recent_rows.get("eva", pd.Series(dtype=int)) == 1).any())

    if recent_eva or ex_min > ex_mean + 1.5 * ex_sd:
        return {
            "status": "ok",
            "reasons": ["Sensor readings consistent with recent EVA or elevated exercise load"],
            "suggested_step": "Prioritize post-EVA hydration and sleep recovery.",
        }

    rhr_z = z_map.get("rhr_bpm", 0.0)
    hrv_z = z_map.get("hrv_rmssd_ms", 0.0)
    if symptoms_present or (rhr_z >= 2.0 and (hrv_z <= -2.0 or prior_abnormal)):
        if symptoms_present:
            reasons.append(f"Cross-sensor shift corroborated by symptoms ({row.get('symptoms')})")
        if rhr_z >= 2.0:
            reasons.append(f"Resting HR elevated ({rhr_z:+.2f} SD) with multi-sensor or multi-day trend")
        if hrv_z <= -2.0:
            reasons.append(f"HRV suppressed ({hrv_z:+.2f} SD) confirming autonomic strain")
        return {
            "status": "check_yourself",
            "reasons": reasons,
            "suggested_step": "Any new symptoms? Re-measure resting HR/temp with the Tool Guide and take a saliva sample.",
        }

    return {
        "status": "ok",
        "reasons": [],
        "suggested_step": "",
    }
