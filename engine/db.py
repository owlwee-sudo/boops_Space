"""Offline SQLite single source of truth for BOOPS (data/mission.db).

Tables:
    astronauts, daily_records, engine_outputs, risk_drivers, actions,
    log_entries, emergency_events, sharing_settings, sources
"""

from __future__ import annotations

import json
import math
import sqlite3
from pathlib import Path
from typing import Any

import pandas as pd

ROOT_DIR = Path(__file__).resolve().parent.parent
DEFAULT_DB_PATH = ROOT_DIR / "data" / "mission.db"


def _connect(db_path: Path | str = DEFAULT_DB_PATH) -> sqlite3.Connection:
    path = Path(db_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn


def init_db(db_path: Path | str = DEFAULT_DB_PATH) -> Path:
    """Create all 9 BOOPS SQLite tables and seed default astronauts & sharing settings."""
    path = Path(db_path)
    with _connect(path) as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS astronauts (
                astronaut_id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                role TEXT NOT NULL,
                medical_officer INTEGER DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS daily_records (
                astronaut_id TEXT NOT NULL,
                mission_day INTEGER NOT NULL,
                date TEXT NOT NULL,
                rhr_bpm REAL,
                hrv_rmssd_ms REAL,
                sleep_hours REAL,
                sleep_quality_1to5 INTEGER,
                eda_mean_us REAL,
                spo2_pct REAL,
                sbp_mmhg REAL,
                dbp_mmhg REAL,
                temp_c REAL,
                exercise_min REAL,
                resistance_min REAL,
                radiation_msv REAL,
                eva INTEGER DEFAULT 0,
                symptoms TEXT DEFAULT '',
                mood_1to5 INTEGER,
                signal_quality REAL,
                source TEXT DEFAULT 'simulated',
                PRIMARY KEY (astronaut_id, mission_day)
            );

            CREATE TABLE IF NOT EXISTS engine_outputs (
                astronaut_id TEXT NOT NULL,
                mission_day INTEGER NOT NULL,
                stress_score INTEGER NOT NULL,
                sleep_score INTEGER NOT NULL,
                baseline_json TEXT NOT NULL,
                z_json TEXT NOT NULL,
                risks_json TEXT NOT NULL,
                data_quality_json TEXT NOT NULL,
                flags_json TEXT NOT NULL,
                labels_json TEXT NOT NULL,
                PRIMARY KEY (astronaut_id, mission_day)
            );

            CREATE TABLE IF NOT EXISTS risk_drivers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                astronaut_id TEXT NOT NULL,
                mission_day INTEGER NOT NULL,
                risk_type TEXT NOT NULL,
                factor TEXT NOT NULL,
                z REAL,
                contribution REAL,
                chain TEXT NOT NULL,
                evidence_stars INTEGER NOT NULL,
                source_id TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS actions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                astronaut_id TEXT NOT NULL,
                mission_day INTEGER NOT NULL,
                rank INTEGER NOT NULL,
                text TEXT NOT NULL,
                targets TEXT NOT NULL,
                evidence_stars INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS log_entries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                astronaut_id TEXT NOT NULL,
                mission_day INTEGER NOT NULL,
                category TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                created_utc TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS emergency_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                astronaut_id TEXT NOT NULL,
                mission_day INTEGER NOT NULL,
                protocol_id TEXT NOT NULL,
                severity TEXT NOT NULL,
                summary TEXT NOT NULL,
                created_utc TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sharing_settings (
                astronaut_id TEXT PRIMARY KEY,
                daily_summary INTEGER NOT NULL DEFAULT 1,
                raw_data INTEGER NOT NULL DEFAULT 0,
                emergency_events INTEGER NOT NULL DEFAULT 1
            );

            CREATE TABLE IF NOT EXISTS sources (
                id TEXT PRIMARY KEY,
                group_name TEXT NOT NULL,
                title TEXT NOT NULL,
                url TEXT NOT NULL,
                layer TEXT NOT NULL DEFAULT 'core'
            );
            """
        )

        # Seed astronauts & default crew-first sharing toggles
        default_crew = [
            ("A1", "Amara Okafor", "Commander", 0),
            ("A2", "Jun Park", "Pilot", 0),
            ("A3", "Lena Fischer", "Flight Engineer / Medical Officer", 1),
        ]
        conn.executemany(
            """
            INSERT OR IGNORE INTO astronauts (astronaut_id, name, role, medical_officer)
            VALUES (?, ?, ?, ?)
            """,
            default_crew,
        )
        for aid, *_ in default_crew:
            conn.execute(
                """
                INSERT OR IGNORE INTO sharing_settings
                    (astronaut_id, daily_summary, raw_data, emergency_events)
                VALUES (?, 1, 0, 1)
                """,
                (aid,),
            )

        # Load sources.json if available
        sources_path = ROOT_DIR / "knowledge" / "sources.json"
        if sources_path.exists():
            with open(sources_path, "r", encoding="utf-8") as f:
                src_items = json.load(f)
            conn.executemany(
                """
                INSERT OR REPLACE INTO sources (id, group_name, title, url, layer)
                VALUES (?, ?, ?, ?, ?)
                """,
                [
                    (
                        s["id"],
                        s.get("group", "General"),
                        s.get("title", s.get("citation", "")),
                        s.get("url", ""),
                        s.get("layer", "core"),
                    )
                    for s in src_items
                ],
            )
    return path


def insert_daily_records(
    df: pd.DataFrame,
    db_path: Path | str = DEFAULT_DB_PATH,
) -> int:
    """Insert or replace daily_records rows from a DataFrame into SQLite."""
    rows = []
    for _, r in df.iterrows():
        rows.append(
            (
                str(r["astronaut_id"]),
                int(r["mission_day"]),
                str(r["date"]),
                None if pd.isna(r["rhr_bpm"]) else float(r["rhr_bpm"]),
                None if pd.isna(r["hrv_rmssd_ms"]) else float(r["hrv_rmssd_ms"]),
                None if pd.isna(r["sleep_hours"]) else float(r["sleep_hours"]),
                None if pd.isna(r["sleep_quality_1to5"]) else int(r["sleep_quality_1to5"]),
                None if pd.isna(r["eda_mean_us"]) else float(r["eda_mean_us"]),
                None if pd.isna(r["spo2_pct"]) else float(r["spo2_pct"]),
                None if pd.isna(r["sbp_mmhg"]) else float(r["sbp_mmhg"]),
                None if pd.isna(r["dbp_mmhg"]) else float(r["dbp_mmhg"]),
                None if pd.isna(r["temp_c"]) else float(r["temp_c"]),
                None if pd.isna(r["exercise_min"]) else float(r["exercise_min"]),
                None if pd.isna(r["resistance_min"]) else float(r["resistance_min"]),
                None if pd.isna(r["radiation_msv"]) else float(r["radiation_msv"]),
                _safe_int(r.get("eva")),
                "" if pd.isna(r.get("symptoms")) else str(r.get("symptoms")),
                None if pd.isna(r["mood_1to5"]) else int(r["mood_1to5"]),
                None if pd.isna(r["signal_quality"]) else float(r["signal_quality"]),
                str(r.get("source", "simulated")),
            )
        )

    with _connect(db_path) as conn:
        conn.executemany(
            """
            INSERT OR REPLACE INTO daily_records (
                astronaut_id, mission_day, date, rhr_bpm, hrv_rmssd_ms,
                sleep_hours, sleep_quality_1to5, eda_mean_us, spo2_pct,
                sbp_mmhg, dbp_mmhg, temp_c, exercise_min, resistance_min,
                radiation_msv, eva, symptoms, mood_1to5, signal_quality, source
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            rows,
        )
    return len(rows)


PLANTED_SPE_UTC = "2026-08-17T06:00:00Z"

# Text starting with one of these is run as a formula by Excel / Sheets.
_CSV_FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def csv_safe(value: Any) -> Any:
    """Neutralise spreadsheet formulas in a CSV cell (prefix with ').

    Numbers are left alone, so negative values like -1.5 stay numeric.
    """
    if isinstance(value, str) and value.startswith(_CSV_FORMULA_PREFIXES):
        try:
            float(value)
            return value
        except ValueError:
            return "'" + value
    return value


def json_safe(obj: Any) -> Any:
    """Recursively replace NaN / inf with None so the JSON is valid (RFC 8259)."""
    if isinstance(obj, float):
        return obj if math.isfinite(obj) else None
    if isinstance(obj, dict):
        return {k: json_safe(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [json_safe(v) for v in obj]
    return obj


def dumps_safe(obj: Any, **kwargs: Any) -> str:
    """json.dumps that never writes NaN / Infinity."""
    return json.dumps(json_safe(obj), allow_nan=False, **kwargs)


def _safe_int(val: Any, default: int = 0) -> int:
    """int() that turns NaN, inf, None and junk into ``default`` instead of crashing."""
    try:
        out = float(val)
    except (TypeError, ValueError):
        return default
    return int(out) if math.isfinite(out) else default


def save_engine_output(
    outputs: list[dict[str, Any]],
    db_path: Path | str = DEFAULT_DB_PATH,
) -> int:
    """Persist engine_output objects into engine_outputs, risk_drivers, and actions tables."""
    with _connect(db_path) as conn:
        conn.execute("DELETE FROM risk_drivers")
        conn.execute("DELETE FROM actions")
        # Only clear the SPE events this function plants itself (so a re-run does
        # not duplicate them). Crew-logged emergency events must never be deleted.
        conn.execute(
            "DELETE FROM emergency_events WHERE astronaut_id = 'all' "
            "AND protocol_id = 'solar_radiation_storm' AND created_utc = ?",
            (PLANTED_SPE_UTC,),
        )

        for item in outputs:
            aid = item["astronaut_id"]
            day = int(item["mission_day"])
            conn.execute(
                """
                INSERT OR REPLACE INTO engine_outputs (
                    astronaut_id, mission_day, stress_score, sleep_score,
                    baseline_json, z_json, risks_json, data_quality_json,
                    flags_json, labels_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    aid,
                    day,
                    int(item["stress_score"]),
                    int(item["sleep_score"]),
                    dumps_safe(item["baseline"]),
                    dumps_safe(item["z"]),
                    dumps_safe(item["risks"]),
                    dumps_safe(item["data_quality"]),
                    dumps_safe(item["flags"]),
                    dumps_safe(item["labels"]),
                ),
            )

            for risk_type, risk_val in item["risks"].items():
                for drv in risk_val.get("drivers", []):
                    conn.execute(
                        """
                        INSERT INTO risk_drivers (
                            astronaut_id, mission_day, risk_type, factor, z,
                            contribution, chain, evidence_stars, source_id
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            aid,
                            day,
                            risk_type,
                            drv["factor"],
                            float(drv.get("z", 0.0)),
                            float(drv.get("contribution", 0.0)),
                            drv["chain"],
                            int(drv["evidence_stars"]),
                            drv["source_id"],
                        ),
                    )

            for act in item.get("actions", []):
                conn.execute(
                    """
                    INSERT INTO actions (
                        astronaut_id, mission_day, rank, text, targets, evidence_stars
                    ) VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        aid,
                        day,
                        int(act["rank"]),
                        act["text"],
                        act["targets"],
                        int(act["evidence_stars"]),
                    ),
                )

            # Log planted critical solar particle event & act_now alerts into emergency_events
            if day in (92, 93) and aid == "A1":
                conn.execute(
                    """
                    INSERT INTO emergency_events (
                        astronaut_id, mission_day, protocol_id, severity, summary, created_utc
                    ) VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        "all",
                        day,
                        "solar_radiation_storm",
                        "critical",
                        f"Solar Particle Event (Day {day}) — shelter protocol triggered",
                        PLANTED_SPE_UTC,
                    ),
                )
    return len(outputs)


def get_day(
    astronaut_id: str,
    mission_day: int,
    db_path: Path | str = DEFAULT_DB_PATH,
) -> dict[str, Any] | None:
    """Retrieve combined record + engine output for one astronaut and mission day."""
    with _connect(db_path) as conn:
        rec_row = conn.execute(
            "SELECT * FROM daily_records WHERE astronaut_id = ? AND mission_day = ?",
            (astronaut_id, int(mission_day)),
        ).fetchone()
        eng_row = conn.execute(
            "SELECT * FROM engine_outputs WHERE astronaut_id = ? AND mission_day = ?",
            (astronaut_id, int(mission_day)),
        ).fetchone()
        if not eng_row:
            return None
        acts = conn.execute(
            "SELECT rank, text, targets, evidence_stars FROM actions WHERE astronaut_id = ? AND mission_day = ? ORDER BY rank",
            (astronaut_id, int(mission_day)),
        ).fetchall()

    return {
        "astronaut_id": astronaut_id,
        "mission_day": int(mission_day),
        "stress_score": int(eng_row["stress_score"]),
        "sleep_score": int(eng_row["sleep_score"]),
        "baseline": json.loads(eng_row["baseline_json"]),
        "z": json.loads(eng_row["z_json"]),
        "risks": json.loads(eng_row["risks_json"]),
        "actions": [dict(a) for a in acts],
        "data_quality": json.loads(eng_row["data_quality_json"]),
        "flags": json.loads(eng_row["flags_json"]),
        "labels": json.loads(eng_row["labels_json"]),
        "record": dict(rec_row) if rec_row else None,
    }


def export_json(
    output_path: Path | str,
    db_path: Path | str = DEFAULT_DB_PATH,
) -> Path:
    """Export all engine_outputs from SQLite to engine_output.json matching the contract."""
    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    with _connect(db_path) as conn:
        rows = conn.execute(
            "SELECT * FROM engine_outputs ORDER BY astronaut_id, mission_day"
        ).fetchall()
        action_rows = conn.execute(
            "SELECT astronaut_id, mission_day, rank, text, targets, evidence_stars FROM actions ORDER BY astronaut_id, mission_day, rank"
        ).fetchall()

    actions_by_key: dict[tuple[str, int], list[dict[str, Any]]] = {}
    for a in action_rows:
        key = (a["astronaut_id"], int(a["mission_day"]))
        actions_by_key.setdefault(key, []).append(
            {
                "rank": int(a["rank"]),
                "text": a["text"],
                "targets": a["targets"],
                "evidence_stars": int(a["evidence_stars"]),
            }
        )

    payload: list[dict[str, Any]] = []
    for r in rows:
        key = (r["astronaut_id"], int(r["mission_day"]))
        payload.append(
            {
                "astronaut_id": r["astronaut_id"],
                "mission_day": int(r["mission_day"]),
                "stress_score": int(r["stress_score"]),
                "sleep_score": int(r["sleep_score"]),
                "baseline": json.loads(r["baseline_json"]),
                "z": json.loads(r["z_json"]),
                "risks": json.loads(r["risks_json"]),
                "actions": actions_by_key.get(key, []),
                "data_quality": json.loads(r["data_quality_json"]),
                "flags": json.loads(r["flags_json"]),
                "labels": json.loads(r["labels_json"]),
            }
        )

    with open(out, "w", encoding="utf-8") as f:
        f.write(dumps_safe(payload, indent=2, ensure_ascii=False))
        f.write("\n")
    return out


def export_csv(
    output_path: Path | str,
    db_path: Path | str = DEFAULT_DB_PATH,
) -> Path:
    """Export daily_records from SQLite to CSV."""
    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    with _connect(db_path) as conn:
        df = pd.read_sql_query(
            "SELECT * FROM daily_records ORDER BY astronaut_id, mission_day", conn
        )
    for col in df.select_dtypes(include=["object", "string"]).columns:
        df[col] = df[col].map(csv_safe)
    df.to_csv(out, index=False)
    return out


def _utc_timestamp(created_utc: str | None) -> str:
    """Return a caller-supplied UTC timestamp or current ISO-8601 UTC time."""
    if created_utc:
        return str(created_utc)
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def save_log_entry(
    astronaut_id: str,
    mission_day: int,
    category: str,
    payload: Any,
    created_utc: str | None = None,
    db_path: Path | str = DEFAULT_DB_PATH,
) -> int:
    """Insert a manual or system log entry into SQLite and return its row id."""
    import json

    payload_json = (
        payload if isinstance(payload, str) else json.dumps(payload, sort_keys=True)
    )
    timestamp = _utc_timestamp(created_utc)
    with _connect(db_path) as conn:
        cur = conn.execute(
            """
            INSERT INTO log_entries (
                astronaut_id, mission_day, category, payload_json, created_utc
            )
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                str(astronaut_id),
                int(mission_day),
                str(category),
                payload_json,
                timestamp,
            ),
        )
        conn.commit()
        return int(cur.lastrowid or 0)


def save_sharing_settings(
    astronaut_id: str,
    daily_summary: bool,
    raw_data: bool,
    db_path: Path | str = DEFAULT_DB_PATH,
) -> dict[str, Any]:
    """Persist sharing toggles to SQLite while keeping emergency_events locked ON."""
    daily_int = 1 if daily_summary else 0
    raw_int = 1 if raw_data else 0
    # Crew-first privacy rule: emergency alerts stay enabled for safety.
    emergency_int = 1
    with _connect(db_path) as conn:
        conn.execute(
            """
            INSERT INTO sharing_settings (
                astronaut_id, daily_summary, raw_data, emergency_events
            )
            VALUES (?, ?, ?, ?)
            ON CONFLICT(astronaut_id) DO UPDATE SET
                daily_summary = excluded.daily_summary,
                raw_data = excluded.raw_data,
                emergency_events = 1
            """,
            (str(astronaut_id), daily_int, raw_int, emergency_int),
        )
        conn.commit()
    return {
        "astronaut_id": str(astronaut_id),
        "daily_summary": bool(daily_int),
        "raw_data": bool(raw_int),
        "emergency_events": True,
    }


def save_emergency_event(
    astronaut_id: str,
    mission_day: int,
    protocol_id: str,
    severity: str,
    summary: str,
    created_utc: str | None = None,
    db_path: Path | str = DEFAULT_DB_PATH,
) -> int:
    """Insert an offline emergency event record into SQLite and return its row id."""
    timestamp = _utc_timestamp(created_utc)
    with _connect(db_path) as conn:
        cur = conn.execute(
            """
            INSERT INTO emergency_events (
                astronaut_id, mission_day, protocol_id, severity, summary, created_utc
            )
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                str(astronaut_id),
                int(mission_day),
                str(protocol_id),
                str(severity),
                str(summary),
                timestamp,
            ),
        )
        conn.commit()
        return int(cur.lastrowid or 0)
