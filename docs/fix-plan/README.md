# BOOPS Remediation Plan (Master Index)

*Drafted 2026-11-15 against `HEAD` `eed40d0` (`claude/landing-match-submission`), covering every finding from the read-only 10× stress test.*

---

## 0. Current Baseline Status (`eed40d0`)

| Check | Baseline Result | Blocking Issues Found |
|---|---|---|
| `git status -s` | Clean working tree | None |
| `cd ui && npm run typecheck` | Pass (`tsc --noEmit` exit `0`) | Needs parity/runtime/accessibility fixes below |
| `node --test hard/rppg/test_rppg_core.mjs hard/face/test_face_core.mjs` | 18 / 18 passed | Adversarial 30 bpm quantized aliasing (`60.1 bpm` passes quality gate) & `pose.size = 0` NaN not covered by unit tests |
| `uvx --offline --with-requirements hard/requirements.txt pytest -v -rA tests/` | **33 passed, 1 failed** (`exit 1`) | `tests/test_wesad_model.py::test_unpickler_blocks_code_execution` fails on `numpy._core.numeric._frombuffer` in `hard/wesad/prepare.py:93` |
| `xcodebuild test` (`BOOPSTests`, iOS Simulator) | 16 / 16 passed | Missing GATT/HealthKit/Multipeer security & physiological range guards |
| Android Gradle / Tauri Cargo | Not executed in audit (`java` absent on host) | Audit based on source inspection (`android/`, `ui/src-tauri/`) |
| Local static previews (`dist-site/`, `web/`, `site/`) | `dist-site/` current on port `8012`; raw `site/` on `8011`/`8018`; `ui/dist/` stale (`13:47:48Z`); `knowledge/web/` & bundles stale | Bundle sources `103` vs `107`; Evidence Map `32/61/60` vs `41/83/107` |

---

## 1. Fix Plan Modules

| Doc | Scope | Suggested Branch | Depends On |
|---|---|---|---|
| [01-mode-sync-and-frontend.md](01-mode-sync-and-frontend.md) | `"My data"` isolation, Welcome flow, storage scoping, `Log*` forms, `Units` toggle, camera save rules, PWA service worker & offline completeness | `feat/fix-mode-sync-pwa` | Track 02 for TS↔Python engine parity |
| [02-engine-health-and-ml.md](02-engine-health-and-ml.md) | `engine/` (`data_quality.py`, `analysis.py`, `risk_engine.py`, `db.py`), `hard/` (`rppg`, `face`, `anomaly`, `wesad`), and TS↔Python clinical/scoring parity | `feat/fix-engine-ml` | Must land before rebuilding `data/` & `boops_bundle.json` |
| [03-security-privacy-and-native.md](03-security-privacy-and-native.md) | `risk_detail_share` export/P2P enforcement, CSV formula neutralization, `engine/server.py` CSRF/bounds/DoS, Android TCP P2P/WebView/BLE/sleep, iOS Multipeer/BLE/HealthKit, Tauri CSP | `feat/fix-security-native` | None (can run in parallel) |
| [04-landing-knowledge-and-content.md](04-landing-knowledge-and-content.md) | `site/index.html`, `site/legal.html`, `site/systems3d.js`, `#start-dialog` modal logic, `knowledge/` graph & citations sync, `content/` clinical contradictions & tool-guide routing | `feat/fix-content-knowledge` | Track 02 before regenerating final `dist-site/` & bundles |
| [05-ui-ux-accessibility-and-contrast.md](05-ui-ux-accessibility-and-contrast.md) | Responsive layout (`knowledge/web/`, `boops.css`, `camera.css`), mobile toast/bottom-nav occlusions, z-index tiers, `>= 44×44 px` touch targets, keyboard/focus traps, WCAG 2.1 AA contrast | `feat/fix-ui-a11y` | Track 04 `#start-dialog` markup tweak |

---

## 2. Priority Order (Phased Execution)

### Phase 0 — Clinical Safety & `"My data"` Blockers (Must Fix First)
1. **Unblock `"My data"` mode & stop Demo leakage** (Track 01): exempt `SettingsProfile` from empty-state lockout (`bindEngineData.ts:3651`), isolate `sharing_settings`, `user_settings`, `checklist_*`, `emergency_events`, `ahm.log_entries`, and active profile across Demo ↔ `"My data"`, remove static `Day 40–42` / `Amara Okafor` / `"Simulated"` leakage, and run client-side personal baseline/scoring or honest personal summary once logged readings accumulate.
2. **Fix `data_quality.py` Step 0 triage inversions & crashes** (Track 02): cap `temp_c <= 42.0` in Step 0 (`L120`), fix `spo2 < 70 && symptoms` downgrade (`L122,145`), enforce BP/HRV/`SpO2 > 100` plausibility, reject non-finite `inf`/`NaN` before propagation (`analysis.py:61`, `risk_engine.py:294,387`, `db.py:211`), and stop `save_engine_output` from deleting `emergency_events` (`db.py:242`).
3. **Fix `NumpyOnlyUnpickler` test failure** (Track 02): allow `("numpy._core.numeric", "_frombuffer")` in `hard/wesad/prepare.py:93`.

### Phase 1 — Privacy, Export & Transport Security
1. **Enforce `risk_detail_share` in exports & P2P** (Track 03): filter per-domain risk fields in `ui/src/services/boopsData.ts:1003-1079` and compose multi-section CSVs safely in `engine/export.py:120-194` and `boopsData.ts:1104-1118` (union headers + CSV formula prefix neutralization + RFC-8259 JSON).
2. **Harden local API & native P2P/WebView/BLE** (Track 03): add `Origin` / `Content-Type: application/json` / `mission_day` bounds checks to `engine/server.py`; authenticate & peer-bind Android TCP P2P (`NearbyCrewManager.kt`) and iOS Multipeer (`NearbyCrewManager.swift`); verify `https://` scheme and `ACTION_VIEW` allowlist in `MainActivity.kt`; add physiological bounds + RMSSD non-adjacent gap handling on Android/iOS BLE & HealthKit.

### Phase 2 — Clinical Accuracy, Feature Bugs & Knowledge/Content Sync
1. **Fix TS↔Python `recomputeEngineFromRecord` parity & form/routing bugs** (Tracks 01 & 02): fix `activeEmergencyId` overriding `#screen=EmergencyFainting` (`installBoopsRuntime.ts:92`, `bindEngineData.ts:3272`), `LogMindfulness` dual-scale collision, `BLE` 60-entry eviction of manual logs, Null HRV `"0 ms"` display, `Units` toggle, `infection_early_warning` day-index bug, and Days 1–14 `adaptation_phase` driver eviction.
2. **Reconcile Landing, 3D Map, Knowledge Graph & Content** (Track 04): fix `systems3d.js` Day 97 scores (`47`/`19`), `Radiation (SPE)` flag, and weights vs `risk_engine.py`; fix landing stats (`4.2 mSv`, `Days 95–96` IEW, `legal.html` journal/font/storage notes); resolve clinical threshold contradictions in `emergency_protocols.json` & `tool_guides.json`; align `knowledge/web/index.html` and `legal.html` counts + deduplicate citations.

### Phase 3 — UI/UX Polish, WCAG 2.1 AA Contrast, PWA Hardening & Rebuild
1. **Fix mobile occlusions, touch targets & WCAG contrast** (Track 05): fix `/knowledge/` mobile horizontal clipping (`min-width: 900px`), toast over bottom nav, mobile camera button occlusion, `#start-dialog` padding click & `overflow-y: auto`, keyboard handlers, `< 44×44 px` controls, and `< 4.5:1` color pairs.
2. **Finish PWA Steps 3–6 & Rebuild All Artifacts** (Tracks 01 & 04): fix `/app` & `/app/camera` SW offline routing, emit `dist-site/_headers`, add `navigator.storage.persist()` + JSON backup/restore, regenerate `engine/run_all.py` → `ui` (`npm run build` / offline `/web`) → `tools/build-docs.mjs` → `tools/build-site.mjs`, and purge stale local HTTP servers.

---

## 3. Global Release Verification Checklist

All items below must pass after the final edits on `main` (never report as full pass unless observed zero-failure on that build):

```bash
python engine/run_all.py
node tools/build-docs.mjs
cd ui && npm run typecheck && npm run build && cd ..
node tools/build-site.mjs
node --test hard/rppg/test_rppg_core.mjs hard/face/test_face_core.mjs
PYTHONDONTWRITEBYTECODE=1 uvx --offline --with-requirements hard/requirements.txt pytest -v -rA tests/
```

- [ ] Verify bundle counts: `boops_bundle.json` and `data_bundle.js` across `ui/public/data/`, `web/`, and `dist-site/app/` all report `107` (or exact reconciled count) sources.
- [ ] Verify single clean preview server on `dist-site/` (`8020` or chosen port) with zero broken links, working `/app/?data=mine` onboarding, `#screen=EmergencyFainting` deep-link, offline reload on `/app/`, `/app/camera/`, and `/knowledge/`.
- [ ] Re-run Android `./gradlew test` + `assembleDebug` and iOS `xcodebuild test` after native fixes.
- [ ] Re-run `tauri build` / verify desktop bundle if desktop ships in submission.
- [ ] Update status board and decisions log in [AGENTS.md](../../AGENTS.md).
