# WESAD stress classifier (H3)

A stress vs non-stress classifier trained on **real labelled data** (WESAD) and tested leave-one-subject-out. Results, limits and the honest caveats are in [REPORT.md](REPORT.md).

## Get the data (once, about 2.2 GB)

The dataset is not in the repo. Download `WESAD.zip` from the link on the authors' page, <https://ubi29.informatik.uni-siegen.de/usi/data_wesad.html>, and save it as `hard/wesad/data/WESAD.zip`. No need to unzip.

Note: the UCI page (<https://archive.ics.uci.edu/dataset/465>) only gives a small file that points to the same University of Siegen host. On 2026-11-14 the link inside that file was dead and the second link on the authors' page worked.

## Run

```bash
pip install -r hard/requirements.txt
```

```bash
python hard/wesad/train.py
```

One command: builds the feature table (about 30 s), runs every LOSO evaluation (about 3 min), and writes `results.json`, `model.json`, `model.joblib` and `web/models/wesad_stress_model.json`.

Other commands: `python hard/wesad/prepare.py --window 30` (features only), `python hard/wesad/stress_model.py` (demo scores), `pytest tests/test_wesad_model.py`.

## Use it in the app (off by default)

Python (`analysis.py`):

```python
STRESS_MODEL = "rules"   # "rules" | "wesad"

if STRESS_MODEL == "wesad":
    from hard.wesad.stress_model import wesad_stress_score
    stress_score = wesad_stress_score(z["rhr_bpm"], z["hrv_rmssd_ms"], z["eda_mean_us"])
```

Dashboard:

```js
import { loadWesadModel, wesadStressScore } from "./lib/wesad-stress.js";
const model = await loadWesadModel();
const score = wesadStressScore(model, { rhr: z.rhr_bpm, hrv: z.hrv_rmssd_ms, eda: z.eda_mean_us });
```

Inputs are the personal-baseline z-scores the engine already computes. Show the result as a second opinion with the label "trained on lab data". Read REPORT.md section 5 for why.

## Safety note on the data files

WESAD ships Python pickles, and a pickle can run code when opened. `prepare.py` reads them with an unpickler that only allows numpy arrays, and refuses anything else.
