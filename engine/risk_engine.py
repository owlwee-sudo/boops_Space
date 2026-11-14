"""Explainable multi-system risk engine and root-cause action recommender.

Converts z-scores, recent history, EVA context, and data quality checks into
normalized 0–100 risk scores for immune, musculoskeletal, and cardio systems,
backed by causal evidence chains and sources from knowledge/links.json.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from engine.analysis import _to_float

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
ROOT_DIR = Path(__file__).resolve().parent.parent
KNOWLEDGE_LINKS_PATH = ROOT_DIR / "knowledge" / "links.json"

RISK_THRESHOLDS: dict[str, int] = {
    "watch": 40,
    "act": 70,  # > 70 -> act; 40..70 -> watch; < 40 -> normal
}

ADAPTATION_DAYS = 14
ADAPTATION_DAMPEN_FACTOR = 0.45

IMMUNE_WEIGHTS: dict[str, float] = {
    "stress": 0.30,
    "sleep": 0.25,
    "eva": 0.15,
    "radiation": 0.10,
    "time_in_flight": 0.10,
    "rhr_or_symptoms": 0.10,
}

MUSCULOSKELETAL_WEIGHTS: dict[str, float] = {
    "resistance_exercise": 0.40,
    "stress_x_inactivity": 0.30,
    "radiation": 0.15,
    "time_in_flight": 0.15,
}

CARDIO_WEIGHTS: dict[str, float] = {
    "exercise": 0.35,
    "autonomic_strain": 0.30,
    "radiation": 0.20,
    "time_in_flight": 0.15,
}


def load_knowledge_links() -> dict[str, dict[str, Any]]:
    """Load knowledge/links.json keyed by link id when present."""
    if not KNOWLEDGE_LINKS_PATH.exists():
        return {}
    with open(KNOWLEDGE_LINKS_PATH, "r", encoding="utf-8") as f:
        items = json.load(f)
    return {item["id"]: item for item in items if "id" in item}


def level_from_score(score: float | int) -> str:
    """Map 0–100 risk score to normal (<40), watch (40–70), or act (>70)."""
    if score > RISK_THRESHOLDS["act"]:
        return "act"
    if score >= RISK_THRESHOLDS["watch"]:
        return "watch"
    return "normal"


def _sanitized_z(z: dict[str, float], data_quality: dict[str, Any] | None) -> dict[str, float]:
    """Neutralize corrupted single-day channel z-scores when status == 'check_device'."""
    clean = dict(z)
    if data_quality and data_quality.get("status") == "check_device":
        for key in ("rhr_bpm", "hrv_rmssd_ms", "temp_c", "spo2_pct"):
            clean[key] = 0.0
    return clean


def _recent_window(history_df: pd.DataFrame | None, cur_day: int, lookback_days: int) -> pd.DataFrame:
    if history_df is None or history_df.empty:
        return pd.DataFrame()
    return history_df[history_df["mission_day"].between(cur_day - lookback_days, cur_day)]


def _has_symptoms(row: pd.Series | dict[str, Any]) -> bool:
    raw = row.get("symptoms")
    if raw is None or (isinstance(raw, float) and np.isnan(raw)):
        return False
    return bool(str(raw).strip())


def compute_immune_risk(
    row: pd.Series | dict[str, Any],
    z: dict[str, float],
    baseline: dict[str, dict[str, float]],
    history_df: pd.DataFrame | None = None,
    flags: dict[str, bool] | None = None,
    data_quality: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Compute immune risk score, level, and ranked causal drivers."""
    clean_z = _sanitized_z(z, data_quality)
    cur_day = int(_to_float(row.get("mission_day")) or 1)
    symptoms_present = _has_symptoms(row)
    iew = bool((flags or {}).get("infection_early_warning", False))

    # 1. Stress (HRV z)
    hrv_z = clean_z.get("hrv_rmssd_ms", 0.0)
    stress_norm = min(abs(hrv_z) / 3.0, 1.0) if hrv_z < 0 else 0.0
    stress_contrib = round(IMMUNE_WEIGHTS["stress"] * stress_norm, 3)

    # 2. Sleep deficit (current + recent 3-day average z)
    sleep_z = clean_z.get("sleep_hours", 0.0)
    recent3 = _recent_window(history_df, cur_day, 2)
    if not recent3.empty and "sleep_hours" in baseline:
        s_mean = baseline["sleep_hours"]["mean"]
        s_sd = max(baseline["sleep_hours"]["sd"], 1e-3)
        recent_sleep_z = float((recent3["sleep_hours"].mean() - s_mean) / s_sd)
        eff_sleep_z = min(sleep_z, recent_sleep_z)
    else:
        eff_sleep_z = sleep_z
    sleep_norm = min(abs(eff_sleep_z) / 3.0, 1.0) if eff_sleep_z < 0 else 0.0
    sleep_contrib = round(IMMUNE_WEIGHTS["sleep"] * sleep_norm, 3)

    # 3. EVA in last 3 days
    recent4 = _recent_window(history_df, cur_day, 3)
    eva_recent = int(_to_float(row.get("eva")) or 0) == 1
    if not eva_recent and not recent4.empty and "eva" in recent4.columns:
        eva_recent = bool((recent4["eva"] == 1).any())
    eva_norm = 1.0 if eva_recent else 0.0
    eva_contrib = round(IMMUNE_WEIGHTS["eva"] * eva_norm, 3)

    # 4. Radiation z (current or lingering lymphocyte effect within 5 days of SPE)
    rad_z = clean_z.get("radiation_msv", 0.0)
    eff_rad_z = rad_z
    recent5 = _recent_window(history_df, cur_day, 5)
    if not recent5.empty and "radiation_msv" in baseline:
        r_mean = baseline["radiation_msv"]["mean"]
        r_sd = max(baseline["radiation_msv"]["sd"], 1e-3)
        peak_z = 0.0
        for _, r_row in recent5.iterrows():
            d_diff = max(0, cur_day - int(r_row["mission_day"]))
            z_val = max(0.0, (float(r_row["radiation_msv"]) - r_mean) / r_sd)
            # Lymphocyte recovery decays linearly over 5 days post-SPE
            decayed = z_val * max(0.0, 1.0 - 0.14 * d_diff)
            peak_z = max(peak_z, decayed)
        eff_rad_z = max(rad_z, peak_z)
    rad_norm = min(max(eff_rad_z, 0.0) / 3.0, 1.0)
    rad_contrib = round(IMMUNE_WEIGHTS["radiation"] * rad_norm, 3)

    # 5. Time in flight
    time_norm = min(cur_day / 180.0, 1.0)
    time_contrib = round(IMMUNE_WEIGHTS["time_in_flight"] * time_norm, 3)

    # 6. Resting HR jump or symptoms
    rhr_z = clean_z.get("rhr_bpm", 0.0)
    if symptoms_present or iew:
        rhr_sym_norm = 1.0
    else:
        rhr_sym_norm = min(max(rhr_z, 0.0) / 3.0, 1.0)
    rhr_sym_contrib = round(IMMUNE_WEIGHTS["rhr_or_symptoms"] * rhr_sym_norm, 3)

    raw_total = (
        stress_contrib
        + sleep_contrib
        + eva_contrib
        + rad_contrib
        + time_contrib
        + rhr_sym_contrib
    )

    # Synergistic pre-symptomatic / clinical infection boost when sleep debt + high stress + RHR/symptoms align
    if (iew or symptoms_present) and stress_norm >= 0.7 and sleep_norm >= 0.7:
        raw_total = min(1.0, raw_total + 0.08)

    if cur_day <= ADAPTATION_DAYS:
        raw_total *= ADAPTATION_DAMPEN_FACTOR

    score = int(round(float(np.clip(raw_total * 100.0, 0.0, 100.0))))
    level = level_from_score(score)

    drivers: list[dict[str, Any]] = [
        {
            "factor": "stress",
            "z": round(hrv_z, 2),
            "contribution": stress_contrib,
            "chain": "HRV ↓ → stress ↑ → cortisol ↑ → latent virus reactivation",
            "evidence_stars": 3,
            "source_id": "mehta2017",
        },
        {
            "factor": "sleep",
            "z": round(eff_sleep_z, 2),
            "contribution": sleep_contrib,
            "chain": "Sleep ↓ → cortisol ↑ → T cells ↓ → virus reactivation",
            "evidence_stars": 3,
            "source_id": "barger2014",
        },
        {
            "factor": "eva",
            "z": 1.0 if eva_recent else 0.0,
            "contribution": eva_contrib,
            "chain": "EVA → stress hormones ↑ → viral reactivation in EVA crew",
            "evidence_stars": 3,
            "source_id": "iss_saliva2020",
        },
        {
            "factor": "rhr_or_symptoms",
            "z": round(rhr_z, 2),
            "contribution": rhr_sym_contrib,
            "chain": "Resting HR jump / symptoms → early infection or viral reactivation",
            "evidence_stars": 3,
            "source_id": "mishra2020",
        },
        {
            "factor": "radiation",
            "z": round(eff_rad_z, 2),
            "contribution": rad_contrib,
            "chain": "Radiation ↑ → lymphocytes ↓ → immune suppression",
            "evidence_stars": 2,
            "source_id": "wadhwa2024",
        },
        {
            "factor": "time_in_flight",
            "z": round(time_norm, 2),
            "contribution": time_contrib,
            "chain": "Mission duration → cumulative immune dysregulation",
            "evidence_stars": 3,
            "source_id": "crucian2018",
        },
    ]

    if cur_day <= ADAPTATION_DAYS:
        drivers.append(
            {
                "factor": "adaptation_phase",
                "z": 0.0,
                "contribution": 0.0,
                "chain": "Mission days 1–14 → fluid shift = normal space adaptation (alerts dampened)",
                "evidence_stars": 3,
                "source_id": "crucian2018",
            }
        )

    drivers.sort(key=lambda d: d["contribution"], reverse=True)
    return {"level": level, "score": score, "drivers": [d for d in drivers if d["contribution"] > 0 or d["factor"] == "adaptation_phase"][:4]}


def compute_musculoskeletal_risk(
    row: pd.Series | dict[str, Any],
    z: dict[str, float],
    baseline: dict[str, dict[str, float]],
    history_df: pd.DataFrame | None = None,
    data_quality: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Compute bone & muscle risk using resistance deficit and stress x inactivity interaction."""
    clean_z = _sanitized_z(z, data_quality)
    cur_day = int(_to_float(row.get("mission_day")) or 1)

    res_mean = baseline.get("resistance_min", {}).get("mean", 58.0)
    res_min = _to_float(row.get("resistance_min"))
    if res_min is None:
        res_min = res_mean

    recent7 = _recent_window(history_df, cur_day, 6)
    avg_res = float(recent7["resistance_min"].mean()) if not recent7.empty else res_min
    eff_res = avg_res

    inactivity_norm = float(np.clip((res_mean - eff_res) / max(res_mean * 0.85, 1.0), 0.0, 1.0))
    res_z = clean_z.get("resistance_min", 0.0)
    res_contrib = round(MUSCULOSKELETAL_WEIGHTS["resistance_exercise"] * inactivity_norm, 3)

    # Multiplicative interaction: stress (cortisol) x inactivity (Ferrando et al. 2004)
    hrv_z = clean_z.get("hrv_rmssd_ms", 0.0)
    stress_norm = min(abs(hrv_z) / 3.0, 1.0) if hrv_z < 0 else 0.0
    interaction_norm = min(1.0, inactivity_norm * max(stress_norm * 1.15, 0.35 if inactivity_norm > 0.3 else 0.0))
    interaction_contrib = round(MUSCULOSKELETAL_WEIGHTS["stress_x_inactivity"] * interaction_norm, 3)

    rad_z = clean_z.get("radiation_msv", 0.0)
    rad_norm = min(max(rad_z, 0.0) / 3.0, 1.0)
    rad_contrib = round(MUSCULOSKELETAL_WEIGHTS["radiation"] * rad_norm, 3)

    time_norm = min(cur_day / 180.0, 1.0)
    time_contrib = round(MUSCULOSKELETAL_WEIGHTS["time_in_flight"] * time_norm, 3)

    raw_total = res_contrib + interaction_contrib + rad_contrib + time_contrib
    if cur_day <= ADAPTATION_DAYS:
        raw_total *= ADAPTATION_DAMPEN_FACTOR

    score = int(round(float(np.clip(raw_total * 100.0, 0.0, 100.0))))
    level = level_from_score(score)

    drivers: list[dict[str, Any]] = [
        {
            "factor": "resistance_exercise",
            "z": round(res_z, 2),
            "contribution": res_contrib,
            "chain": "Low resistance exercise → unloading → muscle & bone loss",
            "evidence_stars": 3,
            "source_id": "ferrando2004",
        },
        {
            "factor": "stress_x_inactivity",
            "z": round(-abs(hrv_z) if inactivity_norm > 0 else 0.0, 2),
            "contribution": interaction_contrib,
            "chain": "Stress (cortisol ↑) × inactivity → amplified muscle loss (interaction)",
            "evidence_stars": 3,
            "source_id": "ferrando2004",
        },
        {
            "factor": "radiation",
            "z": round(rad_z, 2),
            "contribution": rad_contrib,
            "chain": "Radiation ↑ → osteoclast activation → bone resorption ↑",
            "evidence_stars": 2,
            "source_id": "wadhwa2024",
        },
        {
            "factor": "time_in_flight",
            "z": round(time_norm, 2),
            "contribution": time_contrib,
            "chain": "Microgravity duration → progressive bone mineral loss",
            "evidence_stars": 3,
            "source_id": "crucian2018",
        },
    ]

    if cur_day <= ADAPTATION_DAYS:
        drivers.append(
            {
                "factor": "adaptation_phase",
                "z": 0.0,
                "contribution": 0.0,
                "chain": "Mission days 1–14 → unloading adaptation baseline (alerts dampened)",
                "evidence_stars": 3,
                "source_id": "crucian2018",
            }
        )

    drivers.sort(key=lambda d: d["contribution"], reverse=True)
    return {"level": level, "score": score, "drivers": [d for d in drivers if d["contribution"] > 0 or d["factor"] == "adaptation_phase"][:4]}


def compute_cardio_risk(
    row: pd.Series | dict[str, Any],
    z: dict[str, float],
    baseline: dict[str, dict[str, float]],
    history_df: pd.DataFrame | None = None,
    data_quality: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Compute cardiovascular risk from exercise deficit, autonomic strain, and radiation."""
    clean_z = _sanitized_z(z, data_quality)
    cur_day = int(_to_float(row.get("mission_day")) or 1)

    ex_mean = baseline.get("exercise_min", {}).get("mean", 118.0)
    ex_min = _to_float(row.get("exercise_min"))
    if ex_min is None:
        ex_min = ex_mean

    recent7 = _recent_window(history_df, cur_day, 6)
    avg_ex = float(recent7["exercise_min"].mean()) if not recent7.empty else ex_min
    ex_deficit = float(np.clip((ex_mean - avg_ex) / max(ex_mean * 0.75, 1.0), 0.0, 1.0))
    ex_contrib = round(CARDIO_WEIGHTS["exercise"] * ex_deficit, 3)

    hrv_z = clean_z.get("hrv_rmssd_ms", 0.0)
    rhr_z = clean_z.get("rhr_bpm", 0.0)
    stress_norm = min(abs(hrv_z) / 3.0, 1.0) if hrv_z < 0 else 0.0
    rhr_norm = min(max(rhr_z, 0.0) / 3.0, 1.0)
    autonomic_norm = 0.5 * stress_norm + 0.5 * rhr_norm
    autonomic_contrib = round(CARDIO_WEIGHTS["autonomic_strain"] * autonomic_norm, 3)

    rad_z = clean_z.get("radiation_msv", 0.0)
    rad_norm = min(max(rad_z, 0.0) / 3.0, 1.0)
    rad_contrib = round(CARDIO_WEIGHTS["radiation"] * rad_norm, 3)

    time_norm = min(cur_day / 180.0, 1.0)
    time_contrib = round(CARDIO_WEIGHTS["time_in_flight"] * time_norm, 3)

    raw_total = ex_contrib + autonomic_contrib + rad_contrib + time_contrib
    if cur_day <= ADAPTATION_DAYS:
        raw_total *= ADAPTATION_DAMPEN_FACTOR

    score = int(round(float(np.clip(raw_total * 100.0, 0.0, 100.0))))
    level = level_from_score(score)

    drivers: list[dict[str, Any]] = [
        {
            "factor": "exercise",
            "z": round(clean_z.get("exercise_min", 0.0), 2),
            "contribution": ex_contrib,
            "chain": "Low aerobic/resistance exercise → cardiac atrophy; exercise offsets it",
            "evidence_stars": 3,
            "source_id": "jacc2023",
        },
        {
            "factor": "autonomic_strain",
            "z": round(rhr_z if abs(rhr_z) >= abs(hrv_z) else hrv_z, 2),
            "contribution": autonomic_contrib,
            "chain": "Autonomic shift (HRV ↓, RHR ↑) → cardiovascular strain",
            "evidence_stars": 3,
            "source_id": "mishra2020",
        },
        {
            "factor": "radiation",
            "z": round(rad_z, 2),
            "contribution": rad_contrib,
            "chain": "Radiation ↑ → vascular endothelial strain",
            "evidence_stars": 2,
            "source_id": "wadhwa2024",
        },
        {
            "factor": "time_in_flight",
            "z": round(time_norm, 2),
            "contribution": time_contrib,
            "chain": "Long-duration flight → fluid shift & arterial stiffness",
            "evidence_stars": 3,
            "source_id": "jacc2023",
        },
    ]

    if cur_day <= ADAPTATION_DAYS:
        drivers.append(
            {
                "factor": "adaptation_phase",
                "z": 0.0,
                "contribution": 0.0,
                "chain": "Mission days 1–14 → cephalad fluid shift = normal space adaptation (alerts dampened)",
                "evidence_stars": 3,
                "source_id": "crucian2018",
            }
        )

    drivers.sort(key=lambda d: d["contribution"], reverse=True)
    return {"level": level, "score": score, "drivers": [d for d in drivers if d["contribution"] > 0 or d["factor"] == "adaptation_phase"][:4]}


def evaluate_risks(
    row: pd.Series | dict[str, Any],
    z: dict[str, float],
    baseline: dict[str, dict[str, float]],
    history_df: pd.DataFrame | None = None,
    flags: dict[str, bool] | None = None,
    data_quality: dict[str, Any] | None = None,
) -> dict[str, dict[str, Any]]:
    """Compute immune, musculoskeletal, and cardio risk assessments for one astronaut-day."""
    return {
        "immune": compute_immune_risk(row, z, baseline, history_df, flags, data_quality),
        "musculoskeletal": compute_musculoskeletal_risk(row, z, baseline, history_df, data_quality),
        "cardio": compute_cardio_risk(row, z, baseline, history_df, data_quality),
    }


def recommend_actions(
    risks: dict[str, dict[str, Any]],
    row: pd.Series | dict[str, Any] | None = None,
    flags: dict[str, bool] | None = None,
    data_quality: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """Rank concrete interventions by root-cause impact and evidence strength."""
    candidates: list[tuple[float, dict[str, Any]]] = []
    dq_status = (data_quality or {}).get("status", "ok")
    iew = bool((flags or {}).get("infection_early_warning", False))

    if dq_status == "check_device":
        candidates.append(
            (
                10.0,
                {
                    "text": "Check wearable fit and re-measure using the tool guide before acting on alerts",
                    "targets": "data_quality",
                    "evidence_stars": 3,
                },
            )
        )

    immune = risks.get("immune", {})
    musc = risks.get("musculoskeletal", {})
    cardio = risks.get("cardio", {})

    immune_drivers = {d["factor"]: d["contribution"] for d in immune.get("drivers", [])}
    musc_drivers = {d["factor"]: d["contribution"] for d in musc.get("drivers", [])}

    # Sleep root cause
    if immune_drivers.get("sleep", 0.0) >= 0.12 or immune.get("level") in ("watch", "act"):
        sleep_prio = 0.95 if (immune.get("level") == "act" or iew) else immune_drivers.get("sleep", 0.0) + 0.15
        candidates.append(
            (
                sleep_prio,
                {
                    "text": "Fix sleep first: target 7 h tonight (strongest lever)",
                    "targets": "sleep",
                    "evidence_stars": 3,
                },
            )
        )

    # Saliva test for Watch/Act immune or early warning
    if immune.get("level") in ("watch", "act") or iew:
        saliva_prio = 0.90 if (immune.get("level") == "act" or iew) else 0.25
        candidates.append(
            (
                saliva_prio,
                {
                    "text": "Take a saliva test to screen cortisol and latent viral reactivation",
                    "targets": "immune",
                    "evidence_stars": 3,
                },
            )
        )

    # Stress / autonomic recovery
    if immune_drivers.get("stress", 0.0) >= 0.15:
        candidates.append(
            (
                immune_drivers["stress"] * 0.9,
                {
                    "text": "Schedule 15 min guided breathing / workload decompression to restore HRV",
                    "targets": "stress",
                    "evidence_stars": 3,
                },
            )
        )

    # Resistance exercise / ARED
    if musc.get("level") in ("watch", "act") or musc_drivers.get("resistance_exercise", 0.0) >= 0.18:
        candidates.append(
            (
                musc_drivers.get("resistance_exercise", 0.25) + 0.20,
                {
                    "text": "Resume daily ARED resistance exercise (target 60 min) to counter unloading × stress",
                    "targets": "musculoskeletal",
                    "evidence_stars": 3,
                },
            )
        )

    # Aerobic exercise for cardio
    if cardio.get("level") in ("watch", "act"):
        candidates.append(
            (
                0.22,
                {
                    "text": "Complete 30–45 min CEVIS/T2 aerobic conditioning and verify hydration",
                    "targets": "cardio",
                    "evidence_stars": 3,
                },
            )
        )

    # Radiation shelter / EVA deferral
    rad_val = _to_float(row.get("radiation_msv")) if row is not None else None
    if (rad_val is not None and rad_val >= 2.0) or immune_drivers.get("radiation", 0.0) >= 0.08:
        candidates.append(
            (
                0.98 if (rad_val is not None and rad_val >= 2.0) else 0.12,
                {
                    "text": "Move to shielded crew quarters and defer EVAs per solar particle event protocol",
                    "targets": "radiation",
                    "evidence_stars": 2,
                },
            )
        )

    # Contact medical officer when any system is Act (or act_now safety alert)
    any_act = any(r.get("level") == "act" for r in risks.values()) or dq_status == "act_now"
    if any_act:
        candidates.append(
            (
                0.85,
                {
                    "text": "Contact the medical officer and log any new symptoms",
                    "targets": "immune" if immune.get("level") == "act" else "crew_medical",
                    "evidence_stars": 3,
                },
            )
        )

    if not candidates:
        candidates.append(
            (
                0.05,
                {
                    "text": "Maintain sleep ≥ 6.5 h, daily ARED/cardio countermeasures, and routine log check-in",
                    "targets": "baseline",
                    "evidence_stars": 3,
                },
            )
        )

    # Sort by priority score descending, then evidence_stars descending
    candidates.sort(key=lambda item: (item[0], item[1]["evidence_stars"]), reverse=True)
    ranked: list[dict[str, Any]] = []
    seen_texts: set[str] = set()
    for _, action in candidates:
        if action["text"] in seen_texts:
            continue
        seen_texts.add(action["text"])
        ranked.append({"rank": len(ranked) + 1, **action})
    return ranked
