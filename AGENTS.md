# AGENTS.md: Project Context for Every Agent
*Read this first. Keep it up to date. It is the single source of truth for anyone (human or AI agent) working on this repo.*

---

## 1. Project in one paragraph
**BOOPS (Biobehavioral Observation & Offline Predictive System)** is our entry for the **NASA Space Apps Challenge 2026**, challenge *"Create Health Monitoring Software for Astronauts on Space Missions"* (event: 14–15 Nov 2026). It is an **offline, crew-first** app that turns daily wearable, sleep and environment data into **early warnings** for downstream health risks (**immune, bone & muscle, heart**), using each astronaut's **personal in-flight baseline**. It explains **why** each risk matters (evidence chains with ⭐ strength + sources), **how to fix** it (actions ranked by root cause), **how to use each instrument** (tool guides) and **what to do in an emergency** (offline protocols).

**The judges asked for:** (1) track health data, (2) what to do in an emergency, (3) explain how to use each tool, why it matters, and how to fix it.

**Our edge vs other teams:** most teams alert on single vitals. We model **how body systems affect each other** (e.g. stress + sleep loss + EVA → immune risk; stress × inactivity → amplified muscle loss), with **evidence grading**, **space-adaptation awareness** (fluid shift on days 1–14 is normal), and a **"device or astronaut?"** odd-reading checker.

---

## 2. Architecture
```
generate_mission.py ─► SQLite (data/mission.db) ◄─ Log forms (localStorage / optional local API)
                              │
        analysis.py (baseline, z-scores, stress & sleep scores, infection early warning)
                              │
        risk_engine.py (relationship rules + evidence weights → risks, drivers, actions)
        data_quality.py (device vs astronaut funnel)  ◄─ optional: Isolation Forest (H4)
                              │
        run_all.py ─► export ─► data/engine_output.json + data/daily_records.csv
                              │
        /web dashboard (offline static site, matches Figma) ◄─ camera rPPG + face (H1, H2)
```
- **No cloud, no runtime internet.** Offline is a core feature (Earth may be minutes away).
- **Rules + statistics for the core** (real astronaut day-by-day data isn't public). ML only where real data exists (WESAD) or where it's unsupervised.

---

## 3. Repo layout
```
/engine        Python: generate_mission.py, analysis.py, risk_engine.py, data_quality.py, db.py, run_all.py, export.py
/data          mission.db + exports (daily_records.csv, engine_output.json, events.json)
/knowledge     links.json (evidence links), nodes.json (concepts), sources.json (citations); see knowledge/README.md
               edit the JSON, then run `node tools/build-docs.mjs` (checks ids, regenerates relationships.md + sources.md)
               web/index.html = interactive relationship map (open in a browser)
/content       emergency_protocols.json, tool_guides.json
/web           static front-end (+ /web/vendor for offline MediaPipe files, /web/camera = camera check, H1)
/hard          compute-heavy features: rppg, face, wesad, anomaly (see hard-features-handoff.md)
/docs          research notes (astronaut-health-relationships.md), handoff files, pitch material
/tests         pytest checks
AGENTS.md      this file
CLAUDE.md      imports this file for Claude Code
```
Run everything: `python engine/run_all.py`, then open `/web`.
Camera check: `python3 -m http.server 8000 --directory web`, then open `http://localhost:8000/camera/` (add `?sim=steady` for a Simulated signal with no camera).
Tests for the hard features: `node --test hard/rppg/test_rppg_core.mjs hard/face/test_face_core.mjs` and `pytest tests/`. Python packages: `pip install -r hard/requirements.txt`.
WESAD stress model (needs the dataset, see `hard/wesad/README.md`): `python hard/wesad/train.py`.
Anomaly scores: `python hard/anomaly/run_anomaly.py --merge` after the pipeline (or `--fixture` for a demo).

---

## 4. Data contract (do NOT rename fields without updating this file + telling the team)

**`daily_records`** (one row per astronaut per mission day; CSV export and SQLite table):
```
astronaut_id, mission_day, date, rhr_bpm, hrv_rmssd_ms, sleep_hours, sleep_quality_1to5,
eda_mean_us, spo2_pct, sbp_mmhg, dbp_mmhg, temp_c, exercise_min, resistance_min,
radiation_msv, eva (0/1), symptoms (semicolon list), mood_1to5, signal_quality (0–1),
source ("simulated"|"wearable"|"manual"|"camera")
```

**`engine_output.json`** (one object per astronaut per day):
```
astronaut_id, mission_day, stress_score (0–100), sleep_score (0–100),
baseline{metric:{mean,sd}}, z{metric:value},
risks{immune|musculoskeletal|cardio:{level: normal|watch|act, score 0–100,
      drivers[{factor, z, contribution, chain, evidence_stars 1–3, source_id}]}},
actions[{rank, text, targets, evidence_stars}],
data_quality{status: ok|check_device|check_yourself|act_now, reasons[], suggested_step, anomaly_score? (0–1, ≥ 0.5 unusual), anomaly_kind? (point|trend|new)},
flags{infection_early_warning}, labels["Simulated"]
```

**Camera check log entry** (H1; appended to the `localStorage` list `ahm.log_entries`, see `web/camera/log-store.js`):
```
id, entry_type ("camera_check"), astronaut_id, timestamp, date, rhr_bpm, hrv_rmssd_ms (null if pulse not clean),
signal_quality (0–1), source ("camera"|"simulated"), hrv_confidence ("low"), method, duration_s,
quality_parts{snr,motion,face,light}, labels[],
opt-in only (H2): facial_change_z (null until 14 checks), facial_change_level (low|medium|high), facial_features{}, facial_baseline_sessions
```

**SQLite tables:** astronauts · daily_records · engine_outputs · risk_drivers · actions · log_entries · emergency_events · sharing_settings · sources
**db.py functions:** init_db, insert_daily_records, save_engine_output, get_day, export_json, export_csv

---

## 5. Key formulas & thresholds
- **Personal baseline** = mean & SD from in-flight days 1–14. **z = (value − mean) / SD.**
- **Immune risk** = weighted sum of drivers normalised to 0–1:
  stress (HRV z) 0.30 · sleep deficit 0.25 · EVA in last 3 days 0.15 · radiation z 0.10 · time in flight (day/180) 0.10 · resting-HR jump or symptoms 0.10
- **Levels:** < 40 Normal · 40–70 Watch · > 70 Act
- **Infection early warning:** resting HR ≥ 2 SD above baseline for ≥ 2 days, not explained by EVA or exercise (Mishra et al. 2020)
- **Evidence stars:** ⭐⭐⭐ human data · ⭐⭐ animal + some human · ⭐ hypothesis
- **Odd-reading funnel:** signal quality → plausibility (spike = device, trend = body) → cross-sensor agreement → context + ask the human. **Safety rule:** never delete readings; dangerous-if-real → act_now.

---

## 6. Demo story (planted in simulated data)
| Day(s) | Who | Event | The app should show |
|---|---|---|---|
| 1–14 | All | Adaptation (fluid shift) | Alerts dampened, "adaptation phase" |
| 41, 120 | A1 | EVA | Stress ↑ |
| 60–75 | A2 | Skips resistance exercise | Musculoskeletal risk ↑ |
| 88–94 | A1 | Bad sleep | Sleep score ↓, immune risk building |
| 92–93 | All | Solar particle event | Alert banner + shelter protocol |
| 95–96 | A1 | Infection, no symptoms yet | Resting-HR early warning **before** symptoms |
| 97–98 | A1 | Fatigue, sore throat, cold sore | Immune = Act, "Fix sleep first + saliva test" |
| 3 days | any | Sensor glitches | "Check device", not "Act" |

---

## 7. Conventions (everyone, every module)
- Label simulated data **"Simulated"**. Real data sources: **NASA OSDR RadLab**, **NOAA SWPC GOES**.
- Say **"risk indicator" / "early warning"**. Never "diagnose". Footer: **"Prototype · Not a medical device"**.
- **Crew-first privacy:** astronaut sees alerts first; sharing toggles (daily summary on/off, raw data off by default, emergency events always on).
- **No emotion labels from faces**; facial input is opt-in, on-device, low-weight.
- Python: simple, commented, beginner-readable; config values at the top of each file.
- Front-end: match Figma ("NASA Space App", page lo-fi): 1440×1024, 260 px sidebar with Health | Log, grayscale cards, dark pill buttons; **emergency screens = high-contrast red/white**.
- **Cite everything:** add every paper, dataset and library you use to `knowledge/sources.json`. Space Apps can remove awards for uncited resources.

---

## 8. Git workflow
- `main` must always run (`python engine/run_all.py` + open `/web`).
- Work on a branch: `feat/easy-<name>` or `feat/hard-<name>`. Open a PR to merge.
- **Stay in your lane:** don't rewrite another branch's module. Integrate through the documented hooks (config flags default **OFF**).
- Small commits with clear messages. Pull `main` before starting work.
- When you finish or block on something, **update the status table below** in the same PR.

---

## 9. Status board (update me!)
| Task | Owner / agent | Branch | Status |
|---|---|---|---|
| 1 Simulated mission data | Claude Code (easy) | feat/easy-data | ✅ done |
| 2 Analysis engine | Claude Code (easy) | feat/easy-analysis | ✅ done |
| 3 Risk + recommendation engine | Claude Code (easy) | feat/easy-risk | ✅ done |
| 4 Odd-reading checker | Claude Code (easy) | feat/easy-quality | ✅ done |
| 5 SQLite database | Claude Code (easy) | feat/easy-db | ✅ done |
| 6 Pipeline runner | Claude Code (easy) | feat/easy-pipeline | ✅ done |
| 7 Emergency + tool-guide content | Claude Code (easy) | feat/easy-content | ✅ done |
| 8 Front-end dashboard | Claude Code (easy) | feat/easy-web | ✅ done |
| 9 Export | Claude Code (easy) | feat/easy-export | ✅ done |
| 10 Tests + README | Claude Code (easy) | feat/easy-tests | ✅ done |
| H1 Camera rPPG (browser) | Fable 5.2 | feat/hard-rppg | ✅ integrated (simulated tests pass; team live webcam check optional in `hard/VALIDATION.md`) |
| H2 Facial-behaviour features | Fable 5.2 | feat/hard-face | ✅ integrated (`FACE_WEIGHT = 0.0` default hook wired in `engine/analysis.py`) |
| H3 WESAD stress classifier | Fable 5.2 | feat/hard-wesad | ✅ done (`STRESS_MODEL = "rules"` default hook wired in `engine/analysis.py`; 91.0% LOSO wrist) |
| H4 Isolation Forest anomalies | Fable 5.2 | feat/hard-anomaly | ✅ integrated (optional `anomaly_score`/`anomaly_kind` wired in `data_quality.py` & `run_all.py`) |
| H5 LSTM autoencoder (optional) | — | feat/hard-lstm | 💤 optional |
| Figma: risk detail, emergency, tool guides, settings | Design | — | 🛠 in progress |
| Android Health Connect + BLE GATT + Wi-Fi Direct + iOS HealthKit + CoreBluetooth + MultipeerConnectivity + Bridge UI | Coordinator + `android-native-engineer` + `ios-native-engineer` | main | ✅ done (Android 19 JVM tests + APK built; iOS 16 XCTests + device build succeeded; UI typecheck + `/web` + `dist-site` built) |

Status keys: ⏳ todo · 🛠 in progress · ✅ done · ⛔ blocked (add a note)

---

## 10. Decisions log (append, don't delete)
- 2026-11-14: Core = explainable rules + statistics, not trained models (no public astronaut day-by-day data).
- 2026-11-14: SQLite as the offline single source of truth; JSON/CSV are exports.
- 2026-11-14: HRV is the main stress signal; BP and SpO₂ are context only.
- 2026-11-14: Micro-expressions dropped; facial input = opt-in "change vs own baseline", no emotion labels.
- 2026-11-14: Camera rPPG runs in the browser for an offline live demo.
- 2026-11-14: Official project name set to BOOPS (Biobehavioral Observation & Offline Predictive System).
- 2026-11-14: Camera check uses POS (Wang 2017). Signal quality < 0.5 hides the number and asks for a retry. One badly failing part (face, motion, light, pulse) caps quality at 0.40.
- 2026-11-14: Facial input (H2): `FACE_WEIGHT` defaults to 0 and is capped at 0.15. Baseline = the person's first 14 camera checks. Simulated checks are stored apart from real ones. Output words are only low / medium / high.
- 2026-11-14: Isolation Forest (H4) only adds an opinion (`anomaly_score`, `anomaly_kind`). It never changes `data_quality.status` itself: the odd-reading checker and its safety rule stay in charge. Low signal quality outranks "trend"; an EVA day excuses a one-day spike.
- 2026-11-14: WESAD stress model is a second opinion only. `STRESS_MODEL` defaults to "rules": the lab model gives HRV almost no weight and its calibration does not transfer to daily data (`hard/wesad/REPORT.md` section 5).
- 2026-11-14: WESAD wrist HRV is motion noise during the stress task (checked against chest ECG). The app-facing "daily" model takes heart rate and RMSSD from ECG. Do not trust wrist HRV during activity.
- 2026-11-14: Camera HRV (RMSSD) is saved with `hrv_confidence: "low"` and must not feed the personal baseline or stress score: in simulation camera noise inflates it (`hard/VALIDATION.md`).
- 2026-11-15: Merged `feat/hard-face` (`H1`–`H4`) into `main`, wired optional integration hooks cleanly with safe defaults, and reconciled `/knowledge` (`41` concepts, `83` edges, `103` sources).
- 2026-11-15: Added native OS health, BLE GATT, and offline P2P crew sync across Android (`Health Connect`, `BluetoothGatt`, `WifiP2pManager` via `BoopsAndroid`) and Apple iOS (`HealthKit` incl. `HKHeartbeatSeriesQuery` RMSSD, `CoreBluetooth`, `MultipeerConnectivity` via `window.webkit.messageHandlers.boopsNative` / `BoopsApple`), plus desktop Chromium Web Bluetooth fallback and `DeviceHubModal` in `ui/` -> `/web`. Kept all external HTTP blocked (`403 Offline Mode` on Android, `boops-app://app` scheme on iOS) and cited all SDKs/specs in `/knowledge` (`41` concepts, `83` edges, `107` sources).

---

## 11. Key references (full list in knowledge/sources.json and docs/astronaut-health-relationships.md)
Crucian 2018 (immune dysregulation) · Mehta 2017 (virus reactivation) · Barger 2014 (astronaut sleep) · Mishra 2020 (smartwatch pre-symptomatic detection) · Wadhwa 2024 (radiation + microgravity) · WESAD (Schmidt 2018) · StressID (Chaptoukaev 2023) · NeuroKit2 (Makowski 2021) · POS (Wang 2017) · rPPG-Toolbox (Liu 2023) · MediaPipe Face Landmarker · Barrett 2019 (facial expressions ≠ emotions) · NASA OSDR RadLab · NOAA SWPC GOES
