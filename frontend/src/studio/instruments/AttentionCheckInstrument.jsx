// @language JavaScript (React / JSX)
// @updated   2026-09-07
// @changed   New file: the Attention Check instrument. Badge + a ConfigEditor that lists the
//            host block's current options (it only applies to single_choice) so the professor
//            picks which one counts as "paying attention." Never surfaced to the respondent —
//            see backend src/studio/instruments/attention_check.py for why it must not gate submission.
import React from 'react';
import { FaShieldAlt, FaTimes } from 'react-icons/fa';
import { registerInstrument } from './registryStore';

const FONT_BODY = "'Plus Jakarta Sans', 'Inter', system-ui, sans-serif";

const Badge = ({ onRemove }) => (
  <span
    className="inline-flex items-center gap-1 pl-2 pr-1.5 py-1 rounded-full text-[11px] font-semibold"
    style={{ backgroundColor: '#FDECEC', color: '#C0392B', fontFamily: FONT_BODY }}
  >
    <FaShieldAlt size={10} />
    Attention Check
    <button
      type="button"
      onClick={onRemove}
      className="ml-0.5 opacity-40 hover:opacity-100 transition-opacity"
      aria-label="Remove Attention Check"
    >
      <FaTimes size={9} />
    </button>
  </span>
);

const ConfigEditor = ({ config, blockConfig, onChange }) => (
  <select
    value={config?.expected_option || ''}
    onChange={(e) => onChange({ ...config, expected_option: e.target.value })}
    className="text-xs px-2 py-1 rounded-md border"
    style={{ borderColor: 'rgba(31,31,31,0.15)', fontFamily: FONT_BODY, color: '#1F1F1F' }}
  >
    <option value="" disabled>Correct option…</option>
    {(blockConfig?.options || []).map((opt) => (
      <option key={opt} value={opt}>{opt}</option>
    ))}
  </select>
);

registerInstrument('attention_check', { Badge, ConfigEditor });

export default Badge;
