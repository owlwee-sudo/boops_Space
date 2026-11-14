# Claude Code Handoff — Astronaut Health Monitor (Easy Features)
*NASA Space Apps Challenge 2026 · "Create Health Monitoring Software for Astronauts on Space Missions"*

> Paste this whole file into Claude Code (or save it as `CLAUDE.md` at the repo root). Build tasks **in order**. Every task here is **low compute**: runs on any laptop, no GPU, no model training.

---

## 1. What we're building (read first)

An **offline** health-monitoring app for astronauts. It turns daily wearable, sleep and environment data into **early warnings** for downstream health risks (immune, bone & muscle, heart), and explains:
- **Why it matters**: evidence chains with ⭐ evidence strength + sources
- **How to fix it**: actions ranked by root cause
- **How to use each instrument**: tool guides
- **What to do in an emergency**: offline protocols

**Core principles**
- Use each astronaut's **personal in-flight baseline** (days 1–14), never Earth norms.
- Use **explainable rules + statistics, not trained models.** Real day-by-day astronaut data isn't public, so training on simulated data would only learn our own simulation.
- **Offline-first**: no cloud calls at runtime.
- **Crew-first privacy**: the astronaut sees alerts first and chooses what goes to mission control.
- Label all sample data **"Simulated"**. Say "risk indicator" / "early warning", never "diagnose". Footer: "Prototype · Not a medical device".

---

## 2. Tech stack & repo layout

- **Python 3.11** (pandas, numpy; optional neurokit2) for data + engines
- **Static web front-end** (simplest option that works offline: plain HTML/CSS/JS + Chart.js, or Vite + React). No backend server. It reads the JSON files.

```
/data              generated CSV/JSON (daily_records.csv, engine_output.json, events.json)
/knowledge         links.json, sources.json
/content           emergency_protocols.json, tool_guides.json
/engine            generate_mission.py, analysis.py, risk_engine.py, data_quality.py, run_all.py, export.py
/web               front-end
/tests             simple pytest checks
README.md          setup, run steps, data sources, limitations
```
`python engine/run_all.py` must regenerate every file in `/data` from scratch.

---

## 3. Shared data contract (do NOT rename fields)

**`data/daily_records.csv`** (one row per astronaut per mission day):
```
astronaut_id, mission_day, date, rhr_bpm, hrv_rmssd_ms, sleep_hours, sleep_quality_1to5,
eda_mean_us, spo2_pct, sbp_mmhg, dbp_mmhg, temp_c, exercise_min, resistance_min,
radiation_msv, eva (0/1), symptoms (semicolon list), mood_1to5, signal_quality (0–1),
source ("simulated"|"wearable"|"manual"|"camera")
```

**`data/engine_output.json`** (list of objects, one per astronaut per day):
```json
{
  "astronaut_id": "A1", "mission_day": 96,
  "stress_score": 0, "sleep_score": 0,
  "baseline": {"hrv_rmssd_ms": {"mean": 50, "sd": 5}},
  "z": {"hrv_rmssd_ms": -2.0, "rhr_bpm": 2.5, "sleep_hours": -3.0},
  "risks": {
    "immune": {"level": "normal|watch|act", "score": 0,
      "drivers": [{"factor": "sleep", "z": -3.0, "contribution": 0.25,
                   "chain": "Sleep ↓ → cortisol ↑ → T cells ↓ → virus reactivation",
                   "evidence_stars": 3, "source_id": "barger2014"}]},
    "musculoskeletal": {"level": "normal", "score": 0, "drivers": []},
    "cardio": {"level": "normal", "score": 0, "drivers": []}
  },
  "actions": [{"rank": 1, "text": "Fix sleep first: target 7 h tonight", "targets": "sleep", "evidence_stars": 3}],
  "data_quality": {"status": "ok|check_device|check_yourself|act_now", "reasons": [], "suggested_step": ""},
  "flags": {"infection_early_warning": false},
  "labels": ["Simulated"]
}
```
