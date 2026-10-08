// @language JavaScript (React / JSX)
// @updated   2026-10-08
// @changed   Edit mode now renders only the option list (shared OptionListEditor) for the builder's
//            settings panel — the question and Required moved there; respond mode uses the shared
//            QuestionHeader.
// Prior: New file: the Forced Rank Order block. Respond mode reorders via up/down buttons
//            rather than drag handles — a block component isn't part of the builder's DndContext,
//            so real drag-reorder here would mean nesting a second dnd-kit context just for this one
//            block; arrow buttons get the same "order every option" result with far less machinery.
//            Edit mode reuses Single Choice's exact options add/remove/edit pattern.
import React from 'react';
import { FaArrowUp, FaArrowDown } from 'react-icons/fa';
import { registerBlock } from './registryStore';
import { FONT_BODY, QuestionHeader, OptionListEditor } from './blockParts';

const ForcedRankBlock = ({ config, mode = 'edit', onChange, value, onAnswer, error }) => {
  const { options = [] } = config || {};

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
        <QuestionHeader config={config} />
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
    <OptionListEditor
      label="Items to rank"
      hint="Respondents put every item in order."
      items={options}
      itemLabel="item"
      onChange={(next) => onChange({ ...config, options: next })}
    />
  );
};

registerBlock('forced_rank', ForcedRankBlock);

export default ForcedRankBlock;
