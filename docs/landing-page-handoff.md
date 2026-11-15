# Landing Page Handoff — `site/` & `dist-site/`

**Status:** Done (Claude, 2026-11-15). Task 1 markup edits applied; scenario cards toned down (one plain kicker line + status badges only); unused `.inline-avatar-*` CSS removed; mobile overflow in scenario footer buttons fixed; `dist-site/` rebuilt and checked at 1440, 1150 and 390 px. Not committed.  
**Last Updated:** 2026-11-15  

---

## 1. Goal & Design Direction

The static landing page lives in `site/` (`site/index.html`, `site/styles.css`, `site/legal.html`) and bundles into `dist-site/` via `node tools/build-site.mjs`.

### Core Requirements
- **Zero Web Demo (`./demo/`) links:** Replaced all demo links with **GitHub** (`https://github.com/owlwee-sudo/boops_Space`) and **offline Downloads**:
  - `./downloads/boops-android.apk` (Android APK, ~23.65 MiB)
  - `https://github.com/owlwee-sudo/boops_Space/archive/refs/heads/main.zip` (Full Source Archive)
  - `./downloads/flight_surgeon_summary_A1.pdf` (2-page Crew A1 Flight Surgeon summary)
  - `./downloads/daily_records.csv` (540-row `SEED=42` simulated telemetry table)
  - `./knowledge/` (Interactive 41-concept / 83-edge / 103-source Evidence Map)
- **Zero Emojis or Text Arrow Glyphs:** All star ratings (`⭐`), arrows (`→`), and FAQ `+` toggles were replaced with 2D `<svg>` icons (`<symbol>` sprite in `site/index.html` + `.card-icon` / `.subblock-icon` SVGs).
- **Zero Gradients (Latest User Direction):** User explicitly requested removing all CSS gradients (*"remove or fix wried pills or off ui thing include the gradin i dont like gradian"*). Use flat solid surfaces only:
  - Canvas: `#ffffff`
  - Soft surface wells: `#f3f5f7`
  - Dark cards / Hero / Footer frame: `#111827` (inner chips `#1f2937` with `#374151` borders)
  - Primary CTA accent green: `#0fb869`
- **`AGENTS.md` Compliance:** Keep explicit `"Simulated"` labels (citing **NASA OSDR RadLab** and **NOAA SWPC GOES**), `"Prototype · Not a medical device"` notice & footer, `"risk indicator"` / `"early warning"` phrasing (never `"diagnose"`), and crew-first privacy (`FACE_WEIGHT = 0.0` default, capped `0.15`, zero emotion labels per Barrett et al., 2019). Do **not** modify `engine/`, `hard/`, `ui/`, `web/`, or `tests/`.

---

## 2. What Has Already Been Done

### A. Static Site Builder & Legal Page
- `tools/build-site.mjs` is complete: bundles `site/`, `web/boops-logo.svg`, APK, PDF, CSV, and `knowledge/web/index.html` into `dist-site/` and checks for broken local refs.
- `site/legal.html` is updated and clean (no `./demo/` links, no emojis or text arrow glyphs).

### B. 2D Icon System
- `site/index.html` includes an inline `<svg>` `<symbol>` sprite (`#icon-star`, `#icon-arrow-right`, `#icon-arrow-up-right`, `#icon-plus`), 2D `.card-icon` SVGs, and 8 `.subblock-icon` SVGs in `#conclusion`.

### C. Gradient Removal & Bug-Fix CSS in `site/styles.css` (Already Applied!)
All CSS fixes for the 3 screenshots shared by the user are **already saved** in `site/styles.css`:
1. **Removed all 6 gradient declarations:**
   - `--surface-cosmos-dark` set to flat `#111827`.
   - Removed `.hero-frame::before` warm-amber/emerald radial glow overlay.
   - `.hero-frame`, `.atmos-card`, `.final-cta-frame` use flat `background: #111827;`.
   - `.hero-centered`, `.bento-closing`, `.final-cta` use flat solid `#f3f5f7` or `#ffffff`.
   - `.isometric-stage-card` had its `linear-gradient(180deg, #f3f5f7 0%, ... 58%, #0b1512 58% ...)` removed (`padding: 0; background: #111827;`).
2. **Cleaned up pills & badges:**
   - `.badge`, `.section-pill`, `.badge-dark`, `.badge-sim`, `.badge-lime`, `.card-icon-lime`, and `.glass-tag` changed from loud yellow/neon fills to understated flat pills (`#f3f5f7` / `#ecfdf5` / subtle `rgba(255,255,255,0.1)`), while keeping `.badge-watch`, `.badge-act`, and `.badge-normal` reserved for real telemetry statuses.
3. **Hero Navbar Clipping Fix & Showcase Split Classes:**
   - `.hero-nav` now allows `flex-wrap: wrap; gap: 12px 16px;`.
   - Added `@media (max-width: 1320px)` to hide `.hero-nav .brand-sub` so `GitHub` and `Download` buttons don't clip on `1100px–1300px` split-pane viewports.
   - Added `.hero-kicker`, `.iso-head-title`, `.isometric-stage-top` (`background: #f3f5f7; padding: 28px 32px 24px;`), and `.isometric-stage-bottom` (`background: #111827; color: #ffffff; padding: 28px 32px 32px;`), plus solid `#1f2937` `.iso-metric-chip` and `.isometric-action-strip` containers.

> **Important In-Progress State:** Because `site/styles.css` now expects `.isometric-stage-bottom` inside `.isometric-stage-card` (which was set to `padding: 0`), **`site/index.html` MUST be updated before rebuilding `dist-site/`** so the lower telemetry chips and CTAs receive their `#111827` background and padding cleanly. Right now `dist-site/` still holds the previous build before the CSS edits.

---

## 3. What Remains To Be Done (For Claude)

### Task 1 — Update `site/index.html` Markup to Match `site/styles.css`
1. **Trim `.hero-nav-links` (lines 59–68):**
   Reduce from 8 links to 5 concise links so the right-side `GitHub` and `Download` buttons have plenty of horizontal room without wrapping or clipping:
   ```html
   <nav class="hero-nav-links" aria-label="Primary navigation">
     <a class="hero-nav-link" href="#about">About</a>
     <a class="hero-nav-link" href="#how-it-works">How It Works</a>
     <a class="hero-nav-link" href="#scenarios">Scenarios</a>
     <a class="hero-nav-link" href="#conclusion">Conclusion</a>
     <a class="hero-nav-link" href="./legal.html">Legal</a>
   </nav>
   ```
2. **Replace the 3 Hero `.glass-tag` Pills (lines 96–100):**
   Replace `<div class="hero-eyebrows">...</div>` with a single flat uppercase kicker:
   ```html
   <div class="hero-kicker">NASA Space Apps Challenge 2026 · Simulated Telemetry · 100% Offline</div>
   ```
3. **Remove the 3 Mid-Sentence Circular Pills in `#why-it-matters` (lines 206–227):**
   Remove `<span class="inline-pill-avatars">...</span>` from `.editorial-statement` so the two-tone headline reads cleanly:
   ```html
   <h2 class="editorial-statement">
     Healthcare built <span class="text-muted-tone">around your data —</span>
     correlating wearable, sleep, and cabin signals
     <span class="text-muted-tone">into explainable early warnings.</span>
   </h2>
   ```
   (Optionally also clean up the unused `.inline-pill-avatars` / `.inline-avatar-*` CSS rules in `site/styles.css` lines ~2005–2042.)
4. **Fix `.isometric-stage-head` Pills (lines 233–236):**
   Replace the clashing dark + yellow pills with a clean label + subtle badge:
   ```html
   <div class="isometric-stage-head">
     <span class="iso-head-title">Day 97 · Crew A1 (Amara Okafor)</span>
     <span class="badge badge-sim">Simulated</span>
   </div>
   ```
5. **Wrap the Lower Dark Half of `.isometric-stage-card` in `.isometric-stage-bottom` (line 274):**
   Change:
   ```html
   <div style="display: grid; gap: 14px;">
   ```
   to:
   ```html
   <div class="isometric-stage-bottom">
   ```
   This guarantees the `#f3f5f7` light block ends strictly below the laptop SVG and the dark `#111827` block wraps the 3 `.iso-metric-chip` cards, `.isometric-action-strip`, and CTA buttons at every screen width (fixing the broken mid-card split and white-on-light-gray mobile legibility seen in the screenshots).

### Task 2 — Audit Remaining Pill Clusters in Lower Sections
Inspect `#features`, `#users`, `#scenarios`, `#conclusion`, `#download`, and `#process` in `site/index.html` in a browser and remove/tone down any remaining multi-badge clusters (e.g., `.download-meta-row`, `.scenario-stat-group`, or `.atmos-card` `.glass-tag`) that still feel visually noisy.

### Task 3 — Rebuild `dist-site/` & Visually Verify
1. Verify zero gradients remain in CSS/HTML (`grep -n "gradient" site/styles.css site/index.html` returns nothing) and verify zero emojis, zero arrow glyphs (`→`), zero literal backticks outside `<pre>`, and zero `./demo/` references.
2. Rebuild `dist-site/`:
   ```bash
   node tools/build-site.mjs
   ```
3. **Restart the preview HTTP server after rebuilding** (`tools/build-site.mjs` deletes and recreates `dist-site/`, which unlinks the old directory inode from any already-running `http.server` process):
   ```bash
   # Stop any existing http.server on port 8765 first, then:
   python3 -m http.server 8765 --bind 127.0.0.1 --directory dist-site
   ```
4. Visually inspect `http://127.0.0.1:8765/` at:
   - **`1440×900`** (desktop wide)
   - **`1150×820`** (laptop / split-pane width where `.hero-nav` previously clipped `Download`)
   - **`390×844`** (mobile, confirming all 3 stacked `.iso-metric-chip` cards sit inside `#111827` `.isometric-stage-bottom` with clean white contrast)
5. Commit and push only when the user explicitly requests it.

---

## 4. Current Workspace Notes
- Modified working-tree files for the landing page: `site/styles.css` (Step 1 gradient/pill fixes applied), `site/index.html` (ready for Step 2 edits), `site/legal.html`, `dist-site/` (stale relative to latest `site/styles.css` until `node tools/build-site.mjs` is re-run).
- A preview server (`python3 -m http.server 8765 --bind 127.0.0.1 --directory dist-site`) was running on port `8765` prior to handoff.
