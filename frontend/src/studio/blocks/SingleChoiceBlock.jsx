// @language JavaScript (React / JSX)
// @updated   2026-09-07
// @changed   New file: the Single Choice block's canvas renderer — config shape (question/
//            options/required) matches backend src/studio/blocks/single_choice.py exactly.
import React from 'react';
import { registerBlock } from './registry';

const FONT_BODY = "'Plus Jakarta Sans', 'Inter', system-ui, sans-serif";

const SingleChoiceBlock = ({ config, onChange, readOnly = false }) => {
  const { question = '', options = [], required = false } = config || {};

  const updateOption = (idx, value) => {
    const next = [...options];
    next[idx] = value;
    onChange({ ...config, options: next });
  };

  const addOption = () => {
    onChange({ ...config, options: [...options, `Option ${options.length + 1}`] });
  };

  const removeOption = (idx) => {
    onChange({ ...config, options: options.filter((_, i) => i !== idx) });
  };

  if (readOnly) {
    return (
      <div className="p-4">
        <p className="text-sm font-semibold mb-3" style={{ fontFamily: FONT_BODY, color: '#1F1F1F' }}>
          {question} {required && <span style={{ color: '#FA6C43' }}>*</span>}
        </p>
        <div className="flex flex-col gap-2">
          {options.map((opt, idx) => (
            <label
              key={idx}
              className="flex items-center gap-2 text-sm"
              style={{ fontFamily: FONT_BODY, color: '#1F1F1F' }}
            >
              <input type="radio" disabled name={`preview-${question}`} />
              {opt}
            </label>
          ))}
        </div>
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

registerBlock('single_choice', SingleChoiceBlock);

export default SingleChoiceBlock;
