// @language  JavaScript (React / JSX)
// @updated   2026-08-11
// @changed   New file: the attempts-per-exercise setting, shared by the create wizard and the edit page.
import React from 'react';

// Mirrors DEFAULT_MAX_ATTEMPTS / MIN / MAX in backend/src/facilitator/config.py.
// The backend clamps whatever arrives, so this is the friendly bound, not the real one.
export const DEFAULT_MAX_ATTEMPTS = 2;

// How many times a student may check a graded exercise before it locks. A pedagogy
// judgement, so the professor owns it; the code constant is only the default.
export default function FacilitatorAttempts({ config, setConfig }) {
  const value = config.facilitator?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  return (
    <div className="mt-4">
      <label className="block text-xs font-semibold text-gray-600 mb-1.5">Attempts per exercise</label>
      <input
        type="number"
        min={1}
        max={10}
        value={value}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10);
          setConfig((prev) => ({
            ...prev,
            facilitator: {
              ...(prev.facilitator || {}),
              maxAttempts: Number.isNaN(n) ? DEFAULT_MAX_ATTEMPTS : Math.max(1, Math.min(10, n)),
            },
          }));
        }}
        className="w-24 px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F9D0C4] focus:border-[#FA6C43] transition-all"
      />
      <p className="text-[11px] text-gray-400 mt-1.5">
        How many times a student may check a graded exercise before it locks. The answers are never
        shown on screen — after each check they see what they got right and how many are still
        missing, and sending the result to the bot is what gets the rest explained.
      </p>
    </div>
  );
}
