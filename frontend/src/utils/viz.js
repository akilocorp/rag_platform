// Inline chart rendering for chat messages.
//
// A bot can embed a chart by emitting a fenced ```chart block whose body is a
// JSON spec (see schema below). markdown.js detects these blocks and replaces
// them with the self-contained SVG string this module produces — so charts work
// in any path that renders through renderMarkdown (1:1 chat, RAG, the
// experiential analyst box) with no React component or extra dependency.
//
// Spec:
//   {
//     "type": "line" | "bar",
//     "title": "GDP path (% deviation from baseline)",
//     "x": ["Q1","Q2", ... ],
//     "series": [ { "name": "RANK", "values": [ -0.6, -1.2, ... ] }, ... ],
//     "unit": "%"            // optional, appended to y-axis labels
//   }

const PALETTE = ['#FA6C43', '#2563EB', '#16A34A', '#9333EA', '#D97706', '#0891B2'];

const W = 560;
const H = 260;
const PAD = { top: 18, right: 16, bottom: 30, left: 44 };

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const num = (v) => (typeof v === 'number' && !Number.isNaN(v) ? v : 0);

function niceBounds(values) {
  let min = Math.min(0, ...values);
  let max = Math.max(0, ...values);
  if (min === max) { min -= 1; max += 1; }
  const span = max - min;
  return { min: min - span * 0.08, max: max + span * 0.08 };
}

function legendHtml(series) {
  const items = series
    .map((s, i) => {
      const c = PALETTE[i % PALETTE.length];
      return `<span style="display:inline-flex;align-items:center;gap:6px;font-size:12px;color:#475569;">
        <span style="display:inline-block;width:14px;height:3px;border-radius:2px;background:${c};"></span>${esc(s.name)}</span>`;
    })
    .join('');
  return `<div style="display:flex;flex-wrap:wrap;gap:8px 16px;margin-top:6px;padding:0 6px;">${items}</div>`;
}

function renderLine(spec) {
  const x = Array.isArray(spec.x) ? spec.x : [];
  const series = (spec.series || []).map((s) => ({ name: s.name, values: (s.values || []).map(num) }));
  const len = Math.max(x.length, ...series.map((s) => s.values.length), 1);
  const all = series.flatMap((s) => s.values);
  const { min, max } = niceBounds(all.length ? all : [0]);

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const xPos = (i) => PAD.left + (len <= 1 ? plotW / 2 : (i / (len - 1)) * plotW);
  const yPos = (v) => PAD.top + plotH - ((v - min) / (max - min)) * plotH;

  const ticks = [];
  for (let t = 0; t <= 4; t++) {
    const v = min + (t / 4) * (max - min);
    ticks.push(`<line x1="${PAD.left}" x2="${W - PAD.right}" y1="${yPos(v).toFixed(1)}" y2="${yPos(v).toFixed(1)}" stroke="#EEF2F6" stroke-width="1"/>
      <text x="${PAD.left - 6}" y="${(yPos(v) + 3).toFixed(1)}" text-anchor="end" font-size="10" fill="#94A3B8">${v.toFixed(1)}${esc(spec.unit || '')}</text>`);
  }

  const zeroY = yPos(0);
  const xLabels = Array.from({ length: len }).map((_, i) =>
    `<text x="${xPos(i).toFixed(1)}" y="${H - 9}" text-anchor="middle" font-size="10" fill="#94A3B8">${esc(x[i] ?? i + 1)}</text>`);

  const lines = series.map((s, idx) => {
    const c = PALETTE[idx % PALETTE.length];
    const d = s.values.map((v, i) => `${i === 0 ? 'M' : 'L'} ${xPos(i).toFixed(1)} ${yPos(v).toFixed(1)}`).join(' ');
    const dots = s.values.map((v, i) => `<circle cx="${xPos(i).toFixed(1)}" cy="${yPos(v).toFixed(1)}" r="2.5" fill="${c}"/>`).join('');
    return `<path d="${d}" fill="none" stroke="${c}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>${dots}`;
  }).join('');

  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:100%;height:auto;" role="img" aria-label="${esc(spec.title || 'chart')}">
    ${ticks.join('')}
    <line x1="${PAD.left}" x2="${W - PAD.right}" y1="${zeroY.toFixed(1)}" y2="${zeroY.toFixed(1)}" stroke="#CBD5E1" stroke-width="1.25" stroke-dasharray="2 2"/>
    ${xLabels.join('')}
    ${lines}
  </svg>`;
}

function renderBar(spec) {
  const x = Array.isArray(spec.x) ? spec.x : [];
  const series = (spec.series || []).map((s) => ({ name: s.name, values: (s.values || []).map(num) }));
  const groups = Math.max(x.length, ...series.map((s) => s.values.length), 1);
  const all = series.flatMap((s) => s.values);
  const { min, max } = niceBounds(all.length ? all : [0]);

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const yPos = (v) => PAD.top + plotH - ((v - min) / (max - min)) * plotH;
  const groupW = plotW / groups;
  const barW = Math.max(2, (groupW * 0.72) / Math.max(series.length, 1));

  const ticks = [];
  for (let t = 0; t <= 4; t++) {
    const v = min + (t / 4) * (max - min);
    ticks.push(`<line x1="${PAD.left}" x2="${W - PAD.right}" y1="${yPos(v).toFixed(1)}" y2="${yPos(v).toFixed(1)}" stroke="#EEF2F6" stroke-width="1"/>
      <text x="${PAD.left - 6}" y="${(yPos(v) + 3).toFixed(1)}" text-anchor="end" font-size="10" fill="#94A3B8">${v.toFixed(1)}${esc(spec.unit || '')}</text>`);
  }
  const zeroY = yPos(0);

  let bars = '';
  let xLabels = '';
  for (let g = 0; g < groups; g++) {
    const gx = PAD.left + g * groupW;
    xLabels += `<text x="${(gx + groupW / 2).toFixed(1)}" y="${H - 9}" text-anchor="middle" font-size="10" fill="#94A3B8">${esc(x[g] ?? g + 1)}</text>`;
    const startX = gx + (groupW - barW * series.length) / 2;
    series.forEach((s, si) => {
      const v = s.values[g] ?? 0;
      const c = PALETTE[si % PALETTE.length];
      const yTop = Math.min(yPos(v), zeroY);
      const hgt = Math.abs(yPos(v) - zeroY);
      bars += `<rect x="${(startX + si * barW).toFixed(1)}" y="${yTop.toFixed(1)}" width="${(barW * 0.9).toFixed(1)}" height="${hgt.toFixed(1)}" rx="1.5" fill="${c}"/>`;
    });
  }

  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:100%;height:auto;" role="img" aria-label="${esc(spec.title || 'chart')}">
    ${ticks.join('')}
    <line x1="${PAD.left}" x2="${W - PAD.right}" y1="${zeroY.toFixed(1)}" y2="${zeroY.toFixed(1)}" stroke="#CBD5E1" stroke-width="1.25"/>
    ${xLabels}
    ${bars}
  </svg>`;
}

/**
 * Render a chart spec to a self-contained HTML string (title + SVG + legend).
 * Returns null if the spec is unusable so the caller can fall back.
 */
export function renderChartSvg(spec) {
  if (!spec || typeof spec !== 'object') return null;
  const series = Array.isArray(spec.series) ? spec.series : [];
  if (!series.length || !series.some((s) => Array.isArray(s.values) && s.values.length)) return null;

  const body = spec.type === 'bar' ? renderBar(spec) : renderLine(spec);
  const title = spec.title
    ? `<div style="font-size:12px;font-weight:600;color:#334155;margin-bottom:4px;">${esc(spec.title)}</div>`
    : '';
  return `<div class="chat-chart" style="border:1px solid #E5E7EB;border-radius:14px;padding:12px 12px 8px;margin:10px 0;background:#fff;">
    ${title}${body}${legendHtml(series)}
  </div>`;
}
