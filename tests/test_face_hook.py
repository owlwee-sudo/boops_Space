"""Checks for the facial-behaviour stress hook (H2).  Run:  pytest tests/test_face_hook.py"""
import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from hard.face import stress_hook as H  # noqa: E402

GOOD = dict(facial_change_z=3.0, opted_in=True, signal_quality=0.9, face_weight=0.15)


def test_off_by_default():
    assert H.FACE_WEIGHT == 0
    assert H.blend_face_into_stress(40, 3.0, True, 0.9) == 40


def test_changes_only_when_opted_in_weighted_and_good_quality():
    assert H.blend_face_into_stress(40, **GOOD) == round(0.85 * 40 + 0.15 * 100)
    assert H.blend_face_into_stress(40, **{**GOOD, "opted_in": False}) == 40
    assert H.blend_face_into_stress(40, **{**GOOD, "signal_quality": 0.3}) == 40
    assert H.blend_face_into_stress(40, **{**GOOD, "facial_change_z": None}) == 40
    assert H.blend_face_into_stress(40, **{**GOOD, "face_weight": 0}) == 40


def test_weight_is_capped_at_15_percent():
    assert H.blend_face_into_stress(40, **{**GOOD, "face_weight": 0.9}) == H.blend_face_into_stress(40, **GOOD)
    # The facial input can move the score by at most 15 points.
    for score in (0, 50, 100):
        for z in (0.0, 1.0, 2.0, 5.0):
            assert abs(H.blend_face_into_stress(score, z, True, 0.9, 0.15) - score) <= 15


@pytest.mark.skipif(shutil.which("node") is None, reason="Node.js not installed")
def test_javascript_and_python_agree():
    script = (
        "import { blendFaceIntoStress } from './web/camera/face-behaviour-core.js';"
        "const out = [];"
        "for (const s of [0, 35, 80]) for (const z of [0.5, 1.4, 2.2, 3.5])"
        " out.push(blendFaceIntoStress(s, { facialChangeZ: z, optedIn: true, signalQuality: 0.8, weight: 0.15 }));"
        "console.log(JSON.stringify(out));"
    )
    res = subprocess.run(["node", "--input-type=module", "-e", script], capture_output=True, text=True, check=True, cwd=ROOT)
    js = json.loads(res.stdout)
    py = [H.blend_face_into_stress(s, z, True, 0.8, 0.15) for s in [0, 35, 80] for z in [0.5, 1.4, 2.2, 3.5]]
    assert js == py
