# Vendored MediaPipe files (for offline use)

These files are copied here unchanged so the camera check runs with no internet.

| File | From | Version | Licence |
|---|---|---|---|
| `vision_bundle.mjs` | npm package `@mediapipe/tasks-vision` | 1.2.3 | Apache-2.0 |
| `wasm/vision_wasm_internal.js` | same package, `wasm/` folder | 1.2.3 | Apache-2.0 |
| `wasm/vision_wasm_internal.wasm` | same package, `wasm/` folder | 1.2.3 | Apache-2.0 |
| `face_landmarker.task` | `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task` | float16, v1 | Apache-2.0 |

Copyright Google LLC (The MediaPipe Authors). Licence text: <https://www.apache.org/licenses/LICENSE-2.0>.
Model card and docs: <https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker>.

To update: `npm pack @mediapipe/tasks-vision@<version>`, unpack, and copy the three files above. Then re-run the checks in `hard/VALIDATION.md`.
