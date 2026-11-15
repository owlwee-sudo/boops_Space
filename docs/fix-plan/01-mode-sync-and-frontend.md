# Plan 01 — `"My data"` Isolation, Frontend Logic, Log Forms & PWA Sync

**Scope:** `ui/src/services/dataMode.ts`, `ui/src/services/boopsData.ts`, `ui/src/components/Welcome.ts`, `ui/src/app/installBoopsRuntime.ts`, `ui/src/app/bindEngineData.ts`, `ui/src/app/App.ts`, `ui/src/components/BoopsOverlays.ts`, `pwa/`, `web/camera/`.

---

## 1. Fix `"My data"` Unreachability & Demo Leakage (`CRITICAL`)

### 1.1 Unblock `SettingsProfile` in `"My data"` mode
- **Problem:** `applyPersonalModeScreen` ([bindEngineData.ts:3594-3597, 3651-3683](../../ui/src/app/bindEngineData.ts#L3594-L3683)) only exempts `Log*`, `*Guide*`, and `Emergency*`, replacing `SettingsProfile` with `mountEmptyState(...)`. Users cannot access sharing toggles, units, Nearby Crew Sync, or recalibration.
- **Fix:**
  - Exempt `screenId === "SettingsProfile"` in `applyPersonalModeScreen` and hydrate user name/role/mission-start-date/sharing/units/DeviceHub controls normally (while gating Demo-only crew controls with `dataMode === "mine"`).

### 1.2 Unlock personal Health analytics (do not freeze forever at 14+ days)
- **Problem:** `forMode` ([installBoopsRuntime.ts:79-80](../../ui/src/app/installBoopsRuntime.ts#L79-L80)) clears `engineOutput`, `dailyRecords`, and `events` unconditionally in `"mine"` mode, and `applyPersonalModeScreen` ignores `loggedDays >= 14`, leaving `HealthHome`, `Detail*`, Export preview, and sidebar **Readings** ([BoopsOverlays.ts:176](../../ui/src/components/BoopsOverlays.ts#L176)) empty/no-op forever even with 15+ logged days.
- **Fix:**
  - Port deterministic personal-baseline (`days 1–14`) and pure-TS scoring (`analysis` + `risk_engine` + `data_quality` rules) into `ui/src/services/boopsData.ts` (shared pure helper matching Python, see Plan 02), computing `dailyRecords` & `engineOutput` directly from the personal mode's own logs/sensor syncs.
  - While `loggedDays < 14`, show clear baseline-collection progress (`X / 14 days`) alongside available raw readings while withholding baseline-deviation risk claims until calibrated (or show an explicit personal raw summary).
  - On sidebar **Readings** (`showReadingsStatus`), replace silent `if (!engine) return` with an explicit status toast when personal baseline is still collecting data.

### 1.3 Isolate ALL localStorage & session keys across Demo ↔ `"My data"`
- **Problem:** Only `context` and `manual_logs` use `modeKey()` ([boopsData.ts:229-475](../../ui/src/services/boopsData.ts#L229-L475)). Leaked globals:
  - `sharing_settings` (`raw_data=true` in Demo carries into Mine).
  - `user_settings`, `checklist_*`, `emergency_events`.
  - `ahm.log_entries` (`web/camera/log-store.js` shared between Demo and Mine; `loadManualLogs()` always pulls it into `"A1"`).
  - `ahm.current_astronaut`, `ahm.face_optin`, and `dataMode.ts:97-98` parsing wrong-type `"null"` into `null` instead of `{}` (`checklist_*` & profile).
- **Fix:**
  - Apply `modeKey()` (plus profile/`"self"` prefix in Mine mode) consistently across `save/loadSharingSettings`, `save/loadUserSettings`, `load/toggleChecklistTimestamp`, `append/loadEmergencyEvents`, and `ahm.log_entries` / `ahm.face_optin` (tag each camera entry with `data_mode: "demo" | "mine"` and filter by active mode).
  - Harden JSON loaders (`typeof v === "object" && v !== null && !Array.isArray(v)`) so corrupt or `"null"` storage returns safe defaults.
  - Replace hardcoded `astronautId: "A1"` / `"Amara Okafor"` fallbacks in `"mine"` mode:
    - Read personal name/role from `loadPersonalProfile()` in `EmergencyHub`, `"Call mission control"` toast ([App.ts:217](../../ui/src/app/App.ts#L217)), log badges (`Self` / profile callsign instead of `Field 1: A1`), and `web/camera/index.html` sidebar.
    - Hide A1/A2/A3 demo crew cards on `EmergencyHub` / `EmergencyFainting` in `"mine"` mode (show the active local user's card plus optional paired Nearby peers only).
  - On `LogVitals`, `LogSleep`, and `LogNutrition` (`bindEngineData.ts:2630-2643`), remove static Figma `Day 42 / Day 41 / Day 40` `.Log entry` placeholders whenever `state.dataMode === "mine"`, showing `"No logged entries for this category yet"` when `ordered.length === 0`.
  - Strip `"Simulated"` / `"Day 43"` demo pills on Guide screens when `state.dataMode === "mine"` (`bindEngineData.ts:3651-3656` must still run demo-label cleanup).

---

## 2. Fix Onboarding (`Welcome.ts`), Camera & Routing Bugs (`HIGH`)

### 2.1 `?data=mine` mode race, Day-1 overwrite & focus trap
- **Location:** [installBoopsRuntime.ts:47-76](../../ui/src/app/installBoopsRuntime.ts#L47-L76), [Welcome.ts:57, 88-91, 225-232](../../ui/src/components/Welcome.ts#L225-L232)
- **Fixes:**
  1. When `?data=mine` arrives on first visit (or without a profile), do not leave `renderedMode = "demo"` active if user dismisses `X` after requesting `mine`; either prevent closing `X` until mode choice completes or commit `"mine"` + prompt profile before mounting Health cards.
  2. Preserve existing query params (such as `?mode=debug`) inside `applyModeChoice` ([installBoopsRuntime.ts:67](../../ui/src/app/installBoopsRuntime.ts#L67)) instead of wiping them with `pathname + hash`.
  3. Populate `#boops-welcome-day` from `existing ? String(personalMissionDayToday(existing)) : "1"` instead of always hardcoding `"1"`.
  4. Trap `Tab`/`Shift+Tab` inside `.boops-welcome-card` and restore focus on close (`role="dialog"` / `aria-modal="true"`).

### 2.2 Emergency protocol deep-linking (`#screen=EmergencyFainting` bug)
- **Problem:** `activeEmergencyId` initializes to `"solar_radiation_storm"` ([installBoopsRuntime.ts:92](../../ui/src/app/installBoopsRuntime.ts#L92)), so [bindEngineData.ts:3272-3274](../../ui/src/app/bindEngineData.ts#L3272-L3274) ignores `#screen=EmergencyFainting` on load/reload.
- **Fix:** Initialize `activeEmergencyId = ""` (set dynamically only on explicit click from `EmergencyHub`; on `EmergencySolarRadiationStorm` default to `solar_radiation_storm`, and on `EmergencyFainting` use `activeEmergencyId || "fainting_dizziness"`). Support hash parameter `#screen=EmergencyFainting&id=<protocol_id>` for all 6 protocols.

### 2.3 Null HRV `"0 ms"` display & form/camera bugs
- **Null HRV bug:** [bindEngineData.ts:1246-1248](../../ui/src/app/bindEngineData.ts#L1246-L1248) (and Home/Vitals cards at `L808, L1735`) call `Math.round(record.hrv_rmssd_ms)` when `hrv_rmssd_ms === null`, rendering `0 ms` (e.g., `A3` Day 110). Guard with `record.hrv_rmssd_ms == null ? "—" : ...` and show `"Signal unavailable"`.
- **`LogMindfulness` dual-scale collision:** `LogMindfulness.ts` renders two 1–5 scales (`Stress level right now` and `Mood today`) both matching `[data-name="Options"] > div`. Assign explicit `data-boops-field="stress_right_now"` vs `"mood_today"` selectors in `bindEngineData.ts:2598-2613, 2718-2723` so selecting `Stress=5, Mood=1` saves `mood_1to5 = 1`.
- **Form validation & conflicting selections:** Prevent empty submission on `LogMindfulness`; make `"Nothing"` mutually exclusive with noise/temperature/schedule chips on `LogSleep`; add gentle clinical plausibility warnings/min-max bounds on `LogVitals`.
- **BLE 60-entry eviction of manual logs (`boopsData.ts:496-523`):** Separate storage/caps for high-frequency `ingestBleReading` telemetry (`boops.ble_logs`) vs manual crew logs (`boops.manual_logs`) so 65 BLE packets cannot evict a crew member's manual sleep/vitals entry.
- **`Units` toggle (`bindEngineData.ts:2999-3013`):** Implement shared unit formatters (`formatTemp`, `formatRadiation`, `formatWeight`, `formatFluid`) used across Health/Detail/Log cards so switching to `imperial` actually converts `°C → °F`, `mSv → rem`, `kg → lb`.
- **Camera `?sim=steady` contradiction & startup hang (`web/camera/`):**
  - When `?sim=steady` is active, disable `"Save to log"` (or store strictly under a `"simulated"` demo bucket never merged into `"My data"` `loadManualLogs()`), matching the banner copy.
  - Add a 10s `getUserMedia` / MediaPipe initialization timeout in `web/camera/` with a clear retry / permission-denied recovery state instead of hanging indefinitely on `"Starting camera..."`.

---

## 3. Finish PWA Plan Steps 3–6 (`pwa/` & `docs/web-version-plan.md`)

- **SW offline routing bugs ([pwa/sw.js:65-82](../../pwa/sw.js#L65-L82)):**
  - Ensure `/app` (no trailing slash) and `/app/camera` (no trailing slash) work cleanly offline: avoid falling back `/app/camera` redirects to `/app/` dashboard; normalize `camera` → `camera/` in `shellKey`, and wrap `vendorFirst` (`L95-100`) in `try/catch` for clean offline error responses.
- **Security/capability headers (`dist-site/_headers`):** Generate Cloudflare `_headers` in `tools/build-site.mjs` with strict offline CSP (`default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; img-src 'self' data: blob:`), `Permissions-Policy: camera=(self)`, and `X-Content-Type-Options: nosniff`.
- **Persistence & Backup/Restore (PWA Plan Step 4):** Request `navigator.storage.persist?.()` on personal-mode/PWA launch; add "Back up all local data (JSON)" and "Restore from backup JSON" (schema-validated) in `Export` / `SettingsProfile`.
- **Browser Capability Messaging (PWA Plan Step 3):** Detect unsupported Web Bluetooth in Safari/Firefox (`DeviceHubModal.ts`) and hide/disable Bluetooth scan cleanly with explanation; surface explicit message for native-only Health Connect / HealthKit on web.

---

## 4. Verification for Track 01

- [ ] Unit test `dataMode.ts` & `boopsData.ts` (Demo ↔ Mine isolation across every storage key, `"null"` corruption recovery, `65` BLE packets preserving manual sleep logs, `LogMindfulness` independent stress/mood, `hrv_rmssd_ms: null` rendering `—` not `0 ms`).
- [ ] Headless browser E2E: `?data=mine` onboarding → log 15 days → `SettingsProfile` accessible, `EmergencyHub` hides crew A1/A2/A3 demo buttons, `#screen=EmergencyFainting` opens Fainting protocol, `LogVitals/Sleep/Nutrition` show no Day 40–42 static cards.
- [ ] Offline SW test: stop server and navigate to `/app/`, `/app/?data=mine`, `/app/camera/`, `/app/camera` (no slash) without serving wrong routes.
