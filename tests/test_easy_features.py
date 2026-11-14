"""End-to-end verification tests for B.O.O.P.S. Easy Features (Tasks 1–10)."""

from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path

import pandas as pd

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from engine.analysis import (
    infection_early_warning,
    personal_baseline,
    sleep_score,
    stress_score,
    zscores,
)
from engine.data_quality import check_reading
from engine.db import (
    export_csv,
    export_json,
    get_day,
    init_db,
    insert_daily_records,
    save_engine_output,
)
from engine.export import export_astronaut_range, generate_flight_surgeon_pdf, normalize_sharing
from engine.generate_mission import CSV_COLUMNS
from engine.risk_engine import evaluate_risks, level_from_score, recommend_actions


def test_task1_simulated_mission_data_and_events():
    """Task 1: 540 rows, 20 contract columns, A1–A3 x 180 days, Simulated label, and events.json."""
    csv_path = ROOT_DIR / "data" / "daily_records.csv"
    events_path = ROOT_DIR / "data" / "events.json"
    assert csv_path.exists()
    assert events_path.exists()

    df = pd.read_csv(csv_path, keep_default_na=False)
    assert len(df) == 540
    assert list(df.columns) == CSV_COLUMNS
    assert len(df.columns) == 20
    assert sorted(df["astronaut_id"].unique().tolist()) == ["A1", "A2", "A3"]
    for aid in ("A1", "A2", "A3"):
        days = sorted(df.loc[df["astronaut_id"] == aid, "mission_day"].tolist())
        assert days == list(range(1, 181))
    assert (df["source"] == "simulated").all()

    events = json.loads(events_path.read_text(encoding="utf-8"))
    event_types = {e["type"] for e in events}
    assert {"adaptation", "eva", "sensor_glitch", "inactivity", "sleep_deficit", "solar_particle_event", "infection_early_warning"} <= event_types


def test_task2_analysis_baseline_zscores_and_infection_warning():
    """Task 2: Personal baseline days 1–14, worked z-score example, bounded scores, pre-symptomatic warning."""
    # Worked z-score check from spec: mean=50, sd=10, value=30 -> -2.0
    z_example = zscores({"hrv_rmssd_ms": 30.0}, {"hrv_rmssd_ms": {"mean": 50.0, "sd": 10.0}})
    assert z_example["hrv_rmssd_ms"] == -2.0

    # Personal baseline excludes signal_quality < 0.5
    df = pd.read_csv(ROOT_DIR / "data" / "daily_records.csv")
    df_test = df[df["astronaut_id"] == "A1"].copy().reset_index(drop=True)
    b_clean = personal_baseline(df_test, "A1")

    df_polluted = df_test.copy()
    df_polluted.loc[df_polluted["mission_day"] == 3, "signal_quality"] = 0.2
    df_polluted.loc[df_polluted["mission_day"] == 3, "rhr_bpm"] = 250.0
    b_polluted = personal_baseline(df_polluted, "A1")
    assert b_polluted["rhr_bpm"]["mean"] < 80.0
    assert abs(b_polluted["rhr_bpm"]["mean"] - b_clean["rhr_bpm"]["mean"]) < 2.0

    # Scores clamped 0..100 and pre-symptomatic infection early warning turns on Day 96 (before symptoms Day 97)
    a1_sorted = df_test.sort_values("mission_day").reset_index(drop=True)
    iew_days = []
    for idx, row in a1_sorted.iterrows():
        z = zscores(row, b_clean)
        s_stress = stress_score(row, z, b_clean)
        s_sleep = sleep_score(row, z, b_clean)
        assert 0 <= s_stress <= 100
        assert 0 <= s_sleep <= 100
        if infection_early_warning(a1_sorted, idx, b_clean):
            iew_days.append(int(row["mission_day"]))

    assert any(d in (95, 96) for d in iew_days), f"Expected pre-symptomatic warning on day 95/96, got {iew_days}"
    assert 41 not in iew_days, "EVA day 41 should NOT trigger infection early warning"
    assert 30 not in iew_days, "Glitch day 30 should NOT trigger infection early warning"


def test_task3_knowledge_links_and_risk_engine():
    """Task 3: Knowledge link schema & sources, A1 immune act, A2 musculoskeletal rise, adaptation & ranked actions."""
    links = json.loads((ROOT_DIR / "knowledge" / "links.json").read_text(encoding="utf-8"))
    sources = json.loads((ROOT_DIR / "knowledge" / "sources.json").read_text(encoding="utf-8"))
    source_ids = {s["id"] for s in sources}

    assert len(links) > 0
    for link in links:
        for req_key in ("id", "from", "to", "type", "evidence_stars", "source_id", "chain_text"):
            assert req_key in link, f"Missing {req_key} in link {link}"
        assert link["source_id"] in source_ids, f"Unresolved source_id {link['source_id']}"

    assert level_from_score(39) == "normal"
    assert level_from_score(40) == "watch"
    assert level_from_score(70) == "watch"
    assert level_from_score(71) == "act"

    outputs = json.loads((ROOT_DIR / "data" / "engine_output.json").read_text(encoding="utf-8"))
    by_key = {(o["astronaut_id"], o["mission_day"]): o for o in outputs}

    # A1 days 95–97: Immune = Act with sleep / stress among top drivers
    for day in (95, 96, 97):
        item = by_key[("A1", day)]
        assert item["risks"]["immune"]["level"] == "act"
        top_factors = {d["factor"] for d in item["risks"]["immune"]["drivers"][:3]}
        assert top_factors & {"sleep", "stress"}, f"Expected sleep/stress top driver on day {day}, got {top_factors}"

    action_texts_97 = " | ".join(a["text"] for a in by_key[("A1", 97)]["actions"]).lower()
    assert "fix sleep first" in action_texts_97
    assert "saliva" in action_texts_97

    # A2 days 60–75: Musculoskeletal risk climbs from normal before day 60 to watch/act
    assert by_key[("A2", 59)]["risks"]["musculoskeletal"]["level"] == "normal"
    assert max(by_key[("A2", d)]["risks"]["musculoskeletal"]["score"] for d in range(60, 76)) >= 40

    # Days 1–14: adaptation dampening active in drivers / suppressed extreme false alerts
    adapt_cardio_drivers = [d["factor"] for d in by_key[("A1", 5)]["risks"]["cardio"]["drivers"]]
    assert "adaptation_phase" in adapt_cardio_drivers

    # Unit check on evaluate_risks + recommend_actions adaptation dampening
    dummy_z = {"hrv_rmssd_ms": -2.5, "sleep_hours": -2.5, "rhr_bpm": 1.5, "radiation_msv": 0.0, "resistance_min": -2.0}
    risks_day5 = evaluate_risks({"mission_day": 5, "eva": 0, "symptoms": "", "sleep_hours": 5.0}, dummy_z, {})
    risks_day50 = evaluate_risks({"mission_day": 50, "eva": 0, "symptoms": "", "sleep_hours": 5.0}, dummy_z, {})
    assert risks_day5["immune"]["score"] < risks_day50["immune"]["score"]
    acts = recommend_actions(risks_day50, {"symptoms": "sore throat", "sleep_hours": 5.0, "radiation_msv": 0.5}, {"infection_early_warning": True})
    assert acts[0]["rank"] == 1


def test_task4_odd_reading_funnel_and_retention():
    """Task 4: Glitches -> check_device & non-Act, A1 infection -> check_yourself, bad rows kept in CSV/DB."""
    df = pd.read_csv(ROOT_DIR / "data" / "daily_records.csv")
    outputs = json.loads((ROOT_DIR / "data" / "engine_output.json").read_text(encoding="utf-8"))
    by_key = {(o["astronaut_id"], o["mission_day"]): o for o in outputs}

    # Glitches are preserved in daily_records.csv (never deleted)
    low_q = df[df["signal_quality"] < 0.5]
    assert len(low_q) == 3

    for aid, glitch_day in (("A1", 30), ("A2", 50), ("A3", 110)):
        item = by_key[(aid, glitch_day)]
        assert item["data_quality"]["status"] == "check_device"
        assert item["risks"]["immune"]["level"] != "act"
        assert item["risks"]["cardio"]["level"] != "act"

    # A1 real pre-symptomatic infection days 95–97 -> check_yourself (not check_device)
    for day in (95, 96, 97):
        assert by_key[("A1", day)]["data_quality"]["status"] == "check_yourself"

    # Safety rule: dangerous values + symptoms -> act_now
    dq_danger = check_reading(
        {"signal_quality": 0.9, "rhr_bpm": 122.0, "hrv_rmssd_ms": 22.0, "temp_c": 38.7, "spo2_pct": 88.0, "symptoms": "fever;cough", "eva": 0},
        {"rhr_bpm": {"mean": 60.0, "sd": 2.0}},
    )
    assert dq_danger["status"] == "act_now"


def test_task5_sqlite_db_and_engine_output_contract(tmp_path):
    """Task 5: 9 SQLite tables, all db functions verified, 540-record engine_output.json matches contract."""
    db_file = ROOT_DIR / "data" / "mission.db"
    assert db_file.exists()

    expected_tables = {
        "astronauts",
        "daily_records",
        "engine_outputs",
        "risk_drivers",
        "actions",
        "log_entries",
        "emergency_events",
        "sharing_settings",
        "sources",
    }
    with sqlite3.connect(db_file) as conn:
        tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
        assert expected_tables <= tables
        assert conn.execute("SELECT COUNT(*) FROM daily_records").fetchone()[0] == 540
        assert conn.execute("SELECT COUNT(*) FROM engine_outputs").fetchone()[0] == 540

    outputs = json.loads((ROOT_DIR / "data" / "engine_output.json").read_text(encoding="utf-8"))
    assert len(outputs) == 540
    required_keys = {
        "astronaut_id",
        "mission_day",
        "stress_score",
        "sleep_score",
        "baseline",
        "z",
        "risks",
        "actions",
        "data_quality",
        "flags",
        "labels",
    }
    for sample in (outputs[0], outputs[95], outputs[539]):
        assert required_keys <= set(sample.keys())
        assert "Simulated" in sample["labels"]

    # Verify db.py CRUD functions cleanly in isolated tmp_path
    tmp_db = tmp_path / "test_boops.db"
    init_db(tmp_db)
    df_head = pd.read_csv(ROOT_DIR / "data" / "daily_records.csv").head(5)
    insert_daily_records(df_head, db_path=tmp_db)
    save_engine_output(outputs[:2], db_path=tmp_db)
    day1 = get_day("A1", 1, db_path=tmp_db)
    assert day1 is not None and day1["astronaut_id"] == "A1" and day1["mission_day"] == 1
    out_j = tmp_path / "out.json"
    out_c = tmp_path / "out.csv"
    export_json(out_j, db_path=tmp_db)
    export_csv(out_c, db_path=tmp_db)
    assert out_j.exists() and len(json.loads(out_j.read_text(encoding="utf-8"))) == 2
    assert out_c.exists() and len(pd.read_csv(out_c)) == 5


def test_task6_emergency_protocols_and_tool_guides():
    """Task 6: 6 emergency protocols and 7 measurement tool guides present with required fields."""
    protocols = json.loads((ROOT_DIR / "content" / "emergency_protocols.json").read_text(encoding="utf-8"))
    guides = json.loads((ROOT_DIR / "content" / "tool_guides.json").read_text(encoding="utf-8"))

    assert len(protocols) == 6
    for p in protocols:
        for field in ("id", "title", "severity", "first_screen_message", "steps", "why_this_happens", "when_to_escalate", "related_tool_guides", "disclaimer"):
            assert field in p, f"Protocol missing {field}"
        assert len(p["steps"]) >= 3

    assert len(guides) == 7
    guide_ids = {g["id"] for g in guides}
    assert {
        "blood_pressure_cuff",
        "wearable_hrv_fit",
        "thermometer",
        "saliva_sample_kit",
        "personal_dosimeter",
        "pulse_oximeter",
        "exercise_device_log",
    } == guide_ids
    for g in guides:
        for field in ("id", "title", "steps", "why_it_matters", "common_mistakes", "how_to_fix_bad_reading", "linked_log_fields"):
            assert field in g


def test_task7_and_task8_web_bundle_and_privacy_export(tmp_path):
    """Tasks 7 & 8: Offline /web files, crew-first sharing export filters, and Flight-Surgeon PDF."""
    web_index = ROOT_DIR / "web" / "index.html"
    web_app = ROOT_DIR / "web" / "app.js"
    web_bundle = ROOT_DIR / "web" / "data_bundle.js"
    assert web_index.exists() and web_app.exists() and web_bundle.exists()

    html = web_index.read_text(encoding="utf-8")
    assert 'type="module"' not in html
    assert "./data_bundle.js" in html
    assert "./app.js" in html

    # Emergency sharing cannot be turned off even if False is passed
    assert normalize_sharing({"daily_summary": False, "raw_data": False, "emergency_events": False}) == {
        "daily_summary": False,
        "raw_data": False,
        "emergency_events": True,
    }

    # Default sharing (daily_summary=True, raw_data=False) omits raw_records
    default_export = export_astronaut_range("A1", 90, 98, fmt="json")
    assert isinstance(default_export, dict)
    assert "daily_summary" in default_export
    assert "raw_records" not in default_export
    assert len(default_export["emergency_events"]) > 0

    # Emergency-only export (daily_summary=False, raw_data=False) keeps only emergency_events
    strict_export = export_astronaut_range(
        "A1", 90, 98, sharing_settings={"daily_summary": False, "raw_data": False, "emergency_events": False}, fmt="json"
    )
    assert isinstance(strict_export, dict)
    assert "daily_summary" not in strict_export
    assert "raw_records" not in strict_export
    assert strict_export["sharing_settings"]["emergency_events"] is True
    assert len(strict_export["emergency_events"]) > 0

    # Verify PDF exists from pipeline and also works when generated to a temp path
    pdf_main = ROOT_DIR / "data" / "flight_surgeon_summary_A1.pdf"
    assert pdf_main.exists() and pdf_main.read_bytes().startswith(b"%PDF")

    tmp_pdf = tmp_path / "summary_A2.pdf"
    generate_flight_surgeon_pdf("A2", 55, 76, tmp_pdf)
    assert tmp_pdf.exists() and tmp_pdf.read_bytes().startswith(b"%PDF")
