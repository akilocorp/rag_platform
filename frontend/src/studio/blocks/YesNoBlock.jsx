// @language JavaScript (React / JSX)
// @updated   2026-10-08
// @changed   Respond mode uses the shared QuestionHeader (rich text + help text). Edit mode is gone:
//            the question and Required now live in the builder's settings panel, and Yes/No has no
//            settings of its own, so it renders nothing there.
// Prior: New file: the Yes/No block — config shape matches backend
//            src/studio/blocks/yes_no.py exactly. Answer value is the literal string "Yes" or "No".
import React from 'react';
import { registerBlock } from './registryStore';
import { FONT_BODY, QuestionHeader } from './blockParts';

const YesNoBlock = ({ config, mode = 'edit', blockId, value, onAnswer, error }) => {
  if (mode !== 'respond') return null;

  return (
    <div className="p-4">
      <QuestionHeader config={config} />
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
};

registerBlock('yes_no', YesNoBlock);

export default YesNoBlock;
