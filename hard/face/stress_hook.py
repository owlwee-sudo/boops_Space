"""stress_hook.py: INTEGRATION HOOK for the facial-behaviour feature (H2).

Blends "facial change vs own baseline" into the 0-100 stress score as ONE
low-weight input. Same rule as blendFaceIntoStress() in
web/camera/face-behaviour-core.js.

The stress score is returned UNCHANGED unless all of these hold:
  - the astronaut opted in (consent screen),
  - FACE_WEIGHT is above 0 (default 0 = off),
  - a baseline exists (facial_change_z is a number: needs 14 earlier checks),
  - the camera check had signal_quality >= 0.5.

No emotion labels, ever (Barrett et al. 2019). Plain Python, no libraries.

How analysis.py uses it:

    from hard.face.stress_hook import blend_face_into_stress
    stress_score = blend_face_into_stress(stress_score, entry.get("facial_change_z"),
                                          opted_in, entry.get("signal_quality"), face_weight=FACE_WEIGHT)
"""

import math

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
FACE_WEIGHT = 0.0  # 0 = off. Raise only after the astronaut opts in.
FACE_WEIGHT_MAX = 0.15  # hard cap: facial input stays a small extra
MIN_SIGNAL_QUALITY = 0.5
ORDINARY_Z = 0.8  # mean |z| of a normal session
VERY_DIFFERENT_Z = 3.0  # mean |z| that counts as 100


def _is_number(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)


def blend_face_into_stress(stress_score, facial_change_z, opted_in, signal_quality, face_weight=FACE_WEIGHT):
    """Return the stress score, with the facial input blended in when allowed."""
    weight = min(max(face_weight or 0.0, 0.0), FACE_WEIGHT_MAX)
    usable = (
        opted_in is True
        and weight > 0
        and _is_number(facial_change_z)
        and _is_number(signal_quality)
        and signal_quality >= MIN_SIGNAL_QUALITY
    )
    if not usable:
        return stress_score
    face_score = 100 * min(1.0, max(0.0, (facial_change_z - ORDINARY_Z) / (VERY_DIFFERENT_Z - ORDINARY_Z)))
    return round((1 - weight) * stress_score + weight * face_score)
