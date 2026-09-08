// @language JavaScript (React / JSX)
// @updated   2026-09-08
// @changed   New file: the Semantic Differential block — config shape matches backend
//            src/studio/blocks/semantic_differential.py exactly. Respond UI mirrors Rating Scale's
//            row of numbered buttons, flanked by the two adjective labels instead of standing alone.
import React from 'react';
import { registerBlock } from './registryStore';

const FONT_BODY = "'Plus Jakarta Sans', 'Inter', system-ui, sans-serif";

const SemanticDifferentialBlock = ({ config, mode = 'edit', onChange, blockId, value, onAnswer, error }) => {
  const { question = '', left_label = 'Weak', right_label = 'Strong', points = 7, required = false } = config || {};
  const scale = Array.from({ length: points }, (_, i) => i + 1);

  if (mode === 'respond') {
    return (
      <div className="p-4">
        <p className="text-sm font-semibold mb-3" style={{ fontFamily: FONT_BODY, color: '#1F1F1F' }}>
          {question} {required && <span style={{ color: '#FA6C43' }}>*</span>}
        </p>
        <div className="flex items-center gap-3">
          <span className="text-xs shrink-0" style={{ fontFamily: FONT_BODY, color: 'rgba(31,31,31,0.6)' }}>{left_label}</span>
          <div className="flex gap-1.5 flex-1 justify-center">
            {scale.map((n) => (
              <button
                key={n}
                type="button"
                name={blockId}
                onClick={() => onAnswer(n)}
                className="w-8 h-8 rounded-full border text-xs font-semibold transition-colors"
                style={{
                  fontFamily: FONT_BODY,
                  borderColor: value === n ? '#FA6C43' : 'rgba(31,31,31,0.15)',
                  backgroundColor: value === n ? '#FA6C43' : 'transparent',
                  color: value === n ? '#FFFFFF' : '#1F1F1F',
                }}
                aria-pressed={value === n}
              >
                {n}
              </button>
            ))}
          </div>
          <span className="text-xs shrink-0" style={{ fontFamily: FONT_BODY, color: 'rgba(31,31,31,0.6)' }}>{right_label}</span>
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
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={left_label}
          onChange={(e) => onChange({ ...config, left_label: e.target.value })}
          placeholder="Left label"
          className="flex-1 px-2.5 py-1.5 rounded-md border text-sm"
          style={{ borderColor: 'rgba(31,31,31,0.1)', fontFamily: FONT_BODY, color: '#1F1F1F' }}
        />
        <input
          type="text"
          value={right_label}
          onChange={(e) => onChange({ ...config, right_label: e.target.value })}
          placeholder="Right label"
          className="flex-1 px-2.5 py-1.5 rounded-md border text-sm"
          style={{ borderColor: 'rgba(31,31,31,0.1)', fontFamily: FONT_BODY, color: '#1F1F1F' }}
        />
      </div>
      <label
        className="flex items-center gap-2 text-xs mt-1"
        style={{ fontFamily: FONT_BODY, color: 'rgba(31,31,31,0.6)' }}
      >
        Points
        <input
          type="number"
          min={2}
          max={9}
          value={points}
          onChange={(e) => onChange({ ...config, points: Number(e.target.value) })}
          className="w-14 px-2 py-1 rounded-md border text-sm"
          style={{ borderColor: 'rgba(31,31,31,0.15)', fontFamily: FONT_BODY, color: '#1F1F1F' }}
        />
      </label>
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

registerBlock('semantic_differential', SemanticDifferentialBlock);

export default SemanticDifferentialBlock;
