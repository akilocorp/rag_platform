/**
 * @language  JavaScript (ES module)
 * @updated   2026-07-19
 * @changed   looksLikeMath now accepts a leading numeric coefficient (e.g. "2x") so $2x$ renders instead of printing raw.
 */
import { marked } from 'marked';
import katex from 'katex';

marked.use({ gfm: true, breaks: true });

// Placeholder sentinels from the Unicode private-use area: they can never
// appear in real model output and pass through marked untouched.
const M_OPEN = '\uE000';
const M_CLOSE = '\uE001';
const C_OPEN = '\uE002';
const C_CLOSE = '\uE003';
const V_OPEN = '\uE004';
const V_CLOSE = '\uE005';

// Normalize an inline ```chart spec to the canonical chart widget's data shape.
// Two modes:
//  \u2022 static data \u2014 {x|x_labels, series:[{name, values|points}], unit}; the widget
//    uses {x_labels, series:[{name, points}], y_label}. `unit` used to be appended
//    to every y-axis tick ("52.4value"); we carry it to the single y_label axis
//    title so a real unit like "%" still reads without smearing onto every row.
//  \u2022 function graph \u2014 {x_range, params, functions} passes straight through; the
//    widget evaluates the expressions and renders draggable parameter sliders.
function toChartWidgetData(spec) {
  if (!spec || typeof spec !== 'object') return null;

  // Function-graph mode: hand the widget the parametric fields verbatim.
  if (Array.isArray(spec.functions) && spec.functions.length && Array.isArray(spec.x_range)) {
    const data = { type: 'line', x_range: spec.x_range, functions: spec.functions };
    if (Array.isArray(spec.params)) data.params = spec.params;
    if (spec.samples) data.samples = spec.samples;
    if (spec.title) data.title = String(spec.title);
    const yl = spec.y_label || spec.unit;
    if (yl) data.y_label = String(yl);
    if (spec.caption) data.caption = String(spec.caption);
    return data;
  }

  const rawSeries = Array.isArray(spec.series) ? spec.series : [];
  const series = rawSeries
    .map((s) => {
      const pts = s && (Array.isArray(s.points) ? s.points : s.values);
      return { name: s && s.name != null ? String(s.name) : '', points: Array.isArray(pts) ? pts : [] };
    })
    .filter((s) => s.points.length);
  if (!series.length) return null;

  const xRaw = Array.isArray(spec.x_labels) ? spec.x_labels : (Array.isArray(spec.x) ? spec.x : []);
  const data = {
    type: spec.type === 'bar' ? 'bar' : 'line',
    x_labels: xRaw.map((l) => String(l)),
    series,
  };
  if (spec.title) data.title = String(spec.title);
  const yl = spec.y_label || spec.unit;
  if (yl) data.y_label = String(yl);
  if (spec.caption) data.caption = String(spec.caption);
  return data;
}

// Pull ```chart fenced blocks out before anything else and stash each as base64
// widget data. ChatPage mounts these into the live, interactive chart widget
// after innerHTML is set. A malformed spec falls back to a normal code block.
function extractCharts(text) {
  const charts = [];
  const out = text.replace(/```chart\s*\n([\s\S]*?)```/g, (whole, body) => {
    try {
      const spec = JSON.parse(body.trim());
      const data = toChartWidgetData(spec);
      if (!data) return whole; // unusable spec \u2192 leave as a code block
      const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(data))));
      charts.push(encoded);
      return `\n\n${V_OPEN}${charts.length - 1}${V_CLOSE}\n\n`;
    } catch {
      return whole;
    }
  });
  return { text: out, charts };
}

// $...$ is only math when the content actually looks like LaTeX; otherwise
// currency like "$10/M input and $50/M output" gets swallowed as an equation.
// Exported so the inline-math composer (RichMathInput) parses typed $...$ runs
// with the exact same rule the render pipeline uses — no drift between them.
// The middle rule allows an optional leading numeric coefficient so a term like
// "2x" / "3y+1" counts as math; currency stays rejected because the char after
// the digits is a space or "/" (e.g. "10 and ", "10/M input"), not a letter.
export const looksLikeMath = (tex) =>
  /[\\^_{}=]/.test(tex) ||
  /^[-+]?\d*\.?\d*[A-Za-z](?:[A-Za-z0-9 +\-*/.,()]{0,14})$/.test(tex.trim()) ||
  /^[-+]?[\d.,]+$/.test(tex.trim());

// Pull every math segment ($$…$$ / \[…\] as display, \(…\) / $…$ as inline) out
// of a text run, replacing each with a placeholder sentinel via `stash`. Shared
// by the AI-markdown path and the user-text path so both recognise math (and
// reject bare "$10" prices) identically. The manual $-scan lets a rejected pair
// consume only its opening $, so real math later on the line still pairs up.
function stashMath(s, stash) {
  s = s.replace(/\$\$([\s\S]+?)\$\$/g, (_, tex) => stash(tex, true));
  s = s.replace(/\\\[([\s\S]+?)\\\]/g, (_, tex) => stash(tex, true));
  s = s.replace(/\\\(([\s\S]+?)\\\)/g, (_, tex) => stash(tex, false));
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
  return out + s.slice(last);
}

// Swap the math sentinels back to KaTeX-rendered HTML. On a KaTeX error we fall
// back to the raw LaTeX rather than throwing, so a malformed equation never
// blanks the whole message.
function renderMathSentinels(html, math) {
  return html.replace(new RegExp(`${M_OPEN}(\\d+)${M_CLOSE}`, 'g'), (_, n) => {
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
}

// Render AI markdown to HTML. Math segments are pulled out BEFORE marked runs
// (marked eats the backslashes in \(...\) / \[...\]) and rendered directly
// with KaTeX, so no DOM-wide auto-render pass is needed afterwards.
export function renderMarkdown(raw) {
  // Pull ```chart blocks out first so marked never sees them as code. The chart
  // placeholders are mounted into live, interactive widgets by ChatPage.
  const { text, charts } = extractCharts(raw || '');
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
      s = stashMath(s, stash);
      // Models often emit "**Section title**" lines instead of real headings.
      s = s.replace(/^\s{0,3}\*\*([^*\n]+?)\*\*:?\s*$/gm, '### $1');
      s = s.replace(new RegExp(`${C_OPEN}(\\d+)${C_CLOSE}`, 'g'), (_, n) => codes[+n]);
      return s;
    })
    .join('');

  let html = marked.parse(processed);
  html = renderMathSentinels(html, math);
  // Drop chart placeholders back in for ChatPage to mount as live widgets
  // (unwrap any <p> marked put around the bare sentinel).
  html = html.replace(new RegExp(`(?:<p>)?${V_OPEN}(\\d+)${V_CLOSE}(?:</p>)?`, 'g'),
    (_, n) => (charts[+n] ? `<div class="chart-embed" data-chart="${charts[+n]}"></div>` : ''));
  return html;
}

// Render a USER message: their own text is plain (no markdown — we don't let
// user input inject headings/HTML), but inline math they insert via the composer
// (spliced in as `$...$`) must still render. So we pull math OUT first, escape
// the remaining text and turn newlines into <br>, then drop the KaTeX-rendered
// math back in. Sentinels are private-use chars, so HTML-escaping leaves them
// intact for the final math pass.
export function renderUserText(raw) {
  const math = [];
  const stash = (tex, display) => {
    math.push({ tex, display });
    return `${M_OPEN}${math.length - 1}${M_CLOSE}`;
  };
  const withMath = stashMath(raw || '', stash);
  const escaped = withMath
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
  return renderMathSentinels(escaped, math);
}
