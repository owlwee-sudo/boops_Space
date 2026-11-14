# WESAD stress classifier: report (H3)

*2026-11-14 · Prototype · Not a medical device · Risk indicator, not a diagnosis*

## Summary

- Trained on **real labelled data** (WESAD: 15 people, lab stress). Never trained on our simulated mission data.
- Tested **leave-one-subject-out (LOSO)**: each person is scored by a model that never saw them.
- **Headline: 91.0 % accuracy** (balanced accuracy 89.8 %, F1 0.85) for stress vs non-stress from wrist signals, logistic regression, per-person z-scores. Always answering "not stressed" scores 70.2 %.
- **Per-person normalisation matters:** 85.5 % with raw values, 91.0 % with per-person z-scores, 95.4 % against each person's own calm baseline. This supports the app's personal-baseline design.
- **Important catch:** the wrist heartbeat signal is badly corrupted by arm movement during the stress task. Wrist "HRV" in WESAD is mostly noise. See section 4.
- **This does not validate the app for spaceflight.** Lab stress in 15 young adults on Earth is not months of stress in orbit. The config flag stays on `"rules"` by default.

## 1. Reproduce

```bash
python hard/wesad/train.py
```

This builds the feature table if it is missing (needs `hard/wesad/data/WESAD.zip`, see `README.md`), runs every LOSO evaluation below, and rewrites `results.json`, `model.json`, `model.joblib` and `web/models/wesad_stress_model.json`. About 3 minutes on a laptop CPU. Random seed is fixed (0). Every number in this report is in `results.json`.

## 2. Method

| Step | What we did |
|---|---|
| Data | WESAD (Schmidt et al. 2018). 15 subjects (S2–S17, no S12). Wrist device: Empatica E4 (BVP 64 Hz, EDA 4 Hz, TEMP 4 Hz, ACC 32 Hz). Chest device: RespiBAN (ECG 700 Hz used only for the heartbeat check and the "daily" model). |
| Labels | Stress (label 2: public speaking + mental arithmetic) vs non-stress (baseline 1 + amusement 3). Meditation, transitions and undefined labels are dropped. |
| Windows | 60 s, 30 s overlap. A window is kept only if it lies fully inside one phase. 1015 windows: 302 stress, 713 non-stress. Also tried 30 s windows (2121 windows). |
| Features (11, wrist) | Heart: HR, RMSSD, SDNN, pNN50 from BVP peaks (NeuroKit2). EDA: tonic level, sweat-response count and mean size. Temperature: mean, slope. Movement: acceleration size mean and SD. |
| Heartbeat clean-up | An interval is dropped if it is outside 40–180 bpm or more than 20 % away from the median of its 10 neighbours. A window with fewer than 20 clean beats gets empty heart features (filled with the training median). |
| Normalisation | **none** (raw), **subject** (z-score against all of that person's windows, needs no labels), **baseline** (z-score against that person's calm baseline phase: what the app does with flight days 1–14). |
| Models | Logistic regression (interpretable, exported), random forest (300 trees), gradient boosting (200 trees). Balanced class weights for the first two. |
| Evaluation | LOSO only. Accuracy, balanced accuracy, F1 for the stress class, and the spread across the 15 people. |

## 3. Results (60 s windows, LOSO)

### Wrist features, the three models

| Normalisation | Model | Accuracy | Balanced acc. | F1 (stress) | Per-person mean ± SD | Worst person |
|---|---|---|---|---|---|---|
| none | Logistic regression | 0.855 | 0.853 | 0.777 | 0.855 ± 0.128 | 0.536 |
| none | Random forest | 0.897 | 0.872 | 0.824 | 0.896 ± 0.080 | 0.738 |
| none | Gradient boosting | 0.879 | 0.858 | 0.799 | 0.879 ± 0.097 | 0.638 |
| **subject** | **Logistic regression** | **0.910** | **0.898** | **0.852** | **0.911 ± 0.107** | **0.638** |
| subject | Random forest | 0.912 | 0.880 | 0.845 | 0.913 ± 0.116 | 0.652 |
| subject | Gradient boosting | 0.898 | 0.866 | 0.821 | 0.899 ± 0.122 | 0.580 |
| baseline | Logistic regression | 0.954 | 0.948 | 0.923 | 0.953 ± 0.069 | 0.776 |
| baseline | Random forest | 0.946 | 0.932 | 0.908 | 0.945 ± 0.069 | 0.788 |
| baseline | Gradient boosting | 0.923 | 0.893 | 0.864 | 0.923 ± 0.108 | 0.667 |

The bold row is the headline. The simple logistic regression is as good as the tree models here, so it is the one we export.

### Confusion matrix (headline row)

| | Predicted non-stress | Predicted stress |
|---|---|---|
| **True non-stress** (713) | 662 | 51 |
| **True stress** (302) | 40 | 262 |

Recall 86.8 % (40 of 302 stress windows missed). Precision 83.7 % (51 false alarms).

### Per person (headline row)

| S2 | S3 | S4 | S5 | S6 | S7 | S8 | S9 | S10 | S11 | S13 | S14 | S15 | S16 | S17 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0.92 | 0.82 | 1.00 | 0.96 | 1.00 | 0.97 | 0.97 | 0.85 | 1.00 | 0.77 | 1.00 | 0.64 | 0.99 | 0.99 | 0.80 |

The average hides a wide spread: 5 people are classified perfectly, S14 only 64 %. A new crew member could be an "S14".

### Which features carry it (logistic regression, LOSO)

| Feature set | none | subject | baseline |
|---|---|---|---|
| All 11 wrist features | 0.855 | 0.910 | 0.954 |
| Without movement (9) | 0.855 | 0.905 | 0.955 |
| EDA + temperature only (5) | 0.800 | 0.894 | 0.899 |
| "Daily" set (3): ECG heart rate, ECG RMSSD, wrist EDA level | 0.830 | 0.945 | 0.945 |

Removing movement barely changes the result, so the model is not just detecting "standing and talking". Most of the signal is skin conductance and heart rate.

### 30 s windows

Headline row with 30 s windows: accuracy 0.890, balanced 0.876, F1 0.821. Slightly worse than 60 s. Shorter windows give noisier heart and EDA features.

### Compared with the WESAD paper

Schmidt et al. report up to about 93 % accuracy for the same two-class problem using chest sensors, and lower figures (high 80s) for the wrist alone. Our 91.0 % wrist result is in the same range. It is **not** a like-for-like comparison: window step, feature set and labels handling differ. Our 95 % figures use the person's known calm phase for normalisation, which the paper's models did not get, so they must not be quoted against the paper.

## 4. The wrist heartbeat problem

We checked the wrist pulse (BVP) against the chest ECG recorded at the same time:

| Phase | Clean beats, wrist | Clean beats, ECG | HR wrist | HR ECG | RMSSD wrist | RMSSD ECG |
|---|---|---|---|---|---|---|
| Baseline | 72 % | 99 % | 71.8 | 72.4 | 92 ms | 48 ms |
| Stress | 52 % | 97 % | 84.7 | 97.9 | 104 ms | 29 ms |
| Amusement | 65 % | 98 % | 70.2 | 72.8 | 95 ms | 47 ms |

- Under stress the true heart rate rises to about 98 bpm and true RMSSD **falls** to 29 ms. That is the textbook stress response.
- The wrist sensor sees a heart rate 13 bpm too low and an RMSSD that **rises**. People gesture and shift while speaking, and the pulse wave at the wrist breaks up.
- So a model fed wrist "HRV" learns sensor noise, not physiology. In our headline model the wrist HRV weights are small and partly have the wrong sign (SDNN +0.57).

What we did about it:

1. The headline wrist model is reported as is, with this warning.
2. The small **"daily" model**, the only one the app can actually use, takes its heart rate and RMSSD from the **ECG** so that it learns real physiology. Our app's daily HRV is assumed to be a clean resting measurement, which the ECG matches and the moving wrist does not.

Lesson for the app: wrist HRV during activity should not be trusted. Use resting or sleep HRV, and keep `signal_quality` next to every reading.

## 5. The model the app can use ("daily")

Our `daily_records` hold daily values, not raw signals. Only three WESAD features have a daily counterpart:

| WESAD feature | App field | Weight (standardised) |
|---|---|---|
| Heart rate (ECG) | `rhr_bpm` | +4.60 |
| RMSSD (ECG) | `hrv_rmssd_ms` | +0.05 |
| EDA tonic level (wrist) | `eda_mean_us` | +5.00 |

Input: personal-baseline z-scores. LOSO accuracy 94.5 % (balanced 93.2 %, F1 0.91, worst person 80 %).

Missing in daily data, so not used: sweat-response count and size (need raw EDA), temperature slope (needs within-day temperature), movement, SDNN, pNN50.

Example outputs (`python hard/wesad/stress_model.py`): all z = 0 gives score 1. z = (+2, −2, +2) gives 57. z = (+3, −3, +3) gives 93.

### Why this transfer is weak (read before switching it on)

1. **RMSSD gets almost no weight.** In short lab stress, heart rate already says what RMSSD says, so the model ignores it. Our rules engine treats HRV as the main stress signal (decisions log). The WESAD model would miss strain that shows in HRV while resting heart rate stays normal.
2. **Different time scale.** WESAD: 60 s windows during a 10-minute stress task. App: one value per day. A z-score of +10 "baseline-window SDs" in WESAD is not the same thing as +2 "day-to-day SDs" in flight. The score is in the right direction, its calibration (what counts as 50) is not trustworthy.
3. **Different kind of stress.** Public speaking and arithmetic for minutes vs workload, isolation and sleep loss for months.
4. **Different bodies and place.** 15 young adults (mostly men) in a lab on Earth. In flight, fluid shift alone moves resting heart rate.
5. **Skin conductance** depends on temperature, humidity and sensor contact, all different on a station.

So: `STRESS_MODEL = "rules"` stays the default. `"wesad"` is a second opinion to show next to the rules score, with the label "trained on lab data".

## 6. Limits

- 15 people. Per-person accuracy ranges from 64 % to 100 %. Confidence in any single number is low.
- Lab stress is not spaceflight stress. Nothing here was measured in microgravity.
- Wrist heartbeat quality is poor during movement (section 4).
- Overlapping windows from one person are not independent. LOSO handles this for accuracy, but 1015 windows is not 1015 independent tests.
- "baseline" normalisation assumes a known calm period for each person. True in the app (flight days 1–14, though those are also the adaptation phase), an advantage in the lab.
- Two classes only. Amusement and baseline are merged, so "non-stress" is not "relaxed".
- The model outputs a probability from a lab task. It is a risk indicator and must never be shown as a diagnosis.

## 7. Files

| File | What |
|---|---|
| `prepare.py` | Raw WESAD → feature table (`cache/features_w60.csv`). Reads the pickles with a numpy-only unpickler. |
| `train.py` | LOSO evaluation + export. The one command. |
| `results.json` | Every number above, plus per-person accuracy for every run. |
| `model.json` | Logistic-regression weights for `wrist_all` and `daily`. Copied to `web/models/wesad_stress_model.json`. |
| `model.joblib` | scikit-learn pipeline for `wrist_all` (Python only, scikit-learn 1.9.1). |
| `stress_model.py` | Integration hook: `wesad_stress_score(z_rhr, z_hrv, z_eda)`, plain Python. |
| `web/lib/wesad-stress.js` | Same model in the dashboard, no libraries. |
| `tests/test_wesad_model.py` | Python = scikit-learn = JavaScript, safe loading, reproducible headline. |

## References

WESAD: Schmidt, Reiss, Duerichen, Marberger, Van Laerhoven (2018), ICMI. NeuroKit2: Makowski et al. (2021). scikit-learn: Pedregosa et al. (2011). Full entries in `knowledge/sources.json`.
