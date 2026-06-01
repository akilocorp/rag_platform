"""Weight calibration tool — standalone page + API.

GET  /calibrate                          → serves the HTML page
GET  /api/calibrate/configs              → list configs with scored submissions
GET  /api/calibrate/submissions/<cid>    → submissions + full submetric data
POST /api/calibrate/optimize             → optimize weights, return recommendations
"""
from flask import Blueprint, jsonify, request, current_app, render_template_string

calibrate_bp = Blueprint('calibrate', __name__)

# ── defaults (mirrors rubrics/base.py and scoring.py) ───────────────────────
# Competence uses _rollup with these weights.
DEFAULT_COMPETENCE_WEIGHTS = {
    "fundamentals_coverage": 0.45,
    "technical_depth":       0.35,
    "filler_rate":           0.12,
    "pacing_smoothness":     0.08,
}
# Passion uses _compute_passion() formula — NOT _rollup.
# These are the formula coefficients: core term weights + penalty k.
DEFAULT_PASSION_FORMULA = {
    "w_enthusiasm": 0.50,
    "w_variation":  0.22,
    "w_valence":    0.15,
    "w_contour":    0.13,
    "k_penalty":    0.30,
}
SUBMETRIC_LABELS = {
    "fundamentals_coverage": "Fundamentals coverage",
    "technical_depth":       "Technical depth",
    "filler_rate":           "Filler words",
    "pacing_smoothness":     "Pacing smoothness",
    "hume_enthusiasm":       "Vocal enthusiasm",
    "pitch_variation":       "Vocal variation",
    "valence_score":         "Emotional valence",
    "phrase_pitch_contour":  "Phrase-final contour",
    "vocal_control":         "Delivery control",
    "energy_dynamics":       "Vocal energy",
    "prosody_confidence":    "Vocal confidence",
    "face_composure":        "Facial composure",
    "volume_steadiness":     "Delivery steadiness",
}
CANDIDATE_SUBMETRICS = {
    "competence": ["hedging", "pacing_smoothness"],
}


# ── pure-Python weighted-average optimizer ──────────────────────────────────

def _predict(weights_list, keys, sm):
    """Weighted average over available submetrics. Returns 0-100 float."""
    total_w = weighted = 0.0
    for w, k in zip(weights_list, keys):
        s = sm.get(k)
        if s and s.get("available") and s.get("score") is not None:
            total_w += w
            weighted += w * s["score"]
    return weighted / total_w if total_w > 0 else 50.0


def _mse(weights_list, keys, rows):
    """Mean squared error across all (submetrics, target) rows."""
    total = 0.0
    for sm, target in rows:
        diff = _predict(weights_list, keys, sm) - target
        total += diff * diff
    return total / len(rows) if rows else 0.0


def _optimize(current_weights: dict, rows: list, steps=800, lr=0.02) -> dict:
    """
    Gradient descent on weight vector (projected to non-negative simplex each step).
    rows: list of (submetric_dict, target_score_0_100)
    Returns dict of optimized weights normalized to sum=1.
    """
    keys = list(current_weights.keys())
    w = [current_weights[k] for k in keys]
    n = len(w)

    for _ in range(steps):
        grad = [0.0] * n
        for sm, target in rows:
            pred = _predict(w, keys, sm)
            err = pred - target
            denom = sum(w[i] for i, k in enumerate(keys)
                        if sm.get(k) and sm[k].get("available") and sm[k].get("score") is not None)
            if denom <= 0:
                continue
            for i, k in enumerate(keys):
                s = sm.get(k)
                if s and s.get("available") and s.get("score") is not None:
                    # d(pred)/d(w_i) = (score_i * denom - weighted_sum) / denom^2
                    ws = sum(w[j] * sm[kk]["score"]
                             for j, kk in enumerate(keys)
                             if sm.get(kk) and sm[kk].get("available") and sm[kk].get("score") is not None)
                    dpred = (s["score"] * denom - ws) / (denom * denom)
                    grad[i] += 2 * err * dpred

        # gradient step + clamp to positive
        w = [max(1e-4, w[i] - lr * grad[i] / len(rows)) for i in range(n)]

    total = sum(w)
    return {keys[i]: round(w[i] / total, 4) for i in range(n)}


def _r2(weights, keys, rows):
    preds = [_predict(list(weights.values()), keys, sm) for sm, _ in rows]
    targets = [t for _, t in rows]
    mean_t = sum(targets) / len(targets)
    ss_tot = sum((t - mean_t) ** 2 for t in targets)
    ss_res = sum((p - t) ** 2 for p, t in zip(preds, targets))
    return round(1 - ss_res / ss_tot, 3) if ss_tot > 0 else 1.0


def _get(sm, k):
    s = sm.get(k)
    return s["score"] if (s and s.get("available") and s.get("score") is not None) else None


def _predict_passion_formula(params, sm):
    """Mirrors scoring._compute_passion but with optimizable coefficients."""
    w_e  = max(0.0, params[0])
    w_v  = max(0.0, params[1])
    w_val = max(0.0, params[2])
    w_c  = max(0.0, params[3])
    k    = max(0.0, params[4])

    enth    = _get(sm, "hume_enthusiasm")
    if enth is None:
        return 50.0
    variation = _get(sm, "pitch_variation")
    valence   = _get(sm, "valence_score")
    contour   = _get(sm, "phrase_pitch_contour")
    control   = _get(sm, "vocal_control")
    energy    = _get(sm, "energy_dynamics")

    parts = [(w_e, enth)]
    if variation is not None: parts.append((w_v, variation))
    if valence   is not None: parts.append((w_val, valence))
    if contour   is not None: parts.append((w_c, contour))
    tw = sum(w for w, _ in parts)
    core = sum(w * v for w, v in parts) / tw if tw > 0 else 50.0

    polish_vals = [v for v in [control, energy] if v is not None]
    penalty = k * max(0.0, (sum(polish_vals) / len(polish_vals)) - enth) if polish_vals else 0.0
    return max(0.0, min(100.0, core - penalty))


def _optimize_passion(current_formula: dict, rows: list, steps=1000, lr=0.005) -> dict:
    """Gradient descent on 5 passion formula params: [w_e, w_v, w_val, w_c, k_penalty]."""
    keys_order = ["w_enthusiasm", "w_variation", "w_valence", "w_contour", "k_penalty"]
    p = [current_formula[k] for k in keys_order]

    for _ in range(steps):
        grad = [0.0] * 5
        for sm, target in rows:
            pred = _predict_passion_formula(p, sm)
            err = pred - target
            eps = 1.0
            for i in range(5):
                p2 = p[:]
                p2[i] += eps
                grad[i] += 2 * err * (_predict_passion_formula(p2, sm) - pred) / eps
        p = [max(1e-4 if i < 4 else 0.0, p[i] - lr * grad[i] / len(rows)) for i in range(5)]

    # Normalize core weights (first 4) to sum to 1, keep k as-is
    core_sum = sum(max(0, p[i]) for i in range(4)) or 1.0
    result = {keys_order[i]: round(p[i] / core_sum, 4) for i in range(4)}
    result["k_penalty"] = round(max(0.0, p[4]), 4)
    return result


def _r2_passion(formula, rows):
    params = [formula["w_enthusiasm"], formula["w_variation"], formula["w_valence"],
              formula["w_contour"], formula["k_penalty"]]
    preds   = [_predict_passion_formula(params, sm) for sm, _ in rows]
    targets = [t for _, t in rows]
    mean_t  = sum(targets) / len(targets)
    ss_tot  = sum((t - mean_t) ** 2 for t in targets)
    ss_res  = sum((p - t) ** 2 for p, t in zip(preds, targets))
    return round(1 - ss_res / ss_tot, 3) if ss_tot > 0 else 1.0


def _recommendations(dim, opt_weights, rows, candidates):
    """
    Suggest adding candidate submetrics if their scores correlate with residuals.
    """
    keys = list(opt_weights.keys())
    recs = []
    for sm, target in rows:
        pred = _predict(list(opt_weights.values()), keys, sm)
        # residuals stored per row handled below
    residuals = []
    for sm, target in rows:
        pred = _predict(list(opt_weights.values()), keys, sm)
        residuals.append(target - pred)

    mean_res = sum(residuals) / len(residuals) if residuals else 0
    for cand in candidates:
        cand_scores = []
        for i, (sm, _) in enumerate(rows):
            s = sm.get(cand)
            if s and s.get("available") and s.get("score") is not None:
                cand_scores.append((s["score"], residuals[i]))
        if len(cand_scores) < 2:
            continue
        # Pearson correlation between candidate scores and residuals
        xs = [c[0] for c in cand_scores]
        ys = [c[1] for c in cand_scores]
        mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
        num = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
        den = (sum((x - mx) ** 2 for x in xs) * sum((y - my) ** 2 for y in ys)) ** 0.5
        corr = num / den if den > 0 else 0
        if abs(corr) > 0.3:
            label = SUBMETRIC_LABELS.get(cand, cand)
            direction = "positively" if corr > 0 else "negatively"
            recs.append({
                "key": cand,
                "label": label,
                "correlation": round(corr, 2),
                "message": f'"{label}" correlates {direction} with under/over-scored videos (r={round(corr,2)}). '
                           f'Adding it may improve {dim} accuracy.'
            })
    return sorted(recs, key=lambda r: -abs(r["correlation"]))


# ── API endpoints ─────────────────────────────────────────────────────────────

@calibrate_bp.route('/api/calibrate/configs', methods=['GET'])
def list_configs():
    db = current_app.config['MONGO_DB']
    # configs that have at least one scored video submission
    scored_ids = db['video_scores'].distinct('config_id')
    configs = list(db['config_collections'].find(
        {"_id": {"$in": [__import__('bson').ObjectId(cid) for cid in scored_ids if cid]}, "bot_type": "video_analysis"},
        {"bot_name": 1, "_id": 1}
    ))
    return jsonify([{"id": str(c["_id"]), "name": c.get("bot_name", "Unnamed")} for c in configs])


@calibrate_bp.route('/api/calibrate/submissions/<config_id>', methods=['GET'])
def calibrate_submissions(config_id):
    db = current_app.config['MONGO_DB']
    try:
        limit = max(1, int(request.args.get("limit", 50)))
    except (ValueError, TypeError):
        limit = 50
    subs = list(db['video_submissions'].find(
        {"config_id": config_id, "status": "scored"},
        {"_id": 1, "submitter_name": 1, "submitter_email": 1}
    ).sort("created_at", -1).limit(limit))

    out = []
    for s in subs:
        sid = str(s["_id"])
        score_doc = db['video_scores'].find_one(
            {"submission_id": sid},
            {"_id": 0, "scores": 1, "overall": 1, "pccp_eval": 1}
        )
        if not score_doc:
            continue
        pccp = score_doc.get("pccp_eval") or {}
        raw  = score_doc.get("scores") or {}

        def _display(dim):
            pe = (pccp.get(dim) or {}).get("score")
            return pe if pe is not None else (raw.get(dim) or {}).get("value")

        # Collect all submetrics from both composites
        all_sm = {}
        for dim in ("confidence", "competence", "passion"):
            sms = (raw.get(dim) or {}).get("submetrics") or {}
            all_sm.update(sms)

        out.append({
            "id": sid,
            "name": s.get("submitter_name") or s.get("submitter_email") or sid[:8],
            "current": {
                "confidence": _display("confidence"),
                "competence": _display("competence"),
                "passion":    _display("passion"),
                "overall":    score_doc.get("overall"),
            },
            "submetrics": all_sm,
        })
    return jsonify({"submissions": out, "current_weights": {
        "passion_formula": DEFAULT_PASSION_FORMULA,
        "competence":      DEFAULT_COMPETENCE_WEIGHTS,
    }})


@calibrate_bp.route('/api/calibrate/optimize', methods=['POST'])
def optimize_weights():
    """
    Body: {
      "targets": { "<submission_id>": { "passion": 0-100, "competence": 0-100 } },
      "submetrics": { "<submission_id>": { <submetric_key>: {score, available, ...} } }
    }
    """
    data = request.json or {}
    targets   = data.get("targets") or {}
    sm_map    = data.get("submetrics") or {}

    if len(targets) < 2:
        return jsonify({"error": "Need at least 2 videos with targets to optimize."}), 400

    results = {}

    # ── Passion: optimize formula coefficients, not _rollup weights ──────────
    passion_rows = [(sm_map[sid], float(t["passion"]))
                    for sid, t in targets.items()
                    if t.get("passion") is not None and sid in sm_map]
    if len(passion_rows) < 2:
        results["passion"] = {"error": "Not enough passion targets"}
    else:
        opt_formula = _optimize_passion(DEFAULT_PASSION_FORMULA, passion_rows)
        r2_p = _r2_passion(opt_formula, passion_rows)
        params = [opt_formula["w_enthusiasm"], opt_formula["w_variation"],
                  opt_formula["w_valence"], opt_formula["w_contour"], opt_formula["k_penalty"]]
        per_video_p = []
        for sid, (sm, target) in zip([s for s in targets if targets[s].get("passion") is not None], passion_rows):
            pred = _predict_passion_formula(params, sm)
            per_video_p.append({"id": sid, "target": round(target, 1),
                                 "predicted": round(pred, 1), "error": round(pred - target, 1)})
        results["passion"] = {
            "optimized_weights": opt_formula,   # these are formula params, not _rollup weights
            "default_weights":   DEFAULT_PASSION_FORMULA,
            "is_formula":        True,           # flag for frontend to label correctly
            "r2": r2_p, "per_video": per_video_p, "recommendations": [],
        }

    # ── Competence: standard _rollup weight optimization ─────────────────────
    for dim, default_w, candidates in [
        ("competence", DEFAULT_COMPETENCE_WEIGHTS, CANDIDATE_SUBMETRICS["competence"]),
    ]:
        rows = []
        for sid, t in targets.items():
            target_val = t.get(dim)
            if target_val is None or sid not in sm_map:
                continue
            rows.append((sm_map[sid], float(target_val)))

        if len(rows) < 2:
            results[dim] = {"error": f"Not enough targets for {dim}"}
            continue

        opt_w  = _optimize(default_w, rows)
        r2     = _r2(opt_w, list(opt_w.keys()), rows)
        recs   = _recommendations(dim, opt_w, rows, candidates)

        per_video = []
        for sid, (sm, target) in zip(
            [s for s in targets if targets[s].get(dim) is not None],
            rows
        ):
            pred = _predict(list(opt_w.values()), list(opt_w.keys()), sm)
            per_video.append({
                "id": sid,
                "target": round(target, 1),
                "predicted": round(pred, 1),
                "error": round(pred - target, 1),
            })

        results[dim] = {
            "optimized_weights": opt_w,
            "default_weights":   default_w,
            "r2": r2,
            "per_video": per_video,
            "recommendations": recs,
        }

    return jsonify(results)


# ── standalone HTML page ──────────────────────────────────────────────────────

PAGE = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>Weight Calibration Tool</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,sans-serif;background:#f3f4f6;color:#1f2937;min-height:100vh}
header{background:#fff;border-bottom:1px solid #e5e7eb;padding:16px 32px;display:flex;align-items:center;gap:12px}
header h1{font-size:1.1rem;font-weight:700}
header span{font-size:.8rem;color:#6b7280;background:#f3f4f6;padding:2px 8px;border-radius:999px}
main{max-width:1100px;margin:32px auto;padding:0 24px;display:flex;flex-direction:column;gap:24px}
.card{background:#fff;border-radius:12px;border:1px solid #e5e7eb;padding:24px}
.card h2{font-size:.95rem;font-weight:700;margin-bottom:16px;color:#111}
label{font-size:.8rem;font-weight:600;color:#374151;display:block;margin-bottom:4px}
select,input[type=text]{width:100%;padding:8px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:.85rem}
select:focus,input:focus{outline:2px solid #FA6C43;border-color:transparent}
table{width:100%;border-collapse:collapse;font-size:.82rem}
th{text-align:left;padding:8px 10px;border-bottom:2px solid #e5e7eb;color:#6b7280;font-weight:600;font-size:.75rem;text-transform:uppercase}
td{padding:8px 10px;border-bottom:1px solid #f3f4f6;vertical-align:middle}
tr:last-child td{border-bottom:none}
td input[type=number]{width:70px;padding:4px 6px;border:1px solid #d1d5db;border-radius:4px;font-size:.82rem;text-align:center}
td input[type=number]:focus{outline:2px solid #FA6C43;border-color:transparent}
.chip{display:inline-block;padding:2px 8px;border-radius:999px;font-size:.72rem;font-weight:700}
.chip-blue{background:#eff6ff;color:#1d4ed8}
.chip-green{background:#f0fdf4;color:#15803d}
.chip-red{background:#fef2f2;color:#b91c1c}
.chip-gray{background:#f3f4f6;color:#6b7280}
.btn{padding:9px 20px;border-radius:8px;font-size:.85rem;font-weight:600;cursor:pointer;border:none;transition:opacity .15s}
.btn-primary{background:#FA6C43;color:#fff}.btn-primary:hover{opacity:.85}
.btn-secondary{background:#f3f4f6;color:#374151}.btn-secondary:hover{background:#e5e7eb}
.btn:disabled{opacity:.5;cursor:not-allowed}
.section-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
.weights-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}
.weight-row{display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f3f4f6}
.weight-row:last-child{border-bottom:none}
.weight-label{font-size:.82rem;color:#374151}
.weight-vals{display:flex;gap:12px;align-items:center;font-size:.82rem}
.weight-old{color:#9ca3af;text-decoration:line-through}
.weight-new{font-weight:700;color:#FA6C43}
.r2-badge{padding:4px 10px;border-radius:6px;font-size:.8rem;font-weight:700}
.rec-box{background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:12px 16px;font-size:.82rem;color:#78350f;display:flex;gap:10px;align-items:flex-start}
.error-box{background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px 16px;font-size:.82rem;color:#991b1b}
.spinner{display:inline-block;width:16px;height:16px;border:2px solid #f3f4f6;border-top-color:#FA6C43;border-radius:50%;animation:spin .6s linear infinite;vertical-align:middle;margin-right:6px}
@keyframes spin{to{transform:rotate(360deg)}}
.hidden{display:none}
.per-video-row td:last-child{color:#9ca3af;font-size:.75rem}
.err-pos{color:#059669}.err-neg{color:#dc2626}.err-ok{color:#9ca3af}
</style>
</head>
<body>
<header>
  <h1>Weight Calibration Tool</h1>
  <span>Separate from platform</span>
</header>
<main>

  <!-- Step 1: pick config -->
  <div class="card">
    <h2>Step 1 — Select assignment</h2>
    <div style="display:flex;gap:16px;align-items:flex-end">
      <div style="flex:1">
        <label for="configSelect">Assignment / config</label>
        <select id="configSelect"><option value="">Loading…</option></select>
      </div>
      <div style="width:130px">
        <label for="limitInput">Last N videos</label>
        <select id="limitInput" style="width:100%">
          <option value="5">5</option>
          <option value="7" selected>7</option>
          <option value="10">10</option>
          <option value="20">20</option>
          <option value="50">All (50)</option>
        </select>
      </div>
    </div>
  </div>

  <!-- Step 2: enter professor targets -->
  <div class="card hidden" id="step2Card">
    <div class="section-header">
      <h2>Step 2 — Enter professor target scores (0–100)</h2>
      <button class="btn btn-secondary" id="fillCurrentBtn">Pre-fill from current scores</button>
    </div>
    <p style="font-size:.8rem;color:#6b7280;margin-bottom:12px">
      Leave blank to exclude a video from calibration.
    </p>
    <div style="overflow-x:auto">
    <table>
      <thead><tr>
        <th>Student</th>
        <th>Current Conf</th><th>Current Comp</th><th>Current Pass</th>
        <th style="color:#FA6C43">Target Competence</th>
        <th style="color:#FA6C43">Target Passion</th>
        <th style="color:#FA6C43">Prof reasoning (optional)</th>
      </tr></thead>
      <tbody id="subTable"></tbody>
    </table>
    </div>
    <div style="margin-top:16px;display:flex;gap:10px;align-items:center">
      <button class="btn btn-primary" id="optimizeBtn">Run optimization</button>
      <span id="optimizeStatus" style="font-size:.8rem;color:#6b7280"></span>
    </div>
  </div>

  <!-- Step 3: results -->
  <div class="hidden" id="resultsSection">
    <div class="weights-grid">
      <div class="card" id="passionCard">
        <h2>Passion weights</h2>
        <div id="passionWeights"></div>
        <div id="passionRecs" style="margin-top:12px;display:flex;flex-direction:column;gap:8px"></div>
      </div>
      <div class="card" id="competenceCard">
        <h2>Competence weights</h2>
        <div id="competenceWeights"></div>
        <div id="competenceRecs" style="margin-top:12px;display:flex;flex-direction:column;gap:8px"></div>
      </div>
    </div>

    <div class="card" style="margin-top:24px">
      <h2>Per-video fit</h2>
      <table>
        <thead><tr>
          <th>Student</th>
          <th>Target Comp</th><th>Predicted Comp</th><th>Error</th>
          <th>Target Pass</th><th>Predicted Pass</th><th>Error</th>
          <th>Prof reasoning</th>
        </tr></thead>
        <tbody id="perVideoTable"></tbody>
      </table>
    </div>

    <div class="card" style="margin-top:24px">
      <h2>Apply to platform</h2>
      <p style="font-size:.82rem;color:#6b7280;margin-bottom:12px">
        Copy this MongoDB command and run it in Atlas or mongosh to update the scoring spec for this config.
      </p>
      <pre id="mongoCmd" style="background:#f3f4f6;padding:14px;border-radius:8px;font-size:.75rem;overflow-x:auto;white-space:pre-wrap"></pre>
      <button class="btn btn-secondary" style="margin-top:10px" id="copyBtn">Copy command</button>
    </div>
  </div>

</main>

<script>
const API = '';
let submissions = [];
let currentWeights = {};
let configId = '';

async function loadConfigs() {
  const res = await fetch(`${API}/api/calibrate/configs`);
  const data = await res.json();
  const sel = document.getElementById('configSelect');
  if (!data.length) { sel.innerHTML = '<option>No scored video configs found</option>'; return; }
  sel.innerHTML = '<option value="">— pick one —</option>' +
    data.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
}

async function loadSubmissions(cid) {
  configId = cid;
  document.getElementById('step2Card').classList.add('hidden');
  document.getElementById('resultsSection').classList.add('hidden');
  if (!cid) return;
  const limit = document.getElementById('limitInput').value;
  const res = await fetch(`${API}/api/calibrate/submissions/${cid}?limit=${limit}`);
  const data = await res.json();
  submissions = data.submissions || [];
  currentWeights = data.current_weights || {};
  renderTable();
  document.getElementById('step2Card').classList.remove('hidden');
}

function fmt(v) { return v == null ? '—' : (v/10).toFixed(1); }
function chip(v) {
  if (v == null) return '<span class="chip chip-gray">—</span>';
  const n = Math.round(v);
  const cls = v >= 80 ? 'chip-green' : v >= 50 ? 'chip-blue' : 'chip-red';
  return `<span class="chip ${cls}">${n}</span>`;
}

function renderTable() {
  const tbody = document.getElementById('subTable');
  tbody.innerHTML = submissions.map(s => `
    <tr data-id="${s.id}">
      <td><strong>${s.name}</strong></td>
      <td>${chip(s.current.confidence)}</td>
      <td>${chip(s.current.competence)}</td>
      <td>${chip(s.current.passion)}</td>
      <td><input type="number" min="0" max="100" step="1" class="t-comp" placeholder="e.g. 65"/></td>
      <td><input type="number" min="0" max="100" step="1" class="t-pass" placeholder="e.g. 72"/></td>
      <td><input type="text" class="t-reason" placeholder="e.g. great energy but shallow content" style="width:220px;font-size:.78rem"/></td>
    </tr>`).join('');
}

document.getElementById('fillCurrentBtn').addEventListener('click', () => {
  document.querySelectorAll('#subTable tr').forEach((tr, i) => {
    const s = submissions[i];
    if (!s) return;
    const tc = tr.querySelector('.t-comp');
    const tp = tr.querySelector('.t-pass');
    if (s.current.competence != null) tc.value = Math.round(s.current.competence);
    if (s.current.passion    != null) tp.value = Math.round(s.current.passion);
  });
});

document.getElementById('configSelect').addEventListener('change', e => loadSubmissions(e.target.value));
document.getElementById('limitInput').addEventListener('change', () => { if (configId) loadSubmissions(configId); });

document.getElementById('optimizeBtn').addEventListener('click', async () => {
  const targets = {};
  const smMap = {};
  document.querySelectorAll('#subTable tr').forEach((tr, i) => {
    const s = submissions[i];
    if (!s) return;
    const tc = tr.querySelector('.t-comp').value.trim();
    const tp = tr.querySelector('.t-pass').value.trim();
    const tr2 = tr.querySelector('.t-reason').value.trim();
    if (!tc && !tp) return;
    targets[s.id] = {};
    if (tc) targets[s.id].competence = parseFloat(tc);
    if (tp) targets[s.id].passion    = parseFloat(tp);
    if (tr2) targets[s.id].reasoning = tr2;
    smMap[s.id] = s.submetrics;
  });

  const btn = document.getElementById('optimizeBtn');
  const status = document.getElementById('optimizeStatus');
  btn.disabled = true;
  status.innerHTML = '<span class="spinner"></span>Optimizing…';

  try {
    const res = await fetch(`${API}/api/calibrate/optimize`, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({targets, submetrics: smMap}),
    });
    const data = await res.json();
    if (data.error) { status.textContent = data.error; btn.disabled = false; return; }
    renderResults(data, targets);
    status.textContent = '';
  } catch(e) {
    status.textContent = 'Request failed: ' + e.message;
  }
  btn.disabled = false;
});

function r2Color(r2) {
  if (r2 >= 0.85) return '#15803d';
  if (r2 >= 0.6)  return '#b45309';
  return '#b91c1c';
}

function renderWeights(containerId, dimResult) {
  const el = document.getElementById(containerId);
  if (!dimResult || dimResult.error) {
    el.innerHTML = `<div class="error-box">${dimResult?.error || 'No result'}</div>`; return;
  }
  const r2 = dimResult.r2;
  const r2html = `<span class="r2-badge" style="background:${r2Color(r2)}20;color:${r2Color(r2)}">R² = ${r2}</span>`;
  const LABELS = {
    fundamentals_coverage:'Fundamentals coverage',technical_depth:'Technical depth',
    filler_rate:'Filler words',pacing_smoothness:'Pacing smoothness',
    w_enthusiasm:'Enthusiasm weight',w_variation:'Variation weight',
    w_valence:'Valence weight',w_contour:'Contour weight',k_penalty:'Penalty k (polish gap)'
  };
  const isFormula = !!dimResult.is_formula;
  const rows = Object.entries(dimResult.optimized_weights).map(([k, v]) => {
    const old = dimResult.default_weights[k];
    const label = LABELS[k] || k;
    const fmt = x => isFormula ? x.toFixed(3) : (x*100).toFixed(1)+'%';
    return `<div class="weight-row">
      <span class="weight-label">${label}</span>
      <span class="weight-vals"><span class="weight-old">${fmt(old)}</span><span class="weight-new">${fmt(v)}</span></span>
    </div>`;
  }).join('');
  const note = isFormula ? '<p style="font-size:.75rem;color:#6b7280;margin-bottom:8px">Passion uses a formula, not weighted average — these are formula coefficients.</p>' : '';
  el.innerHTML = `<div style="display:flex;justify-content:flex-end;margin-bottom:10px">${r2html}</div>${note}${rows}`;
  if (r2 < 0.6) {
    el.innerHTML += `<div class="rec-box" style="margin-top:12px">⚠️ Low R² (${r2}) — the current signals can't fully explain the professor's scores. See recommendations below.</div>`;
  }
}

function renderRecs(containerId, recs) {
  const el = document.getElementById(containerId);
  if (!recs || !recs.length) { el.innerHTML = '<p style="font-size:.78rem;color:#9ca3af">No additional factors suggested.</p>'; return; }
  el.innerHTML = recs.map(r =>
    `<div class="rec-box">💡 ${r.message}</div>`
  ).join('');
}

function renderResults(data, targets) {
  renderWeights('passionWeights',    data.passion);
  renderWeights('competenceWeights', data.competence);
  renderRecs('passionRecs',    data.passion?.recommendations);
  renderRecs('competenceRecs', data.competence?.recommendations);

  // Per-video table
  const subById = Object.fromEntries(submissions.map(s => [s.id, s]));
  const sids = Object.keys(targets);
  const compPV = Object.fromEntries((data.competence?.per_video || []).map(r => [r.id, r]));
  const passPV = Object.fromEntries((data.passion?.per_video    || []).map(r => [r.id, r]));

  document.getElementById('perVideoTable').innerHTML = sids.map(sid => {
    const name = subById[sid]?.name || sid.slice(0,8);
    const cp = compPV[sid], pp = passPV[sid];
    const errCls = e => Math.abs(e) <= 5 ? 'err-ok' : e > 0 ? 'err-pos' : 'err-neg';
    const errFmt = e => (e > 0 ? '+' : '') + e;
    const reasoning = (targets[sid] || {}).reasoning || '';
    return `<tr class="per-video-row">
      <td><strong>${name}</strong></td>
      <td>${cp ? cp.target : '—'}</td>
      <td>${cp ? cp.predicted : '—'}</td>
      <td class="${cp ? errCls(cp.error) : ''}">${cp ? errFmt(cp.error) : '—'}</td>
      <td>${pp ? pp.target : '—'}</td>
      <td>${pp ? pp.predicted : '—'}</td>
      <td class="${pp ? errCls(pp.error) : ''}">${pp ? errFmt(pp.error) : '—'}</td>
      <td style="font-size:.75rem;color:#6b7280;max-width:180px">${reasoning || '<span style="color:#d1d5db">—</span>'}</td>
    </tr>`;
  }).join('');

  // MongoDB update command
  const pf = data.passion?.optimized_weights || {};
  const cw = data.competence?.optimized_weights || {};
  // Passion uses a formula — written to scoring_spec.passion_formula, NOT submetric_weights
  const cmd = `db.config_collections.updateOne(
  { _id: ObjectId("${configId}") },
  { $set: {
      "scoring_spec.passion_formula": ${JSON.stringify(pf, null, 4)},
      "scoring_spec.submetric_weights.competence": ${JSON.stringify(cw, null, 4)}
  }}
)`;
  document.getElementById('mongoCmd').textContent = cmd;
  document.getElementById('resultsSection').classList.remove('hidden');
}

document.getElementById('copyBtn').addEventListener('click', () => {
  navigator.clipboard.writeText(document.getElementById('mongoCmd').textContent);
  document.getElementById('copyBtn').textContent = 'Copied!';
  setTimeout(() => document.getElementById('copyBtn').textContent = 'Copy command', 1500);
});

loadConfigs();
</script>
</body>
</html>"""


@calibrate_bp.route('/calibrate', methods=['GET'])
def calibrate_page():
    return render_template_string(PAGE)
