"""rppg_reference.py: Python reference for the browser camera heart-rate check (H1).

It repeats the maths of web/camera/rppg-core.js step by step (resample -> POS ->
band-pass -> FFT peak), so the JavaScript can be checked against an independent
implementation.

Two ways to use it:

  1. On a colour trace (numbers only, no video). In the browser console after a
     camera check:   copy(JSON.stringify(cameraCheck.getLastTrace()))
     paste into trace.json, then:
         python hard/rppg_reference.py trace.json

  2. On a recorded video (needs:  pip install opencv-python-headless mediapipe
     and the face model file web/vendor/mediapipe/face_landmarker.task):
         python hard/rppg_reference.py --video clip.mp4

Prototype. Not a medical device.
"""

import argparse
import json
import math
import sys

import numpy as np

# ---------------------------------------------------------------------------
# Config: keep these equal to CONFIG in web/camera/rppg-core.js
# ---------------------------------------------------------------------------
FS = 30.0  # Hz, steady processing rate
POS_WINDOW_S = 1.6
BAND_LOW_HZ = 0.7  # 42 bpm
BAND_HIGH_HZ = 3.0  # 180 bpm
HR_WINDOW_S = 10.0
HR_MIN_WINDOW_S = 6.0
FFT_SIZE = 4096
SNR_HALF_WIDTH_HZ = 0.1
FACE_MODEL = "web/vendor/mediapipe/face_landmarker.task"

# Skin patches in "eye widths" (same numbers as web/camera/face-tracker.js)
PATCHES = [
    ("forehead", 0.0, -0.5, 0.36, 0.13),
    ("left cheek", -0.37, 0.42, 0.16, 0.14),
    ("right cheek", 0.37, 0.42, 0.16, 0.14),
]


# ---------------------------------------------------------------------------
# 1. Resample to a steady 30 Hz clock
# ---------------------------------------------------------------------------
def resample_trace(t, r, g, b, fs=FS):
    t = np.asarray(t, dtype=float)
    count = int(math.floor((t[-1] - t[0]) * fs)) + 1
    grid = t[0] + np.arange(count) / fs
    return (np.interp(grid, t, r), np.interp(grid, t, g), np.interp(grid, t, b))


# ---------------------------------------------------------------------------
# 2. POS (Wang et al. 2017) with overlap-add
# ---------------------------------------------------------------------------
def pos_pulse(r, g, b, fs=FS, window_s=POS_WINDOW_S):
    rgb = np.vstack([r, g, b]).astype(float)  # 3 x N
    n = rgb.shape[1]
    win = max(2, math.ceil(window_s * fs))
    out = np.zeros(n)
    cover = np.zeros(n)
    for start in range(0, n - win + 1):
        block = rgb[:, start:start + win]
        means = block.mean(axis=1, keepdims=True)
        if np.any(means <= 0):
            continue
        cn = block / means  # remove skin tone and brightness
        s1 = cn[1] - cn[2]  # axis [0, 1, -1]
        s2 = -2 * cn[0] + cn[1] + cn[2]  # axis [-2, 1, 1]
        sd2 = s2.std()
        alpha = s1.std() / sd2 if sd2 > 1e-12 else 0.0
        h = s1 + alpha * s2
        out[start:start + win] += h - h.mean()
        cover[start:start + win] += 1
    covered = cover > 0
    out[covered] /= cover[covered]
    return out


# ---------------------------------------------------------------------------
# 3. Band-pass: the same two Butterworth sections as the JavaScript
# ---------------------------------------------------------------------------
def biquad(kind, cutoff_hz, fs):
    w0 = 2 * math.pi * cutoff_hz / fs
    cos = math.cos(w0)
    alpha = math.sin(w0) / (2 * math.sqrt(0.5))
    a0 = 1 + alpha
    if kind == "lowpass":
        b = [(1 - cos) / 2, 1 - cos, (1 - cos) / 2]
    else:
        b = [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2]
    return [v / a0 for v in b], [-2 * cos / a0, (1 - alpha) / a0]


def run_biquad(x, b, a):
    y = np.zeros(len(x))
    x1 = x2 = y1 = y2 = 0.0
    for i, v in enumerate(x):
        out = b[0] * v + b[1] * x1 + b[2] * x2 - a[0] * y1 - a[1] * y2
        x2, x1, y2, y1 = x1, v, y1, out
        y[i] = out
    return y


def zero_phase(x, b, a):
    """Filter forwards then backwards so the pulse is not shifted in time."""
    n = len(x)
    if n < 4:
        return np.array(x, dtype=float)
    pad = min(n - 1, 90)
    head = 2 * x[0] - x[pad:0:-1]
    tail = 2 * x[-1] - x[-2:-pad - 2:-1]
    ext = np.concatenate([head, x, tail])
    y = run_biquad(ext, b, a)[::-1]
    y = run_biquad(y, b, a)[::-1]
    return y[pad:pad + n]


def bandpass(x, fs=FS, low=BAND_LOW_HZ, high=BAND_HIGH_HZ):
    x = zero_phase(np.asarray(x, dtype=float), *biquad("highpass", low, fs))
    return zero_phase(x, *biquad("lowpass", high, fs))


# ---------------------------------------------------------------------------
# 4. Heart rate = strongest frequency between 0.7 and 3.0 Hz
# ---------------------------------------------------------------------------
def estimate_heart_rate(pulse, fs=FS):
    n = len(pulse)
    if n < HR_MIN_WINDOW_S * fs:
        return {"bpm": float("nan"), "snr_fraction": 0.0}
    size = FFT_SIZE
    while size < n:
        size *= 2
    hann = 0.5 - 0.5 * np.cos(2 * np.pi * np.arange(n) / (n - 1))
    spec = np.fft.rfft((pulse - pulse.mean()) * hann, size)
    power = np.abs(spec[: size // 2]) ** 2
    bin_hz = fs / size
    lo = math.ceil(BAND_LOW_HZ / bin_hz)
    hi = min(len(power) - 2, math.floor(BAND_HIGH_HZ / bin_hz))
    peak = lo + int(np.argmax(power[lo:hi + 1]))
    total = power[lo:hi + 1].sum()
    if total <= 0:
        return {"bpm": float("nan"), "snr_fraction": 0.0}
    offset = 0.0
    if lo < peak < hi:
        a, b, c = power[peak - 1], power[peak], power[peak + 1]
        denom = a - 2 * b + c
        if denom < 0:
            offset = 0.5 * (a - c) / denom
    half = round(SNR_HALF_WIDTH_HZ / bin_hz)
    signal = power[max(lo, peak - half):min(hi, peak + half) + 1].sum()
    return {"bpm": (peak + offset) * bin_hz * 60, "snr_fraction": float(signal / total)}


def analyse_trace(t, r, g, b, fs=FS):
    """Heart rate for a whole check: median of one reading per second."""
    rr, gg, bb = resample_trace(t, r, g, b, fs)
    pulse = bandpass(pos_pulse(rr, gg, bb, fs), fs)
    window_n = round(HR_WINDOW_S * fs)
    min_n = round(HR_MIN_WINDOW_S * fs)
    readings = []
    for end in range(min_n, len(pulse) + 1, int(fs)):
        hr = estimate_heart_rate(pulse[max(0, end - window_n):end], fs)
        if np.isfinite(hr["bpm"]):
            readings.append(hr)
    if not readings:
        return {"hr_bpm": None, "snr_fraction": 0.0, "readings": 0, "duration_s": len(pulse) / fs}
    return {
        "hr_bpm": round(float(np.median([x["bpm"] for x in readings])), 1),
        "snr_fraction": round(float(np.median([x["snr_fraction"] for x in readings])), 3),
        "readings": len(readings),
        "duration_s": len(pulse) / fs,
    }


# ---------------------------------------------------------------------------
# Optional: read a colour trace from a recorded video (OpenCV + MediaPipe)
# ---------------------------------------------------------------------------
def trace_from_video(path, model_path=FACE_MODEL):
    try:
        import cv2
        import mediapipe as mp
    except ImportError:
        sys.exit("Video mode needs:  pip install opencv-python-headless mediapipe")
    options = mp.tasks.vision.FaceLandmarkerOptions(
        base_options=mp.tasks.BaseOptions(model_asset_path=model_path),
        running_mode=mp.tasks.vision.RunningMode.VIDEO,
        num_faces=1,
    )
    cap = cv2.VideoCapture(path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    trace = {"t": [], "r": [], "g": [], "b": []}
    frames = 0
    with mp.tasks.vision.FaceLandmarker.create_from_options(options) as landmarker:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            t = frames / fps
            frames += 1
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            result = landmarker.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb), int(t * 1000))
            if not result.face_landmarks:
                continue
            colour = _patch_colour(rgb, result.face_landmarks[0])
            if colour is not None:
                trace["t"].append(t)
                for key, value in zip("rgb", colour):
                    trace[key].append(float(value))
    cap.release()
    return trace, frames


def _patch_colour(rgb, landmarks):
    """Mean colour of the forehead + cheek patches (same geometry as the browser)."""
    h, w, _ = rgb.shape
    e1 = np.array([landmarks[33].x * w, landmarks[33].y * h])
    e2 = np.array([landmarks[263].x * w, landmarks[263].y * h])
    chin = np.array([landmarks[152].x * w, landmarks[152].y * h])
    centre = (e1 + e2) / 2
    size = np.linalg.norm(e2 - e1)
    if size < 1:
        return None
    ax = (e2 - e1) / size
    down = np.array([-ax[1], ax[0]])
    if down @ (chin - centre) < 0:
        down = -down
    ys, xs = np.mgrid[0:h, 0:w]
    dx, dy = xs - centre[0], ys - centre[1]
    u = (dx * ax[0] + dy * ax[1]) / size  # along the eyes
    v = (dx * down[0] + dy * down[1]) / size  # down the face
    mask = np.zeros((h, w), dtype=bool)
    for _, cx, cy, half_w, half_h in PATCHES:
        mask |= (np.abs(u - cx) <= half_w) & (np.abs(v - cy) <= half_h)
    pixels = rgb[mask].astype(float)
    if len(pixels) == 0:
        return None
    usable = (pixels.max(axis=1) <= 250) & (pixels.min(axis=1) >= 20)  # drop clipped pixels
    if not usable.any():
        return None
    return pixels[usable].mean(axis=0)


# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(description="Python reference for the camera heart-rate check")
    parser.add_argument("trace", nargs="?", help="JSON file with t, r, g, b arrays (t in seconds)")
    parser.add_argument("--video", help="recorded video file instead of a trace")
    parser.add_argument("--model", default=FACE_MODEL, help="face_landmarker.task path (video mode)")
    args = parser.parse_args()
    if args.video:
        trace, frames = trace_from_video(args.video, args.model)
        print(f"frames: {frames}, frames with a face: {len(trace['t'])}")
        if len(trace["t"]) < HR_MIN_WINDOW_S * 10:
            sys.exit("Not enough frames with a face to read a pulse.")
    elif args.trace:
        with open(args.trace) as f:
            trace = json.load(f)
    else:
        parser.error("give a trace JSON file or --video")
    print(json.dumps(analyse_trace(trace["t"], trace["r"], trace["g"], trace["b"])))


if __name__ == "__main__":
    main()
