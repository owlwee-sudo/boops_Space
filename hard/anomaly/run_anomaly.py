"""run_anomaly.py: score a whole mission with the Isolation Forest detector (H4).

    python hard/anomaly/run_anomaly.py                      reads data/daily_records.csv
    python hard/anomaly/run_anomaly.py --merge              ...and adds data_quality.anomaly_score
                                                            to data/engine_output.json
    python hard/anomaly/run_anomaly.py --fixture            demo on the simulated test fixture

Writes data/anomaly_scores.json (one object per astronaut per day). The merge
is OFF unless --merge is given, so the easy pipeline is never changed by accident.
"""

import argparse
import json
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from hard.anomaly.anomaly import ANOMALY_AT, score_mission  # noqa: E402

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
DAILY_CSV = ROOT / "data" / "daily_records.csv"
ENGINE_OUTPUT = ROOT / "data" / "engine_output.json"
SCORES_JSON = ROOT / "data" / "anomaly_scores.json"


def to_records(scores):
    """Scores table -> list of plain dicts for JSON."""
    records = []
    for row in scores.itertuples():
        records.append({
            "astronaut_id": row.astronaut_id,
            "mission_day": int(row.mission_day),
            "anomaly_score": float(row.anomaly_score),
            "is_anomaly": bool(row.is_anomaly),
            "point_vs_trend": row.point_vs_trend,
            "suggested_status": row.suggested_status,
            "reason": row.reason,
            "top_factors": row.top_factors,
        })
    return records


def merge_into_engine_output(records, path=ENGINE_OUTPUT):
    """Add data_quality.anomaly_score (and anomaly_kind) to each matching day.

    Only ADDS two optional fields. It never changes status, reasons or any
    reading: the odd-reading checker (F4) stays in charge of those.
    Returns how many day objects were updated.
    """
    days = json.loads(Path(path).read_text())
    by_key = {(r["astronaut_id"], r["mission_day"]): r for r in records}
    updated = 0
    for day in days:
        record = by_key.get((day.get("astronaut_id"), day.get("mission_day")))
        if record is None:
            continue
        quality = day.setdefault("data_quality", {})
        quality["anomaly_score"] = record["anomaly_score"]
        quality["anomaly_kind"] = record["point_vs_trend"]
        updated += 1
    Path(path).write_text(json.dumps(days, indent=2) + "\n")
    return updated


def main():
    parser = argparse.ArgumentParser(description="Isolation Forest anomaly scores for the mission")
    parser.add_argument("--csv", default=str(DAILY_CSV), help="daily_records CSV (data contract in AGENTS.md)")
    parser.add_argument("--out", default=str(SCORES_JSON))
    parser.add_argument("--merge", action="store_true", help="also add anomaly_score to data/engine_output.json")
    parser.add_argument("--fixture", action="store_true", help="use the simulated test fixture and only print")
    args = parser.parse_args()

    if args.fixture:
        from tests.fixtures.demo_mission import make_mission

        table, _ = make_mission()
        print("Using the SIMULATED test fixture (tests/fixtures/demo_mission.py). Nothing is written.")
    else:
        if not Path(args.csv).exists():
            sys.exit(f"{args.csv} not found. Run the pipeline first (python engine/run_all.py), or try --fixture.")
        table = pd.read_csv(args.csv)

    scores = score_mission(table)
    flagged = scores[scores["anomaly_score"] >= ANOMALY_AT]
    flagged = flagged[flagged["is_anomaly"]]
    print(f"{len(scores)} days scored, {len(flagged)} unusual:")
    print(flagged[["astronaut_id", "mission_day", "anomaly_score", "point_vs_trend", "suggested_status", "top_factors"]].to_string(index=False))

    if args.fixture:
        return
    records = to_records(scores)
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(records, indent=2) + "\n")
    print(f"Wrote {args.out}")
    if args.merge:
        if not ENGINE_OUTPUT.exists():
            sys.exit(f"{ENGINE_OUTPUT} not found: nothing to merge into.")
        print(f"Added anomaly_score to {merge_into_engine_output(records)} days in {ENGINE_OUTPUT}")


if __name__ == "__main__":
    main()
