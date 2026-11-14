# Isolation Forest anomaly detector (H4)

An unsupervised second opinion for the odd-reading checker (F4): **is it the device or the astronaut?** No labels are used. Prototype · Not a medical device.

## How it works

Per astronaut:

1. Personal baseline = in-flight days 1–14.
2. Each day becomes 13 numbers: the z-score of `rhr_bpm`, `hrv_rmssd_ms`, `sleep_hours`, `temp_c`, `spo2_pct` and `signal_quality` against the baseline, the day-to-day jump of the five vitals, plus the largest deviation and largest jump of the day.
3. An Isolation Forest (scikit-learn, 300 trees) is fitted on the baseline days. Fourteen points are too few for a forest, so it also gets 600 jittered copies of those days (a real day plus noise of 1 baseline SD). Nothing else is added.
4. Every later day gets `anomaly_score` from 0 to 1. **0.5 or more = unusual**, and only if at least one vital is 2 SD or more from baseline.
5. `point_vs_trend` for each unusual day:
   - `point`: no neighbouring day is off in the same way. Looks like a device fault.
   - `trend`: the day before or after is off in the same vital, same direction, at least a third as far. Looks like the body.
   - `new`: latest day, cannot know yet. Treated as "could be the body".

## Rule (the integration hook)

`anomaly.suggest_status(anomaly_score, signal_quality, kind, symptoms, eva)` returns a suggestion for `data_quality.check_reading()`. First match wins:

| Situation | Suggestion |
|---|---|
| Not unusual | none |
| Unusual on an EVA day, no symptoms, good signal | none ("expected after a spacewalk") |
| Unusual + symptoms | `act_now` if trend, else `check_yourself` |
| Unusual + low `signal_quality` (< 0.6) | `check_device` |
| Unusual + multi-day trend | `check_yourself` |
| Unusual + single-day spike | `check_device` |
| Unusual, latest day only | `check_yourself` |

**The safety rule still wins and stays in `check_reading()`:** never delete a reading, and a value that would be dangerous if real is `act_now` whatever this module says. This module only adds an opinion.

How `data_quality.py` can use it (optional input, off unless passed):

```python
def check_reading(reading, ..., anomaly_score=None, anomaly_kind=""):
    ...
    if anomaly_score is not None:
        from hard.anomaly.anomaly import suggest_status
        status, reason = suggest_status(anomaly_score, reading["signal_quality"], anomaly_kind,
                                        reading.get("symptoms", ""), reading.get("eva", 0))
        # use as one more input to the funnel, then apply the safety rule
```

## Run

```bash
python hard/anomaly/run_anomaly.py --fixture
```

Demo on the simulated test fixture. Prints the unusual days, writes nothing.

```bash
python hard/anomaly/run_anomaly.py --merge
```

Reads `data/daily_records.csv`, writes `data/anomaly_scores.json`, and with `--merge` adds `data_quality.anomaly_score` and `data_quality.anomaly_kind` to `data/engine_output.json` so the dashboard can show them. Without `--merge` the easy pipeline's output is not touched.

Tests: `pytest tests/test_anomaly.py`.

## Results

**These numbers are from a simulated test fixture, not from the project's mission data.** `engine/generate_mission.py` did not exist when this was built, so `tests/fixtures/demo_mission.py` stands in for it: 3 astronauts, 180 days, the demo story from `AGENTS.md` (A1 EVAs, bad sleep, infection on days 95–98, three one-day sensor glitches). The planted events are used only to check results.

Over 20 random fixture missions:

| Check (the "done when" list) | Result |
|---|---|
| The 3 planted glitches are flagged `check_device` | 60 of 60. Lowest anomaly score 0.73. |
| A1's infection days 95–98 are not called device errors | 0 of 80 called `check_device`. 56 of 80 flagged: 22 `check_yourself`, 34 `act_now`. 24 not flagged. |
| False alarms on normal days | **1.3 %** on average (0.0 % to 4.2 % per mission, 473 normal days each). Target was under about 5 %. |
| EVA days called device errors | 0 of 40 |

## Limits

- **Tuned on the fixture.** `JITTER_SD` and `THRESHOLD_QUANTILE` in `anomaly.py` were chosen on the fixture. Re-run the tests on the real `data/daily_records.csv` and adjust if false alarms exceed 5 %.
- **On simulated data it mostly learns the simulator.** Passing these checks shows the method behaves sensibly. It does not show it works on real astronauts.
- **It misses some illness days** (24 of 80 infection days not flagged). That is by design: the infection early warning (resting HR ≥ 2 SD for ≥ 2 days) is the primary detector. This module only helps decide device vs body.
- **A real one-day event looks like a device fault.** A single bad night or a hard workout is a one-day spike. EVA days are excused. Other context (exercise, symptoms) should be passed in by the checker, and the reading is never deleted.
- **First day of an illness.** Looking back, day 1 is a `trend` because day 2 follows. Live, on the day itself, it is `new` and the suggestion is `check_yourself`, not `check_device`.
- **Baseline is the adaptation phase.** Days 1–14 include the fluid shift, so the "normal" cloud is a little off for the rest of the mission. The wide jitter absorbs some of it.
- **The score is coarse.** An Isolation Forest says "outside what I have seen", not "how far outside". A 30 SD glitch and a 5 SD illness can score alike. Use `top_factors` for the size.

## References

Isolation Forest: Liu, Ting, Zhou (2008). scikit-learn: Pedregosa et al. (2011). Entries in `knowledge/sources.json`.
