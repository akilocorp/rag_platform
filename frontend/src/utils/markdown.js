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
const D_OPEN = '\uE006';
const D_CLOSE = '\uE007';

// Normalize an inline ```chart spec to the canonical chart widget's data shape.
// The old inline spec used {x, series:[{name, values}], unit}; the widget uses
// {x_labels, series:[{name, points}], y_label}. `unit` used to be appended to
// every y-axis tick ("52.4value"); we carry it to the single y_label axis title
// instead, so a real unit like "%" still reads without smearing onto each row.
function toChartWidgetData(spec) {
  if (!spec || typeof spec !== 'object') return null;
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

// Pull ```desmos fenced blocks out and swap each for a placeholder div that
// ChatPage mounts into a live Desmos calculator after innerHTML is set. We
// validate the JSON here so a malformed spec just stays a normal code block;
// the spec rides along in a data attribute (base64 so quotes/newlines survive).
function extractDesmos(text) {
  const graphs = [];
  const out = text.replace(/```desmos\s*\n([\s\S]*?)```/g, (whole, body) => {
    try {
      const spec = JSON.parse(body.trim());
      if (!spec || !Array.isArray(spec.expressions) || !spec.expressions.length) {
        return whole; // unusable spec → leave as a code block
      }
      const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(spec))));
      graphs.push(`<div class="desmos-embed" data-desmos="${encoded}"></div>`);
      return `\n\n${D_OPEN}${graphs.length - 1}${D_CLOSE}\n\n`;
    } catch {
      return whole;
    }
  });
  return { text: out, graphs };
}

// $...$ is only math when the content actually looks like LaTeX; otherwise
// currency like "$10/M input and $50/M output" gets swallowed as an equation.
const looksLikeMath = (tex) =>
  /[\\^_{}=]/.test(tex) || /^[A-Za-z](?:[A-Za-z0-9 +\-*/.,()]{0,14})$/.test(tex.trim());

// Render AI markdown to HTML. Math segments are pulled out BEFORE marked runs
// (marked eats the backslashes in \(...\) / \[...\]) and rendered directly
// with KaTeX, so no DOM-wide auto-render pass is needed afterwards.
export function renderMarkdown(raw) {
  // Pull ```chart and ```desmos blocks out first so marked never sees them as
  // code. Desmos placeholders are mounted into live calculators by ChatPage.
  const { text: noCharts, charts } = extractCharts(raw || '');
  const { text, graphs } = extractDesmos(noCharts);
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
  // Drop chart placeholders back in for ChatPage to mount as live widgets
  // (unwrap any <p> marked put around the bare sentinel).
  html = html.replace(new RegExp(`(?:<p>)?${V_OPEN}(\\d+)${V_CLOSE}(?:</p>)?`, 'g'),
    (_, n) => (charts[+n] ? `<div class="chart-embed" data-chart="${charts[+n]}"></div>` : ''));
  // Drop the Desmos placeholder divs back in (ChatPage mounts them live).
  html = html.replace(new RegExp(`(?:<p>)?${D_OPEN}(\\d+)${D_CLOSE}(?:</p>)?`, 'g'), (_, n) => graphs[+n] || '');
  return html;
}
