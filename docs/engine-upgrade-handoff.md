# Handoff: analysis-engine upgrade + fluid-shift correction

For: Fable 5.2 (hard features). Written 16 Nov 2026 and checked against `main` at commit `c5d2bcb`.
Read `AGENTS.md` first, then this file. Related: `docs/fix-plan/02-engine-health-and-ml.md` (bug fixes, Phase 0 done). This plan is the next step after it, not a replacement.

## 1. Goal
1. Stop fluid shift (days 1-14) from corrupting the baseline or hiding real problems.
2. Prove the engine is not just learning "days in space".
3. Tune the ML we already have (WESAD, Isolation Forest) with harm-weighted thresholds. Both are already wired in.

## 2. Current state (verified in the repo)
- `engine/analysis.py`: `BASELINE_DAYS = (1, 14)`. The baseline mean and SD come from the **same days as the fluid shift**, so the baseline contains the transient.
- `engine/risk_engine.py`: `ADAPTATION_DAYS = 14`, `ADAPTATION_DAMPEN_FACTOR = 0.45`. On days 1-14 the final **risk score** is multiplied by 0.45 and an `adaptation_phase` driver is added. On day 15 the factor drops to 1.0 (a hard cutoff). The z-scores themselves are **not** corrected.
- `STRESS_MODEL = "rules"` and `FACE_WEIGHT = 0.0` hooks exist in `engine/analysis.py`. The WESAD model is already wired behind `STRESS_MODEL`.
- H4 Isolation Forest is already wired: `engine/run_all.py` runs `hard.anomaly.anomaly.score_mission` and merges `anomaly_score` / `anomaly_kind` into `engine_output.json`. By decision, it never changes `data_quality.status`.
- `ui/` has a TypeScript copy of the scorer used for "My data" mode (see fix-plan 02, section 2). **Any engine change here must be mirrored there**, or Demo and My data will disagree.

## 3. Tasks (in order)

### T1. Adaptation curve instead of baseline-on-the-transient + a hard cutoff
Correct the z-score itself, not only the final risk score:

```
z_adj = (x - (mu + delta(t))) / sigma
delta(t) = A * exp(-t / tau)
```

- `mu`, `sigma`: baseline from a **stable window**. Proposed default days 15-28, falling back to days 1-14 when fewer than 14 good stable days exist (document the fallback; "My data" users won't have days 15-28 for weeks).
- `A` and `tau`: one pair per metric (resting HR up, BP down, HRV down). Config dict at the top of the file. Placeholder values first; replace with ranges from papers and cite each in `knowledge/sources.json`. Do **not** invent literature numbers.
- Worked example (illustrative values, put it in the docstring): day 3, mu = 60, sigma = 3, A = 8, tau = 7, observed 66.
  - delta(3) = 8 * e^(-3/7) = 8 * 0.651 = 5.21
  - raw z = (66 - 60) / 3 = **2.0** (false alarm)
  - z_adj = (66 - 65.21) / 3 = **0.26** (normal)
- Replace the 0.45 multiplier with the curve once the tests below pass. Keep the `adaptation_phase` flag and driver (the fix plan pinned them on purpose); it can become "adaptation fading" instead of a boolean cliff, but the field must stay in the data contract.
- Flag: `ADAPTATION_MODEL = "curve" | "window"` (`"window"` = today's behaviour). Choose the default after T4 and log it.
- Reuse the same mechanism for motion sickness (first days and landing) and re-adaptation after landing, as separate config entries.
- Mirror in the `ui/` TypeScript scorer.

### T2. Mission-day confounding check
- New `engine/confound_check.py`. Show that stress, risk and the infection warning carry information beyond mission day.
- Method: shuffle the day order within each astronaut and re-score (permutation test), or regress the score on mission day and test the residual. Report real vs shuffled.
- Run it on the rules engine **and** on `STRESS_MODEL = "wesad"` and the anomaly score.
- Output a small JSON or markdown report in `data/`. A "Why?" panel line is optional.
- Note: `risk_engine.py` already has a `time in flight (day/180)` driver at weight 0.10. Report how much of each risk is explained by that driver alone.

### T3. Harm-weighted thresholds (uses the ML that is already wired)
- Missing an infection costs more than a false alarm, but too many false alarms and the crew stops trusting the app.
- Add a config cost ratio (`MISS_COST / FALSE_ALARM_COST`). Use it to pick thresholds from the WESAD ROC curve and to document the infection-warning threshold (>= 2 SD, >= 2 days).
- Be honest in the docstring: the only "labels" for the infection warning are our own planted events, so tuning there is tuning to our story.
- Fix-plan 02 notes `anomaly_score = 0.536` with `is_anomaly = False`. If not already fixed, calibrate `>= 0.5` consistently first.

### T4. Tests (pytest, `tests/`)
Cover T1-T3. Keep every existing test passing (last known: pytest 88/88, node 18/18).

### T5. Roadmap only (do NOT build)
- **FiLM fluid-shift correction:** adaptation state `a` (mission day + fluid-shift markers) modulates features, `h' = gamma(a) * h + beta(a)`. Needs real analog data (head-down-tilt bed rest, published ISS data). Do not train it on our simulation. Write only a short `docs/roadmap-film.md`.
- **Lagged / time-lag models** (stress -> viral reactivation days later): needs real multi-day data with outcomes. Skip.
- **H5 LSTM autoencoder:** optional, low value on simulated data. Skip.

## 4. Acceptance checks (all must pass)
1. `python engine/run_all.py` runs clean; pytest and `node --test` stay green; `ui` typecheck passes.
2. **A1's infection early warning still turns on at day 95 or 96**, before symptoms on day 97, and A1 immune risk is Act on days 97-98.
3. Sensor glitches on days 30, 50 and 110 still show **"check device"**.
4. A2 days 60-75 still raise the musculoskeletal risk to Watch.
5. **False alerts in days 1-14 drop** vs `ADAPTATION_MODEL = "window"`. Put before/after counts in the PR description.
6. The curve does **not** suppress checks 2-4 (they are the proof it hides nothing real).
7. The mission-day shuffle test (T2) does not reproduce the real scores.
8. With `ADAPTATION_MODEL = "window"` and all other new flags off, output matches today's.
9. The Python and TypeScript scorers agree on the demo data (days 1-30 for all three astronauts, at minimum).

## 5. Do not
- Do not train anything on the simulated data and present it as validated.
- Do not rewrite another branch's module. Do not change `data_quality.status` from an ML score.
- Do not use the word "diagnose". Footer stays "Prototype · Not a medical device". Weights and thresholds are starting values, not clinically validated.
- Do not rename fields in the data contract without updating `AGENTS.md` and telling the team.
- Do not invent numbers for citations; mark placeholders as placeholders.

## 6. When you finish
- Update the status board row and add decisions-log lines (adaptation default, baseline window, threshold ratio) in `AGENTS.md`.
- Add new sources to `knowledge/sources.json`, then run `node tools/build-docs.mjs` (never hand-edit generated files).
- PR description: what changed, before/after false-alert counts, which flags are still off.
