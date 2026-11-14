"""demo_mission.py: a small SIMULATED mission table for testing the hard features.

This is a TEST FIXTURE, not the project's data generator (that is
engine/generate_mission.py on the easy track). It follows the data contract and
the demo story in AGENTS.md so the anomaly detector (H4) can be checked before
the real generator exists. All values are Simulated.

The planted events are returned separately and are used ONLY to check results,
never to train anything.
"""

import numpy as np
import pandas as pd

MISSION_DAYS = 180
ASTRONAUTS = ["A1", "A2", "A3"]

# One-day sensor glitches (device faults): (astronaut, day, what goes wrong)
GLITCHES = [
    ("A2", 30, {"rhr_bpm": lambda v: v * 2.0, "signal_quality": lambda v: 0.30}),  # motion artefact doubles the pulse
    ("A3", 55, {"temp_c": lambda v: 33.0, "signal_quality": lambda v: 0.40}),  # sensor lifted off the skin
    ("A1", 110, {"spo2_pct": lambda v: 84.0, "hrv_rmssd_ms": lambda v: v * 3.0, "signal_quality": lambda v: 0.25}),  # loose clip
]

EVENTS = {
    "glitches": [{"astronaut_id": a, "mission_day": d} for a, d, _ in GLITCHES],
    "infection": {"astronaut_id": "A1", "days": [95, 96, 97, 98]},
    "bad_sleep": {"astronaut_id": "A1", "days": list(range(88, 95))},
    "eva": {"astronaut_id": "A1", "days": [41, 120]},
    "recovery": {"astronaut_id": "A1", "days": [99, 100, 101]},
}


def make_mission(seed=7):
    rng = np.random.default_rng(seed)
    rows = []
    for k, astronaut in enumerate(ASTRONAUTS):
        base = {"rhr": 56 + 3 * k, "hrv": 58 - 5 * k, "sleep": 6.6, "temp": 36.6, "spo2": 97.6, "quality": 0.92}
        for day in range(1, MISSION_DAYS + 1):
            adapt = np.exp(-(day - 1) / 5.0)  # fluid shift fades over the first two weeks
            drift = day / MISSION_DAYS  # slow change over the mission
            row = {
                "astronaut_id": astronaut,
                "mission_day": day,
                "rhr_bpm": base["rhr"] + 4 * adapt + 2 * drift + rng.normal(0, 1.8),
                "hrv_rmssd_ms": base["hrv"] - 6 * adapt - 3 * drift + rng.normal(0, 5.0),
                "sleep_hours": base["sleep"] - 0.6 * adapt + rng.normal(0, 0.55),
                "temp_c": base["temp"] + rng.normal(0, 0.12),
                "spo2_pct": min(100.0, base["spo2"] + rng.normal(0, 0.6)),
                "signal_quality": float(np.clip(base["quality"] + rng.normal(0, 0.04), 0.6, 1.0)),
                "eva": 0,
                "symptoms": "",
                "source": "simulated",
            }
            if astronaut == "A1":
                if day in EVENTS["eva"]["days"]:
                    row["eva"] = 1
                    row["rhr_bpm"] += 5
                    row["hrv_rmssd_ms"] -= 9
                if day in EVENTS["bad_sleep"]["days"]:
                    row["sleep_hours"] = 4.3 + rng.normal(0, 0.3)
                    row["hrv_rmssd_ms"] -= 7
                if day in EVENTS["infection"]["days"]:
                    row["rhr_bpm"] += 7.5 + (1.5 if day >= 97 else 0)
                    row["hrv_rmssd_ms"] -= 13
                    row["temp_c"] += 0.25 if day < 97 else 0.8
                    if day >= 97:
                        row["symptoms"] = "fatigue;sore throat;cold sore"
                if day in EVENTS["recovery"]["days"]:
                    row["rhr_bpm"] += 3
                    row["hrv_rmssd_ms"] -= 5
            rows.append(row)
    table = pd.DataFrame(rows)
    for astronaut, day, changes in GLITCHES:
        at = (table["astronaut_id"] == astronaut) & (table["mission_day"] == day)
        for column, change in changes.items():
            table.loc[at, column] = change(float(table.loc[at, column].iloc[0]))
    return table, EVENTS


def normal_day_mask(table, events=EVENTS):
    """True for days with no planted event of any kind (for the false-alarm rate)."""
    special = {(g["astronaut_id"], g["mission_day"]) for g in events["glitches"]}
    for key in ["infection", "bad_sleep", "eva", "recovery"]:
        special |= {(events[key]["astronaut_id"], d) for d in events[key]["days"]}
    # The day after a one-day event still shows a jump back; leave it out too.
    special |= {(a, d + 1) for a, d in list(special)}
    keys = list(zip(table["astronaut_id"], table["mission_day"]))
    return np.array([k not in special for k in keys]) & (table["mission_day"].to_numpy() > 14)
