// @language JavaScript (React / JSX)
// @updated   2026-10-08
// @changed   Min/max character limits (with a live counter, shared with Short Text). Edit mode now
//            renders only the settings for the builder's settings panel — the question and Required
//            moved there; respond mode uses the shared QuestionHeader.
// Prior: New file: the Long Text block — config shape matches backend
//            src/studio/blocks/long_text.py exactly (identical to short_text; only the
//            rendering differs, a textarea instead of a single-line input).
import React from 'react';
import { registerBlock } from './registryStore';
import { FONT_BODY, QuestionHeader, TextField, SettingsStack } from './blockParts';
import { CharCounter, CharLimitFields } from './ShortTextBlock';

const LongTextBlock = ({ config, mode = 'edit', onChange, blockId, value, onAnswer, error }) => {
  const { placeholder = '', max_chars = 0 } = config || {};

  if (mode === 'respond') {
    return (
      <div className="p-4">
        <QuestionHeader config={config} as="label" htmlFor={blockId} className="mb-2" />
        <textarea
          id={blockId}
          rows={4}
          value={value || ''}
          onChange={(e) => onAnswer(e.target.value)}
          placeholder={placeholder}
          className="w-full px-3 py-2 rounded-lg border text-sm resize-y"
          style={{ borderColor: error ? '#E5484D' : 'rgba(31,31,31,0.2)', fontFamily: FONT_BODY, color: '#1F1F1F' }}
        />
        <CharCounter value={value} max={max_chars} />
        {error && <p className="text-xs mt-1" style={{ color: '#E5484D', fontFamily: FONT_BODY }}>{error}</p>}
      </div>
    );
  }

  return (
    <SettingsStack>
      <TextField label="Placeholder" hint="Faint example text inside the empty box." value={placeholder} placeholder="e.g. Tell us more…" onChange={(v) => onChange({ ...config, placeholder: v })} />
      <CharLimitFields config={config} onChange={onChange} />
    </SettingsStack>
  );
};

registerBlock('long_text', LongTextBlock);

export default LongTextBlock;
