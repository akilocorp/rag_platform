// @language JavaScript (React / JSX)
// @updated   2026-09-08
// @changed   New file: the Instructed Response instrument. Badge + a ConfigEditor with the
//            instruction sentence and a dropdown of the host block's current options (same pattern
//            as Attention Check's ConfigEditor) so the professor picks which one counts as
//            compliant. The instruction sentence itself gets appended to the question by
//            StudioRunnerPage — this file has no RespondExtra, it never renders anything for the
//            respondent directly.
import React from 'react';
import { FaClipboardCheck, FaTimes } from 'react-icons/fa';
import { registerInstrument } from './registryStore';

const FONT_BODY = "'Plus Jakarta Sans', 'Inter', system-ui, sans-serif";

const Badge = ({ onRemove }) => (
  <span
    className="inline-flex items-center gap-1 pl-2 pr-1.5 py-1 rounded-full text-[11px] font-semibold"
    style={{ backgroundColor: '#F1EBFA', color: '#6B3FA0', fontFamily: FONT_BODY }}
  >
    <FaClipboardCheck size={10} />
    Instructed Response
    <button
      type="button"
      onClick={onRemove}
      className="ml-0.5 opacity-40 hover:opacity-100 transition-opacity"
      aria-label="Remove Instructed Response"
    >
      <FaTimes size={9} />
    </button>
  </span>
);

const ConfigEditor = ({ config, blockConfig, onChange }) => (
  <div className="flex flex-col gap-1.5">
    <input
      type="text"
      value={config?.instruction_text || ''}
      onChange={(e) => onChange({ ...config, instruction_text: e.target.value })}
      placeholder="Instruction sentence shown after the question"
      className="text-xs px-2 py-1 rounded-md border w-56"
      style={{ borderColor: 'rgba(31,31,31,0.15)', fontFamily: FONT_BODY, color: '#1F1F1F' }}
    />
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
  </div>
);

registerInstrument('instructed_response', { Badge, ConfigEditor });

export default Badge;
