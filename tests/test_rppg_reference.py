"""Cross-check: the Python reference and the browser JavaScript must agree.

Run:  pytest tests/test_rppg_reference.py
Uses SIMULATED colour traces with a known heart rate. Skips if Node is missing.
"""
import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "hard"))
import rppg_reference as ref  # noqa: E402

NODE = shutil.which("node")
RUNNER = str(ROOT / "hard" / "rppg" / "run_core.mjs")

pytestmark = pytest.mark.skipif(NODE is None, reason="Node.js not installed")


def make_trace(bpm, seed):
    out = subprocess.run([NODE, RUNNER, "--make", str(bpm), str(seed)], capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


@pytest.mark.parametrize("bpm", [52, 72, 95, 130, 165])
def test_python_and_javascript_agree(bpm, tmp_path):
    trace = make_trace(bpm, seed=bpm)
    py = ref.analyse_trace(trace["t"], trace["r"], trace["g"], trace["b"])
    path = tmp_path / "trace.json"
    path.write_text(json.dumps(trace))
    js = json.loads(subprocess.run([NODE, RUNNER, str(path)], capture_output=True, text=True, check=True).stdout)
    # Both are right...
    assert abs(py["hr_bpm"] - trace["truth_bpm"]) <= 2
    assert abs(js["hr_bpm"] - trace["truth_bpm"]) <= 2
    # ...and they agree with each other almost exactly.
    assert abs(py["hr_bpm"] - js["hr_bpm"]) <= 0.2
    assert abs(py["snr_fraction"] - js["snr_fraction"]) <= 0.02
    assert js["retry"] is False


def test_python_reference_rejects_nothing_but_reports_low_snr_on_noise():
    import numpy as np

    rng = np.random.default_rng(3)
    t = np.arange(900) / 30
    noise = lambda base: base + rng.normal(0, 0.15, len(t))  # noqa: E731
    py = ref.analyse_trace(t, noise(182), noise(128), noise(104))
    assert py["snr_fraction"] < 0.4  # no pulse -> no sharp peak
