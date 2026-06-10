import { marked } from 'marked';
import katex from 'katex';

marked.use({ gfm: true, breaks: true });

// Placeholder sentinels from the Unicode private-use area: they can never
// appear in real model output and pass through marked untouched.
const M_OPEN = '\uE000';
const M_CLOSE = '\uE001';
const C_OPEN = '\uE002';
const C_CLOSE = '\uE003';

// $...$ is only math when the content actually looks like LaTeX; otherwise
// currency like "$10/M input and $50/M output" gets swallowed as an equation.
const looksLikeMath = (tex) =>
  /[\\^_{}=]/.test(tex) || /^[A-Za-z](?:[A-Za-z0-9 +\-*/.,()]{0,14})$/.test(tex.trim());

// Render AI markdown to HTML. Math segments are pulled out BEFORE marked runs
// (marked eats the backslashes in \(...\) / \[...\]) and rendered directly
// with KaTeX, so no DOM-wide auto-render pass is needed afterwards.
export function renderMarkdown(raw) {
  const text = raw || '';
  const math = [];
  const stash = (tex, display) => {
    math.push({ tex, display });
    return `${M_OPEN}${math.length - 1}${M_CLOSE}`;
  };

  // Never touch fenced code blocks (odd indices after this split).
  const parts = text.split(/(```[\s\S]*?(?:```|$))/);
  const processed = parts
    .map((part, i) => {
      if (i % 2 === 1) return part;
      let s = part;
      const codes = [];
      s = s.replace(/`[^`\n]*`/g, (m) => {
        codes.push(m);
        return `${C_OPEN}${codes.length - 1}${C_CLOSE}`;
      });
      s = s.replace(/\$\$([\s\S]+?)\$\$/g, (_, tex) => stash(tex, true));
      s = s.replace(/\\\[([\s\S]+?)\\\]/g, (_, tex) => stash(tex, true));
      s = s.replace(/\\\(([\s\S]+?)\\\)/g, (_, tex) => stash(tex, false));
      // Manual scan so a rejected pair (e.g. "$5 ... $") only consumes its
      // opening $, letting genuine math later on the line still pair up.
      const dollarRe = /\$([^$\n]+?)\$/g;
      let out = '';
      let last = 0;
      let mm;
      while ((mm = dollarRe.exec(s))) {
        if (looksLikeMath(mm[1])) {
          out += s.slice(last, mm.index) + stash(mm[1], false);
          last = dollarRe.lastIndex;
        } else {
          dollarRe.lastIndex = mm.index + 1;
        }
      }
      s = out + s.slice(last);
      // Models often emit "**Section title**" lines instead of real headings.
      s = s.replace(/^\s{0,3}\*\*([^*\n]+?)\*\*:?\s*$/gm, '### $1');
      s = s.replace(new RegExp(`${C_OPEN}(\\d+)${C_CLOSE}`, 'g'), (_, n) => codes[+n]);
      return s;
    })
    .join('');

  let html = marked.parse(processed);
  html = html.replace(new RegExp(`${M_OPEN}(\\d+)${M_CLOSE}`, 'g'), (_, n) => {
    const { tex, display } = math[+n];
    try {
      return katex.renderToString(tex, {
        displayMode: display,
        throwOnError: false,
        strict: false,
        trust: false,
      });
    } catch {
      return tex;
    }
  });
  return html;
}
