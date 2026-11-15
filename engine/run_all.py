"""End-to-end offline BOOPS pipeline runner.

Usage:
    python engine/run_all.py

Regenerates from scratch:
    - data/daily_records.csv
    - data/events.json
    - data/engine_output.json
    - data/mission.db
    - data/flight_surgeon_summary_A1.pdf
    - web/data_bundle.js
    - ui/public/data/boops_bundle.json
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

import pandas as pd

from engine.analysis import (
    infection_early_warning,
    personal_baseline,
    sleep_score,
    stress_score,
    zscores,
)
from engine.data_quality import check_reading
from engine.db import init_db, insert_daily_records, save_engine_output
from engine.export import generate_flight_surgeon_pdf
from engine.generate_mission import ASTRONAUT_PROFILES, generate_mission_data
from engine.risk_engine import evaluate_risks, recommend_actions

DATA_DIR = ROOT_DIR / "data"
CONTENT_DIR = ROOT_DIR / "content"
KNOWLEDGE_DIR = ROOT_DIR / "knowledge"
WEB_DIR = ROOT_DIR / "web"
UI_PUBLIC_DATA_DIR = ROOT_DIR / "ui" / "public" / "data"


def _load_json(path: Path) -> Any:
    if not path.exists():
        return []
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def run_pipeline() -> list[dict[str, Any]]:
    """Execute Tasks 1->4, persist SQLite/JSON/CSV/PDF outputs, and sync web bundles."""
    df, events = generate_mission_data(output_dir=DATA_DIR)
    outputs: list[dict[str, Any]] = []

    for astro_id in ASTRONAUT_PROFILES:
        sub = (
            df[df["astronaut_id"] == astro_id]
            .sort_values("mission_day")
            .reset_index(drop=True)
        )
        baseline = personal_baseline(df, astro_id)

        for idx in range(len(sub)):
            row = sub.iloc[idx]
            day = int(row["mission_day"])
            hist = sub.iloc[: idx + 1]
            z = zscores(row, baseline)
            dq = check_reading(row, baseline, hist, z)
            iew = infection_early_warning(sub, idx, baseline)
            flags = {"infection_early_warning": iew}

            s_stress = stress_score(row, z, baseline)
            s_sleep = sleep_score(row, z, baseline)
            risks = evaluate_risks(row, z, baseline, hist, flags, dq)
            actions = recommend_actions(risks, row, flags, dq)

            outputs.append(
                {
                    "astronaut_id": astro_id,
                    "mission_day": day,
                    "stress_score": s_stress,
                    "sleep_score": s_sleep,
                    "baseline": baseline,
                    "z": z,
                    "risks": risks,
                    "actions": actions,
                    "data_quality": dq,
                    "flags": flags,
                    "labels": ["Simulated"],
                }
            )

    # Attach H4 Isolation Forest anomaly scores & write data/anomaly_scores.json
    from hard.anomaly.anomaly import score_mission
    from hard.anomaly.run_anomaly import merge_into_engine_output, to_records

    anomaly_records = to_records(score_mission(df))
    anomaly_json_path = DATA_DIR / "anomaly_scores.json"
    with open(anomaly_json_path, "w", encoding="utf-8") as f:
        json.dump(anomaly_records, f, indent=2, ensure_ascii=False)
        f.write("\n")

    # Save engine_output.json and merge anomaly_score / anomaly_kind fields
    engine_json_path = DATA_DIR / "engine_output.json"
    with open(engine_json_path, "w", encoding="utf-8") as f:
        json.dump(outputs, f, indent=2, ensure_ascii=False)
        f.write("\n")
    merge_into_engine_output(anomaly_records, path=engine_json_path)
    with open(engine_json_path, "r", encoding="utf-8") as f:
        outputs = json.load(f)

    # Persist to SQLite DB (single source of truth)
    db_path = DATA_DIR / "mission.db"
    init_db(db_path)
    insert_daily_records(df, db_path)
    save_engine_output(outputs, db_path)

    # Generate Flight-Surgeon PDF summary for A1 demo story window (Days 80–105)
    pdf_path = DATA_DIR / "flight_surgeon_summary_A1.pdf"
    generate_flight_surgeon_pdf("A1", 80, 105, pdf_path, db_path=db_path)

    # Build offline bundles for /web and /ui
    daily_records_clean = json.loads(df.to_json(orient="records"))
    bundle = {
        "engineOutput": outputs,
        "dailyRecords": daily_records_clean,
        "events": events,
        "emergencyProtocols": _load_json(CONTENT_DIR / "emergency_protocols.json"),
        "toolGuides": _load_json(CONTENT_DIR / "tool_guides.json"),
        "sources": _load_json(KNOWLEDGE_DIR / "sources.json"),
        "links": _load_json(KNOWLEDGE_DIR / "links.json"),
    }

    UI_PUBLIC_DATA_DIR.mkdir(parents=True, exist_ok=True)
    with open(UI_PUBLIC_DATA_DIR / "boops_bundle.json", "w", encoding="utf-8") as f:
        json.dump(bundle, f, ensure_ascii=False)

    WEB_DIR.mkdir(parents=True, exist_ok=True)
    with open(WEB_DIR / "data_bundle.js", "w", encoding="utf-8") as f:
        f.write("window.BOOPS_DATA = ")
        json.dump(bundle, f, ensure_ascii=False)
        f.write(";\n")

    return outputs


def print_demo_summary(outputs: list[dict[str, Any]]) -> None:
    """Print concise demo summary for A1 days 88–98, A2 days 60–75, and glitches."""
    by_key = {(o["astronaut_id"], o["mission_day"]): o for o in outputs}

    print("\n=== BOOPS Demo Summary: A1 Days 88–98 ===")
    print("Day | Stress | Sleep | Immune      | IEW   | Quality        | Top Action")
    print("-" * 92)
    for d in range(88, 99):
        o = by_key[("A1", d)]
        imm = o["risks"]["immune"]
        iew = o["flags"]["infection_early_warning"]
        dq = o["data_quality"]["status"]
        act1 = o["actions"][0]["text"][:36] if o["actions"] else ""
        print(
            f"{d:3d} | {o['stress_score']:6d} | {o['sleep_score']:5d} | "
            f"{imm['level']:5s} ({imm['score']:3d}) | {str(iew):5s} | {dq:14s} | {act1}"
        )

    print("\n=== Planted Sensor Glitches ===")
    for aid, d in [("A1", 30), ("A2", 50), ("A3", 110)]:
        o = by_key[(aid, d)]
        print(
            f"{aid} Day {d:3d}: data_quality={o['data_quality']['status']} "
            f"(immune={o['risks']['immune']['level']}) -> {o['data_quality']['reasons']}"
        )

    print("\n=== A2 Days 60–75 (Skipped Resistance Exercise) ===")
    for d in [59, 60, 64, 68, 72, 75]:
        o = by_key[("A2", d)]
        m = o["risks"]["musculoskeletal"]
        print(f"A2 Day {d:2d}: musculoskeletal={m['level']:6s} ({m['score']:3d})")


if __name__ == "__main__":
    results = run_pipeline()
    print_demo_summary(results)
