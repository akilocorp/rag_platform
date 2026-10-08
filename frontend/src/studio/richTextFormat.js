// @language JavaScript
// @updated   2026-10-08
// @changed   New file: the pure helpers behind Studio's rich-text format — the piped-answer token,
//            the inline-mark pattern, plain-text stripping and the textarea editing operations the
//            settings panel's toolbar uses. Kept apart from richText.jsx so that file only exports
//            a component (Vite fast refresh).

// Piped-answer token: `{{answer:<block id>}}`, replaced at render time with
// that block's answer. Mirrors _PIPE_RE in backend src/studio/block_settings.py.
export const PIPE_RE = /\{\{answer:([A-Za-z0-9_-]+)\}\}/g;
export const pipeToken = (blockId) => `{{answer:${blockId}}}`;

// Inline marks, in priority order: bold before italic so `**x**` isn't read
// as two empty italics. Links are http(s) only — a `javascript:` URL can't be
// written in this syntax at all, so there's nothing to sanitize afterwards.
export const INLINE_RE = /(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(\[([^\]]+)\]\((https?:\/\/[^)\s]+)\))/g;

// Swaps every piped-answer token for `lookup(blockId)`'s text.
export const resolvePipes = (text, lookup) => String(text || '').replace(PIPE_RE, (_, id) => lookup(id));

// A rich-text string as a plain one-line label — for dropdowns, CSV-style
// column headers and anywhere markup would show as literal asterisks.
// Mirrors plain_text in backend src/studio/block_settings.py.
export const plainText = (text) => String(text || '')
  .replace(PIPE_RE, '[…]')
  .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1')
  .replace(/(\*\*|\*)(.+?)\1/g, '$2')
  .replace(/^\s*[-*]\s+/gm, '')
  .replace(/\s+/g, ' ')
  .trim();

// Wraps the textarea's current selection in `before`/`after` (or inserts a
// placeholder when nothing is selected), then restores a selection over the
// wrapped text so a second click on the same button is easy to undo by hand.
export const wrapSelection = (textarea, value, before, after = before, placeholder = 'text') => {
  const start = textarea?.selectionStart ?? value.length;
  const end = textarea?.selectionEnd ?? value.length;
  const selected = value.slice(start, end) || placeholder;
  const next = value.slice(0, start) + before + selected + after + value.slice(end);
  return { next, selStart: start + before.length, selEnd: start + before.length + selected.length };
};

// Inserts `snippet` at the cursor (replacing any selection).
export const insertAtCursor = (textarea, value, snippet) => {
  const start = textarea?.selectionStart ?? value.length;
  const end = textarea?.selectionEnd ?? value.length;
  const next = value.slice(0, start) + snippet + value.slice(end);
  return { next, selStart: start + snippet.length, selEnd: start + snippet.length };
};

// Prefixes every line the selection touches with "- " (a bulleted list).
export const bulletLines = (textarea, value) => {
  const start = textarea?.selectionStart ?? value.length;
  const end = textarea?.selectionEnd ?? value.length;
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  const lineEndIdx = value.indexOf('\n', end);
  const lineEnd = lineEndIdx === -1 ? value.length : lineEndIdx;
  const block = value.slice(lineStart, lineEnd).split('\n').map((l) => (l.startsWith('- ') ? l : `- ${l}`)).join('\n');
  const next = value.slice(0, lineStart) + block + value.slice(lineEnd);
  return { next, selStart: lineStart, selEnd: lineStart + block.length };
};
