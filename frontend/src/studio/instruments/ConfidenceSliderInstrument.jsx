// @language JavaScript (React / JSX)
// @updated   2026-09-07
// @changed   New file: the Confidence Slider instrument. Badge for the builder canvas; RespondExtra
//            is the actual 0-100 range input shown to the respondent below the block's own answer,
//            rendered by StudioRunnerPage (not the builder) since it captures a real value.
import React from 'react';
import { FaSlidersH, FaTimes } from 'react-icons/fa';
import { registerInstrument } from './registryStore';

const FONT_BODY = "'Plus Jakarta Sans', 'Inter', system-ui, sans-serif";

const Badge = ({ onRemove }) => (
  <span
    className="inline-flex items-center gap-1 pl-2 pr-1.5 py-1 rounded-full text-[11px] font-semibold"
    style={{ backgroundColor: '#EAF3FF', color: '#3E6493', fontFamily: FONT_BODY }}
  >
    <FaSlidersH size={10} />
    Confidence Slider
    <button
      type="button"
      onClick={onRemove}
      className="ml-0.5 opacity-40 hover:opacity-100 transition-opacity"
      aria-label="Remove Confidence Slider"
    >
      <FaTimes size={9} />
    </button>
  </span>
);

const RespondExtra = ({ value, onChange }) => {
  const current = value ?? 50;
  return (
    <div className="px-4 pb-4 -mt-1">
      <label
        className="text-xs font-medium flex items-center justify-between mb-1.5"
        style={{ fontFamily: FONT_BODY, color: 'rgba(31,31,31,0.6)' }}
      >
        How confident are you?
        <span style={{ color: '#FA6C43', fontWeight: 700 }}>{current}</span>
      </label>
      <input
        type="range"
        min={0}
        max={100}
        value={current}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
      />
    </div>
  );
};

registerInstrument('confidence_slider', { Badge, RespondExtra });

export default Badge;
