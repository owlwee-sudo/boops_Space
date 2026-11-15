# Plan 03 — Security, Crew-First Privacy, Export & Native Bridges

**Scope:** `ui/src/services/boopsData.ts`, `engine/export.py`, `engine/server.py`, `android/`, `ios/BOOPS/`, `ui/src-tauri/`.

---

## 1. Fix Privacy Toggle Enforcement & Export Serialization (`HIGH`)

### 1.1 Enforce `risk_detail_share` in UI exports & P2P summaries
- **Problem:** `bindEngineData.ts:1107-1136` lets crew toggle `sharing.risk_detail_share` (`{ immune, musculoskeletal, cardio }`), yet `buildExportPayload` ([boopsData.ts:1003-1079](../../ui/src/services/boopsData.ts#L1003-L1079)) — used for both Download/Print Export and `DeviceHubModal` Nearby Crew P2P — completely ignores `risk_detail_share`. When `daily_summary` is `true`, all 3 risk scores/levels export even when toggled OFF; when `daily_summary` is `false` and `immune` is `true`, nothing exports.
- **Fix:**
  - Include each day when `sharing.daily_summary || sharing.raw_data || anyRiskEnabled || isEmergencyDay`.
  - Gate `immune_*`, `musculoskeletal_*`, and `cardio_*` fields on their respective `risk_detail_share` flags (or `isEmergencyDay`), and gate summary metrics (`stress_score`, `sleep_score`, `top_action`, `data_quality_status`) on `sharing.daily_summary || isEmergencyDay`.

### 1.2 Fix heterogeneous CSV schema loss & formula injection
- **UI CSV (`ui/src/services/boopsData.ts:1104-1118`):**
  - *Header truncation bug:* `Object.keys(rows[0])` drops 11 summary/emergency keys whenever `rows[0]` is a raw-only row (`22` keys) and `rows[1]` is an emergency row (`33` keys). Compute headers as the **ordered union** of all keys across `rows`.
  - *Formula injection & `\r`:* Neutralize leading `=`, `+`, `-`, `@`, `\t`, `\r` (e.g., prefix `'`) and include `\r` inside the quoting regex alongside `"`, `,`, `\n`.
- **Python CSV & JSON (`engine/export.py:120-205`, `engine/db.py:260-266, 413-429`):**
  - Neutralize formula prefixes (`=`, `+`, `-`, `@`, `\t`, `\r`) in `db.export_csv` and `export.export_astronaut_range` CSV writers.
  - Fix `export_astronaut_range(..., fmt="csv")` dropping sections (`L147-194`): include all enabled sections (`raw_records`, `daily_summary`, `emergency_events` whenever present) instead of mutually exclusive `if/elif`.
  - Enforce RFC-8259 compliant JSON (`allow_nan=False` after recursive NaN/Inf → `None` normalization).

---

## 2. Harden Local HTTP API Server (`engine/server.py`, `HIGH`)

- **Location:** [engine/server.py:63-167](../../engine/server.py#L63-L167), [engine/db.py:458](../../engine/db.py#L458)
- **Fixes:**
  1. **Block Cross-Origin / Simple-Form CSRF:**
     - Require `Content-Type: application/json` on `POST` routes.
     - Validate `Origin`, `Referer`, and `Host` headers strictly against loopback (`127.0.0.1` / `localhost`) so cross-origin `text/plain` requests cannot mutate `/api/sharing`, `/api/log`, or `/api/emergency`.
  2. **Validate inputs & prevent handler crashes:**
     - Reject `NaN`/`Infinity` (`parse_constant` raising `ValueError` → `400`).
     - Validate `mission_day` is a strict `int` within `1..3650` (reject `bool`, negatives, and `OverflowError`-sized values like `10**30` with `400`).
  3. **Remove info leaks & socket resets:**
     - Remove `db_path` from `GET /api/health` (`server.py:98`).
     - Disable directory listings in `do_GET()`.
     - Drain or close cleanly on `> MAX_REQUEST_BYTES` and raise `ThreadingHTTPServer.request_queue_size` (from default `5` to `64`) with timeouts so 60-client concurrent bursts do not reset sockets.

---

## 3. Native P2P Authentication, WebView & Sensor Bounds (`HIGH`)

### 3.1 Android (`android/app/`)
- **Nearby P2P authentication & routing ([NearbyCrewManager.kt:312-498](../../android/app/src/main/kotlin/space/boops/crewhealth/NearbyCrewManager.kt#L312-L498)):**
  - *Bugs:* Plaintext TCP server on `0.0.0.0:48721`, no peer authentication, `flushPendingSend(client)` sends queued health JSON to *any* incoming client regardless of `pending.peerId`, `sendSummary` picks `activeSockets.firstOrNull` ignoring `targetPeerId`, trusts unverified `senderId`/`senderName`, allocates up to `2 MiB` frames with no socket timeout/connection cap, and registers `p2pReceiver` / `bluetoothStateReceiver` with `RECEIVER_EXPORTED`.
  - *Fix:* Add mutual pairing / TLS PSK or HMAC challenge before accepting sockets, map sockets strictly by verified `peerId`, never flush pending telemetry to unverified incoming sockets, enforce socket timeouts + concurrent connection limit, validate `senderId` matches authenticated peer, and change non-system receivers or drop unnecessary `RECEIVER_EXPORTED`.
- **WebView scheme checks & export race ([MainActivity.kt:195-308](../../android/app/src/main/kotlin/space/boops/crewhealth/MainActivity.kt#L195-L308)):**
  - Require `url.scheme == "https" && url.host == ASSET_HOST` on both `shouldInterceptRequest` and `shouldOverrideUrlLoading`.
  - Allowlist `ACTION_VIEW` intents (`https://` only) and replace single `pendingExportContent` with a thread-safe request queue.
- **Backup & release hardening ([AndroidManifest.xml:32,62](../../android/app/src/main/AndroidManifest.xml), `build.gradle.kts:56`):**
  - Set `android:allowBackup="false"` (or configure `dataExtractionRules`/`fullBackupContent` excluding WebView localStorage), remove unused `BLUETOOTH_ADVERTISE`, and enable R8 `isMinifyEnabled = true` on release builds.
- **BLE & Health Connect aggregation ([BoopsBridgePayloads.kt:153-283, 420-445](../../android/app/src/main/kotlin/space/boops/crewhealth/BoopsBridgePayloads.kt#L153-L283)):**
  - Enforce physiological bounds on HR (`25..240 bpm`), BP (`50..260` / `30..180` with `sbp > dbp`), SpO₂ (`50..100%`), Temp (`30..43 °C`).
  - Handle truncated HR energy-expended without dropping RR intervals; preserve beat adjacency inside `computeRmssdMs` so filtered outliers do **not** compute `valid[i] - valid[i-1]` across gaps.
  - Deduplicate overlapping `awakeSeconds` sleep intervals rather than summing `sleeps.sumOf { it.awakeSeconds }` over merged sleep duration.
  - Bound `discovered` BLE map size (`BleSensorManager.kt`) and require valid vital/device UUIDs or clear service filter.

### 3.2 iOS (`ios/BOOPS/`)
- **Multipeer pairing & privacy ([NearbyCrewManager.swift:62-124, 271-321](../../ios/BOOPS/Nearby/NearbyCrewManager.swift#L55-L325)):**
  - Require explicit user confirmation / PSK pairing via invitation `context` instead of `invitationHandler(true, session)` with `securityIdentity: nil`.
  - Avoid persisting static `space.boops.nearby.device_tag` (`UserDefaults`) and broadcasting plaintext `astronautId`; track peers by verified token rather than mutable `displayName`.
- **BLE & HealthKit math ([BleGattParsers.swift](../../ios/BOOPS/Bluetooth/BleGattParsers.swift), [HealthKitManager.swift](../../ios/BOOPS/Health/HealthKitManager.swift)):**
  - Add finite + physiological range guards to `BleGattParsers` (HR `25..240`, SpO₂ `50..100`, BP `50..260` / `30..180` & `sbp > dbp`, Temp `30..43 °C`, RR `250..2500 ms`).
  - Fix `HealthMetricsMath.computeRMSSD` to require `250..2500 ms` intervals, sort/reject unsorted `timeSinceStart` beats, deduplicate overlapping HealthKit workouts, query live `HKAuthorizationStatus` instead of `UserDefaults` timeout fallback, and align sleep/workout sort descriptors.
- **WebView CSP / subresource lock ([BoopsWebViewController.swift](../../ios/BOOPS/Web/BoopsWebViewController.swift), `BoopsNativeBridge.swift:120`):**
  - Check `url.scheme == "boops-app" && url.host == "app"` strictly, remove `originProtocol == "null"` carveout in `BoopsNativeBridge.swift`, and attach a `WKContentRuleList` blocking non-`boops-app:` subresource `fetch`/`XHR`/`<img>` requests.

### 3.3 Desktop Tauri (`ui/src-tauri/tauri.conf.json`)
- Replace `"csp": null` with an explicit offline-only CSP (`default-src 'self' tauri:; connect-src 'self' http://127.0.0.1:*; script-src 'self' 'wasm-unsafe-eval'; img-src 'self' data: blob:`) and ignore arbitrary `?astronaut=` overrides in [log-store.js](../../web/camera/log-store.js#L28) when in personal mode.

---

## 4. Verification for Track 03

- [ ] Export matrix test: toggle each `risk_detail_share` flag individually and assert exact columns appear/omit in JSON, CSV, and Nearby P2P payloads.
- [ ] `server_csrf_stress`: assert `Origin: https://attacker.example` / `text/plain` `POST` returns `403`/`415`, `/api/health` omits `db_path`, `GET /assets/` returns `403`/`404`, and `mission_day=10**30` returns `400`.
- [ ] Re-run iOS `xcodebuild test BOOPSTests` + Swift stress test verifying rejection of `-100/200` BP, `500000 °C`, `[1, 50, 1000] ms` RMSSD, and unconfirmed Multipeer invites.
- [ ] Run Android JVM unit tests (`BoopsBridgePayloads`, `HealthDailyAggregator`, URL scheme validation) once JDK/Android SDK is available.
