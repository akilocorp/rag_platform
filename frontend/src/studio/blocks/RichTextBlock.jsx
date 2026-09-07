// @language JavaScript (React / JSX)
// @updated   2026-09-07
// @changed   New file: the Instructions block — config shape matches backend
//            src/studio/blocks/rich_text.py exactly (just `content`, no `required` — it
//            captures no response, which is how the backend knows to skip it as "answerable").
import React from 'react';
import { registerBlock } from './registryStore';

const FONT_BODY = "'Plus Jakarta Sans', 'Inter', system-ui, sans-serif";

const RichTextBlock = ({ config, mode = 'edit', onChange }) => {
  const { content = '' } = config || {};

  if (mode === 'respond') {
    return (
      <div className="p-4">
        <p
          className="text-sm whitespace-pre-wrap"
          style={{ fontFamily: FONT_BODY, color: '#1F1F1F' }}
        >
          {content}
        </p>
      </div>
    );
  }

  return (
    <div className="p-4">
      <textarea
        rows={3}
        value={content}
        onChange={(e) => onChange({ ...config, content: e.target.value })}
        placeholder="Instructions or context shown to respondents (no response captured)"
        className="w-full px-3 py-2 rounded-lg border text-sm resize-y"
        style={{ borderColor: 'rgba(31,31,31,0.15)', fontFamily: FONT_BODY, color: '#1F1F1F' }}
      />
    </div>
  );
};

registerBlock('rich_text', RichTextBlock);

export default RichTextBlock;
