# Plan 04 — Landing Page, 3D Body-Systems Map, Knowledge Graph, Content & Build Sync

**Scope:** `site/index.html`, `site/home.css`, `site/legal.html`, `site/systems3d.js`, `knowledge/`, `content/`, `tools/build-docs.mjs`, `tools/build-site.mjs`, `AGENTS.md`, `dist-site/`.

---

## 1. Fix 3D Body-Systems Map Accuracy & Stability (`site/systems3d.js`, `HIGH`)

- **Day 96 vs Day 97 score mismatch & false SPE driver ([systems3d.js:2, 29-36](../../site/systems3d.js#L2-L36)):**
  - *Bug:* Labeled **Day 97, Crew A1** ([index.html:70,74,173,185](../../site/index.html#L70-L185)), yet displays `Heart 49` (`watch`) and `Bone & muscle 15` (`normal`) from **Day 96** (`engine_output.json` Day 97 = `immune: 88, cardio: 47, musculoskeletal: 19`), and sets `rad` (`Radiation (SPE)`) `on: true` despite Day 97 `radiation_msv = 0.515` (`rad_z = 0.02`; SPE happened Days 92–93).
  - *Fix:* Update node scores to A1 Day 97 truth (`Immune 88`, `Heart 47`, `Bone & muscle 19`) and `Radiation (SPE)` `on: false` (or explicitly move the scene to Day 92/96 if active SPE is intended, syncing caption/aria-label/hero card). Validate values directly from `data/engine_output.json`.
- **Weight & causal-link mismatch vs `engine/risk_engine.py:33-54` ([systems3d.js:43-56](../../site/systems3d.js#L43-L56)):**
  - *Bug:* `cardio` edges sum to `0.55` and invent a `sleep -> cardio (0.15)` link (`risk_engine.py` uses `exercise: 0.35, autonomic_strain: 0.30, radiation: 0.20, time_in_flight: 0.15`); `bone` sums to `0.60` (`resistance_exercise: 0.40, stress_x_inactivity: 0.30, radiation: 0.15, time_in_flight: 0.15`). Contradicts *"Line width is the weight in the score"* (`site/index.html:174`).
  - *Fix:* Add the `exercise` node and wire exact `CARDIO_WEIGHTS` & `MUSCULOSKELETAL_WEIGHTS` summing to `1.00` per outcome so visual thickness equals engine weight everywhere.
- **`ctx === null` crash & continuous `rAF` CPU burn ([systems3d.js:13, 71, 218-235, 300](../../site/systems3d.js#L218-L235)):**
  - Add `if (!ctx) return;` after `canvas.getContext("2d")`.
  - Stop scheduling infinite `requestAnimationFrame(frame)` when `!visible || reduceMotion || dragging || hover`; trigger single `draw()` on interaction/resize and subscribe `matchMedia("(prefers-reduced-motion: reduce)")` `.addEventListener("change", ...)` cleanly.

---

## 2. Reconcile Knowledge Graph, Citations & Stale Web Map (`HIGH`)

- **Align `knowledge/web/index.html` and `site/legal.html` ([legal.html:188-190](../../site/legal.html#L188-L190), [knowledge/README.md:11,43](../../knowledge/README.md#L11-L43)):**
  - *Bug:* `knowledge/web/index.html` (and `dist-site/knowledge/index.html`) only embeds **32 nodes / 61 edges / 60 sources** (omits `eva`, all 8 `nervous` nodes, 21 edges including `stress->immune`, 47 sources, and has 34 diverged edges vs `links.json`), while `legal.html` states all `107` sources / `41` concepts / `83` edges are browsable on `./knowledge/`, and `README.md` still says `103` sources.
  - *Fix:* Teach `tools/build-docs.mjs` (or a sibling builder) to inject `nodes.json`, `links.json`, and `sources.json` into `knowledge/web/index.html` cleanly (support a `Core` / `All (Core + Nervous)` toggle so the interactive web covers all **41 nodes, 83 edges, 107 sources** without hand-drift), update `knowledge/README.md` to `107`, and replace external `fonts.googleapis.com` in `knowledge/web/index.html:7-9` with self-hosted `inter-latin.woff2` / system font stack for 100% offline consistency.
- **Fix uncited & duplicate citations (`knowledge/links.json`, `knowledge/sources.json`):**
  - Cite the **9 uncited edges** (`sources: []`), prioritizing the 1 causal edge `cortisol -> bone` (`cortisol_to_bone_causal`, `knowledge/links.json:118-132`) and the 8 `confounds`/`measures` edges (`fluidshift->face`, `fluidshift->rppg`, `dosimeter->radiation`, `cgm->glucose`, `scans->bone/muscle`, `exerciselog->unloading`, `missionday->isolation`).
  - Consolidate the **8 duplicate paper pairs** (`crucian18`/`crucian2018`, `mehta17`/`mehta2017`, `wadhwa24`/`wadhwa2024`, `jacc23`/`jacc2023`, `barger14`/`barger2014`, `inact`/`ferrando2004`, `salivary`/`iss_saliva2020`, `mishra20`/`mishra2020`) and check duplicate `(from, to)` edges (`cortisol->muscle`, `exercise->muscle`).

---

## 3. Reconcile Landing Copy, `#start-dialog`, Platform Docs & Content JSON (`HIGH` / `MEDIUM`)

- **Landing stats & Legal copy ([index.html](../../site/index.html), [legal.html](../../site/legal.html)):**
  - Replace `"Radiation 4.2 mSv · Act"` (`index.html:215`) with actual simulated Day 92 SPE reading (`4.6 mSv` for A1, or `4.6–4.9 mSv` across A1–A3).
  - Clarify Days `95–96` copy (`index.html:202, 241`): Day 95 hits Immune `Act (80)` while `infection_early_warning` triggers on **Day 96**.
  - Document **iOS (`ios/`)** and **Tauri Desktop (`ui/src-tauri/`)** accurately across Hero badges (`L56-59`), Download list (`L270-326`), FAQ (`L379-395`), CTA (`L395`), and `legal.html` (`L145-152`), alongside `boops.*` `localStorage` keys (`boops.manual_logs.v1`, `boops.data_mode.v1`, etc.). Clarify APK size unit (`~23.9 MiB` / `25.0 MB`) and commit an OSI `LICENSE` or keep license text explicit.
  - Fix `legal.html:206` Mehta et al. (2017) journal (`JCI Insight` → *npj Microgravity*) and add `@font-face` to `site/styles.css` (or clarify `legal.html:298` font claim).
  - Commit/link `docs/submission-answers.md` on the active release branch or remove dead references from notes.
- **Fix `#start-dialog` modal logic & Nav links ([site/index.html:33, 429-522](../../site/index.html#L429-L522), [site/home.css:324-366](../../site/home.css#L324-L366)):**
  - Add `data-start` on Nav `Download` (`index.html:33`) or keep picker consistent; keep `GitHub` reachable on mobile (`<= 640px`).
  - Wrap modal inner content in `<div class="start-dialog-panel">` (move `padding: 28px 24px 20px` onto `.start-dialog-panel` and set `padding: 0` on `<dialog class="start-dialog">`) so clicking modal padding cannot trigger `e.target === dialog` backdrop close (`index.html:520`).
  - Add `var c = copy[kind] || copy.web;` guard at `index.html:500`, `aria-describedby` on `<dialog>`, and focus the primary choice or heading cleanly on `showModal()` instead of focusing Close first.
- **Fix `content/emergency_protocols.json`, `tool_guides.json` & Artboard fallbacks:**
  - Harmonize clinical cutoffs: `thermometer` repeat threshold (`< 35.5 °C` vs `< 30 °C` mistake text), `saliva_sample_kit` post-rinse wait (`10 min` vs `30 min` across JSON & `HealthRiskDetailImmuneGuideSalivaSample.ts`), `severe_rash_fever` (`>= 38.0 °C` quarantine vs `>= 38.3 °C` escalate), and `breathing_difficulty` (`SpO2 < 90%` escalate vs `< 92%` across `fainting_dizziness`/`chest_pain`).
  - Add structured `sources: [...]` citations referencing `knowledge/sources.json` to `emergency_protocols.json` and `tool_guides.json`.
  - Fix `bindEngineData.ts:2446-2471` (`fieldToGuide`) so `LogEnvironmentGravity`, `LogEnvironment`, `LogNutrition`, `LogSleep`, and `LogMindfulness` map cleanly to `exercise_device_log` / appropriate guides instead of `wearable_hrv_fit` / oral `thermometer`, and add a `camera_rppg` tool guide JSON entry (activating `BoopsOverlays.ts:527`) or remove the dead branch.
  - Replace static `"05:42:10"`, `"Sam Rivera"`, `"Alex Kim"`, and `"Illustration placeholder"` fallback strings in Figma screen files.

---

## 4. Regenerate Bundles & Build Pipeline (`tools/build-site.mjs`)

- Extend `tools/build-site.mjs` `validateLocalRefs` to verify CSS `url(...)` paths, `manifest.webmanifest` icons, and exact source-count / bundle-hash parity between `knowledge/sources.json`, `ui/public/data/boops_bundle.json`, `web/data_bundle.js`, and `dist-site/`.
- Re-run full pipeline (`engine/run_all.py` → `ui` build & sync → `build-docs.mjs` → `build-site.mjs`) so all bundles carry reconciled sources and `ui/dist/` matches `web/`.
