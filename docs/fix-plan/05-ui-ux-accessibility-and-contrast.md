# Plan 05 — UI/UX Scaling, Mobile Occlusions, Touch Targets & WCAG 2.1 AA Contrast

**Scope:** `ui/src/styles/boops.css`, `ui/src/components/Welcome.css`, `web/camera/camera.css`, `site/home.css`, `site/styles.css`, `site/systems3d.js`, `knowledge/web/index.html`, `pwa/pwa.js`.

---

## 1. Fix Mobile Overflow & UI Occlusions (`HIGH`)

| Target | Observed Defect | Concrete Fix |
|---|---|---|
| **Evidence Map (`/knowledge/`)** (`knowledge/web/index.html:55`) | `svg#web{min-width:900px}` overflows horizontally on `< 900px` screens (verified at `390×844` where `MECHANISM HUBS` clips off-screen) | Wrap `#web` in a touch-scrollable zoom/pan container (`overflow-x: auto; -webkit-overflow-scrolling: touch; max-width: 100%`) plus responsive viewBox scaling, reset/zoom buttons, search box, and visible `[data-theme]` switcher (fixing dead CSS vars `L22-39`) |
| **Mobile Toast Occlusion** (`ui/src/styles/boops.css`) | Bottom `.boops-toast` sits directly over the fixed mobile bottom nav bar (`Home`, `Vitals`, `Log`, `SOS`, `More`) for 4s | Below `@media (max-width: 1023px)`, position toast above the bottom nav (`bottom: calc(76px + env(safe-area-inset-bottom))`) or top-center below header (`pointer-events: none` wrapper with dismiss button) |
| **Camera Mobile Actions** (`web/camera/camera.css:191-252`) | Fixed bottom tab bar partially overlaps `"Measure again"` and `"Save to log"` buttons at `390×844` | Increase `.app` bottom padding (`calc(96px + env(safe-area-inset-bottom))`) and add `scroll-margin-bottom` on `.result-card .actions` so buttons sit clear of `.bottom-nav` |
| **Start Dialog Overflow** (`site/home.css:324-327`) | `.start-dialog` sets `max-height: calc(100dvh - 32px)` with no `overflow-y: auto` | Add `overflow-y: auto; overscroll-behavior: contain` alongside inner panel wrapper refactor (Plan 04) |
| **Breakpoints Mismatch** | `boops.css` breaks at `1023px` / `767px`, `Welcome.css` at `767px`, `camera.css` at `1000px` / `600px` | Unify shared layout breakpoints across `boops.css`, `Welcome.css`, and `camera.css` (`1023px` tablet/drawer, `767px` mobile) so `601–767px` and `1001–1023px` viewports stay consistent |
| **Z-Index Collisions** (`boops.css:773, 937, 1604`; `Welcome.css:11`) | `.boops-modal-backdrop` (`95`) ties mobile sidebar (`95 !important`); `.boops-footer .frame-hud` drops to `40` vs `figma.css` `9999` | Establish explicit monotonic z-index scale: page `< 50`, mobile nav/drawer `80–90`, modals `120`, welcome dialog `150`, toast `200`, debug HUD `< 120` when Welcome is open |

---

## 2. Enlarge Touch Targets to `>= 44×44 px` & Fix Keyboard/Motion (`HIGH`)

### 2.1 Sub-44px controls measured in live browser & CSS
- **Mission day stepper chevrons (`‹` / `›`):** Currently `20×20 px` (`1024×768`) and `28×28 px` (`1440×900`, `768×1024`, `390×844`, `320×568`). Enlarge minimum hit area to `44×44 px` (compact visual icon centered inside `min-width: 44px; min-height: 44px`).
- **Tablet/drawer nav buttons (`1024×768`):** Measured `162×31 px` and Home empty-state CTAs `33 px`. Raise row/button `min-height: 44px`.
- **Close buttons:** `.boops-pwa-notice__close` (`28×28 px` in `pwa/pwa.js:62-63`), `.boops-mobile-drawer-close` (`32×32 px`), `.boops-welcome-close` (`34×34 px` in `Welcome.css:41-42`), `.start-close` (`34×34 px` in `home.css:341`), and modal close buttons (`14–20 px`). Enlarge button box or invisible `::after` tap target to `>= 44×44 px`.
- **Log options pills (`App.ts:550`):** `40 px` → raise `min-height: 44px`.
- **Welcome / Landing links:** `"Explore the demo mission instead"` (`11–16 px` height) → add vertical padding so tap area `>= 44 px` on touch viewports.

### 2.2 Keyboard Accessibility & Reduced Motion
- **Emergency steps (`bindEngineData.ts:3369`):** `.boops-em-step` elements have `role="button"` but `hasKeydown: false` (`Enter`/`Space` fail). Use native `<button>` elements or attach `keydown` (`Enter` / `Space` → `click()`).
- **Evidence Map `<svg>` (`knowledge/web/index.html:157`):** Remove `role="img"` from interactive `<svg id="web">`; make node groups `<g tabindex="0" role="button" aria-label="...">` with `Enter`/`Space` selection handlers.
- **3D Canvas (`systems3d.js` + `site/index.html:184`):** Add keyboard rotation (`ArrowLeft/Right/Up/Down`) and avoid calling `setPointerCapture` on touch until drag intent disambiguates from vertical scroll (`touch-action: pan-y`).
- **Landing `.start-option` focus (`site/home.css:352`):** Replace `outline: none` with a visible high-contrast focus ring (`outline: 2px solid var(--ink); outline-offset: 2px`).
- **Reduced motion (`ui/src/components/Welcome.css`):** Add `@media (prefers-reduced-motion: reduce)` transitions/animations disable block matching `home.css`.

---

## 3. WCAG 2.1 AA Contrast Token Upgrade (`>= 4.5:1` Normal Text, `HIGH`)

Replace every failing color combination measured below `4.5:1` (verified via luminance check):

| File | Current Failing Pair | Current Ratio | Verified Accessible Replacement |
|---|---|---|---|
| `boops.css` / `figma.css` | `#9ca3af` on `#ffffff` (`empty-step-num`, chevrons) & on `#f4f5f7` (`HUD`) | **`2.54:1` / `2.33:1`** | Use `#525866` (`7.13:1` on `#fff`, `6.53:1` on `#f4f5f7`) or `#4b5563` (`7.56:1` / `6.93:1`) |
| `boops.css` / `pwa.js` / `camera.css` | `#6b7280` on `#f4f5f7` (muted labels, offline status, *"Today"*) | **`4.43:1`** | Darken muted text token to `#4b5563` (`6.93:1` on `#f4f5f7`) |
| `boops.css` | `#6b7280` on `#c6f432` (secondary label on active lime card) | **`3.77:1`** | Force `#111827` (`13.84:1`) / `#1f2937` (`11.45:1`) inside active lime surfaces |
| `boops.css` | `#ffffff` on `#059669` (`dq-ok`) & `#ffffff` on `#d97706` (`dq-watch`) | **`3.77:1` / `3.19:1`** | Darken badge fill to `#047857` (`5.48:1`) / `#b45309` (`5.02:1`) or switch to light pill + dark text |
| `site/home.css:14, 15, 20, 21` | `--muted #71717a` on `--band #f4f4f5` (`.lead`, `.step-num`, `.card-kicker`, `.footnote`), `--faint #a1a1aa` on `#ffffff`, `--normal #16a34a`, `--watch #d97706` | **`4.40:1`**, **`2.56:1`**, **`3.30:1`**, **`3.19:1`** | Darken `--muted` to `#52525b` (`7.03:1` on `#f4f4f5`, `7.73:1` on `#fff`), restrict `--faint` to dark `.cli` bg, darken text-bearing `--normal` to `#15803d` (`5.02:1`) and `--watch` to `#b45309` (`5.02:1`) |
| `site/styles.css:11` & `site/systems3d.js:17-19` | `--emerald #0fb869` / `normal #0fb869` / `MUTED #94a3b8` on `#ffffff` & dimmed `0.30` alpha (`1.26–1.94:1`) | **`2.56:1`–`2.60:1`** (`1.26:1` dimmed) | Darken canvas label `MUTED` to `#64748b` (`4.76:1`) or `#475569` (`7.58:1`), `normal` label text to `#15803d` (`5.02:1`), `watch` label text to `#b45309` (`5.02:1`), and keep hovered-out text alpha `>= 0.55` |

---

## 4. Verification for Track 05

- [ ] Run automated contrast & bounding-box audit across all rendered screens and landing sections at `1440×900`, `1024×768`, `768×1024`, `390×844`, and `320×568`:
  - `0` text/control combinations `< 4.5:1`.
  - `0` interactive controls `< 44×44 px` tap target on mobile/tablet viewports.
  - `0` horizontal overflow (`scrollWidth === innerWidth`) across app, camera, landing, legal, and `/knowledge/`.
- [ ] Keyboard walkthrough: navigate `#start-dialog`, `Welcome` onboarding, `EmergencyHub` steps, and `/knowledge/` graph purely via `Tab` + `Enter`/`Space` + `Escape`.
