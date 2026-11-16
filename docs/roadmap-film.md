# Roadmap: learned fluid-shift correction (FiLM)

Status: **not built**. This is a note for later, from `docs/engine-upgrade-handoff.md` (T5).

## What we have today
The engine removes the expected fluid-shift change with a fixed curve per metric:

```
z = (x - (mean + A * exp(-day / tau))) / sd
```

`A` and `tau` are the same for every astronaut and are placeholders (`engine/analysis.py`, `ADAPTATION_CURVES`). Real crew adapt at different speeds and by different amounts.

## The idea
Let a small model learn the correction from data instead of fixing it by hand.
FiLM (feature-wise linear modulation) scales and shifts each feature based on an "adaptation state" `a`:

```
h' = gamma(a) * h + beta(a)
```

- `h`: the day's features (resting HR, HRV, blood pressure, ...).
- `a`: adaptation state, built from mission day plus fluid-shift markers (for example blood pressure change, face puffiness or leg volume if measured).
- `gamma(a)`, `beta(a)`: small learned functions. Today's curve is the special case `gamma = 1`, `beta = -A * exp(-day / tau)`.

## Why it is not built
- It needs **real** data that shows the adaptation: head-down-tilt bed-rest studies or published ISS day-by-day data (NASA OSDR is the first place to look).
- Our mission data is simulated with the same curve the engine removes. Training on it would only teach the model our own assumption, and the result could not be called validated.

## Before starting
1. Find a real analog dataset with daily heart rate, HRV and blood pressure across the first weeks. Cite it in `knowledge/sources.json`.
2. Replace the placeholder `A` and `tau` with ranges from that data first. That alone may be enough.
3. Only then try FiLM, and compare it against the fixed curve with leave-one-person-out testing.
4. Keep the fixed curve as the default until the learned version is better on real data.

## Also on the roadmap, not built
- **Time-lag models** (stress today, virus reactivation days later): need real multi-day data with outcomes.
- **H5 LSTM autoencoder**: optional, low value on simulated data.

Prototype · Not a medical device. Risk indicators and early warnings only.
