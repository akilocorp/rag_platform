// @language JavaScript (React / JSX)
// @updated   2026-09-07
// @changed   Phase 1: replaced the unused `readOnly` disabled-preview with a real `mode` prop.
//            `mode="respond"` is now an actually-interactive input wired to `value`/`onAnswer`,
//            used by StudioRunnerPage; `mode="edit"` (default) is unchanged, used by the builder.
import React from 'react';
import { registerBlock } from './registryStore';

const FONT_BODY = "'Plus Jakarta Sans', 'Inter', system-ui, sans-serif";

const ShortTextBlock = ({ config, mode = 'edit', onChange, blockId, value, onAnswer, error }) => {
  const { question = '', placeholder = '', required = false } = config || {};

  if (mode === 'respond') {
    return (
      <div className="p-4">
        <label
          htmlFor={blockId}
          className="block text-sm font-semibold mb-2"
          style={{ fontFamily: FONT_BODY, color: '#1F1F1F' }}
        >
          {question} {required && <span style={{ color: '#FA6C43' }}>*</span>}
        </label>
        <input
          id={blockId}
          type="text"
          value={value || ''}
          onChange={(e) => onAnswer(e.target.value)}
          placeholder={placeholder}
          className="w-full px-3 py-2 rounded-lg border text-sm"
          style={{ borderColor: error ? '#E5484D' : 'rgba(31,31,31,0.2)', fontFamily: FONT_BODY, color: '#1F1F1F' }}
        />
        {error && <p className="text-xs mt-1" style={{ color: '#E5484D', fontFamily: FONT_BODY }}>{error}</p>}
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
      <input
        type="text"
        value={placeholder}
        onChange={(e) => onChange({ ...config, placeholder: e.target.value })}
        placeholder="Placeholder text (optional)"
        className="w-full px-3 py-2 rounded-lg border text-sm"
        style={{ borderColor: 'rgba(31,31,31,0.1)', fontFamily: FONT_BODY, color: 'rgba(31,31,31,0.7)' }}
      />
      <label
        className="flex items-center gap-2 text-xs"
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

registerBlock('short_text', ShortTextBlock);

export default ShortTextBlock;
