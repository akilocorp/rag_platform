// @language JavaScript (React / JSX)
// @updated   2026-09-08
// @changed   New file: the Piped Text instrument. Badge + a ConfigEditor that picks which sibling
//            block to pull an answer from — the first instrument ConfigEditor to use the new
//            `allBlocks` prop (StudioBuilderPage's PlacedBlock now passes every other placed block,
//            self already excluded). The actual text-splicing happens in StudioRunnerPage's
//            applyBehaviorInstruments, not here — this file only edits config.
import React from 'react';
import { FaLink, FaTimes } from 'react-icons/fa';
import { registerInstrument } from './registryStore';

const FONT_BODY = "'Plus Jakarta Sans', 'Inter', system-ui, sans-serif";

const Badge = ({ onRemove }) => (
  <span
    className="inline-flex items-center gap-1 pl-2 pr-1.5 py-1 rounded-full text-[11px] font-semibold"
    style={{ backgroundColor: '#E8EEFB', color: '#3552A6', fontFamily: FONT_BODY }}
  >
    <FaLink size={10} />
    Piped Text
    <button
      type="button"
      onClick={onRemove}
      className="ml-0.5 opacity-40 hover:opacity-100 transition-opacity"
      aria-label="Remove Piped Text"
    >
      <FaTimes size={9} />
    </button>
  </span>
);

const ConfigEditor = ({ config, allBlocks, onChange }) => (
  <select
    value={config?.source_block_id || ''}
    onChange={(e) => onChange({ ...config, source_block_id: e.target.value })}
    className="text-xs px-2 py-1 rounded-md border max-w-[220px]"
    style={{ borderColor: 'rgba(31,31,31,0.15)', fontFamily: FONT_BODY, color: '#1F1F1F' }}
  >
    <option value="" disabled>Pull answer from…</option>
    {(allBlocks || []).map((b) => (
      <option key={b.id} value={b.id}>{b.config?.question || b.type}</option>
    ))}
  </select>
);

registerInstrument('piped_text', { Badge, ConfigEditor });

export default Badge;
