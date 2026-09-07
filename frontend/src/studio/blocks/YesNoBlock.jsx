// @language JavaScript (React / JSX)
// @updated   2026-09-07
// @changed   New file: the Yes/No block — config shape matches backend
//            src/studio/blocks/yes_no.py exactly. Answer value is the literal string "Yes" or "No".
import React from 'react';
import { registerBlock } from './registryStore';

const FONT_BODY = "'Plus Jakarta Sans', 'Inter', system-ui, sans-serif";

const YesNoBlock = ({ config, mode = 'edit', onChange, blockId, value, onAnswer, error }) => {
  const { question = '', required = false } = config || {};

  if (mode === 'respond') {
    return (
      <div className="p-4">
        <p className="text-sm font-semibold mb-3" style={{ fontFamily: FONT_BODY, color: '#1F1F1F' }}>
          {question} {required && <span style={{ color: '#FA6C43' }}>*</span>}
        </p>
        <div className="flex gap-2">
          {['Yes', 'No'].map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => onAnswer(opt)}
              className="flex-1 py-2.5 rounded-lg border text-sm font-semibold transition-colors"
              style={{
                fontFamily: FONT_BODY,
                borderColor: value === opt ? '#FA6C43' : 'rgba(31,31,31,0.15)',
                backgroundColor: value === opt ? '#FFF1EA' : 'transparent',
                color: value === opt ? '#FA6C43' : '#1F1F1F',
              }}
              aria-pressed={value === opt}
              name={blockId}
            >
              {opt}
            </button>
          ))}
        </div>
        {error && <p className="text-xs mt-2" style={{ color: '#E5484D', fontFamily: FONT_BODY }}>{error}</p>}
      </div>
    );
  }

  return (
    <div className="p-4 flex flex-col gap-2">
      <input
        type="text"
        value={question}
        onChange={(e) => onChange({ ...config, question: e.target.value })}
        placeholder="Question text"
        className="w-full px-3 py-2 rounded-lg border text-sm font-semibold"
        style={{ borderColor: 'rgba(31,31,31,0.15)', fontFamily: FONT_BODY, color: '#1F1F1F' }}
      />
      <div className="flex gap-2 mt-1">
        {['Yes', 'No'].map((opt) => (
          <span
            key={opt}
            className="flex-1 py-2 rounded-lg border text-sm text-center"
            style={{ borderColor: 'rgba(31,31,31,0.1)', fontFamily: FONT_BODY, color: 'rgba(31,31,31,0.5)' }}
          >
            {opt}
          </span>
        ))}
      </div>
      <label
        className="flex items-center gap-2 text-xs mt-1"
        style={{ fontFamily: FONT_BODY, color: 'rgba(31,31,31,0.6)' }}
      >
        <input
          type="checkbox"
          checked={required}
          onChange={(e) => onChange({ ...config, required: e.target.checked })}
        />
        Required
      </label>
    </div>
  );
};

registerBlock('yes_no', YesNoBlock);

export default YesNoBlock;
