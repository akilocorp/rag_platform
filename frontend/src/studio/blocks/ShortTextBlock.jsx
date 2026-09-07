// @language JavaScript (React / JSX)
// @updated   2026-09-07
// @changed   New file: the Short Text block's canvas renderer — config shape (question/
//            placeholder/required) matches backend src/studio/blocks/short_text.py exactly.
import React from 'react';
import { registerBlock } from './registry';

const FONT_BODY = "'Plus Jakarta Sans', 'Inter', system-ui, sans-serif";

// `readOnly` renders the disabled preview a respondent would eventually see (Phase 1+);
// the editable form (default) is what the professor interacts with on the canvas.
const ShortTextBlock = ({ config, onChange, readOnly = false }) => {
  const { question = '', placeholder = '', required = false } = config || {};

  if (readOnly) {
    return (
      <div className="p-4">
        <label
          className="block text-sm font-semibold mb-2"
          style={{ fontFamily: FONT_BODY, color: '#1F1F1F' }}
        >
          {question} {required && <span style={{ color: '#FA6C43' }}>*</span>}
        </label>
        <input
          type="text"
          disabled
          placeholder={placeholder}
          className="w-full px-3 py-2 rounded-lg border text-sm"
          style={{ borderColor: 'rgba(31,31,31,0.15)', fontFamily: FONT_BODY }}
        />
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
