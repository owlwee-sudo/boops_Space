# BOOPS — Biobehavioral Observation & Offline Predictive System
NASA Space Apps Challenge 2026, team boops boops (a fish name). Health monitoring software for a space crew.

## UI

The desktop app lives in [`ui/`](ui). It's built with **Tauri**: a TypeScript + CSS frontend (Vite, no framework) and a Rust core.

```
ui/
├── index.html
├── public/boops-logo.svg
├── src/                      ← TypeScript + CSS
│   ├── main.ts               entry: loads fonts, tokens, mounts the app
│   ├── types.ts              data shapes shared with Rust
│   ├── app/                  page layout + refresh loop (App.ts, App.css)
│   ├── components/           one folder per component (.ts + .css)
│   │   ├── Sidebar/
│   │   ├── TopBar/
│   │   ├── CrewSelector/
│   │   ├── VitalCard/
│   │   ├── Sparkline/
│   │   ├── TrendChart/
│   │   ├── RadiationCard/
│   │   ├── SleepCard/
│   │   ├── AlertsPanel/
│   │   └── StatusBadge/
│   ├── lib/                  DOM helpers, icons, formatting, vital metadata
│   ├── services/             data source: Rust via Tauri, or browser simulator
│   └── styles/               tokens.css (design tokens) + base.css
└── src-tauri/                ← Rust
    ├── src/lib.rs            Tauri command `get_mission_snapshot`
    ├── src/vitals.rs         simulated crew vitals, radiation, sleep, alerts
    └── tauri.conf.json
```

Each component is a plain function that returns `{ el, update }` and imports its own stylesheet. Colours, type sizes and spacing come only from `src/styles/tokens.css`, so the same token names can be used as Figma variables.

### Run it

In a browser (no Rust needed; uses the TypeScript simulator):

```bash
cd ui && npm install && npm run dev
```

Then open http://localhost:1420.

As the desktop app (needs Rust, install it from https://rustup.rs):

```bash
cd ui && npm run app
```

Run the Rust tests (they check that Rust and the TypeScript simulator give the same numbers):

```bash
cd ui/src-tauri && cargo test
```

### Data

Readings are simulated, not real sensor data. Each value is a pure function of time (baseline + daily rhythm + small waves + noise), so the Rust core and `src/services/simulator.ts` stay in step. To use real data, replace `sample()` in `src-tauri/src/vitals.rs`.

---

## Offline Engine, Data Pipeline & Architecture (`engine/` + `/web`)

> **Disclaimer:** **Prototype · Not a medical device.** All sample telemetry is explicitly labeled **Simulated**. BOOPS provides **risk indicators** and **early warnings**, never diagnoses.

### Quick Start (100% Offline)

1. **Generate simulated mission telemetry, run the analysis + risk + data-quality pipeline, populate SQLite, export artifacts, and bundle `/web` data:**
   ```bash
   python engine/run_all.py
   ```
   *(Uses `pandas`, `numpy`, and `matplotlib`.)*
2. **Open the offline dashboard:**
   - Run the local server with SQLite persistence & camera access: `python engine/server.py`, then open `http://127.0.0.1:8000` (and `/camera/` or `/camera/?sim=steady` for the camera rPPG + facial-behaviour check), **or**
   - Open `web/index.html` directly in a browser (`file://`, localStorage fallback, zero server needed), **or**
   - Run the Vite / Tauri desktop frontend inside `ui/`: `cd ui && npm install && npm run dev`.
3. **Run verification tests & knowledge validation:**
   ```bash
   node tools/build-docs.mjs
   node --test hard/rppg/test_rppg_core.mjs hard/face/test_face_core.mjs
   pytest tests/ -v
   ```

### Pipeline Architecture
- **`engine/generate_mission.py`**: Deterministic (`SEED=42`) 180-day synthetic mission telemetry for 3 astronauts (`A1` Amara Okafor, `A2` Jun Park, `A3` Lena Fischer) producing `data/daily_records.csv` (540 rows × 20 contract columns, `source="simulated"`) and `data/events.json` (days 1–14 fluid-shift adaptation, EVAs on days 41 & 120, `A2` resistance-exercise skip on days 60–75, `A1` sleep deficit on days 88–94, Solar Particle Event on days 92–93, `A1` pre-symptomatic infection warning on days 95–96 before day 97–98 symptoms, and 3 planted sensor glitches).
- **`engine/analysis.py`**: Builds each astronaut's personal in-flight baseline (mean & SD from days 1–14, excluding `signal_quality < 0.5`), computes z-scores `z = (value - mean) / SD`, daily `stress_score` and `sleep_score` (`0–100`), and `infection_early_warning` (resting HR `>= 2 SD` above baseline for `>= 2` consecutive days not explained by recent EVA or hard exercise, per Mishra et al. 2020).
- **`engine/data_quality.py`**: 4-step **"device or astronaut?"** odd-reading funnel (`signal_quality` -> `plausibility` -> `cross-sensor agreement` -> `context + ask the human`) with safety rule `act_now` for dangerous corroborated values. Bad readings are marked (`check_device`), never deleted.
- **`engine/risk_engine.py`**: Models cross-system causal rules (`immune`, `musculoskeletal`, `cardio` scores `0–100`; levels `normal < 40`, `watch 40–70`, `act > 70`) with evidence star ratings (`⭐⭐⭐` human data, `⭐⭐` animal + some human, `⭐` hypothesis), adaptation dampening on days 1–14, stress × inactivity muscle-loss interaction, and ranked root-cause recommendations.
- **`engine/db.py` & `engine/export.py`**: Offline SQLite single source of truth (`data/mission.db`, 9 tables) plus JSON/CSV exports (`data/engine_output.json`, `data/daily_records.csv`) and 2-page `data/flight_surgeon_summary_A1.pdf` respecting **crew-first privacy** (`daily_summary` on by default, `raw_data` off by default, `emergency_events` locked always on).
- **`engine/server.py`**: Optional localhost-only (`127.0.0.1:8000`) HTTP server for `/web` + `/web/camera/` with SQLite write-back (`/api/log`, `/api/log_entries`, `/api/sharing`, `/api/emergency`).
- **`content/emergency_protocols.json` & `content/tool_guides.json`**: 6 offline emergency checklists (with crew responder/patient role handoff and timestamped steps) and 7 step-by-step instrument measurement guides.
- **`hard/` & `web/camera/` (ML & Sensor Modules H1–H4)**:
  - **H1 Camera rPPG (`/web/camera/`, `hard/rppg_reference.py`)**: 30-second webcam pulse check using POS (Wang et al. 2017) + vendored offline MediaPipe FaceLandmarker (`/web/vendor/mediapipe`). Saves into `ahm.log_entries` (`hrv_confidence: "low"`).
  - **H2 Facial Behaviour (`web/camera/face-behaviour-core.js`, `hard/face/stress_hook.py`)**: Opt-in 5-feature change-vs-baseline tracker (no emotion labels). Optional stress blend hook (`FACE_WEIGHT = 0.0` default, capped at `0.15`) in `engine/analysis.py`.
  - **H3 WESAD Stress Classifier (`hard/wesad/`, `web/models/wesad_stress_model.json`)**: Leave-one-subject-out validated logistic model (second opinion via `STRESS_MODEL = "rules" | "wesad"`, default `"rules"`).
  - **H4 Isolation Forest Anomaly Detector (`hard/anomaly/`)**: Unsupervised `point` vs `trend` vs `new` second opinion integrated into `engine/data_quality.py` and `engine/run_all.py` (never overrides safety `act_now`).

### Data Labels & Limitations
- **Simulated telemetry:** Because real day-by-day astronaut biometrics are private, all 540 crew-day records (`source="simulated"`) and demo emergency/clinical scenarios are simulated synthetic approximations.
- **Spaceflight reference sources:** Radiation storm morphology and dosimetry context follow public **NASA OSDR RadLab** and **NOAA SWPC GOES** proton flux references.
- **Not validated for flight medicine:** Thresholds (2 SD RHR, 40/70 risk cutoffs, unweighted/weighted rule coefficients) are transparent heuristic indicators for crew self-monitoring and ground triage, not clinical diagnostics.

### Core Scientific & Public Data Citations
Full bibliography (103 sources, 41 concepts, 83 evidence links) is maintained in `knowledge/sources.json` and `knowledge/sources.md`:
- `hazards` — NASA – 5 Hazards of Human Spaceflight (`https://www.nasa.gov/hrp/hazards`)
- `immrisk` — NASA Immune Risk page incl. Immune Risk DAG (`https://www.nasa.gov/directorates/esdmd/hhp/immune-risk/`)
- `mehta2017` — Mehta et al. 2017 – Latent virus reactivation in astronauts on the ISS, *npj Microgravity* (`https://pmc.ncbi.nlm.nih.gov/articles/PMC5445581`)
- `crucian2018` — Crucian et al. 2018 – Immune System Dysregulation During Spaceflight, *Frontiers in Immunology* (`https://frontiersin.org/journals/immunology/articles/10.3389/fimmu.2018.01437/full`)
- `barger2014` — Barger et al. 2014 – Prevalence of sleep deficiency and use of hypnotic drugs in astronauts, *The Lancet Neurology* (`https://pmc.ncbi.nlm.nih.gov/articles/PMC4188436`)
- `iss_saliva2020` — Salivary antimicrobial proteins & stress biomarkers on a 6-month ISS mission (`https://pmc.ncbi.nlm.nih.gov/articles/PMC7864226`)
- `mishra2020` — Mishra et al. 2020 – Pre-symptomatic detection of COVID-19 from smartwatch data, Stanford (`https://pmc.ncbi.nlm.nih.gov/articles/PMC7673274/`)
- `wadhwa2024` — Wadhwa et al. 2024 – Synergistic interplay between radiation and microgravity, *Immunity & Ageing* (`https://immunityageing.biomedcentral.com/articles/10.1186/s12979-024-00449-w`)
- `jacc2023` — Cardiac effects of long-duration spaceflight, *JACC* 2023 (`https://utsouthwestern.elsevierpure.com/en/publications/cardiac-effects-of-long-duration-space-flight`)
- `ferrando2004` — Ferrando et al. 2004 – Inactivity amplifies muscle catabolic response to cortisol, NASA NTRS (`https://ntrs.nasa.gov/citations/20040141797`)
- `nasa_radlab` — NASA OSDR RadLab Portal – Spaceflight Radiation Dosimetry (`https://visualization.osdr.nasa.gov/radlab/`)
- `noaa_swpc` — NOAA SWPC GOES Primary Integral Protons 1-Day Feed (`https://services.swpc.noaa.gov/json/goes/primary/integral-protons-1-day.json`)
