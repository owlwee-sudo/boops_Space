# Validation: camera heart-rate check (H1)

**Status on 2026-11-14: the maths is tested on simulated signals. Accuracy on real faces is NOT yet measured.** The team test in section 3 is still to do.

Prototype · Not a medical device.

## 1. What has been tested

All inputs below are **Simulated** colour traces with a known heart rate (`hard/rppg/synthetic.mjs`). They test the signal processing. They say nothing about real skin, real cameras or real light.

| Check | Result | How to repeat |
|---|---|---|
| Heart rate, 50–150 bpm, 20 seeds each, camera noise 0.15 levels | Mean error 0.1–0.4 bpm, worst 1.2 bpm, no false retry | `node hard/rppg/explore.mjs` |
| Heart rate at 15 fps, with 10 ms frame jitter, with a 4x weaker pulse | Within 2 bpm | `node --test hard/rppg/test_rppg_core.mjs` |
| 10 % brightness flicker at 2 Hz (20x larger than the pulse) | Heart rate unchanged. Green channel alone reads the flicker (120 bpm). | same |
| Noise with no pulse, 100 seeds | 100/100 ask for a retry | same |
| Head shaking, covered face, too dark, dropped frames | Each forces a retry with the matching reason | same, and `?sim=shake`, `?sim=cover`, `?sim=dark` in the browser |
| JavaScript vs independent Python version | Heart rate agrees within 0.2 bpm on 5 traces | `pytest tests/test_rppg_reference.py` |
| Browser page with simulated face (`?sim=steady`) | Reads 72 bpm (true 72), quality 1.00 | open `/camera/?sim=steady` |
| Offline assets | Face model and runtime load from `/web/vendor`. The page made 0 requests outside `localhost`. | browser dev tools, Network tab |

### Rough HRV (RMSSD) in simulation

Planted RMSSD about 30 ms at 66 bpm, 30 seeds per row. "Camera noise" is the random error of the mean patch colour per frame, in 0–255 levels.

| Camera noise | Shown | Mean estimate | True | Bias |
|---|---|---|---|---|
| 0.02 | 30/30 | 29.0 ms | 29.5 ms | −0.5 ms |
| 0.05 | 30/30 | 35.0 ms | 29.5 ms | +5.5 ms |
| 0.10 | 30/30 | 48.3 ms | 29.5 ms | +18.8 ms |
| 0.15 | 30/30 | 63.9 ms | 29.5 ms | +34.4 ms |
| 0.30 | 2/30 | (withheld in 28) | 29.8 ms | large |

**Reading this honestly:** camera noise adds beat-timing error, which inflates RMSSD. Only a very clean signal gives a usable value. We do not yet know which row a real webcam sits on. Until the team test shows otherwise, camera RMSSD is a lower-confidence estimate that tends to read high. It is stored with `hrv_confidence: "low"` and must not feed the personal baseline or the stress score.

## 2. What has NOT been tested

- **Real faces and a real webcam.** Development ran with no camera. The face model loads and runs, but the patch placement, motion thresholds and lighting thresholds have not been seen on a real face.
- **The ±5 bpm target** against a watch or pulse oximeter.
- **Skin tone, glasses, beards, make-up.**
- **The motion thresholds** (`MOTION_GOOD` 0.15 and `MOTION_BAD` 0.6 eye-widths per second in `web/camera/rppg-core.js`). They are estimates. If a still person gets "Hold still", raise them. If head shaking passes, lower them.
- **Microgravity.** Not testable here. Stated as a limit in the README.
- **The optional video mode** of `hard/rppg_reference.py` (OpenCV + MediaPipe in Python).

## 3. Team test (to do)

Setup: sit 50–70 cm from the laptop camera, face a window or lamp, rest for 2 minutes first. Wear a watch or finger pulse oximeter as the reference. Start both at the same time. Write down the reference heart rate at the middle of the 30 seconds.

Run at least 3 people x 3 checks. Then run the two "should fail" checks.

| # | Person | Skin tone (Fitzpatrick I–VI) | Light | Reference HR (device) | Camera HR | Error | Quality | Camera RMSSD | Reference RMSSD | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | | | | | | | | | | |
| 2 | | | | | | | | | | |
| 3 | | | | | | | | | | |
| 4 | | | | | | | | | | |
| 5 | | | | | | | | | | |
| 6 | | | | | | | | | | |
| 7 | | | | | | | | | | |
| 8 | | | | | | | | | | |
| 9 | | | | | | | | | | |

| Should-fail check | Expected | Quality shown | Retry asked? |
|---|---|---|---|
| Shake head during the check | Quality < 0.5, "Hold still" | | |
| Cover face with a hand for 10 s | Quality < 0.5, "Face not fully visible" | | |
| Dim room | Quality < 0.5, "Too dark" | | |
| Network unplugged | Check still runs | n/a | |

**Pass rule (from the handoff):** on a still face in decent light, camera HR within ±5 bpm of the reference.

To investigate a bad reading, run in the browser console after a check:

```js
copy(JSON.stringify(cameraCheck.getLastTrace()))
```

Paste into `trace.json` and run `python hard/rppg_reference.py trace.json`. The trace is about 900 colour averages. It contains no image.
