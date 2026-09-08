// @language JavaScript (React / JSX)
// @updated   2026-09-08
// @changed   New file: the Cross-Answer Inconsistency instrument. Badge + a ConfigEditor reusing
//            the `allBlocks` prop Piped Text introduced — picks which sibling block's answer to
//            compare against. No RespondExtra: computed owner-side at results-view time (see
//            backend src/studio/instruments/cross_answer_inconsistency.py for how the sibling
//            answer actually reaches compute()).
import React from 'react';
import { FaNotEqual, FaTimes } from 'react-icons/fa';
import { registerInstrument } from './registryStore';

const FONT_BODY = "'Plus Jakarta Sans', 'Inter', system-ui, sans-serif";

const Badge = ({ onRemove }) => (
  <span
    className="inline-flex items-center gap-1 pl-2 pr-1.5 py-1 rounded-full text-[11px] font-semibold"
    style={{ backgroundColor: '#FDECEC', color: '#C0392B', fontFamily: FONT_BODY }}
  >
    <FaNotEqual size={10} />
    Cross-Answer Inconsistency
    <button
      type="button"
      onClick={onRemove}
      className="ml-0.5 opacity-40 hover:opacity-100 transition-opacity"
      aria-label="Remove Cross-Answer Inconsistency"
    >
      <FaTimes size={9} />
    </button>
  </span>
);

const ConfigEditor = ({ config, allBlocks, onChange }) => (
  <select
    value={config?.compare_to_block_id || ''}
    onChange={(e) => onChange({ ...config, compare_to_block_id: e.target.value })}
    className="text-xs px-2 py-1 rounded-md border max-w-[220px]"
    style={{ borderColor: 'rgba(31,31,31,0.15)', fontFamily: FONT_BODY, color: '#1F1F1F' }}
  >
    <option value="" disabled>Compare against…</option>
    {(allBlocks || []).map((b) => (
      <option key={b.id} value={b.id}>{b.config?.question || b.type}</option>
    ))}
  </select>
);

registerInstrument('cross_answer_inconsistency', { Badge, ConfigEditor });

export default Badge;
