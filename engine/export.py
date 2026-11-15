"""Mission data and Flight-Surgeon PDF summary exporter respecting crew privacy settings.

Sharing toggles (crew-first privacy):
    - daily_summary: on by default (True)
    - raw_data: off by default (False)
    - emergency_events: always on, locked (True)
"""

from __future__ import annotations

import csv
import io
import json
from pathlib import Path
from typing import Any

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.backends.backend_pdf import PdfPages

from engine.db import DEFAULT_DB_PATH, _connect

ROOT_DIR = Path(__file__).resolve().parent.parent
SOURCES_PATH = ROOT_DIR / "knowledge" / "sources.json"

DEFAULT_SHARING: dict[str, bool] = {
    "daily_summary": True,
    "raw_data": False,
    "emergency_events": True,
}


def normalize_sharing(sharing_settings: dict[str, Any] | None) -> dict[str, bool]:
    """Return normalized sharing settings with emergency_events always locked True."""
    merged = dict(DEFAULT_SHARING)
    if sharing_settings:
        if "daily_summary" in sharing_settings:
            merged["daily_summary"] = bool(sharing_settings["daily_summary"])
        if "raw_data" in sharing_settings:
            merged["raw_data"] = bool(sharing_settings["raw_data"])
    merged["emergency_events"] = True  # Locked on for crew safety
    return merged


def _query_range(
    astronaut_id: str,
    start_day: int,
    end_day: int,
    db_path: Path | str = DEFAULT_DB_PATH,
) -> dict[str, Any]:
    with _connect(db_path) as conn:
        astro = conn.execute(
            "SELECT * FROM astronauts WHERE astronaut_id = ?", (astronaut_id,)
        ).fetchone()
        raw_rows = conn.execute(
            """
            SELECT * FROM daily_records
            WHERE astronaut_id = ? AND mission_day BETWEEN ? AND ?
            ORDER BY mission_day
            """,
            (astronaut_id, int(start_day), int(end_day)),
        ).fetchall()
        eng_rows = conn.execute(
            """
            SELECT * FROM engine_outputs
            WHERE astronaut_id = ? AND mission_day BETWEEN ? AND ?
            ORDER BY mission_day
            """,
            (astronaut_id, int(start_day), int(end_day)),
        ).fetchall()
        action_rows = conn.execute(
            """
            SELECT mission_day, rank, text, targets, evidence_stars FROM actions
            WHERE astronaut_id = ? AND mission_day BETWEEN ? AND ?
            ORDER BY mission_day, rank
            """,
            (astronaut_id, int(start_day), int(end_day)),
        ).fetchall()
        em_rows = conn.execute(
            """
            SELECT * FROM emergency_events
            WHERE (astronaut_id = ? OR astronaut_id = 'all')
              AND mission_day BETWEEN ? AND ?
            ORDER BY mission_day
            """,
            (astronaut_id, int(start_day), int(end_day)),
        ).fetchall()

    actions_by_day: dict[int, list[dict[str, Any]]] = {}
    for a in action_rows:
        actions_by_day.setdefault(int(a["mission_day"]), []).append(dict(a))

    summaries: list[dict[str, Any]] = []
    for r in eng_rows:
        day = int(r["mission_day"])
        summaries.append(
            {
                "astronaut_id": r["astronaut_id"],
                "mission_day": day,
                "stress_score": int(r["stress_score"]),
                "sleep_score": int(r["sleep_score"]),
                "risks": json.loads(r["risks_json"]),
                "data_quality": json.loads(r["data_quality_json"]),
                "flags": json.loads(r["flags_json"]),
                "actions": actions_by_day.get(day, []),
                "labels": json.loads(r["labels_json"]),
            }
        )

    return {
        "astronaut": dict(astro) if astro else {"astronaut_id": astronaut_id, "name": astronaut_id, "role": "Crew"},
        "raw_records": [dict(r) for r in raw_rows],
        "daily_summary": summaries,
        "emergency_events": [dict(e) for e in em_rows],
    }


def export_astronaut_range(
    astronaut_id: str,
    start_day: int,
    end_day: int,
    sharing_settings: dict[str, Any] | None = None,
    fmt: str = "json",
    output_path: Path | str | None = None,
    db_path: Path | str = DEFAULT_DB_PATH,
) -> str | dict[str, Any]:
    """Export astronaut data for a day range while strictly enforcing sharing toggles."""
    sharing = normalize_sharing(sharing_settings)
    data = _query_range(astronaut_id, start_day, end_day, db_path=db_path)

    payload: dict[str, Any] = {
        "astronaut": data["astronaut"],
        "mission_day_range": [int(start_day), int(end_day)],
        "sharing_settings": sharing,
        "labels": ["Simulated", "Prototype · Not a medical device"],
        "emergency_events": data["emergency_events"],
    }
    if sharing["daily_summary"]:
        payload["daily_summary"] = data["daily_summary"]
    if sharing["raw_data"]:
        payload["raw_records"] = data["raw_records"]

    if fmt.lower() == "csv":
        buf = io.StringIO()
        if sharing["raw_data"] and data["raw_records"]:
            fieldnames = list(data["raw_records"][0].keys())
            writer = csv.DictWriter(buf, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(data["raw_records"])
        elif sharing["daily_summary"] and data["daily_summary"]:
            fieldnames = [
                "astronaut_id",
                "mission_day",
                "stress_score",
                "sleep_score",
                "immune_level",
                "immune_score",
                "musculoskeletal_level",
                "musculoskeletal_score",
                "cardio_level",
                "cardio_score",
                "data_quality_status",
                "infection_early_warning",
                "label",
            ]
            writer = csv.DictWriter(buf, fieldnames=fieldnames)
            writer.writeheader()
            for s in data["daily_summary"]:
                writer.writerow(
                    {
                        "astronaut_id": s["astronaut_id"],
                        "mission_day": s["mission_day"],
                        "stress_score": s["stress_score"],
                        "sleep_score": s["sleep_score"],
                        "immune_level": s["risks"]["immune"]["level"],
                        "immune_score": s["risks"]["immune"]["score"],
                        "musculoskeletal_level": s["risks"]["musculoskeletal"]["level"],
                        "musculoskeletal_score": s["risks"]["musculoskeletal"]["score"],
                        "cardio_level": s["risks"]["cardio"]["level"],
                        "cardio_score": s["risks"]["cardio"]["score"],
                        "data_quality_status": s["data_quality"]["status"],
                        "infection_early_warning": s["flags"].get("infection_early_warning", False),
                        "label": "Simulated · Not a medical device",
                    }
                )
        else:
            fieldnames = ["astronaut_id", "mission_day", "protocol_id", "severity", "summary", "created_utc"]
            writer = csv.DictWriter(buf, fieldnames=fieldnames)
            writer.writeheader()
            for e in data["emergency_events"]:
                writer.writerow({k: e.get(k, "") for k in fieldnames})

        csv_text = buf.getvalue()
        if output_path is not None:
            out = Path(output_path)
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text(csv_text, encoding="utf-8")
        return csv_text

    if output_path is not None:
        out = Path(output_path)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return payload


def generate_flight_surgeon_pdf(
    astronaut_id: str,
    start_day: int,
    end_day: int,
    output_path: Path | str,
    sharing_settings: dict[str, Any] | None = None,
    db_path: Path | str = DEFAULT_DB_PATH,
) -> Path:
    """Generate a 2-page Flight-Surgeon PDF summary report with charts, drivers, and sources."""
    sharing = normalize_sharing(sharing_settings)
    data = _query_range(astronaut_id, start_day, end_day, db_path=db_path)
    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)

    summaries = data["daily_summary"]
    astro = data["astronaut"]
    days = [s["mission_day"] for s in summaries]
    stress_vals = [s["stress_score"] for s in summaries]
    sleep_vals = [s["sleep_score"] for s in summaries]
    imm_vals = [s["risks"]["immune"]["score"] for s in summaries]
    musc_vals = [s["risks"]["musculoskeletal"]["score"] for s in summaries]
    cardio_vals = [s["risks"]["cardio"]["score"] for s in summaries]

    latest = summaries[-1] if summaries else None
    peak_imm = max(summaries, key=lambda s: s["risks"]["immune"]["score"]) if summaries else None
    dq_issues = [s for s in summaries if s["data_quality"]["status"] != "ok"]

    sources_list: list[dict[str, Any]] = []
    if SOURCES_PATH.exists():
        with open(SOURCES_PATH, "r", encoding="utf-8") as f:
            sources_list = json.load(f)

    with PdfPages(str(out)) as pdf:
        # Page 1: Clinical & Mission Summary + Trend Charts
        fig = plt.figure(figsize=(8.5, 11.0), dpi=150)
        fig.patch.set_facecolor("white")

        fig.text(
            0.06,
            0.955,
            "BOOPS — Flight-Surgeon Mission Summary",
            fontsize=15,
            fontweight="bold",
            color="#111827",
        )
        fig.text(
            0.06,
            0.933,
            f"Crew: {astro.get('name', astronaut_id)} ({astronaut_id} · {astro.get('role', 'Crew')})  |  "
            f"Window: Mission Days {start_day}–{end_day}  |  Label: Simulated",
            fontsize=9.5,
            color="#374151",
        )
        fig.text(
            0.06,
            0.914,
            f"Sharing scope: daily_summary={'ON' if sharing['daily_summary'] else 'OFF'} · "
            f"raw_data={'ON' if sharing['raw_data'] else 'OFF'} · emergency_events=LOCKED ON",
            fontsize=8.5,
            color="#6B7280",
        )

        if sharing["daily_summary"] and days:
            ax1 = fig.add_axes([0.08, 0.70, 0.85, 0.18])
            ax1.plot(days, imm_vals, label="Immune risk", color="#DC2626", linewidth=1.8)
            ax1.plot(days, musc_vals, label="Bone & Muscle risk", color="#D97706", linewidth=1.6)
            ax1.plot(days, cardio_vals, label="Heart risk", color="#2563EB", linewidth=1.5)
            ax1.axhline(40, color="#9CA3AF", linestyle="--", linewidth=0.9, label="Watch (40)")
            ax1.axhline(70, color="#DC2626", linestyle=":", linewidth=0.9, label="Act (>70)")
            ax1.set_ylim(0, 102)
            ax1.set_ylabel("Risk score")
            ax1.set_title("Downstream Health Risk Trends (Personal Baseline)", fontsize=10, loc="left")
            ax1.legend(loc="upper left", fontsize=7.5, ncol=3, frameon=False)
            ax1.grid(alpha=0.2)

            ax2 = fig.add_axes([0.08, 0.49, 0.85, 0.16])
            ax2.plot(days, stress_vals, label="Stress score", color="#111827", linewidth=1.6)
            ax2.plot(days, sleep_vals, label="Sleep score", color="#16A34A", linewidth=1.6)
            ax2.set_ylim(0, 102)
            ax2.set_xlabel("Mission Day")
            ax2.set_ylabel("Score (0–100)")
            ax2.set_title("Daily Stress & Sleep Recovery Scores", fontsize=10, loc="left")
            ax2.legend(loc="upper left", fontsize=7.5, ncol=2, frameon=False)
            ax2.grid(alpha=0.2)
        else:
            fig.text(
                0.08,
                0.76,
                "Daily summary charts withheld by astronaut privacy toggle (daily_summary = OFF).",
                fontsize=10,
                color="#6B7280",
            )

        # Text summary blocks (Drivers, Actions, Data Quality, Emergency Events)
        y = 0.435
        if sharing["daily_summary"] and peak_imm:
            p_day = peak_imm["mission_day"]
            p_imm = peak_imm["risks"]["immune"]
            fig.text(
                0.06,
                y,
                f"Peak Risk Snapshot (Day {p_day}) — Immune: {p_imm['level'].upper()} ({p_imm['score']}/100)  |  "
                f"Early Warning Flag: {peak_imm['flags'].get('infection_early_warning', False)}",
                fontsize=9.5,
                fontweight="bold",
                color="#111827",
            )
            y -= 0.022
            for drv in p_imm.get("drivers", [])[:3]:
                stars = "★" * int(drv.get("evidence_stars", 1))
                fig.text(
                    0.075,
                    y,
                    f"• {drv['factor']} (z={drv['z']:+.2f}, w={drv['contribution']:.2f}) — {drv['chain']} [{stars}, {drv['source_id']}]",
                    fontsize=8.0,
                    color="#374151",
                )
                y -= 0.019

            y -= 0.010
            fig.text(0.06, y, "Top Ranked Recommended Actions:", fontsize=9.5, fontweight="bold", color="#111827")
            y -= 0.021
            for act in peak_imm.get("actions", [])[:3]:
                stars = "★" * int(act.get("evidence_stars", 1))
                fig.text(
                    0.075,
                    y,
                    f"{act['rank']}. {act['text']} [{stars} · {act['targets']}]",
                    fontsize=8.0,
                    color="#374151",
                )
                y -= 0.019

            y -= 0.010
            fig.text(
                0.06,
                y,
                f"Data-Quality Flagged Days ({len(dq_issues)} total in range):",
                fontsize=9.5,
                fontweight="bold",
                color="#111827",
            )
            y -= 0.020
            for item in dq_issues[:4]:
                reason_txt = "; ".join(item["data_quality"].get("reasons", []))[:88]
                fig.text(
                    0.075,
                    y,
                    f"• Day {item['mission_day']}: {item['data_quality']['status']} — {reason_txt}",
                    fontsize=8.0,
                    color="#374151",
                )
                y -= 0.018

        y -= 0.010
        fig.text(
            0.06,
            y,
            f"Emergency Events Log (Locked Always On — {len(data['emergency_events'])} events):",
            fontsize=9.5,
            fontweight="bold",
            color="#B91C1C",
        )
        y -= 0.020
        if data["emergency_events"]:
            for ev in data["emergency_events"][:4]:
                fig.text(
                    0.075,
                    y,
                    f"• Day {ev['mission_day']} [{ev['severity'].upper()}]: {ev['summary']}",
                    fontsize=8.0,
                    color="#7F1D1D",
                )
                y -= 0.018
        else:
            fig.text(0.075, y, "• No emergency events logged in selected window.", fontsize=8.0, color="#6B7280")

        fig.text(
            0.06,
            0.03,
            "BOOPS · Simulated · Prototype · Not a medical device · Offline Flight-Surgeon Summary (Page 1/2)",
            fontsize=8.0,
            color="#6B7280",
        )
        pdf.savefig(fig)
        plt.close(fig)

        # Page 2: Scientific Citations & Methodology / Limitations
        fig2 = plt.figure(figsize=(8.5, 11.0), dpi=150)
        fig2.patch.set_facecolor("white")
        fig2.text(0.06, 0.955, "BOOPS — Scientific Sources & Limitations", fontsize=14, fontweight="bold", color="#111827")
        fig2.text(
            0.06,
            0.928,
            "Methodology: Personal in-flight baseline (Days 1–14) + z-scores + evidence-graded causal chains + 4-step quality funnel.",
            fontsize=8.5,
            color="#374151",
        )
        fig2.text(
            0.06,
            0.908,
            "Limitations: Crew vitals are simulated for demo; solar storm curve uses NOAA SWPC / NASA OSDR RadLab shapes. Not a medical device.",
            fontsize=8.5,
            color="#374151",
        )

        y2 = 0.875
        fig2.text(0.06, y2, "Key Cited Sources (from knowledge/sources.json):", fontsize=10, fontweight="bold", color="#111827")
        y2 -= 0.022

        priority_ids = [
            "mehta2017",
            "crucian2018",
            "barger2014",
            "iss_saliva2020",
            "mishra2020",
            "wadhwa2024",
            "jacc2023",
            "ferrando2004",
            "nasa_radlab",
            "noaa_swpc",
        ]
        by_id = {s["id"]: s for s in sources_list}
        ordered_sources = [by_id[sid] for sid in priority_ids if sid in by_id] + [
            s for s in sources_list if s["id"] not in priority_ids
        ]

        for src in ordered_sources[:32]:
            if y2 < 0.07:
                break
            line = f"[{src['id']}] {src['title'][:85]} — {src['url'][:65]}"
            fig2.text(0.06, y2, line, fontsize=7.2, color="#374151")
            y2 -= 0.023

        fig2.text(
            0.06,
            0.03,
            "BOOPS · Simulated · Prototype · Not a medical device · Sources Page (Page 2/2)",
            fontsize=8.0,
            color="#6B7280",
        )
        pdf.savefig(fig2)
        plt.close(fig2)

    return out
