// @language JavaScript (React / JSX)
// @updated   2026-09-07
// @changed   New file: the Rating Scale block — config shape matches backend
//            src/studio/blocks/rating_scale.py exactly (question/scale_max/required).
import React from 'react';
import { registerBlock } from './registryStore';

const FONT_BODY = "'Plus Jakarta Sans', 'Inter', system-ui, sans-serif";

const RatingScaleBlock = ({ config, mode = 'edit', onChange, blockId, value, onAnswer, error }) => {
  const { question = '', scale_max = 5, required = false } = config || {};
  const points = Array.from({ length: scale_max }, (_, i) => i + 1);

  if (mode === 'respond') {
    return (
      <div className="p-4">
        <p className="text-sm font-semibold mb-3" style={{ fontFamily: FONT_BODY, color: '#1F1F1F' }}>
          {question} {required && <span style={{ color: '#FA6C43' }}>*</span>}
        </p>
        <div className="flex gap-2">
          {points.map((n) => (
            <button
              key={n}
              type="button"
              name={blockId}
              onClick={() => onAnswer(n)}
              className="w-9 h-9 rounded-full border text-sm font-semibold transition-colors"
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
      <label
        className="flex items-center gap-2 text-xs mt-1"
        style={{ fontFamily: FONT_BODY, color: 'rgba(31,31,31,0.6)' }}
      >
        Scale up to
        <input
          type="number"
          min={2}
          max={10}
          value={scale_max}
          onChange={(e) => onChange({ ...config, scale_max: Number(e.target.value) })}
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

registerBlock('rating_scale', RatingScaleBlock);

export default RatingScaleBlock;
