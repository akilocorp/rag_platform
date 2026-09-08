// @language JavaScript (React / JSX)
// @updated   2026-09-08
// @changed   New file: the Forced Rank Order block. Respond mode reorders via up/down buttons
//            rather than drag handles — a block component isn't part of the builder's DndContext,
//            so real drag-reorder here would mean nesting a second dnd-kit context just for this one
//            block; arrow buttons get the same "order every option" result with far less machinery.
//            Edit mode reuses Single Choice's exact options add/remove/edit pattern.
import React from 'react';
import { FaArrowUp, FaArrowDown } from 'react-icons/fa';
import { registerBlock } from './registryStore';

const FONT_BODY = "'Plus Jakarta Sans', 'Inter', system-ui, sans-serif";

const ForcedRankBlock = ({ config, mode = 'edit', onChange, value, onAnswer, error }) => {
  const { question = '', options = [], required = false } = config || {};

  const updateOption = (idx, val) => {
    const next = [...options];
    next[idx] = val;
    onChange({ ...config, options: next });
  };
  const addOption = () => onChange({ ...config, options: [...options, `Option ${options.length + 1}`] });
  const removeOption = (idx) => onChange({ ...config, options: options.filter((_, i) => i !== idx) });

  if (mode === 'respond') {
    const order = Array.isArray(value) && value.length === options.length ? value : options;
    const move = (idx, dir) => {
      const target = idx + dir;
      if (target < 0 || target >= order.length) return;
      const next = [...order];
      [next[idx], next[target]] = [next[target], next[idx]];
      onAnswer(next);
    };

    return (
      <div className="p-4">
        <p className="text-sm font-semibold mb-3" style={{ fontFamily: FONT_BODY, color: '#1F1F1F' }}>
          {question} {required && <span style={{ color: '#FA6C43' }}>*</span>}
        </p>
        <div className="flex flex-col gap-1.5">
          {order.map((opt, idx) => (
            <div
              key={opt}
              className="flex items-center gap-2 px-3 py-2 rounded-lg border text-sm"
              style={{ borderColor: 'rgba(31,31,31,0.12)', fontFamily: FONT_BODY, color: '#1F1F1F' }}
            >
              <span className="w-5 text-center font-bold" style={{ color: '#FA6C43' }}>{idx + 1}</span>
              <span className="flex-1">{opt}</span>
              <button
                type="button"
                onClick={() => move(idx, -1)}
                disabled={idx === 0}
                className="p-1 rounded disabled:opacity-30"
                style={{ color: 'rgba(31,31,31,0.5)' }}
                aria-label={`Move ${opt} up`}
              >
                <FaArrowUp size={11} />
              </button>
              <button
                type="button"
                onClick={() => move(idx, 1)}
                disabled={idx === order.length - 1}
                className="p-1 rounded disabled:opacity-30"
                style={{ color: 'rgba(31,31,31,0.5)' }}
                aria-label={`Move ${opt} down`}
              >
                <FaArrowDown size={11} />
              </button>
            </div>
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

registerBlock('forced_rank', ForcedRankBlock);

export default ForcedRankBlock;
