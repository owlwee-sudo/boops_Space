"""prepare.py: turn the raw WESAD recordings into one table of features (H3).

WESAD (Schmidt et al. 2018) = 15 people wearing a chest and a wrist sensor in
the lab, with labelled phases: baseline, stress (public speaking + mental
arithmetic), amusement (funny videos).

We use the WRIST sensor (Empatica E4), because it is the closest thing to the
wearable in our app:
    BVP  64 Hz  pulse wave      -> heart rate + HRV
    EDA   4 Hz  skin conductance -> sweat response
    TEMP  4 Hz  skin temperature
    ACC  32 Hz  movement

We ALSO compute heart rate + HRV from the chest ECG (700 Hz). Reason: the wrist
pulse wave is wrecked by arm movement during the stress task, so wrist "HRV"
there is mostly noise (see REPORT.md). The ECG columns are the trustworthy
heartbeat and are what the small "daily" model uses.

Output: hard/wesad/cache/features_w60.csv  (one row per 60 s window)

Run:  python hard/wesad/prepare.py            (reads hard/wesad/data/WESAD.zip)
      python hard/wesad/prepare.py --window 30

The dataset is ~2.2 GB zipped and is NOT in the repo. Get it from the link on
https://ubi29.informatik.uni-siegen.de/usi/data_wesad.html and save it as
hard/wesad/data/WESAD.zip (see hard/wesad/README.md).
"""

import argparse
import io
import pickle
import sys
import warnings
import zipfile
from pathlib import Path

import numpy as np
import pandas as pd

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
HERE = Path(__file__).resolve().parent
DATA_ZIP = HERE / "data" / "WESAD.zip"
CACHE_DIR = HERE / "cache"

SUBJECTS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 14, 15, 16, 17]  # S1 and S12 do not exist
WINDOW_S = 60
STEP_S = 30  # 30 s overlap between neighbouring windows

FS_LABEL = 700  # labels are stored at the chest sensor's rate
FS = {"BVP": 64, "EDA": 4, "TEMP": 4, "ACC": 32, "ECG": 700}

# WESAD label codes. 0 = transition, 4 = meditation, 5-7 = ignore.
LABEL_BASELINE, LABEL_STRESS, LABEL_AMUSEMENT = 1, 2, 3
KEEP_LABELS = {LABEL_BASELINE, LABEL_STRESS, LABEL_AMUSEMENT}

# Heartbeat clean-up (same rules as the camera check)
IBI_MIN_S, IBI_MAX_S = 0.33, 1.5  # 180 to 40 bpm
IBI_MAX_DEVIATION = 0.2  # drop beats more than 20 % away from the median of their neighbours
IBI_NEIGHBOURS = 5  # ...looking 5 beats to each side
MIN_BEATS = 20  # fewer clean beats in a window -> heart features left empty

# Wrist features (the handoff's feature list)
FEATURES = [
    "hr_mean", "hrv_rmssd", "hrv_sdnn", "hrv_pnn50",
    "eda_tonic_mean", "eda_scr_count", "eda_scr_amp_mean",
    "temp_mean", "temp_slope",
    "acc_mag_mean", "acc_mag_sd",
]
# Chest-ECG heart features (trustworthy heartbeat) + how clean each source was
ECG_FEATURES = ["ecg_hr_mean", "ecg_hrv_rmssd", "ecg_hrv_sdnn", "ecg_hrv_pnn50"]
QUALITY_COLUMNS = ["bvp_clean_share", "ecg_clean_share"]


# ---------------------------------------------------------------------------
# Safe loading: the .pkl files are Python pickles. A pickle can run code when
# opened, so we only allow the few numpy pieces these files really need.
# ---------------------------------------------------------------------------
class NumpyOnlyUnpickler(pickle.Unpickler):
    ALLOWED = {
        ("numpy.core.multiarray", "_reconstruct"),
        ("numpy._core.multiarray", "_reconstruct"),
        ("numpy.core.multiarray", "scalar"),
        ("numpy._core.multiarray", "scalar"),
        # NumPy >= 2 with pickle protocol 5 rebuilds arrays through _frombuffer.
        ("numpy.core.numeric", "_frombuffer"),
        ("numpy._core.numeric", "_frombuffer"),
        ("numpy", "ndarray"),
        ("numpy", "dtype"),
        ("_codecs", "encode"),
    }

    def find_class(self, module, name):
        if (module, name) not in self.ALLOWED:
            raise pickle.UnpicklingError(f"Blocked: {module}.{name} is not allowed in a WESAD file")
        if module.startswith("numpy"):
            import numpy._core.multiarray as multiarray

            if name == "_frombuffer":
                import numpy._core.numeric as numeric

                return numeric._frombuffer
            return getattr(multiarray, name) if name in ("_reconstruct", "scalar") else getattr(np, name)
        import _codecs

        return getattr(_codecs, name)


def load_subject(source, subject):
    """Return the unpickled dict for one subject from the zip (or a folder)."""
    name = f"WESAD/S{subject}/S{subject}.pkl"
    if source.is_dir():
        with open(source / f"S{subject}" / f"S{subject}.pkl", "rb") as f:
            return NumpyOnlyUnpickler(f, encoding="latin1").load()
    with zipfile.ZipFile(source) as z, z.open(name) as f:
        # Read through a buffer: unzipping ~900 MB takes 10-20 s per person.
        return NumpyOnlyUnpickler(io.BufferedReader(f, buffer_size=1 << 24), encoding="latin1").load()


# ---------------------------------------------------------------------------
# Whole-recording signal processing (done once per person, then cut in windows)
# ---------------------------------------------------------------------------
def find_heartbeats(bvp):
    """Sample positions of the pulse peaks in the wrist BVP signal (NeuroKit2)."""
    import neurokit2 as nk

    cleaned = nk.ppg_clean(bvp, sampling_rate=FS["BVP"])
    return np.asarray(nk.ppg_findpeaks(cleaned, sampling_rate=FS["BVP"])["PPG_Peaks"])


def find_ecg_beats(ecg):
    """Sample positions of the R peaks in the chest ECG (NeuroKit2)."""
    import neurokit2 as nk

    cleaned = nk.ecg_clean(ecg, sampling_rate=FS["ECG"])
    _, info = nk.ecg_peaks(cleaned, sampling_rate=FS["ECG"])
    return np.asarray(info["ECG_R_Peaks"])


def split_eda(eda):
    """Slow level (tonic) and fast sweat responses (phasic) with NeuroKit2."""
    import neurokit2 as nk

    parts = nk.eda_phasic(eda, sampling_rate=FS["EDA"], method="highpass")
    tonic = parts["EDA_Tonic"].to_numpy()
    phasic = parts["EDA_Phasic"].to_numpy()
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        _, info = nk.eda_peaks(phasic, sampling_rate=FS["EDA"], amplitude_min=0.05)
    peaks = np.asarray(info["SCR_Peaks"], dtype=float)
    amps = np.asarray(info["SCR_Amplitude"], dtype=float)
    ok = np.isfinite(peaks) & np.isfinite(amps)
    return tonic, peaks[ok].astype(int), amps[ok]


# ---------------------------------------------------------------------------
# Features for one window
# ---------------------------------------------------------------------------
def heart_features(peak_times, prefix=""):
    """Heart rate and HRV from the beat times (seconds) inside one window.

    Also returns `clean_share`: the share of beat-to-beat intervals that look
    like real heartbeats. A low share means the sensor was mostly reading noise.
    """
    names = ["hr_mean", "hrv_rmssd", "hrv_sdnn", "hrv_pnn50"]
    out = {prefix + n: np.nan for n in names}
    out["clean_share"] = 0.0
    if len(peak_times) < 3:
        return out
    ibi = np.diff(peak_times)
    # Compare each interval with the median of its neighbours.
    k = IBI_NEIGHBOURS
    padded = np.pad(ibi, k, mode="edge")
    local = np.array([np.median(padded[i:i + 2 * k + 1]) for i in range(len(ibi))])
    ok = (ibi >= IBI_MIN_S) & (ibi <= IBI_MAX_S) & (np.abs(ibi - local) <= IBI_MAX_DEVIATION * local)
    out["clean_share"] = float(ok.mean())
    if ok.sum() < MIN_BEATS:
        return out
    # Beat-to-beat changes only between two neighbouring CLEAN intervals.
    both = ok[1:] & ok[:-1]
    diffs_ms = (np.diff(ibi) * 1000)[both]
    clean = ibi[ok]
    out[prefix + "hr_mean"] = 60.0 / clean.mean()
    out[prefix + "hrv_sdnn"] = float(clean.std() * 1000)
    if len(diffs_ms) >= 5:
        out[prefix + "hrv_rmssd"] = float(np.sqrt(np.mean(diffs_ms**2)))
        out[prefix + "hrv_pnn50"] = float(np.mean(np.abs(diffs_ms) > 50) * 100)
    return out


def subject_windows(data, window_s=WINDOW_S, step_s=STEP_S):
    """All labelled windows for one person, as a list of dict rows."""
    signals = data["signal"]["wrist"]
    labels = np.asarray(data["label"]).ravel()
    bvp = np.asarray(signals["BVP"], dtype=float).ravel()
    eda = np.asarray(signals["EDA"], dtype=float).ravel()
    temp = np.asarray(signals["TEMP"], dtype=float).ravel()
    acc = np.asarray(signals["ACC"], dtype=float) / 64.0  # E4 units: 1/64 g
    acc_mag = np.linalg.norm(acc, axis=1)

    beat_times = find_heartbeats(bvp) / FS["BVP"]
    ecg = np.asarray(data["signal"]["chest"]["ECG"], dtype=float).ravel()
    ecg_times = find_ecg_beats(ecg) / FS["ECG"]
    tonic, scr_peaks, scr_amps = split_eda(eda)
    scr_times = scr_peaks / FS["EDA"]

    duration = min(len(labels) / FS_LABEL, len(bvp) / FS["BVP"], len(eda) / FS["EDA"], len(acc_mag) / FS["ACC"])
    rows = []
    for start in np.arange(0, duration - window_s + 1e-9, step_s):
        end = start + window_s
        window_labels = labels[int(start * FS_LABEL):int(end * FS_LABEL)]
        label = int(window_labels[0])
        # Keep a window only if it sits fully inside ONE phase (no transitions).
        if label not in KEEP_LABELS or not np.all(window_labels == label):
            continue
        row = {"window_start_s": float(start), "wesad_label": label, "stress": int(label == LABEL_STRESS)}
        wrist = heart_features(beat_times[(beat_times >= start) & (beat_times < end)])
        row["bvp_clean_share"] = wrist.pop("clean_share")
        row.update(wrist)
        chest = heart_features(ecg_times[(ecg_times >= start) & (ecg_times < end)], prefix="ecg_")
        row["ecg_clean_share"] = chest.pop("clean_share")
        row.update(chest)

        in_scr = (scr_times >= start) & (scr_times < end)
        row["eda_tonic_mean"] = float(tonic[int(start * FS["EDA"]):int(end * FS["EDA"])].mean())
        row["eda_scr_count"] = int(in_scr.sum())
        row["eda_scr_amp_mean"] = float(scr_amps[in_scr].mean()) if in_scr.any() else 0.0

        t = temp[int(start * FS["TEMP"]):int(end * FS["TEMP"])]
        row["temp_mean"] = float(t.mean())
        row["temp_slope"] = float(np.polyfit(np.arange(len(t)) / FS["TEMP"] / 60.0, t, 1)[0])  # deg C per minute

        a = acc_mag[int(start * FS["ACC"]):int(end * FS["ACC"])]
        row["acc_mag_mean"] = float(a.mean())
        row["acc_mag_sd"] = float(a.std())
        rows.append(row)
    return rows


# ---------------------------------------------------------------------------
def build_features(source=DATA_ZIP, window_s=WINDOW_S, step_s=STEP_S, subjects=SUBJECTS):
    all_rows = []
    for subject in subjects:
        print(f"S{subject}: loading...", end=" ", flush=True)
        data = load_subject(source, subject)
        rows = subject_windows(data, window_s, step_s)
        del data  # ~1 GB per person: free it before the next one
        for row in rows:
            row["subject"] = f"S{subject}"
        n_stress = sum(r["stress"] for r in rows)
        print(f"{len(rows)} windows ({n_stress} stress, {len(rows) - n_stress} non-stress)")
        all_rows.extend(rows)
    columns = ["subject", "window_start_s", "wesad_label", "stress"] + FEATURES + ECG_FEATURES + QUALITY_COLUMNS
    return pd.DataFrame(all_rows)[columns]


def cache_path(window_s):
    return CACHE_DIR / f"features_w{int(window_s)}.csv"


def main():
    parser = argparse.ArgumentParser(description="WESAD wrist signals -> feature table")
    parser.add_argument("--data", default=str(DATA_ZIP), help="WESAD.zip, or the unzipped WESAD folder")
    parser.add_argument("--window", type=int, default=WINDOW_S, help="window length in seconds")
    parser.add_argument("--step", type=int, default=None, help="step in seconds (default: half the window)")
    parser.add_argument("--subjects", type=int, nargs="*", default=SUBJECTS)
    args = parser.parse_args()
    source = Path(args.data)
    if not source.exists():
        sys.exit(f"WESAD data not found at {source}. See hard/wesad/README.md for the download link.")
    step = args.step or args.window // 2
    table = build_features(source, args.window, step, args.subjects)
    CACHE_DIR.mkdir(exist_ok=True)
    out = cache_path(args.window)
    table.to_csv(out, index=False)
    print(f"\nSaved {len(table)} windows from {table['subject'].nunique()} people to {out}")
    print(table.groupby("stress").size().rename({0: "non-stress", 1: "stress"}).to_string())


if __name__ == "__main__":
    main()
