# BOOPS web version: plan

*Drafted 2026-11-15, after a check of the current app.*

## 0. Health check (done before planning)

Checked on `main` at `65c0514`, which includes PR #9 (no separate top bar, calmer crew switcher). The committed `web/app.js` and `web/boops-space-ui.css` match a fresh build of `ui/` byte for byte.

| Check | Result |
|---|---|
| `python engine/run_all.py` | ✅ runs. Demo story is present: A1 immune risk reaches Act on days 94–98, infection early warning on days 96–98, A2 musculoskeletal risk reaches Watch on days 64–75, and the 3 sensor glitches show "check_device" |
| `pytest tests/` | ✅ 33 passed, 1 skipped (the WESAD test needs `hard/wesad/prepare.py` and the dataset) |
| `node --test` rPPG + face | ✅ 18 / 18 passed |
| `ui` typecheck, Vite build, offline `/web` build | ✅ all pass (warning: `app.js` is 2.4 MB, one chunk) |
| `/web` in a browser | ✅ no console errors. Home, Emergency, Log and the sidebar screens all open. Tool Guides (drawer) and Export (modal) open. The camera check (`?sim=steady`) reads the 72 bpm test pulse. At 375 px there is no sideways scroll and a bottom tab bar appears |

Not checked: the Android and iOS builds, a real webcam, and the Tauri desktop build.

## 1. What "web version" means here

`/web` already runs in a browser, but it is only served locally (`engine/server.py` or `file://`). The landing site (`dist-site/`, Cloudflare) shows screenshots instead of the app.

**Goal:** host the same crew app at `/app/` on the landing site as an **installable, offline-first PWA**. Judges and the public can try it from a link, and after the first visit it keeps working with no internet. This matches the offline promise in AGENTS.md.

**Not in scope:** any cloud backend, accounts or server-side health data. Everything stays on the device.

## 2. Changes

> **Status (2026-11-15):** steps 1 and 2 are done. `tools/build-site.mjs` copies `web/` to `dist-site/app/` and adds the files from `/pwa`. Checked locally with the server stopped: the dashboard, Emergency and the simulated camera check all work offline, and the "Update ready · Reload" flow swaps the cache. What differs from the plan below: 59 files (6.6 MB) are precached, not ~3 MB, because the data bundle is included in two forms (`data_bundle.js` and `data/boops_bundle.json`). The hero's "See the app" button became "Open the web app". A real-camera check offline needs one online camera check first, so MediaPipe is cached.

### Step 1. Host `/web` at `/app/` (small)
- In `tools/build-site.mjs`, copy `web/` to `dist-site/app/`. Leave `web/` itself unchanged: the APK sync and the tests depend on it.
- Add an "Open the web app" button next to "Download for Android" in `site/index.html`.
- Check the size limit: the largest file is `vision_wasm_internal.wasm` at 14 MB, which is under Cloudflare's 25 MiB per-file limit.

### Step 2. Make it a PWA that works offline (medium, the main work)
- Add `web/manifest.webmanifest` (name, icons from `boops-logo.svg`, `display: standalone`, theme colours from `tokens.css`).
- Add `web/sw.js`, a hand-written service worker with no new dependency:
  - **Precache on install:** `index.html`, `app.js`, the CSS, `data_bundle.js`, the content JSON, fonts and the logo (about 3 MB).
  - **Cache on first use:** the MediaPipe files under `vendor/` (18 MB), loaded only when someone opens the camera check.
  - **Versioning:** the build script stamps a hash into the cache name, so a new deploy replaces the old cache.
- Register the service worker only on `https:` or `localhost`, so `file://` and the Android/iOS WebViews behave as they do now.
- Show a small "Available offline ✓" / "Update ready, reload" chip next to the existing "Offline · On-device" badge.

### Step 3. Handle features that only work in the native apps (small)
`nativeBridge.ts` already reports `platform: "web"`. On the web:
- Health Connect / HealthKit: not available. The Sensors & Sync modal should say "Available in the Android / iOS app" instead of showing an error.
- Bluetooth: Web Bluetooth works in Chrome and Edge only. Hide the scan button in Safari and Firefox and explain why.
- Crew P2P sync: not available. Offer an **export/import file** (JSON) as the manual alternative.

### Step 4. Storage and privacy (small)
- Without `engine/server.py`, `postLocalApi` already falls back to `localStorage`. Keep it that way.
- Request `navigator.storage.persist()` so the browser is less likely to clear saved log entries.
- Add a "Back up my data" / "Restore" button (one JSON file) on the Export screen, because browser storage can be wiped.
- Add a `_headers` file for Cloudflare: a strict CSP (`connect-src 'self'`, no third-party scripts), `Permissions-Policy: camera=(self)`, and no analytics. The camera needs HTTPS, which Cloudflare Pages provides.
- Show a banner the first time the app opens: "Demo with **Simulated** crew data · Prototype · Not a medical device."

### Step 5. Performance (optional)
- Split `app.js` (2.4 MB) so the Emergency and Home screens load first and the charts and the 3D map load later. Not required, because the service worker caches it after the first visit.

### Step 6. Verification
- Add a Playwright smoke test (or `node --test` with a headless browser) that opens `/app/`, visits every sidebar screen and fails on any console error.
- Manual checks: install the PWA on desktop Chrome, iPhone Safari and Android Chrome; go offline (airplane mode) and reload; run the camera check offline; open Emergency offline.
- Lighthouse PWA and accessibility audit on the deployed preview.

## 3. Order and estimate

| # | Step | Size | Depends on |
|---|---|---|---|
| 1 | Host at `/app/` + landing button | ~1 h | – |
| 2 | Manifest + service worker + offline chip | ~3 h | 1 |
| 3 | Fallbacks for native-only features | ~1–2 h | – |
| 4 | Persistence, backup/restore, headers, demo banner | ~2 h | – |
| 5 | Split `app.js` (optional) | ~2 h | – |
| 6 | Smoke test + device checks | ~2 h | 1–4 |

Steps 3 and 4 do not depend on steps 1 and 2 and can run in parallel. Branch: `feat/web-pwa`. When it is done, add a row to the status board in AGENTS.md and a decision-log entry ("Web version = static PWA, no backend").

## 4. Open questions for the team
1. Should the hosted app show only the simulated demo, or also let visitors log their own data (stored in their own browser only)?
2. Is `/app/` on the landing domain the right place, or should it have its own subdomain?
3. Should we keep the "Download for Android" button as the main call to action, or put "Open web app" first?
