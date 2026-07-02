import React, { useEffect } from 'react';

// Professor-facing structured inputs for a Shock World lab. Rendered generically
// by LabGenerator when this method is selected; the values are sent to
// /experiential/generate as `method_params` and are the SOURCE OF TRUTH for the
// country list / round count / course-only flag (the generation model can't
// mis-transcribe them). Shape: { countries: string[], maxRounds: int, courseOnly: bool }.
export default function ConfigForm({ params, onChange }) {
  const p = params || {};
  const countriesText = Array.isArray(p.countries) ? p.countries.join('\n') : (p.countries || '');
  const maxRounds = Number.isInteger(p.maxRounds) ? p.maxRounds : 4;
  const courseOnly = !!p.courseOnly;

  const set = (patch) => onChange({ ...p, ...patch });

  // Seed the displayed default so an untouched form still sends maxRounds (the
  // backend would otherwise fall back to its own default and mismatch the UI).
  useEffect(() => {
    if (!Number.isInteger(p.maxRounds)) set({ maxRounds: 4 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="rounded-2xl border border-gray-200 bg-gray-50/60 p-4 space-y-3">
      <div>
        <label className="block text-[13px] font-semibold text-gray-700 mb-1.5">Countries students can pick (one per line)</label>
        <textarea
          value={countriesText}
          onChange={(e) => set({ countries: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) })}
          rows={4}
          placeholder={'Argentina\nTurkey\nEgypt'}
          className="w-full p-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F9D0C4] focus:border-[#FA6C43] transition-all resize-y"
        />
        <p className="text-[11px] text-gray-400 mt-1">Each student picks one; the shock is grounded to that country’s current conditions.</p>
      </div>

      <div className="flex items-center gap-3">
        <label className="text-[13px] font-semibold text-gray-700">Reply budget (N)</label>
        <input
          type="number"
          min={1}
          max={12}
          value={maxRounds}
          onChange={(e) => set({ maxRounds: Math.max(1, parseInt(e.target.value, 10) || 1) })}
          className="w-20 p-2 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F9D0C4] focus:border-[#FA6C43] transition-all"
        />
        <span className="text-[11px] text-gray-400">Max exchanges the tutor gets to guide the student to your end goal — they should reach it in fewer.</span>
      </div>

      <label className="flex items-center gap-2 text-[13px] text-gray-700 cursor-pointer">
        <input
          type="checkbox"
          checked={courseOnly}
          onChange={(e) => set({ courseOnly: e.target.checked })}
          className="w-4 h-4 rounded border-gray-300 text-[#FA6C43] focus:ring-[#FA6C43]"
        />
        <span><span className="font-semibold">Course-only</span> — confine the tutor strictly to uploaded course material</span>
      </label>
    </div>
  );
}
