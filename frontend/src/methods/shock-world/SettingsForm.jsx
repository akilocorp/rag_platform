// @language JavaScript (React)
// @updated 2026-07-16
// @changed New — post-generation grading settings panel (minimum grade floor).
import React from 'react';
import { FiSliders } from 'react-icons/fi';

// Post-generation settings for a Shock World lab. Unlike ConfigForm (which feeds
// the AI that WRITES the lab), these are grading-POLICY knobs applied at score
// time — no LLM ever sees them — so they patch the already-generated config
// directly and NEVER trigger a regenerate. Mounted generically by LabGenerator
// beneath the finished lab when the method ships a SettingsForm.
//
// Props: { config, onChange }. onChange(patch) is merged into experiential_config.
export default function SettingsForm({ config, onChange }) {
  const c = config || {};
  const floor = Number.isInteger(c.gradeFloor) ? c.gradeFloor : 0;

  const setFloor = (raw) => {
    let n = parseInt(raw, 10);
    if (!Number.isFinite(n)) n = 0;
    n = Math.max(0, Math.min(99, n));
    onChange({ gradeFloor: n });
  };

  return (
    <div className="mt-3 rounded-2xl border border-gray-200 bg-gray-50/60 p-4 space-y-2">
      <div className="flex items-center gap-2 text-[13px] font-semibold text-gray-700">
        <FiSliders className="text-[#FA6C43]" /> Grading
      </div>
      <div className="flex items-center gap-3">
        <label className="text-[13px] text-gray-700">Minimum grade</label>
        <input
          type="number"
          min={0}
          max={99}
          value={floor}
          onChange={(e) => setFloor(e.target.value)}
          className="w-20 p-2 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F9D0C4] focus:border-[#FA6C43] transition-all"
        />
        <span className="text-[11px] text-gray-400">
          {floor > 0
            ? `Every completed run scores between ${floor} and 100.`
            : 'No floor — runs score on the full 0–100 range.'}
        </span>
      </div>
      <p className="text-[11px] text-gray-400">
        A grading policy only — changing it re-scores future runs without rebuilding the lab.
      </p>
    </div>
  );
}
