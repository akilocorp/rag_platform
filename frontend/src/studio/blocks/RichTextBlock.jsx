// @language JavaScript (React / JSX)
// @updated   2026-10-08
// @changed   Content renders as rich text (bold, italic, links, bullet lists, piped answers) via the
//            shared RichText renderer. Edit mode is gone: the content is written in the builder's
//            settings panel, with a formatting toolbar.
// Prior: New file: the Instructions block — config shape matches backend
//            src/studio/blocks/rich_text.py exactly (just `content`, no `required` — it
//            captures no response, which is how the backend knows to skip it as "answerable").
import React from 'react';
import { registerBlock } from './registryStore';
import { FONT_BODY } from './blockParts';
import { RichText } from '../richText';

const RichTextBlock = ({ config, mode = 'edit' }) => {
  if (mode !== 'respond') return null;

  return (
    <div className="p-4 text-sm leading-relaxed" style={{ fontFamily: FONT_BODY, color: '#1F1F1F' }}>
      <RichText text={config?.content} />
    </div>
  );
};

registerBlock('rich_text', RichTextBlock);

export default RichTextBlock;
