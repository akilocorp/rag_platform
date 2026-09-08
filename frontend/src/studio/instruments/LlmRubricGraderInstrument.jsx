// @language JavaScript (React / JSX)
// @updated   2026-09-08
// @changed   New file: the LLM Rubric Grader instrument. Badge + a ConfigEditor (rubric textarea).
//            No RespondExtra — the score is computed owner-side at results-view time (see backend
//            src/studio/instruments/llm_rubric_grader.py), not something the respondent sees live.
import React from 'react';
import { FaGraduationCap, FaTimes } from 'react-icons/fa';
import { registerInstrument } from './registryStore';

const FONT_BODY = "'Plus Jakarta Sans', 'Inter', system-ui, sans-serif";

const Badge = ({ onRemove }) => (
  <span
    className="inline-flex items-center gap-1 pl-2 pr-1.5 py-1 rounded-full text-[11px] font-semibold"
    style={{ backgroundColor: '#FDF3E3', color: '#B8860B', fontFamily: FONT_BODY }}
  >
    <FaGraduationCap size={10} />
    LLM Rubric Grader
    <button
      type="button"
      onClick={onRemove}
      className="ml-0.5 opacity-40 hover:opacity-100 transition-opacity"
      aria-label="Remove LLM Rubric Grader"
    >
      <FaTimes size={9} />
    </button>
  </span>
);

const ConfigEditor = ({ config, onChange }) => (
  <textarea
    value={config?.rubric || ''}
    onChange={(e) => onChange({ ...config, rubric: e.target.value })}
    placeholder="Score the answer's clarity and relevance from 1 (poor) to 5 (excellent)."
    rows={2}
    className="text-xs px-2 py-1.5 rounded-md border w-64 resize-y"
    style={{ borderColor: 'rgba(31,31,31,0.15)', fontFamily: FONT_BODY, color: '#1F1F1F' }}
  />
);

registerInstrument('llm_rubric_grader', { Badge, ConfigEditor });

export default Badge;
