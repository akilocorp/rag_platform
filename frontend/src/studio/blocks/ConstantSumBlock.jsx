// @language JavaScript (React / JSX)
// @updated   2026-09-08
// @changed   New file: the Constant Sum block. Respond mode shows a running total against the
//            target and colors it red/green — feedback only, doesn't block Submit (see backend
//            src/studio/blocks/constant_sum.py for why: no page-level mechanism today for a block
//            to fail validation beyond the generic "required" check).
import React from 'react';
import { registerBlock } from './registryStore';

const FONT_BODY = "'Plus Jakarta Sans', 'Inter', system-ui, sans-serif";

const ConstantSumBlock = ({ config, mode = 'edit', onChange, value, onAnswer, error }) => {
  const { question = '', options = [], total = 100, required = false } = config || {};

  const updateOption = (idx, val) => {
    const next = [...options];
    next[idx] = val;
    onChange({ ...config, options: next });
  };
  const addOption = () => onChange({ ...config, options: [...options, `Option ${options.length + 1}`] });
  const removeOption = (idx) => onChange({ ...config, options: options.filter((_, i) => i !== idx) });

  if (mode === 'respond') {
    const allocations = value || {};
    const sum = options.reduce((acc, opt) => acc + (Number(allocations[opt]) || 0), 0);
    const isBalanced = sum === total;

    return (
      <div className="p-4">
        <p className="text-sm font-semibold mb-3" style={{ fontFamily: FONT_BODY, color: '#1F1F1F' }}>
          {question} {required && <span style={{ color: '#FA6C43' }}>*</span>}
        </p>
        <div className="flex flex-col gap-2">
          {options.map((opt) => (
            <div key={opt} className="flex items-center gap-2">
              <span className="flex-1 text-sm" style={{ fontFamily: FONT_BODY, color: '#1F1F1F' }}>{opt}</span>
              <input
                type="number"
                value={allocations[opt] ?? ''}
                onChange={(e) => onAnswer({ ...allocations, [opt]: e.target.value === '' ? undefined : Number(e.target.value) })}
                className="w-20 px-2 py-1 rounded-md border text-sm text-right"
                style={{ borderColor: 'rgba(31,31,31,0.15)', fontFamily: FONT_BODY, color: '#1F1F1F' }}
              />
            </div>
          ))}
        </div>
        <p
          className="text-xs mt-2 font-semibold"
          style={{ fontFamily: FONT_BODY, color: isBalanced ? '#1E7A3D' : '#B85C1E' }}
        >
          Total: {sum} / {total}
        </p>
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
      <div className="flex flex-col gap-1.5 mt-1">
        {options.map((opt, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <input
              type="text"
              value={opt}
              onChange={(e) => updateOption(idx, e.target.value)}
              className="flex-1 px-2.5 py-1.5 rounded-md border text-sm"
              style={{ borderColor: 'rgba(31,31,31,0.1)', fontFamily: FONT_BODY, color: '#1F1F1F' }}
            />
            {options.length > 2 && (
              <button
                type="button"
                onClick={() => removeOption(idx)}
                className="text-xs px-1.5"
                style={{ color: 'rgba(31,31,31,0.4)' }}
                aria-label="Remove option"
              >
                &times;
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          onClick={addOption}
          className="self-start text-xs font-semibold mt-1"
          style={{ color: '#FA6C43', fontFamily: FONT_BODY }}
        >
          + Add option
        </button>
      </div>
      <label
        className="flex items-center gap-2 text-xs mt-1"
        style={{ fontFamily: FONT_BODY, color: 'rgba(31,31,31,0.6)' }}
      >
        Total to allocate
        <input
          type="number"
          min={1}
          max={1000}
          value={total}
          onChange={(e) => onChange({ ...config, total: Number(e.target.value) })}
          className="w-20 px-2 py-1 rounded-md border text-sm"
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

registerBlock('constant_sum', ConstantSumBlock);

export default ConstantSumBlock;
