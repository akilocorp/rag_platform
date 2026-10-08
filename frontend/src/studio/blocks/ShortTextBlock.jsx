// @language JavaScript (React / JSX)
// @updated   2026-10-08
// @changed   Response validation settings (input format, min/max characters) with a live character
//            counter when a max is set. Edit mode now renders only those settings for the builder's
//            settings panel — the question and Required moved there; respond mode uses the shared
//            QuestionHeader.
// Prior: Phase 1: replaced the unused `readOnly` disabled-preview with a real `mode` prop.
//            `mode="respond"` is now an actually-interactive input wired to `value`/`onAnswer`,
//            used by StudioRunnerPage; `mode="edit"` (default) is unchanged, used by the builder.
import React from 'react';
import { registerBlock } from './registryStore';
import {
  FONT_BODY, QuestionHeader, TextField, NumberField, SegmentedField, SettingsStack,
} from './blockParts';

// Shared by Long Text: the counter under a text answer, shown only when the
// professor set a limit, turning red once the answer runs over.
export const CharCounter = ({ value, max }) => {
  if (!max) return null;
  const len = (value || '').length;
  return (
    <p className="text-[11px] mt-1 text-right tabular-nums" style={{ fontFamily: FONT_BODY, color: len > max ? '#E5484D' : 'rgba(31,31,31,0.4)' }}>
      {len} / {max}
    </p>
  );
};

// Shared by Long Text: min/max character limits, 0 meaning no limit.
export const CharLimitFields = ({ config, onChange }) => (
  <>
    <NumberField label="Minimum characters" hint="Leave blank for no minimum." value={config?.min_chars || 0} min={0} max={50000} onChange={(n) => onChange({ ...config, min_chars: n })} />
    <NumberField label="Maximum characters" hint="Leave blank for no limit." value={config?.max_chars || 0} min={0} max={50000} onChange={(n) => onChange({ ...config, max_chars: n })} />
  </>
);

const ShortTextBlock = ({ config, mode = 'edit', onChange, blockId, value, onAnswer, error }) => {
  const { placeholder = '', input_format = 'any', max_chars = 0 } = config || {};

  if (mode === 'respond') {
    return (
      <div className="p-4">
        <QuestionHeader config={config} as="label" htmlFor={blockId} className="mb-2" />
        <input
          id={blockId}
          type={input_format === 'email' ? 'email' : 'text'}
          inputMode={input_format === 'number' ? 'decimal' : undefined}
          value={value || ''}
          onChange={(e) => onAnswer(e.target.value)}
          placeholder={placeholder}
          className="w-full px-3 py-2 rounded-lg border text-sm"
          style={{ borderColor: error ? '#E5484D' : 'rgba(31,31,31,0.2)', fontFamily: FONT_BODY, color: '#1F1F1F' }}
        />
        <CharCounter value={value} max={max_chars} />
        {error && <p className="text-xs mt-1" style={{ color: '#E5484D', fontFamily: FONT_BODY }}>{error}</p>}
      </div>
    );
  }

  return (
    <SettingsStack>
      <TextField label="Placeholder" hint="Faint example text inside the empty box." value={placeholder} placeholder="e.g. Your answer" onChange={(v) => onChange({ ...config, placeholder: v })} />
      <SegmentedField
        label="Answer format"
        value={input_format}
        options={[{ value: 'any', label: 'Any text' }, { value: 'number', label: 'Number' }, { value: 'email', label: 'Email' }]}
        onChange={(v) => onChange({ ...config, input_format: v })}
      />
      <CharLimitFields config={config} onChange={onChange} />
    </SettingsStack>
  );
};

registerBlock('short_text', ShortTextBlock);

export default ShortTextBlock;
