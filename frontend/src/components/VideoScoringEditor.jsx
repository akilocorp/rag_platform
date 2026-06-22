import React, { useEffect, useState } from 'react';
import { FaTrash, FaPlus } from 'react-icons/fa';
import apiClient from '../api/apiClient';

/**
 * Assignment-type picker + editable scoring spec for video-analysis configs.
 * Presets come from the code-defined registry (GET /api/video/assignment-types);
 * selecting one pre-fills an editable spec that is stored on the config doc.
 *
 * Scoring "boxes" (dimensions) are fully prof-defined: name + definition. The
 * scoring agent reads whichever signals (delivery report and/or transcript) are
 * relevant to each definition — there is no per-source picker by design. Each
 * box renders on the results page as a score /10 + a one-paragraph rationale.
 *
 * Props:
 *   assignmentType : string
 *   scoringSpec    : object | null
 *   onChange({ assignment_type, scoring_spec })
 */
export default function VideoScoringEditor({ assignmentType, scoringSpec, onChange }) {
  const [presets, setPresets] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    apiClient.get('/video/assignment-types')
      .then((res) => {
        if (!alive) return;
        const list = res.data?.presets || [];
        setPresets(list);
        // Auto-select the first preset if nothing is configured yet.
        if (!assignmentType && list.length) {
          onChange({ assignment_type: list[0].key, scoring_spec: list[0].scoring_spec });
        }
      })
      .catch((e) => console.error('Failed to load assignment types', e))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectPreset = (key) => {
    const p = presets.find((x) => x.key === key);
    if (p) onChange({ assignment_type: key, scoring_spec: JSON.parse(JSON.stringify(p.scoring_spec)) });
  };

  const spec = scoringSpec || {};
  const dimensions = spec.dimensions || [];
  const checks = spec.content_checks || [];

  const patch = (next) => onChange({ assignment_type: assignmentType, scoring_spec: { ...spec, ...next } });

  // --- dimensions (scoring boxes) ---
  const slug = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const setDim = (idx, field, val) => {
    const d = dimensions.map((x, i) => {
      if (i !== idx) return x;
      const next = { ...x, [field]: val };
      // keep id in sync with the name unless it was already a stable slug the
      // user typed against; regenerate from name so it stays human-readable.
      if (field === 'name') next.id = slug(val) || x.id || `dim_${idx + 1}`;
      return next;
    });
    patch({ dimensions: d });
  };
  const addDim = () =>
    patch({ dimensions: [...dimensions, { id: `dim_${dimensions.length + 1}`, name: '', definition: '' }] });
  const removeDim = (idx) =>
    patch({ dimensions: dimensions.filter((_, i) => i !== idx) });

  // --- content checks ---
  const setCheck = (idx, field, val) => {
    const c = checks.map((x, i) => (i === idx ? { ...x, [field]: val } : x));
    patch({ content_checks: c });
  };
  const addCheck = () =>
    patch({ content_checks: [...checks, { id: `check_${checks.length + 1}`, label: '', description: '' }] });
  const removeCheck = (idx) =>
    patch({ content_checks: checks.filter((_, i) => i !== idx) });

  if (loading) {
    return <p className="text-sm text-gray-500 text-center py-8">Loading assignment types…</p>;
  }

  return (
    <div className="space-y-6">
      {/* Assignment type */}
      <div>
        <label className="block text-[13px] font-semibold text-gray-700 mb-1.5">Assignment Type</label>
        <select
          value={assignmentType || ''}
          onChange={(e) => selectPreset(e.target.value)}
          className="w-full p-3 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-[#FA6C43]"
        >
          {presets.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
        {(() => {
          const p = presets.find((x) => x.key === assignmentType);
          return p?.description ? <p className="text-xs text-gray-500 mt-1.5">{p.description}</p> : null;
        })()}
      </div>

      {/* Scoring boxes (dimensions) */}
      <div className="bg-gray-50 p-5 rounded-2xl border border-gray-100">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-[13px] font-bold text-gray-800 uppercase tracking-wider">Scoring Boxes</h3>
          <button type="button" onClick={addDim} className="text-xs font-bold text-[#FA6C43] flex items-center gap-1 hover:underline">
            <FaPlus className="text-[10px]" /> Add box
          </button>
        </div>
        <p className="text-xs text-gray-500 mb-4">
          Each box is scored out of 10 with a short written rationale. Name it and describe what it measures —
          the AI evaluator decides which signals (body language, voice, transcript) to use from your description.
        </p>
        <div className="space-y-3">
          {dimensions.map((d, idx) => (
            <div key={idx} className="bg-white border border-gray-100 rounded-xl p-3">
              <div className="flex gap-2 items-start">
                <div className="flex-1 space-y-2">
                  <input
                    value={d.name || ''} onChange={(e) => setDim(idx, 'name', e.target.value)}
                    placeholder="Box name (e.g. Confidence)"
                    className="w-full p-2 bg-gray-50 border border-gray-200 rounded-lg text-sm font-semibold focus:outline-none focus:border-[#FA6C43]"
                  />
                  <textarea
                    rows="2"
                    value={d.definition || ''} onChange={(e) => setDim(idx, 'definition', e.target.value)}
                    placeholder="What does this box measure? e.g. 'How composed and assured the speaker appears — steady gaze, grounded posture, controlled gestures, a steady voice.'"
                    className="w-full p-2 bg-gray-50 border border-gray-200 rounded-lg text-xs focus:outline-none focus:border-[#FA6C43]"
                  />
                </div>
                <button type="button" onClick={() => removeDim(idx)} className="text-gray-400 hover:text-red-500 p-2">
                  <FaTrash className="text-sm" />
                </button>
              </div>
            </div>
          ))}
          {dimensions.length === 0 && <p className="text-xs text-gray-400">No scoring boxes — add at least one (e.g. Confidence, Competence, Passion).</p>}
        </div>
      </div>

      {/* Grading prompt */}
      <div>
        <label className="block text-[13px] font-semibold text-gray-700 mb-1.5">Grading Prompt</label>
        <p className="text-xs text-gray-500 mb-2">Your grading philosophy — how strict to be and what matters most. Guides the final evaluator across all boxes and checks.</p>
        <textarea
          rows="5"
          value={spec.feedback_prompt_template || ''}
          onChange={(e) => patch({ feedback_prompt_template: e.target.value })}
          className="w-full p-3 border border-gray-200 rounded-xl text-sm focus:border-[#FA6C43] outline-none"
          placeholder="E.g. 'You are a strict pitch-competition judge. Reward explicit clarity; penalize vague or implied content. Poor delivery should drag the overall score down even if the content is solid.'"
        />
      </div>

      {/* Content checks */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-[13px] font-semibold text-gray-700">Content Checks <span className="font-normal text-gray-400">(checked against the transcript)</span></label>
          <button type="button" onClick={addCheck} className="text-xs font-bold text-[#FA6C43] flex items-center gap-1 hover:underline">
            <FaPlus className="text-[10px]" /> Add check
          </button>
        </div>
        <div className="space-y-2">
          {checks.map((c, idx) => (
            <div key={idx} className="flex gap-2 items-start bg-white border border-gray-100 rounded-xl p-3">
              <div className="flex-1 space-y-2">
                <input
                  value={c.label || ''} onChange={(e) => setCheck(idx, 'label', e.target.value)}
                  placeholder="Label (e.g. Opening hook)"
                  className="w-full p-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-[#FA6C43]"
                />
                <input
                  value={c.description || ''} onChange={(e) => setCheck(idx, 'description', e.target.value)}
                  placeholder="What satisfies this check?"
                  className="w-full p-2 bg-gray-50 border border-gray-200 rounded-lg text-xs focus:outline-none focus:border-[#FA6C43]"
                />
              </div>
              <button type="button" onClick={() => removeCheck(idx)} className="text-gray-400 hover:text-red-500 p-2">
                <FaTrash className="text-sm" />
              </button>
            </div>
          ))}
          {checks.length === 0 && <p className="text-xs text-gray-400">No content checks — scoring relies on the boxes and grading prompt only.</p>}
        </div>
      </div>
    </div>
  );
}
