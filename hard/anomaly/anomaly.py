"""anomaly.py: Isolation Forest second opinion for odd readings (H4).

Question it helps answer: "Is this odd reading the DEVICE or the ASTRONAUT?"

How it works, per astronaut:
  1. Personal baseline = in-flight days 1-14 (same as the rest of the app).
  2. Every day becomes a row of numbers: how far each vital is from the
     baseline (z-score) and how much it jumped since yesterday.
  3. An Isolation Forest learns what the baseline days look like. No labels.
  4. Every later day gets an anomaly_score (0-1). 0.5 or more = unusual.
  5. point_vs_trend says whether an unusual day stands alone ("point": looks
     like a device fault) or is part of a run of unusual days ("trend":
     looks like the body).

It is UNSUPERVISED: it never sees which days are glitches or illness. The
planted events are used only by the tests, to check the results.

INTEGRATION HOOK: data_quality.check_reading(..., anomaly_score=None) may call
suggest_status() below. The safety rule still wins and stays in
check_reading(): never delete a reading, and dangerous-if-real values -> act_now.

Prototype. Not a medical device. A risk indicator, never a diagnosis.
"""

import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
BASELINE_DAYS = (1, 14)  # personal baseline period (inclusive)
VITALS = ["rhr_bpm", "hrv_rmssd_ms", "sleep_hours", "temp_c", "spo2_pct"]
# Two summary numbers help the forest see a fault in ONE sensor: with 11
# separate features, a single wild value is easy to miss.
SUMMARY = ["worst_z", "worst_jump"]  # largest deviation / largest jump of the day
FEATURES = VITALS + ["signal_quality"] + [f"{v}_jump" for v in VITALS] + SUMMARY

SEED = 0
N_TREES = 300
# 14 days are too few points for a forest. We add jittered copies of the real
# baseline days (each copy = a real day plus a little noise), so the forest
# sees a smooth cloud instead of 14 dots. No new information is invented.
N_JITTERED = 600
JITTER_SD = 1.0  # noise size, in baseline standard deviations
# A day is "unusual" when its raw forest score is above this share of the
# (jittered) baseline scores. Higher = fewer alarms.
# JITTER_SD and THRESHOLD_QUANTILE were picked on the test fixture to keep
# false alarms on normal days under 5 % (see hard/anomaly/README.md). Re-check
# them when the real engine/generate_mission.py data exists.
THRESHOLD_QUANTILE = 0.99
SD_FLOOR = {"rhr_bpm": 1.0, "hrv_rmssd_ms": 2.0, "sleep_hours": 0.3, "temp_c": 0.1, "spo2_pct": 0.4, "signal_quality": 0.03}

# point_vs_trend
UNUSUAL_Z = 2.0  # a vital this many baseline SDs from normal counts as "off"
TREND_MIN_DAYS = 2  # this many days in a row -> trend
TREND_SIMILAR = 0.33  # ...and the neighbouring day must be at least a third as far off as today

# suggest_status
LOW_SIGNAL_QUALITY = 0.6
ANOMALY_AT = 0.5  # anomaly_score at or above this = unusual


# ---------------------------------------------------------------------------
# Features
# ---------------------------------------------------------------------------
def _baseline_stats(days):
    """Mean and SD of each feature over the baseline days (with a floor on SD)."""
    base = days[(days["mission_day"] >= BASELINE_DAYS[0]) & (days["mission_day"] <= BASELINE_DAYS[1])]
    stats = {}
    for col in VITALS + ["signal_quality"]:
        stats[col] = (float(base[col].mean()), max(float(base[col].std(ddof=0)), SD_FLOOR[col]))
    for col in VITALS:
        jumps = base[col].diff().dropna()
        stats[f"{col}_jump"] = (0.0, max(float(jumps.std(ddof=0)) if len(jumps) else 0.0, SD_FLOOR[col]))
    return stats


def make_features(days):
    """One astronaut's days -> table of z-scores and day-to-day jumps.

    `days` must be sorted by mission_day. Missing values become 0 (= "normal"),
    so a gap in the data is never called an anomaly by itself.
    """
    stats = _baseline_stats(days)
    out = pd.DataFrame(index=days.index)
    for col in VITALS + ["signal_quality"]:
        mean, sd = stats[col]
        out[col] = (days[col] - mean) / sd
    for col in VITALS:
        _, sd = stats[f"{col}_jump"]
        out[f"{col}_jump"] = days[col].diff() / sd
    out = out.fillna(0.0)
    out["worst_z"] = out[VITALS].abs().max(axis=1)
    out["worst_jump"] = out[[f"{v}_jump" for v in VITALS]].abs().max(axis=1)
    return out[FEATURES], stats


# ---------------------------------------------------------------------------
# Isolation Forest per astronaut
# ---------------------------------------------------------------------------
def score_astronaut(days, seed=SEED):
    """Anomaly score for every day of one astronaut.

    Returns a table with: mission_day, anomaly_score (0-1, >= 0.5 unusual),
    is_anomaly, point_vs_trend ("point" | "trend" | "new" | ""), top_factors.
    """
    days = days.sort_values("mission_day").reset_index(drop=True)
    features, _ = make_features(days)
    in_baseline = (days["mission_day"] >= BASELINE_DAYS[0]) & (days["mission_day"] <= BASELINE_DAYS[1])
    base = features[in_baseline].to_numpy()
    if len(base) < 5:
        raise ValueError("Need at least 5 baseline days to fit the anomaly detector")

    rng = np.random.default_rng(seed)
    picks = rng.integers(0, len(base), N_JITTERED)
    cloud = np.vstack([base, base[picks] + rng.normal(0, JITTER_SD, (N_JITTERED, base.shape[1]))])
    forest = IsolationForest(n_estimators=N_TREES, contamination="auto", random_state=seed).fit(cloud)

    raw = -forest.score_samples(features.to_numpy())  # higher = more unusual
    raw_base = -forest.score_samples(cloud)
    typical = float(np.median(raw_base))
    threshold = float(np.quantile(raw_base, THRESHOLD_QUANTILE))
    # Rescale so that 0 = a typical baseline day and 0.5 = the alarm threshold.
    score = np.clip(0.5 * (raw - typical) / max(threshold - typical, 1e-9), 0.0, 1.0)

    out = pd.DataFrame({
        "astronaut_id": days["astronaut_id"].to_numpy(),
        "mission_day": days["mission_day"].to_numpy(),
        "anomaly_score": np.round(score, 3),
    })
    # Unusual = the forest says so AND at least one vital is really off today.
    # (The day after a glitch shows a big jump BACK to normal: that is not odd.)
    really_off = features["worst_z"].to_numpy() >= UNUSUAL_Z
    out["is_anomaly"] = (out["anomaly_score"] >= ANOMALY_AT) & really_off & ~in_baseline.to_numpy()
    out["point_vs_trend"] = point_vs_trend(features, out["is_anomaly"].to_numpy())
    out["top_factors"] = [_top_factors(features.iloc[i]) if flag else "" for i, flag in enumerate(out["is_anomaly"])]
    return out


def _top_factors(row, k=3):
    """The vitals furthest from normal on that day, as text (for the reasons list)."""
    z = row[VITALS + ["signal_quality"]]
    worst = z.abs().sort_values(ascending=False).head(k)
    return ";".join(f"{name} {z[name]:+.1f} SD" for name in worst.index if abs(z[name]) >= 1.0)


# ---------------------------------------------------------------------------
# point_vs_trend: one odd day, or a run of them?
# ---------------------------------------------------------------------------
def point_vs_trend(features, is_anomaly):
    """For each unusual day: "point", "trend" or "new".

    A vital is "off" on a day when it is UNUSUAL_Z baseline SDs from normal.
      trend  the same vital is off in the same direction on a neighbouring day
             too (yesterday or tomorrow): the body is doing something.
      point  nothing is off on the day before or after: looks like a one-off
             device fault.
      new    it is the latest day we have, so we cannot know yet. Treated as
             "could be the body" to stay on the safe side.
    """
    z = features[VITALS].to_numpy()
    off = np.sign(z) * (np.abs(z) >= UNUSUAL_Z)  # -1, 0, +1 per vital per day
    n = len(z)
    kinds = [""] * n

    def same_problem(i, j):
        """Is day j off in the same vital, same direction, and similar size as day i?"""
        similar = np.abs(z[j]) >= TREND_SIMILAR * np.abs(z[i])
        return bool(np.any((off[i] != 0) & (off[j] == off[i]) & similar))

    for i in range(n):
        if not is_anomaly[i]:
            continue
        run = 1
        for step in (-1, 1):  # look back, then forward
            j = i + step
            while 0 <= j < n and same_problem(i, j):
                run += 1
                j += step
        if run >= TREND_MIN_DAYS:
            kinds[i] = "trend"
        elif i == n - 1:
            kinds[i] = "new"
        else:
            kinds[i] = "point"
    return kinds


# ---------------------------------------------------------------------------
# INTEGRATION HOOK for data_quality.check_reading()
# ---------------------------------------------------------------------------
def suggest_status(anomaly_score, signal_quality, kind, symptoms="", eva=0):
    """Second opinion on an odd reading. Returns (status, reason) or (None, "").

    status is one of the data_quality statuses: "check_device", "check_yourself",
    "act_now". None means "nothing unusual, no opinion".

    Rule (from the handoff), first match wins:
      unusual on an EVA day, no symptoms      -> no alarm (a spacewalk explains it)
      unusual + symptoms                      -> act_now  (check_yourself if no trend yet)
      unusual + low signal quality            -> check_device
      unusual + multi-day trend               -> check_yourself
      unusual + single-day spike ("point")    -> check_device
      unusual + only today ("new")            -> check_yourself (safe side; re-checked tomorrow)

    THE CALLER STILL APPLIES THE SAFETY RULE: never delete the reading, and a
    value that would be dangerous if real is act_now whatever this says.
    """
    if anomaly_score is None or anomaly_score < ANOMALY_AT:
        return None, ""
    has_symptoms = bool(symptoms and str(symptoms).strip())
    if eva and not has_symptoms and not (signal_quality is not None and signal_quality < LOW_SIGNAL_QUALITY):
        return None, "Unusual reading on an EVA day: expected after a spacewalk."
    if has_symptoms:
        status = "act_now" if kind == "trend" else "check_yourself"
        return status, "Unusual pattern together with logged symptoms: more likely the body than the device."
    if signal_quality is not None and signal_quality < LOW_SIGNAL_QUALITY:
        return "check_device", "Unusual reading with low signal quality: check the sensor and measure again."
    if kind == "trend":
        return "check_yourself", "Unusual pattern for several days in a row: more likely the body than the device."
    if kind == "point":
        return "check_device", "One-day spike with normal days around it: check the sensor and measure again."
    return "check_yourself", "Unusual reading today with good signal quality: measure again and note how you feel."


# ---------------------------------------------------------------------------
# Whole mission
# ---------------------------------------------------------------------------
def score_mission(table, seed=SEED):
    """Score every astronaut. `table` follows the daily_records data contract."""
    parts = []
    for _, days in table.groupby("astronaut_id", sort=True):
        scored = score_astronaut(days, seed)
        days = days.sort_values("mission_day").reset_index(drop=True)
        symptoms = days["symptoms"].fillna("") if "symptoms" in days else pd.Series([""] * len(days))
        eva = days["eva"].fillna(0) if "eva" in days else pd.Series([0] * len(days))
        suggestions = [
            suggest_status(row.anomaly_score if row.is_anomaly else 0.0, days["signal_quality"].iloc[i],
                           row.point_vs_trend, symptoms.iloc[i], int(eva.iloc[i]))
            for i, row in enumerate(scored.itertuples())
        ]
        scored["suggested_status"] = [s[0] or "" for s in suggestions]
        scored["reason"] = [s[1] for s in suggestions]
        parts.append(scored)
    return pd.concat(parts, ignore_index=True)
