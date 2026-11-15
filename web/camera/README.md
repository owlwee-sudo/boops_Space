# Camera check (H1): heart rate from the webcam, in the browser

A 30-second check that reads heart rate, and a rough HRV estimate, from tiny colour changes in the face. No extra equipment, no internet, no video stored.

**Prototype · Not a medical device.** It gives a risk indicator, never a diagnosis.

## Run it

The page must be served from `localhost` (browsers only allow the camera on a secure address, and ES modules do not load from `file://`).

```bash
python3 -m http.server 8000 --directory web
```

Then open <http://localhost:8000/camera/>. Works with the network unplugged: the face model and its runtime are in `/web/vendor/mediapipe/`.

No camera on this machine? Open <http://localhost:8000/camera/?sim=steady> for a **Simulated** signal (a drawn face with a known 72 bpm pulse). Other modes: `?sim=shake`, `?sim=cover`, `?sim=dark` show the retry screen. Add `&seconds=12` for a shorter check while developing, and `&astronaut=A2` to pick the crew member.

## How it works

| Step | What happens | File |
|---|---|---|
| 1 | Webcam at about 30 fps. MediaPipe FaceLandmarker finds the face. | `sources.js`, `face-tracker.js` |
| 2 | Three skin patches (forehead, both cheeks) are placed from the eye positions. They avoid the eyes and mouth. | `face-tracker.js` |
| 3 | Each frame: mean red, green, blue of the patch pixels (clipped pixels are skipped). | `face-tracker.js` |
| 4 | Frames are put on a steady 30 Hz clock, then **POS** (Wang et al. 2017) turns the three colours into one pulse wave using 1.6 s sliding windows. | `rppg-core.js` |
| 5 | Band-pass 0.7–3.0 Hz (42–180 bpm). | `rppg-core.js` |
| 6 | Heart rate = strongest frequency in the last 10 s, refreshed every second. Final value = median over the check. | `rppg-core.js` |
| 7 | Rough HRV: each beat is timed where the wave crosses zero going up, giving beat-to-beat intervals and RMSSD. | `rppg-core.js` |
| 8 | Signal quality 0–1. Under 0.5 the result is hidden and the user is asked to retry. | `rppg-core.js` |
| 9 | "Save to log" stores the numbers only. | `log-store.js` |
| + | Optional, opt-in: facial-behaviour change vs own baseline (H2). | `face-behaviour.js`, `face-behaviour-core.js` |

`rppg-core.js` has no browser code in it, so the same file is unit-tested in Node (`node --test hard/rppg/test_rppg_core.mjs`) and cross-checked against a Python version (`pytest tests/test_rppg_reference.py`).

## Signal quality

Four parts, each scored 0–1, then combined:

| Part | Weight | Measures | Low score means |
|---|---|---|---|
| Pulse signal | 0.45 | Share of 0.7–3.0 Hz power within ±0.1 Hz of the heart-rate peak, and how steady the per-second readings are | No clear pulse |
| Stillness | 0.25 | Face movement in eye-widths per second | Head moving |
| Face in view | 0.20 | Share of frames with a face, and no long holes in the frames | Face covered, or frames dropped |
| Lighting | 0.10 | Mean brightness and share of clipped pixels | Too dark or glare |

If any one part fails badly, the score is capped at 0.40. So a covered face or a shaking head always triggers a retry, even when the other parts look fine. All thresholds are in `CONFIG` at the top of `rppg-core.js`.

## Integration hook

Saving appends one entry to the `localStorage` list `ahm.log_entries` (config in `log-store.js`):

```json
{
  "id": "cam-1794661848943",
  "entry_type": "camera_check",
  "astronaut_id": "A1",
  "timestamp": "2026-11-14T13:10:48.943Z",
  "date": "2026-11-14",
  "rhr_bpm": 72,
  "hrv_rmssd_ms": 31.5,
  "signal_quality": 0.92,
  "source": "camera",
  "hrv_confidence": "low",
  "method": "rPPG POS, 30 fps webcam",
  "duration_s": 30,
  "quality_parts": { "snr": 0.9, "motion": 1, "face": 1, "light": 0.8 },
  "labels": []
}
```

- Field names follow the data contract in `AGENTS.md`, so the odd-reading checker (F4) can compare `rhr_bpm` from the camera with the wearable.
- `hrv_rmssd_ms` is `null` when the pulse was not clean enough. Do not use camera HRV for the personal baseline.
- Optional Python side: set `LOG_CONFIG.API_URL` to a local endpoint that calls `db.insert_log_entry(...)`. It is `null` by default, so nothing breaks when the API does not exist.
- Other features can listen to the same check with `registerPlugin(...)` in `camera-check.js` (the facial-behaviour feature, H2, uses this).

## Facial-behaviour check (H2, opt-in)

Off until the user agrees on the consent card on this page. It can be turned off again there (or from a Settings screen with `setFaceOptIn(false)` in `face-behaviour.js`), and the stored numbers can be deleted.

During the same 30 seconds it measures five things (`face-behaviour-core.js`):

| Feature | From |
|---|---|
| Blink rate (per minute) | MediaPipe eye-blink blendshapes, counted closed-then-open |
| Eye openness | 1 − mean eye-blink blendshape |
| Brow lowering | Mean of the two brow-down blendshapes |
| Expressivity | How much brow, mouth and chin landmarks move, measured in face coordinates so head movement does not count |
| Head motion | Movement of the face centre, in eye-widths per second |

- **Baseline = the person's first 14 checks.** After that, each check gets `facial_change_z` = the mean |z| across the five features, shown on the result card as a three-step bar for low / medium / high (medium from 1.3, high from 2.0) with a plain sentence such as "Your face is moving like your usual self today." Before that it shows "Still learning your usual: n of 14 checks done", and the card shows 14 progress dots.
- **No emotion labels.** Facial movements are not reliable signs of emotion (Barrett et al. 2019), so the app never shows words like "angry" or "sad". Micro-expressions are not used. `facial_change_z` has no direction: it only says "different from your normal".
- **Low quality is ignored.** If the camera check asks for a retry, or has fewer than 150 face frames, nothing is computed or stored.
- **Stored:** the five numbers per check in `localStorage` (`ahm.face_sessions`), and `facial_change_z`, `facial_change_level`, `facial_features`, `facial_baseline_sessions` on the saved log entry. Blendshapes are only requested from the face model after opt-in.
- **Stress-score hook:** `blend_face_into_stress()` in `hard/face/stress_hook.py` (and `blendFaceIntoStress()` in JS). Config key `FACE_WEIGHT`, default **0**. The weight is capped at 0.15, and the stress score is unchanged unless the user opted in, the weight is above 0, a baseline exists and signal quality is at least 0.5.
- **Legal framing:** the EU AI Act restricts emotion inference at work except for medical or safety reasons. This feature does not infer emotions, is opt-in, and is for crew medical and safety use only.
- **Not validated.** There is no evidence yet that this change score tracks stress in astronauts. StressID (Chaptoukaev et al. 2023) is the dataset we would use to test it. Until then it must stay a low-weight, optional input.

Tests: `node --test hard/face/test_face_core.mjs` and `pytest tests/test_face_hook.py`.

## Privacy

- Frames are drawn to an off-screen canvas, averaged to three numbers, and overwritten by the next frame.
- Nothing is uploaded. The page makes no network request outside `localhost`.
- Only the final numbers are stored, and only after the user presses **Save to log**.
- The page shows "Processed on device · No video saved".

## Limits (read before trusting a number)

- **Movement.** Talking, nodding or drifting (likely in microgravity without a restraint) corrupts the signal. The check asks for a retry, it cannot fix it.
- **Lighting.** Needs steady, reasonably bright light on the face. Dim cabins, flickering lamps and screen glow reduce quality. Brightness changes that hit all colours equally are cancelled by POS, coloured changes are not.
- **Skin tone.** The pulse signal is weaker on darker skin with a normal colour camera, especially in low light. Published rPPG error is higher for darker skin tones. A near-infrared camera helps, but this prototype uses a normal webcam and has not been tested across skin tones.
- **Not validated in microgravity.** Fluid shift changes facial blood flow (puffy face), which may change the signal. Nobody has measured this method in flight.
- **Camera settings.** Automatic exposure, white balance and video compression add noise. A 3-second settle period helps, it does not remove it.
- **Heart-rate range.** 42–180 bpm. Outside this range the reading is wrong.
- **HRV is a rough estimate.** A 30 fps camera times a beat far less precisely than an ECG. In simulation, camera noise pushes RMSSD **up** (see `hard/VALIDATION.md`). Treat it as lower confidence, never as a baseline.
- **Hair, glasses, masks, heavy make-up** over the forehead or cheeks reduce the usable skin area.
- **Real-face accuracy is not yet measured.** See `hard/VALIDATION.md` for what has and has not been tested.

## References

POS: Wang, den Brinker, Stuijk, de Haan (2017). CHROM: de Haan & Jeanne (2013). rPPG-Toolbox: Liu et al. (2023). MediaPipe Face Landmarker (Google, Apache-2.0). Filter formulas: Bristow-Johnson, Audio EQ Cookbook. Full entries in `knowledge/sources.json`.
