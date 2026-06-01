"""
Anchor-separation regression test.

Ground-truth clips:
  Titin        — dramatic name-reading, no pitch, angry delivery  → Passion 2
  Smarter Shade — strong pitch, composed + enthusiastic           → Passion 10

Run with:  python -m pytest backend/src/video/test_scoring_anchors.py -v
       or:  python backend/src/video/test_scoring_anchors.py
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', '..'))
from backend.src.video.scoring import _compute_passion


def _sm(score, available=True):
    return {"score": float(score) if score is not None else None,
            "available": available and score is not None, "raw": score, "label": ""}


# Titin: angry delivery, dramatic name-reading, no pitch content
TITIN = {
    "hume_enthusiasm":      _sm(32),
    "pitch_variation":      _sm(34),
    "valence_score":        _sm(22),   # hostile prosody → low valence
    "phrase_pitch_contour": _sm(None, False),
    "vocal_control":        _sm(98),
    "energy_dynamics":      _sm(100),
}

# Smarter Shade: strong elevator pitch, composed + enthusiastic
SMARTER_SHADE = {
    "hume_enthusiasm":      _sm(37),
    "pitch_variation":      _sm(65),
    "valence_score":        _sm(76),   # positive/animated prosody → high valence
    "phrase_pitch_contour": _sm(None, False),
    "vocal_control":        _sm(80),
    "energy_dynamics":      _sm(77),
}


def test_passion_anchors_separate():
    titin   = _compute_passion(TITIN)
    smarter = _compute_passion(SMARTER_SHADE)
    assert titin   is not None, "Titin passion returned None"
    assert smarter is not None, "Smarter Shade passion returned None"
    assert titin < smarter, (
        f"INVERSION: Titin ({titin}) >= Smarter Shade ({smarter})"
    )
    assert titin   <= 35, f"Titin passion too high: {titin} (expected ≤35)"
    assert smarter >= 50, f"Smarter Shade passion too low: {smarter} (expected ≥50)"
    print(f"PASS  Titin={titin} ({titin/10:.1f}/10)  Smarter Shade={smarter} ({smarter/10:.1f}/10)")


if __name__ == "__main__":
    test_passion_anchors_separate()
