// @language JavaScript (React / JSX)
// @updated   2026-09-07
// @changed   Phase 3: registration call updated to the new {Badge, ...} bundle shape. Still no
//            RespondExtra/ConfigEditor — it's purely passive, just attach/remove.
//            Prior: New file: the Reaction Timer instrument's badge — rendered on a placed block
//            that carries it. No config UI (its backend config is always {}); just attach/remove.
import React from 'react';
import { FaStopwatch, FaTimes } from 'react-icons/fa';
import { registerInstrument } from './registryStore';

const FONT_BODY = "'Plus Jakarta Sans', 'Inter', system-ui, sans-serif";

const ReactionTimerInstrument = ({ onRemove }) => (
  <span
    className="group/badge inline-flex items-center gap-1 pl-2 pr-1.5 py-1 rounded-full text-[11px] font-semibold"
    style={{ backgroundColor: '#FFF1EA', color: '#FA6C43', fontFamily: FONT_BODY }}
  >
    <FaStopwatch size={10} />
    Reaction Timer
    <button
      type="button"
      onClick={onRemove}
      className="ml-0.5 opacity-40 hover:opacity-100 transition-opacity"
      aria-label="Remove Reaction Timer"
    >
      <FaTimes size={9} />
    </button>
  </span>
);

registerInstrument('reaction_timer', { Badge: ReactionTimerInstrument });

export default ReactionTimerInstrument;
