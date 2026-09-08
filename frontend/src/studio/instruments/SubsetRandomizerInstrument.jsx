// @language JavaScript (React / JSX)
// @updated   2026-09-08
// @changed   New file: the Subset Randomizer instrument. Badge + a ConfigEditor (count input,
//            capped to the host block's current option count). No RespondExtra — like Option
//            Randomizer, it transforms the block's own rendering (a seeded slice, not just a
//            shuffle) via StudioRunnerPage's applyBehaviorInstruments rather than adding UI
//            alongside it.
import React from 'react';
import { FaFilter, FaTimes } from 'react-icons/fa';
import { registerInstrument } from './registryStore';

const FONT_BODY = "'Plus Jakarta Sans', 'Inter', system-ui, sans-serif";

const Badge = ({ onRemove }) => (
  <span
    className="inline-flex items-center gap-1 pl-2 pr-1.5 py-1 rounded-full text-[11px] font-semibold"
    style={{ backgroundColor: '#E7F3EE', color: '#1E6B4F', fontFamily: FONT_BODY }}
  >
    <FaFilter size={10} />
    Subset Randomizer
    <button
      type="button"
      onClick={onRemove}
      className="ml-0.5 opacity-40 hover:opacity-100 transition-opacity"
      aria-label="Remove Subset Randomizer"
    >
      <FaTimes size={9} />
    </button>
  </span>
);

const ConfigEditor = ({ config, blockConfig, onChange }) => {
  const optionCount = blockConfig?.options?.length || 2;
  return (
    <label className="inline-flex items-center gap-1.5 text-xs" style={{ fontFamily: FONT_BODY, color: 'rgba(31,31,31,0.6)' }}>
      Show
      <input
        type="number"
        min={1}
        max={optionCount}
        value={config?.count ?? 2}
        onChange={(e) => onChange({ ...config, count: Number(e.target.value) })}
        className="w-12 px-1.5 py-1 rounded-md border text-xs"
        style={{ borderColor: 'rgba(31,31,31,0.15)', color: '#1F1F1F' }}
      />
      of {optionCount} options
    </label>
  );
};

registerInstrument('subset_randomizer', { Badge, ConfigEditor });

export default Badge;
