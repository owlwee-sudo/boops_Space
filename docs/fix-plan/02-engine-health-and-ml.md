# Plan 02 — Python Engine, Clinical Data Quality, Hard-ML & Signal Processing

**Scope:** `engine/data_quality.py`, `engine/analysis.py`, `engine/risk_engine.py`, `engine/db.py`, `hard/wesad/`, `hard/rppg*`, `hard/face/`, `hard/anomaly/`, `web/camera/rppg-core.js`, `web/camera/face-behaviour-core.js`, plus TypeScript scoring parity (`ui/src/services/boopsData.ts`).

---

## 1. Fix Clinical Triage & Crash Bugs in `engine/` (`CRITICAL` / `HIGH`)

### 1.1 `engine/data_quality.py` — Step 0 vs Step 2 clinical inversions & plausibility gaps
- **Implausible high temperature (`engine/data_quality.py:120`):**
  - *Bug:* `temp_c >= DANGEROUS_THRESHOLDS["temp_high"]` with `sq >= 0.7` has no upper bound, so `temp_c = 65.0` or `999.0` triggers `status = "act_now" ("High fever")`.
  - *Fix:* Gate Step 0 fever check on physiological plausibility (`DANGEROUS_THRESHOLDS["temp_high"] <= temp <= PLAUSIBLE_LIMITS["temp_c"][1]`, i.e., `<= 42.0 °C`), so `65.0` / `999.0` falls through to Step 2 `check_device`.
- **Critical hypoxemia (`SpO2 < 70%`) + symptoms downgraded (`engine/data_quality.py:122, 145`):**
  - *Bug:* `spo2_pct = 65.0, sq = 0.95, symptoms = "dyspnea"` skips Step 0 (`70.0 <= spo2 < 90.0`) AND skips Step 2 (`not symptoms_present`), downgrading a medical emergency to `"check_yourself"`.
  - *Fix:* In Step 0, if `spo2 < DANGEROUS_THRESHOLDS["spo2_low"]` AND `symptoms_present` (even if `< 70%`), trigger `act_now`; only treat `spo2 < 70` as Step 2 sensor-contact fault when `!symptoms_present` (or corroborated by `sq < MIN_SIGNAL_QUALITY`).
- **Missing Step 2 plausibility bounds (`engine/data_quality.py:140-146`):**
  - *Bug:* `sbp_mmhg = 400.0`, `dbp_mmhg = 250.0`, `spo2_pct = 150.0`, `hrv_rmssd_ms = 500.0` or `1.0` are not rejected as implausible (`BP` returns `status = "ok"`).
  - *Fix:* Add explicit Step 2 bounds (`spo2_pct` in `[70..100]`, `sbp_mmhg` in `50..260`, `dbp_mmhg` in `30..180` with `sbp > dbp`, `hrv_rmssd_ms` in `2..300`) consistent with Android `HealthDailyAggregator`.
- **Null/NaN `signal_quality`, `NaN` symptoms, & `inf` integers (`engine/data_quality.py:75, 109, 133, 167`):**
  - Handle missing `sq is None` explicitly rather than passing Step 1 silently; normalize `_has_symptoms` so `float('nan')` is treated as `""` not `"nan"` at `L75`; sanitize `eva` and `mission_day` against `inf`/`-inf` via a safe finite integer parser.

### 1.2 `engine/analysis.py` — Non-finite values, `SD=0` blowup, baseline leak & IEW day-index math
- **Reject non-finite floats (`engine/analysis.py:61`):** Change `np.isnan(out)` in `_to_float` to `not np.isfinite(out)` so `inf`/`-inf` cannot propagate into `personal_baseline`, `zscores`, `stress_score` (`L167` `ValueError`), or `risk_engine` (`ValueError`).
- **`Series` missing column (`engine/analysis.py:68`):** Use `row.get("signal_quality")` uniformly on both `pd.Series` and `dict` instead of `row["signal_quality"]` (`KeyError`).
- **Baseline fallback leak & `SD=0` floor (`engine/analysis.py:85-86, 99`):**
  - Filter `df.loc[df["astronaut_id"] == astronaut_id]` fallback by `signal_quality >= MIN_SIGNAL_QUALITY` (so low-SQ Days 1–14 fallback never sucks in a Day-30 `250 bpm` glitch).
  - Replace `1e-3` SD floor with clinically sane minimum SD floors per metric (e.g., `rhr_bpm >= 1.5`, `hrv_rmssd_ms >= 2.0`, `sleep_hours >= 0.4`, `temp_c >= 0.15`, `radiation_msv >= 0.05`) so constant baseline readings + `0.1` variation cannot create `z = 100.0`.
- **`infection_early_warning` day-index & `eva` bugs (`engine/analysis.py:223-262`):**
  - Look up actual mission days (`cur_day`, `cur_day - 1`, ..., and EVA window `[day - 2 .. day]`) rather than `row_idx - lookback` / `idx - eva_back` (fixes false positive on Days 94 & 96 skipping 95, and fixes Day-80 EVA suppressing Day 96 when intermediate rows are missing). Locate `cur_row` safely after sorting by `mission_day`.
  - Guard `eva` against `NaN`/`Inf` at `L250` via safe finite integer parsing and validate `row_idx` type.

### 1.3 `engine/risk_engine.py` — Rolling `NaN` crash, `adaptation_phase` eviction & rad threshold
- **All-NaN 7-day rolling windows (`engine/risk_engine.py:270, 294, 365, 387`):** When `recent7["resistance_min"].mean()` or `recent7["exercise_min"].mean()` is `NaN`, fall back cleanly to `res_min` / `ex_min` / baseline mean before computing `np.clip` and `int(round(...))`.
- **Ensure `adaptation_phase` is preserved on Days 1–14 (`engine/risk_engine.py:180-220`):** Currently evicted in **39/126** Days 1–14 evaluations because `drivers` sorts descending and slices `[:4]` while `adaptation_phase` has `contribution = 0.0`. Preserve `adaptation_phase: true` on the risk object/flags or pin the `adaptation_phase` driver during `cur_day <= ADAPTATION_DAYS`.
- **Radiation action threshold (`engine/risk_engine.py:555-560`):** Trigger `rad_action` on physical dose (`rad >= 1.5 mSv`) or sustained elevated exposure rather than `rad_z >= 3.0` alone against a near-zero `0.04` SD baseline (which fires below `1.5 mSv`, e.g., at `1.49 mSv`), and guard invalid `mission_day = NaN`.

### 1.4 `engine/db.py` — `save_engine_output` deleting `emergency_events` & `eva=NaN`
- **`emergency_events` wiped on pipeline re-run (`engine/db.py:242`):** Remove `conn.execute("DELETE FROM emergency_events")` inside `save_engine_output` so user/protocol emergency events persist across analysis re-runs.
- **`eva=NaN` in `insert_daily_records` (`engine/db.py:211`):** Parse `eva` safely (`0` when `pd.isna` or non-finite).

---

## 2. Align TypeScript & Python Risk/Data-Quality Logic (`HIGH`)

- **Problem:** `recomputeEngineFromRecord` ([boopsData.ts:792-892](../../ui/src/services/boopsData.ts#L792-L892)) uses simplified linear deltas and sticky `||` status/flags, diverging from Python up to `62` immune score points on Days 1–14, missing `stress_x_inactivity`, inverting Day 92 `spo2=65%` without symptoms to `act_now`, missing `rhr > 115 && symptoms` `act_now`, and never clearing resolved glitches.
- **Fix:**
  - Replace delta patching in `recomputeEngineFromRecord` with an exact deterministic TypeScript port of:
    1. `zscores`, `stress_score`, `sleep_score`, and day-based `infection_early_warning`.
    2. `compute_immune_risk`, `compute_musculoskeletal_risk` (`stress_x_inactivity`), `compute_cardio_risk` — including Days 1–14 `0.45` adaptation dampening and dynamic `recommend_actions` re-ranking.
    3. `check_reading` 4-step odd-reading funnel (`temp <= 42.0` cap, `spo2 < 70 && !symptoms -> check_device`, BP/HRV bounds, clearing resolved statuses).
  - Re-use that exact same TypeScript scorer for `"My data"` mode once baseline metrics exist (`14` days, or interim raw status before Day 14).
  - Add a Node↔Python parity test in `tests/` validating `recomputeEngineFromRecord` against Python `engine/` across synthetic C1–C8 scenarios.

---

## 3. Hard Modules (`hard/`) & Camera Cores (`HIGH` / `MEDIUM`)

| Module & File | Defect | Concrete Fix |
|---|---|---|
| **WESAD Unpickler** (`hard/wesad/prepare.py:93`) | Blocks `numpy._core.numeric._frombuffer` under modern NumPy/pickle >= 4, failing `tests/test_wesad_model.py:83` | Whitelist `("numpy._core.numeric", "_frombuffer")` (and `("numpy.core.numeric", "_frombuffer")` if needed) while verifying arbitrary callables stay blocked |
| **WESAD Logistic Overflow** (`hard/wesad/stress_model.py:67`) | `math.exp(-total)` throws `OverflowError` on large negative logits (`[-1000, 0, 0]`) | Clamp `total` to `[-700.0, 700.0]` or branch sign cleanly; validate input element types |
| **WESAD Training Edge Cases** (`hard/wesad/train.py:119-120`) | Missing baseline labels yield all-NaN columns; single-class LOSO folds crash | Raise informative skip/error when a subject lacks baseline or stress class in LOSO CV |
| **Face Hook (`stress_hook.py:51`, `face-behaviour-core.js:78,82`)** | Python throws `ValueError`/`OverflowError` on `NaN`/`Inf` `stress_score`; JS divides by `pose.size=0` and propagates `NaN` blendshapes | Reject/sanitize non-finite `stress_score` in Python & JS; guard `pose.size <= 0` and non-finite landmarks/blendshapes in `face-behaviour-core.js` |
| **rPPG Core (`rppg_reference.py:54,163`, `rppg-core.js`)** | `analyse_trace([])` raises `IndexError`; quantized 8-bit 30 bpm aliases to 60.1 bpm harmonic and **passes** JS quality gate (`sq: 0.76`) | Return `None` when trace length `< 2` or span `<= 0` in Python; add quantization / step-harmonic / sub-42 bpm validation so aliased square signals fail quality (`retry: true`) |
| **Anomaly Detector (`hard/anomaly/anomaly.py:72,113,210-212`)** | `anomaly_score = 0.536` has `is_anomaly = False` (`A1` D111); missing `signal_quality` `KeyError`; duplicate days not deduplicated; `suggest_status` treats `NaN` SQ (`False`) as `check_device` and `"nan"` symptoms as true symptoms | Calibrate `anomaly_score >= 0.5` consistently with `is_anomaly`, guard `np.isfinite(signal_quality)` and ignore `"nan"`/`"none"` symptom strings in `suggest_status`, `.get("signal_quality")`, and deduplicate `(astronaut_id, mission_day)` |

---

## 4. Verification for Track 02

- [ ] `pytest -v -rA tests/`: **34 / 34 passed** (0 failures, 0 skips).
- [ ] Add regression tests covering: `temp=65/999`, `spo2=65+dyspnea`, `sbp=400`, `SD=0`, `inf`/`NaN` across all 12 vitals, Days 94+96 gap + Day-80 stale EVA in IEW, all-`NaN` 7d exercise/resistance windows, `save_engine_output` retaining pre-existing `emergency_events`, `rppg_reference.analyse_trace([])`, `stress_model.predict_proba([-1000,0,0])`, `pose.size=0`, quantized 30 bpm rPPG retry, and TS↔Python parity suite C1–C8.
- [ ] Re-run `python engine/run_all.py` and verify Days 1–14 `adaptation_phase` flag is preserved on every domain.
