// @language JavaScript (React / JSX)
// @updated   2026-09-07
// @changed   New file: the Option Randomizer instrument. Badge only — no config (always {}) and no
//            RespondExtra (it transforms the block's own rendering, via StudioRunnerPage's seeded
//            shuffle, rather than adding anything alongside it).
import React from 'react';
import { FaRandom, FaTimes } from 'react-icons/fa';
import { registerInstrument } from './registryStore';

const FONT_BODY = "'Plus Jakarta Sans', 'Inter', system-ui, sans-serif";

const Badge = ({ onRemove }) => (
  <span
    className="inline-flex items-center gap-1 pl-2 pr-1.5 py-1 rounded-full text-[11px] font-semibold"
    style={{ backgroundColor: '#EAF6EF', color: '#1E7A3D', fontFamily: FONT_BODY }}
  >
    <FaRandom size={10} />
    Option Randomizer
    <button
      type="button"
      onClick={onRemove}
      className="ml-0.5 opacity-40 hover:opacity-100 transition-opacity"
      aria-label="Remove Option Randomizer"
    >
      <FaTimes size={9} />
    </button>
  </span>
);

registerInstrument('option_randomizer', { Badge });

export default Badge;
