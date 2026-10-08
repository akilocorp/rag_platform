// @language JavaScript (React / JSX)
// @updated   2026-10-08
// @changed   New file: the renderer for the small rich-text format Studio questions and
//            Instructions use (bold, italic, links, bullet lists). Builds React elements directly —
//            never innerHTML — because this text is shown to anonymous respondents. The format's
//            helpers (piped-answer tokens, plain-text stripping, toolbar edits) are in
//            richTextFormat.js.
import React from 'react';
import { INLINE_RE } from './richTextFormat';

// One line of text -> React nodes with bold/italic/link applied.
const renderInline = (line, keyPrefix) => {
  const nodes = [];
  let last = 0;
  let match;
  INLINE_RE.lastIndex = 0;
  while ((match = INLINE_RE.exec(line)) !== null) {
    if (match.index > last) nodes.push(line.slice(last, match.index));
    const key = `${keyPrefix}-${match.index}`;
    if (match[1]) nodes.push(<strong key={key}>{match[2]}</strong>);
    else if (match[3]) nodes.push(<em key={key}>{match[4]}</em>);
    else {
      nodes.push(
        <a key={key} href={match[7]} target="_blank" rel="noopener noreferrer" className="underline" style={{ color: '#FA6C43' }}>
          {match[6]}
        </a>,
      );
    }
    last = match.index + match[0].length;
  }
  if (last < line.length) nodes.push(line.slice(last));
  return nodes;
};

// Renders the format. `inline` (questions) keeps everything inside the
// caller's own <p>/<label> with line breaks; block mode (Instructions) groups
// "- " lines into a bulleted list and blank-line-separated runs into
// paragraphs.
export const RichText = ({ text, inline = false }) => {
  const lines = String(text || '').split('\n');

  if (inline) {
    return lines.map((line, i) => (
      <React.Fragment key={i}>
        {i > 0 && <br />}
        {renderInline(line, `l${i}`)}
      </React.Fragment>
    ));
  }

  const groups = [];
  lines.forEach((line) => {
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    const prev = groups[groups.length - 1];
    if (bullet) {
      if (prev?.type === 'list') prev.items.push(bullet[1]);
      else groups.push({ type: 'list', items: [bullet[1]] });
    } else if (!line.trim()) {
      groups.push({ type: 'break' });
    } else if (prev?.type === 'para') {
      prev.lines.push(line);
    } else {
      groups.push({ type: 'para', lines: [line] });
    }
  });

  return groups.map((g, i) => {
    if (g.type === 'list') {
      return (
        <ul key={i} className="list-disc pl-5 my-1 space-y-0.5">
          {g.items.map((item, j) => <li key={j}>{renderInline(item, `g${i}-${j}`)}</li>)}
        </ul>
      );
    }
    if (g.type === 'break') return null;
    return (
      <p key={i} className="my-1 first:mt-0 last:mb-0">
        {g.lines.map((line, j) => (
          <React.Fragment key={j}>
            {j > 0 && <br />}
            {renderInline(line, `g${i}-${j}`)}
          </React.Fragment>
        ))}
      </p>
    );
  });
};
