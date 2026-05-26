import React, { useEffect, useState } from 'react';
import { FaTrash, FaPlus } from 'react-icons/fa';
import apiClient from '../api/apiClient';

const DIMS = [
  { key: 'confidence', label: 'Confidence', hint: 'Composure, steady voice, low filler' },
  { key: 'competence', label: 'Competence', hint: 'Content quality, structure, evidence' },
  { key: 'passion', label: 'Passion', hint: 'Energy, vocal variation, expressivity' },
];

/**
 * Assignment-type picker + editable scoring spec for video-analysis configs.
 * Presets come from the code-defined registry (GET /api/video/assignment-types);
 * selecting one pre-fills an editable spec that is stored on the config doc.
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
  const cw = spec.composite_weights || { confidence: 0.34, competence: 0.33, passion: 0.33 };
  const checks = spec.content_checks || [];

  const patch = (next) => onChange({ assignment_type: assignmentType, scoring_spec: { ...spec, ...next } });

  const setWeight = (dim, val) =>
    patch({ composite_weights: { ...cw, [dim]: val } });

  const setCheck = (idx, field, val) => {
    const c = checks.map((x, i) => (i === idx ? { ...x, [field]: val } : x));
    patch({ content_checks: c });
  };
  const addCheck = () =>
    patch({ content_checks: [...checks, { id: `check_${checks.length + 1}`, label: '', description: '' }] });
  const removeCheck = (idx) =>
    patch({ content_checks: checks.filter((_, i) => i !== idx) });

  const total = DIMS.reduce((s, d) => s + (Number(cw[d.key]) || 0), 0) || 1;

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

      {/* Composite weights */}
      <div className="bg-gray-50 p-5 rounded-2xl border border-gray-100">
        <h3 className="text-[13px] font-bold text-gray-800 uppercase tracking-wider mb-1">Score Weighting</h3>
        <p className="text-xs text-gray-500 mb-4">How much each composite counts toward the overall score.</p>
        <div className="space-y-4">
          {DIMS.map((d) => {
            const pct = Math.round(((Number(cw[d.key]) || 0) / total) * 100);
            return (
              <div key={d.key}>
                <label className="flex justify-between text-xs font-semibold text-gray-700 mb-1.5">
                  <span>{d.label} <span className="font-normal text-gray-400">— {d.hint}</span></span>
                  <span className="text-[#FA6C43] font-bold">{pct}%</span>
                </label>
                <input
                  type="range" min="0" max="1" step="0.05"
                  value={Number(cw[d.key]) || 0}
                  onChange={(e) => setWeight(d.key, parseFloat(e.target.value))}
                  className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-[#FA6C43]"
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* Feedback prompt */}
      <div>
        <label className="block text-[13px] font-semibold text-gray-700 mb-1.5">Feedback Prompt</label>
        <textarea
          rows="4"
          value={spec.feedback_prompt_template || ''}
          onChange={(e) => patch({ feedback_prompt_template: e.target.value })}
          className="w-full p-3 border border-gray-200 rounded-xl text-sm focus:border-[#FA6C43] outline-none"
          placeholder="Instructions for the AI that writes qualitative feedback…"
        />
      </div>

      {/* Content checks */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-[13px] font-semibold text-gray-700">Content Checks <span className="font-normal text-gray-400">(optional)</span></label>
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
          {checks.length === 0 && <p className="text-xs text-gray-400">No content checks — scoring relies on the rubric and delivery signals only.</p>}
        </div>
      </div>
    </div>
  );
}
