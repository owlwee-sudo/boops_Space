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
/pwa           web-version extras (manifest, service worker, icons), added only to dist-site/app/ by tools/build-site.mjs
/hard          compute-heavy features: rppg, face, wesad, anomaly (see hard-features-handoff.md)
/docs          research notes (astronaut-health-relationships.md), handoff files, pitch material
/tests         pytest checks
AGENTS.md      this file
CLAUDE.md      imports this file for Claude Code
```
Run everything: `python engine/run_all.py`, then open `/web`.
Hosted web version (PWA): `node tools/build-site.mjs` (needs the Android APK built), then `python3 -m http.server 8020 --directory dist-site` and open `http://localhost:8020/app/`. Plan: `docs/web-version-plan.md`.
Deploy to Cloudflare (`boops.owlwee.co`, Worker `boops`, config in `wrangler.jsonc`): `node tools/build-site.mjs`, then `npx wrangler login` (once) and `npx wrangler deploy`.
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
risks{immune|musculoskeletal|cardio:{level: normal|watch|act, score 0–100, adaptation_phase (bool, days 1–14),
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
| Welcome screen + Demo / My data mode + landing start pop-up | Claude Code (easy) | feat/easy-demo-welcome | ✅ done (web, `/app/`, APK, iOS and desktop builds checked; pytest not run, not installed) |
| Android Health Connect + BLE GATT + Wi-Fi Direct + iOS HealthKit + CoreBluetooth + MultipeerConnectivity + Bridge UI | Coordinator + `android-native-engineer` + `ios-native-engineer` | main | ✅ done (Android 19 JVM tests + APK built; iOS 16 XCTests + device build succeeded; UI typecheck + `/web` + `dist-site` built) |
| App header cleanup: no separate top bar (day stepper in page header, Sensors & Sync in sidebar) | Claude Code | claude/app-seamless-header | ✅ done (`ui` typecheck + offline `/web` build + APK built; Figma still to match) |
| Web version PWA at `/app/` (plan steps 1–2: hosting, manifest, service worker, offline/update notices) | Claude Code | claude/app-check-web-plan-d7958e | ✅ done (checked offline with the server stopped: dashboard, Emergency, camera check; update flow checked). Steps 3–6 in `docs/web-version-plan.md` ⏳ todo |
| Landing page (`site/` → `dist-site/`): clean redesign with real crew-app screens, 3D body-systems map, plain-language copy | Gemini → Claude Code | claude/landing-page-gemini-handover-daa8b6 | ✅ done (`node tools/build-site.mjs`; checked at 1440 / 390 px) |
| Landing copy matches `docs/submission-answers.md` (107 sources, iOS, ML wording, when to ask for help) | Claude Code | claude/landing-match-submission | ✅ done (`node tools/build-site.mjs`; quick-guide scope not applied, submission answers win) |
| Cloudflare deploy config (`wrangler.jsonc`: Worker `boops`, static `dist-site/`, custom domain `boops.owlwee.co`) | Claude Code | claude/cloudflare-deploy | ✅ done (`wrangler deploy --dry-run` passes; first real deploy still to run) |

| Fix plan Phase 0 (`docs/fix-plan/`): engine triage + NaN/inf safety, IEW day lookup, adaptation driver kept, emergency events kept, WESAD unpickler, "My data" Settings unlocked | Claude Code | claude/fix-plan-phase0 | ✅ done (pytest 63/63, node 18/18, `ui` typecheck + offline `/web` built; "My data" Settings not clicked through in a browser). Phases 1–3 ⏳ todo |
| Fix plan Phase 1 (`docs/fix-plan/03`): per-risk sharing in exports + Nearby, safe CSV/JSON, local API CSRF/bounds/no listings, Android WebView + backup + BLE bounds, iOS BLE/RMSSD bounds, Tauri CSP | Claude Code | claude/fix-plan-phase0 | 🛠 mostly done (pytest 88/88, Android JVM 20/20 + debug APK, iOS 18/18 XCTests, `ui` typecheck + `/web` built). Not done: Android/iOS Nearby peer authentication, iOS bridge `null`-origin carve-out, R8 minify, Tauri build not run (no Rust toolchain) |
| Fix plan Phase 2 (`docs/fix-plan/01,02,04`): Emergency deep links (`#screen=EmergencyFainting&id=…`), missing HRV shows "—", Mindfulness stress/mood saved apart, Sleep "Nothing" chip exclusive, device logs capped apart from crew logs, Units toggle converts dose/temp/mass, landing 3D map = A1 Day 97 + engine weights, landing/legal copy fixes, content thresholds aligned + `sources` on every protocol/guide, all knowledge links cited, evidence map generated from JSON (41/83/107, nervous-system toggle, no Google Fonts) | Claude Code | claude/fix-plan-phase0 | ✅ done (pytest 88/88, node 18/18, `ui` typecheck, `/web` + `dist-site` built; checked in browser: deep link, Units, "My data" Settings, Mindfulness save, evidence map). Not done: TS↔Python engine parity port, 8 duplicate source pairs (kept: merging changes the 107 count) |
| Fix plan Phase 3 (`docs/fix-plan/05` + PWA steps 3–4): muted text token #4b5563 (app, camera, landing, legal), >= 44 px tap areas on phone (stepper, rating circles, chips, buttons, close buttons, icon pads), toast clears the bottom nav, camera actions clear its bottom nav, z-index order, keyboard on emergency steps, Welcome focus trap + kept day + reduced motion, landing start dialog (panel, scroll, focus, focus ring), evidence map scrolls on phones, SW `/app/camera` + offline model message, `dist-site/_headers` (strict CSP for /app/*), camera inline scripts moved to `page-shell.js`, storage persist + JSON backup/restore in Settings | Claude Code | claude/fix-plan-phase0 | ✅ done (pytest 88/88, node 18/18, `ui` typecheck + `/web` + `ui/dist` + `dist-site` built; checked at 375 px: tap sizes, toast, camera, start dialog, evidence map). Not checked: offline reload with the server stopped (servers belong to other sessions), `/app` without a slash offline (outside the SW scope), APK/iOS/Tauri rebuilds |
| Mission-day calendar dropdown: tap the "Day N / 180 · date" readout in any page header to pick a day from a month grid (Watch/Act dots, keyboard, Esc/back closes) | Claude Code | claude/fix-plan-phase0 | ✅ done (`ui` typecheck + offline `/web` + `ui/dist` built; checked in the browser at desktop and phone width. APK / iOS / Tauri rebuilds not run) |
| Secondary pages match the landing theme (`docs/fix-plan/06`): shared `site/base.css` + same header/footer on Legal, evidence map and new 404 page; Legal rebuilt on `legal.css` (old `styles.css` deleted); evidence map light-only with Inter, ink accent and BOOPS header; `build-site.mjs` fails if header/footer links drift | Claude Code | claude/fix-plan-phase0 | ✅ done (`build-docs` + `build-site` + `wrangler deploy --dry-run` pass, node 18/18; checked at 1440 / 375 px incl. OS dark mode and map clicks. pytest not run, not installed; 404 on Cloudflare not checked until deploy) |
| Team & credits page (`site/team.html` → `/team.html`): 6 members from the team doc, credits for data, software, AI help and the challenge; "Team & credits" link in every site footer (checked by `build-site.mjs`) | Claude Code | claude/fix-plan-phase0 | ✅ done (`node tools/build-site.mjs` passes; checked at 1440 / 375 px. Member roles not added, not in the doc) |
| SEO + GEO for the public site: landing title/description/canonical, Open Graph + Twitter card (`site/assets/og-image.jpg`), JSON-LD (WebSite, SoftwareApplication, Dataset, FAQPage, Organization), visible "What is BOOPS?" FAQ answer, canonical + OG on Team, Legal and evidence map, `robots.txt`, `llms.txt`, generated `sitemap.xml`; `/app/` gets a description, camera page `noindex` | Claude Code | claude/fix-plan-phase0 | ✅ done (`build-docs` + `build-site` pass, incl. new SEO check; checked in the browser at 1440 px. Not checked live: Google Rich Results test and social previews need the deployed site) |

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
- 2026-11-15: Landing page uses flat colours only (no gradients), no emoji or arrow glyphs, plain-language copy. The isometric laptop was replaced by a dependency-free canvas 3D body-systems map (`site/systems3d.js`); immune line weights match section 5, heart and bone line weights are illustrative.
- 2026-11-15: Landing page redesigned (`site/index.html` + `site/home.css`; `legal.html` keeps `styles.css`, replaced 2026-11-16, see below). It shows real crew-app screens captured from `/web` (`site/assets/app/*.webp`, simulated data) instead of a live demo, and self-hosts Inter (OFL, credited on the Legal page).
- 2026-11-15: Web version = the same `/web` app hosted at `/app/` on the landing site as a static, offline-first PWA. No backend, no accounts: data stays in the browser. The service worker and manifest live in `/pwa` and are added only to `dist-site/app/`, so `web/` and the Android/iOS apps are unchanged. A new version waits until the user taps "Reload". MediaPipe (18 MB) is cached on first camera use, not on install.
- 2026-11-15: Crew App view has no separate top bar. The mission-day stepper sits on the right of each page title (`.boops-page-tools`, or inside the Log header actions), Sensors & Sync joins the sidebar actions, and the crew switcher stays in the sidebar Profile card. The top bar now only shows in Demo / Debug mode (scrubber + story jumps).
- 2026-11-15: First launch shows a welcome screen (`ui/src/components/Welcome.ts`) that asks: Try the demo (Simulated crew) or Start with my data. "My data" never shows simulated readings: health screens show an empty state with 14-day baseline progress until the engine can score personal readings; Log, Emergency and tool guides work as usual. Personal logs and context use separate storage keys (`*_mine`) so demo and real entries never mix. The landing page passes the choice as `/app/?data=demo|mine`; the APK cannot receive it, so the app asks on first open. Switch any time from **Data** in the sidebar. Mode helpers live in `ui/src/services/dataMode.ts`.
- 2026-11-15: Fix plan Phase 0. Odd-reading checker: a fever only counts as `act_now` up to 42 °C (above that = `check_device`); low SpO₂ with symptoms is `act_now` at any value; BP, HRV and SpO₂ > 100 % get plausibility bounds (SBP 50–260, DBP 30–180 and SBP > DBP, HRV 2–300 ms). `inf` is treated like NaN everywhere. Baseline SD has a floor per metric (RHR 1.5, HRV 2.0, sleep 0.4 h, temp 0.15 °C, radiation 0.05 mSv). The infection early warning looks up real mission days, so a missing day breaks the streak. Shelter action triggers on dose ≥ 1.5 mSv. Re-running the pipeline no longer deletes crew-logged emergency events. Effect on the demo: three borderline A1 immune days (62, 73, 167) move from Watch to Normal; the story table in section 6 is unchanged.
- 2026-11-15: Fix plan Phase 1. Each risk domain (immune, bone & muscle, heart) is exported or sent to Nearby crew only when its own "Share with mission control" toggle is on, or on an emergency day; "daily summary" now covers only stress, sleep, data quality, the early-warning flag and the top action. CSV cells that start with `= + - @` (not numbers) get a leading `'`. JSON is written with NaN/inf as `null`. The local API (`engine/server.py`) only accepts JSON POSTs from its own loopback origin, refuses `mission_day` outside 1–3650, hides `db_path` and directory listings. Bluetooth readings outside HR 25–240, SBP 50–260 / DBP 30–180 (SBP > DBP), temp 30–43 °C or RR 250–2500 ms are dropped on Android and iOS.
- 2026-11-15: Fix plan Phase 2. `knowledge/nodes.json` now holds each concept's map position (`web.x/y`) and `links.json` optional `web_bend`; `node tools/build-docs.mjs` writes the data block in `knowledge/web/index.html`, so the evidence map can no longer drift from the JSON. The map shows the core web by default and the nervous-system layer with `?layer=all`. Emergency protocols and tool guides carry a `sources` list (ids in `knowledge/sources.json`). Escalation SpO₂ threshold is 92 % in every protocol. The landing 3D map's line widths are the engine's own weights for all three outcomes.
- 2026-11-15: Fix plan Phase 3. Shared muted text colour is #4b5563 (was #6b7280, 4.4:1 on the grey page background). On touch screens (`pointer: coarse` or width <= 1023 px) every control is at least 44 x 44 px; small icon buttons get an invisible 44 px tap pad instead of a bigger look. `/app/*` is served with a strict Content-Security-Policy (no inline scripts, `connect-src 'self'`), so app pages must keep scripts in files. Settings has "Back up all local data (JSON)" / "Restore from backup"; restore accepts only `boops*` / `ahm.*` keys with string values.
- 2026-11-15: When `docs/quick-guide.md` (older stress-and-sleep plan) and `docs/submission-answers.md` disagree, the submission answers win, because they match the built app. The landing page follows them.
- 2026-11-15: The landing site deploys as its own static-assets Worker `boops` on the custom domain `boops.owlwee.co`, separate from the `owlwee-co` portfolio Worker. No Worker script: everything in `dist-site/` is served as files.
- 2026-11-16: Every site page outside `/app/` (landing, Legal, Team, 404) links `site/base.css` (tokens, Inter, nav, buttons, footer) and uses the landing header and footer markup; `tools/build-site.mjs` fails the build if their nav or footer links differ. `site/styles.css` (lime/emerald "Cosmos" theme) is deleted. The evidence map copies the same tokens inline (it must still open alone from `knowledge/web/`), is light only like the rest of the site, and keeps its node category colours because they carry meaning. Missing paths get `site/404.html` (`not_found_handling: "404-page"` in `wrangler.jsonc`).
- 2026-11-17: SEO/GEO. Canonical URLs use Cloudflare's final paths (`/team`, `/legal`, not `.html`). `tools/build-site.mjs` writes `sitemap.xml` and fails the build if a sitemap page lacks a title, a 50+ character description, a matching canonical, an `og:image` (except `/app/`), or has JSON-LD that does not parse. The FAQ JSON-LD on the landing page must match the visible FAQ word for word in meaning; `site/llms.txt` is a plain summary for AI assistants and must follow section 5's numbers. No ratings or reviews in structured data (we have none).

---

## 11. Key references (full list in knowledge/sources.json and docs/astronaut-health-relationships.md)
Crucian 2018 (immune dysregulation) · Mehta 2017 (virus reactivation) · Barger 2014 (astronaut sleep) · Mishra 2020 (smartwatch pre-symptomatic detection) · Wadhwa 2024 (radiation + microgravity) · WESAD (Schmidt 2018) · StressID (Chaptoukaev 2023) · NeuroKit2 (Makowski 2021) · POS (Wang 2017) · rPPG-Toolbox (Liu 2023) · MediaPipe Face Landmarker · Barrett 2019 (facial expressions ≠ emotions) · NASA OSDR RadLab · NOAA SWPC GOES
