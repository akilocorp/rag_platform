// @language  JavaScript (React / JSX)
// @updated   2026-08-20
// @changed   Static charts: thin x-axis labels to whatever fits legibly instead of drawing every one, and
//            size left padding to the actual tick text (+ title strip) instead of a flat constant — fixes
//            dense/wide data overlapping the axis labels.
import React, { useMemo, useRef, useState, useCallback, useEffect } from 'react';
import { Parser } from 'expr-eval';
import { loadDesmos } from '../../../utils/desmos';

// chart — the single canonical renderer every chart in the app flows through.
// Dependency-free SVG (line or bar), interactive: hover a crosshair to read
// each series' value at that point, and click to open a full-screen view.
//
// Two data modes:
//  • static  — { title?, type:'line'|'bar', x_labels:[str],
//                series:[{name, points:[num]}], y_label?, caption? }
//  • function — a parametric graph the user can manipulate with sliders:
//                { title?, type:'line', x_range:[min,max],
//                  params:[{name,min,max,default,step?}],
//                  functions:[{name, expr}],   // expr in terms of x + params
//                  samples?, y_label?, caption? }
//              Rendered by an embedded Desmos GraphingCalculator; our slider
//              strip below drives the Desmos variables. Explicit y = f(x) only.
//
// Static data charts (line + bar) render with the in-house SVG below. Function
// mode goes to Desmos because it draws math curves far better; Desmos has no
// faithful categorical/bar representation, so data charts stay in-house.

const PALETTE = ['#FA6C43', '#2563EB', '#16A34A', '#9333EA', '#D97706'];

const WIDTH = 560;
const HEIGHT = 248;
// `left` isn't here — it's computed per-chart in useGeom from the actual tick labels being
// drawn, because a flat constant is either too narrow (wide/negative numbers collide with
// the rotated y-axis title) or wastes space (short numbers with no title at all).
const PAD = { top: 16, right: 16, bottom: 30 };
const LEFT_PAD_MIN = 30;
const TICK_CHAR_W = 5.7;    // ~px per glyph at fontSize 10, the size tick/x-axis text renders at
const TICK_GAP = 6;         // gap between the axis line and a tick label's near edge
const TITLE_STRIP_W = 16;   // width reserved for the rotated y-axis title, when there is one
const Y_TITLE_X = 8;        // rotated title's x anchor, centered in that reserved strip

const fmt = (v) => {
  if (v == null || !Number.isFinite(v)) return '—';
  if (Number.isInteger(v)) return String(v);
  const a = Math.abs(v);
  if (a !== 0 && (a < 0.01 || a >= 1e5)) return v.toExponential(1);
  return v.toFixed(a < 1 ? 3 : a < 100 ? 2 : 1);
};

const isFiniteNum = (v) => typeof v === 'number' && Number.isFinite(v);

// --- function mode ----------------------------------------------------------

function isFunctionMode(data) {
  return (
    Array.isArray(data?.functions) &&
    data.functions.length > 0 &&
    Array.isArray(data?.x_range) &&
    data.x_range.length === 2
  );
}

function initParamValues(params) {
  const out = {};
  params.forEach((p) => {
    const d = p.default != null ? p.default : p.min;
    out[p.name] = Number.isFinite(Number(d)) ? Number(d) : 0;
  });
  return out;
}

// Evaluate the parametric spec at the current slider values into the resolved
// view the renderer draws (same shape a static spec resolves to).
function evalFunctions(data, vals) {
  const xmin = Number(data.x_range[0]);
  const xmax = Number(data.x_range[1]);
  const N = Math.min(Math.max(parseInt(data.samples, 10) || 121, 11), 400);
  const parser = new Parser();

  const fns = (data.functions || []).map((f, i) => {
    let expr = null;
    try { expr = parser.parse(String(f?.expr ?? '')); } catch { expr = null; }
    return { name: (f && f.name != null && String(f.name)) || `y${i + 1}`, expr };
  });

  const xValues = Array.from({ length: N }, (_, i) => xmin + (i / (N - 1)) * (xmax - xmin));
  const series = fns.map((f) => ({
    name: f.name,
    points: xValues.map((x) => {
      if (!f.expr) return null;
      try {
        const v = f.expr.evaluate({ x, ...vals });
        return Number.isFinite(v) ? v : null;
      } catch {
        return null;
      }
    }),
  }));

  const step = Math.max(1, Math.round((N - 1) / 5));
  const xLabels = xValues.map((x, i) => (i % step === 0 || i === N - 1 ? fmt(x) : ''));
  const xHeaders = xValues.map((x) => fmt(x));
  return { type: 'line', xLabels, xHeaders, series, y_label: data.y_label, title: data.title };
}

// A static series can carry far more x labels than there's room to draw without them
// overlapping (e.g. one per year across two decades). Blank out all but however many fit
// at a legible glyph-width, always keeping the first and last — the same idea evalFunctions
// already applies above via its own `step`, generalized to arbitrary label lengths. Blanked
// entries stay in the array (same length in, same length out) since xAt(i) still needs an
// index per data point; only the label *text* is dropped.
function thinXLabels(labels) {
  const n = labels.length;
  if (n <= 1) return labels;
  // Left padding is data-dependent (see useGeom) and unknown at this point, so estimate
  // conservatively — this only ever under-fills the available width, never overflows it.
  const plotW = WIDTH - PAD.right - 60;
  const avgLen = labels.reduce((sum, l) => sum + l.length, 0) / n;
  const slotW = avgLen * TICK_CHAR_W + 8;
  const maxVisible = Math.max(2, Math.floor(plotW / slotW) + 1);
  if (n <= maxVisible) return labels;
  const step = Math.ceil(n / maxVisible);
  return labels.map((l, i) => (i % step === 0 || i === n - 1 ? l : ''));
}

// Resolve either mode into a common view the SVG understands.
function resolveView(data, vals) {
  if (isFunctionMode(data)) return evalFunctions(data, vals);
  const rawLabels = (Array.isArray(data?.x_labels) ? data.x_labels : []).map((l) => String(l));
  return {
    type: data?.type === 'bar' ? 'bar' : 'line',
    xLabels: thinXLabels(rawLabels),
    xHeaders: rawLabels,
    series: Array.isArray(data?.series) ? data.series : [],
    y_label: data?.y_label,
    title: data?.title,
  };
}

// --- geometry ---------------------------------------------------------------

// Build a line path that breaks across null/undefined gaps (out-of-domain
// points like log of a negative), so the curve doesn't draw a false segment.
function linePath(points, xLine, yPos) {
  let d = '';
  let pen = false;
  points.forEach((v, i) => {
    if (!isFiniteNum(v)) { pen = false; return; }
    d += `${pen ? 'L' : 'M'} ${xLine(i).toFixed(1)} ${yPos(v).toFixed(1)} `;
    pen = true;
  });
  return d.trim();
}

function useGeom(view) {
  return useMemo(() => {
    const { xLabels, series, type, y_label: yLabel } = view;
    const plotH = HEIGHT - PAD.top - PAD.bottom;
    const n = xLabels.length;
    if (n < 2 || series.length === 0) return null;

    const all = series.flatMap((s) => (Array.isArray(s.points) ? s.points : [])).filter(isFiniteNum);
    let min = Math.min(0, ...all);
    let max = Math.max(0, ...all);
    if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) { min -= 1; max += 1; }
    const span = max - min;
    min -= span * 0.08;
    max += span * 0.08;

    // yPos only depends on top/bottom padding, so ticks can be resolved before we know how
    // much left padding they'll need — solving that chicken-and-egg order is the whole fix.
    const yPos = (v) => PAD.top + plotH - ((v - min) / (max - min)) * plotH;
    const ticks = [];
    for (let t = 0; t <= 4; t++) {
      const v = min + (t / 4) * (max - min);
      ticks.push({ v, yp: yPos(v) });
    }

    // Left padding sized to the widest tick label actually being drawn, plus a reserved
    // strip for the rotated y-axis title when there is one — so neither ever runs into the
    // other regardless of the data's magnitude (the bug: a flat 44px only worked for
    // short, title-less numbers).
    const widestTick = Math.max(0, ...ticks.map((t) => fmt(t.v).length));
    const leftPad = Math.max(
      LEFT_PAD_MIN,
      Math.ceil(TICK_GAP + widestTick * TICK_CHAR_W + (yLabel ? TITLE_STRIP_W : 0))
    );
    const plotW = WIDTH - leftPad - PAD.right;

    const xLine = (i) => leftPad + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
    const bandW = plotW / n;
    const xBand = (i) => leftPad + bandW * i + bandW / 2;
    const xAt = (i) => (type === 'bar' ? xBand(i) : xLine(i));

    const lines = series.map((s, idx) => ({
      name: s.name,
      color: PALETTE[idx % PALETTE.length],
      d: linePath(s.points, xLine, yPos),
    }));

    const groupW = bandW * 0.7;
    const barW = groupW / series.length;
    const bars = series.map((s, sIdx) => ({
      name: s.name,
      color: PALETTE[sIdx % PALETTE.length],
      rects: s.points.map((v, i) => {
        if (!isFiniteNum(v)) return null;
        const x0 = xBand(i) - groupW / 2 + barW * sIdx;
        const yTop = yPos(Math.max(v, 0));
        const yBot = yPos(Math.min(v, 0));
        return { x: x0, y: yTop, w: barW * 0.86, h: Math.max(1, yBot - yTop) };
      }),
    }));

    return { min, max, yPos, xAt, ticks, lines, bars, n, plotH, plotW, leftPad, zeroY: yPos(0) };
  }, [view]);
}

function ChartSvg({ view, animate = true }) {
  const { type, xLabels, xHeaders, series, y_label: yLabel } = view;
  const geom = useGeom(view);
  const svgRef = useRef(null);
  const [hi, setHi] = useState(null);

  const onMove = useCallback((e) => {
    const svg = svgRef.current;
    if (!svg || !geom) return;
    const rect = svg.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const xView = ((clientX - rect.left) / rect.width) * WIDTH;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < xLabels.length; i++) {
      const d = Math.abs(geom.xAt(i) - xView);
      if (d < bestD) { bestD = d; best = i; }
    }
    setHi(best);
  }, [geom, xLabels]);

  if (!geom) return null;

  // Tooltip content + box geometry (rendered in SVG so it scales with the chart)
  let tip = null;
  if (hi != null) {
    const rows = series.map((s, idx) => ({
      color: PALETTE[idx % PALETTE.length],
      label: `${s.name}: ${fmt(s.points[hi])}`,
    }));
    const header = (xHeaders || xLabels)[hi] || '';
    const longest = Math.max(header.length, ...rows.map((r) => r.label.length + 2));
    const boxW = Math.min(240, longest * 6.2 + 20);
    const boxH = 18 + rows.length * 15 + 8;
    const cx = geom.xAt(hi);
    const boxX = cx > WIDTH / 2 ? cx - boxW - 10 : cx + 10;
    const boxY = PAD.top + 4;
    tip = { rows, header, boxW, boxH, cx, boxX, boxY };
  }

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="w-full max-w-full select-none touch-none"
      role="img"
      aria-label={view.title || 'Chart'}
      onMouseMove={onMove}
      onMouseLeave={() => setHi(null)}
      onTouchStart={onMove}
      onTouchMove={onMove}
      onTouchEnd={() => setHi(null)}
    >
      {/* y gridlines + labels */}
      {geom.ticks.map((t, i) => (
        <g key={i}>
          <line x1={geom.leftPad} x2={WIDTH - PAD.right} y1={t.yp} y2={t.yp} stroke="#EEF2F6" strokeWidth="1" />
          <text x={geom.leftPad - TICK_GAP} y={t.yp + 3} textAnchor="end" fontSize="10" fill="#94A3B8">{fmt(t.v)}</text>
        </g>
      ))}

      {/* zero baseline */}
      {geom.min < 0 && geom.max > 0 && (
        <line x1={geom.leftPad} x2={WIDTH - PAD.right} y1={geom.zeroY} y2={geom.zeroY} stroke="#CBD5E1" strokeWidth="1.25" strokeDasharray="2 2" />
      )}

      {/* x labels */}
      {xLabels.map((lbl, i) => (
        lbl ? (
          <text key={i} x={geom.xAt(i)} y={HEIGHT - 10} textAnchor="middle" fontSize="10"
                fill={hi === i ? '#334155' : '#94A3B8'} fontWeight={hi === i ? 600 : 400}>
            {lbl}
          </text>
        ) : null
      ))}

      {/* y axis label — sits in the TITLE_STRIP_W reserved by useGeom, left of the tick numbers */}
      {yLabel && (
        <text x={Y_TITLE_X} y={PAD.top + geom.plotH / 2} fontSize="10" fill="#94A3B8" textAnchor="middle"
              transform={`rotate(-90 ${Y_TITLE_X} ${PAD.top + geom.plotH / 2})`}>
          {yLabel}
        </text>
      )}

      {/* crosshair */}
      {hi != null && (
        <line x1={geom.xAt(hi)} x2={geom.xAt(hi)} y1={PAD.top} y2={PAD.top + geom.plotH}
              stroke="#CBD5E1" strokeWidth="1" strokeDasharray="3 3" />
      )}

      {type === 'line'
        ? geom.lines.map((p, idx) => (
            <path key={idx} className={animate ? 'fac-chart-line' : undefined} d={p.d} fill="none"
                  stroke={p.color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round"
                  pathLength="1" style={animate ? { animationDelay: `${idx * 120}ms` } : undefined} />
          ))
        : geom.bars.map((b, idx) => (
            <g key={idx}>
              {b.rects.map((r, i) => (
                r ? (
                  <rect key={i} className={animate ? 'fac-chart-bar' : undefined} x={r.x} y={r.y}
                        width={r.w} height={r.h} fill={b.color} rx="1.5"
                        opacity={hi == null || hi === i ? 1 : 0.45}
                        style={animate ? { animationDelay: `${idx * 80 + i * 30}ms` } : undefined} />
                ) : null
              ))}
            </g>
          ))}

      {/* highlighted points at the hovered index (line charts) */}
      {type === 'line' && hi != null && series.map((s, idx) => (
        isFiniteNum(s.points[hi]) ? (
          <circle key={idx} cx={geom.xAt(hi)} cy={geom.yPos(s.points[hi])} r="4"
                  fill={PALETTE[idx % PALETTE.length]} stroke="#fff" strokeWidth="1.5" />
        ) : null
      ))}

      {/* tooltip */}
      {tip && (
        <g pointerEvents="none">
          <rect x={tip.boxX} y={tip.boxY} width={tip.boxW} height={tip.boxH} rx="6"
                fill="#ffffff" stroke="#E5E7EB" strokeWidth="1" opacity="0.98" />
          <text x={tip.boxX + 8} y={tip.boxY + 14} fontSize="10.5" fontWeight="700" fill="#111827">{tip.header}</text>
          {tip.rows.map((r, i) => (
            <g key={i}>
              <rect x={tip.boxX + 8} y={tip.boxY + 22 + i * 15} width="7" height="7" rx="1.5" fill={r.color} />
              <text x={tip.boxX + 20} y={tip.boxY + 29 + i * 15} fontSize="10.5" fill="#374151">{r.label}</text>
            </g>
          ))}
        </g>
      )}
    </svg>
  );
}

// Slider panel for function mode. Dragging updates the shared param values so
// every mounted ChartSvg (inline + full-screen) re-plots live.
function ParamSliders({ params, vals, onChange }) {
  if (!params.length) return null;
  return (
    <div className="fac-enter mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-2 px-1">
      {params.map((p) => {
        const min = Number(p.min);
        const max = Number(p.max);
        const step = Number(p.step) || (max - min) / 100 || 0.1;
        return (
          <label key={p.name} className="flex items-center gap-2 text-xs text-gray-600">
            <span className="font-mono font-semibold text-[#FA6C43] whitespace-nowrap">
              {p.name} = {fmt(vals[p.name])}
            </span>
            <input
              type="range"
              min={min}
              max={max}
              step={step}
              value={vals[p.name]}
              onChange={(e) => onChange(p.name, Number(e.target.value))}
              onClick={(e) => e.stopPropagation()}
              className="flex-1 accent-[#FA6C43] cursor-pointer"
            />
          </label>
        );
      })}
    </div>
  );
}

// --- Desmos (function mode) --------------------------------------------------

// Replace every balanced `name(...)` call with `wrap(inner)`. Runs over the whole
// string so multiple/nested calls all convert (nested ones are picked up on later
// passes for their own name). Bails on an unbalanced paren rather than mangling.
function replaceCall(src, name, wrap) {
  const re = new RegExp(`\\b${name}\\s*\\(`);
  let out = src;
  let guard = 0;
  let m;
  while ((m = re.exec(out)) !== null && guard++ < 50) {
    const start = m.index;
    const open = m.index + m[0].length - 1; // index of '('
    let depth = 0;
    let close = -1;
    for (let i = open; i < out.length; i++) {
      if (out[i] === '(') depth++;
      else if (out[i] === ')') { depth--; if (depth === 0) { close = i; break; } }
    }
    if (close === -1) break; // unbalanced — leave the rest alone
    out = out.slice(0, start) + wrap(out.slice(open + 1, close)) + out.slice(close + 1);
  }
  return out;
}

// Brace exponents so Desmos reads multi-character powers correctly: b^x → b^{x},
// 2^(k+1) → 2^{k+1}. A `^` already followed by `{` is left as-is.
function braceExponents(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '^') { out += s[i]; continue; }
    let j = i + 1;
    while (j < s.length && s[j] === ' ') j++;
    if (s[j] === '{') { out += '^'; continue; } // already braced
    if (s[j] === '(') {
      let depth = 0;
      let close = -1;
      for (let k = j; k < s.length; k++) {
        if (s[k] === '(') depth++;
        else if (s[k] === ')') { depth--; if (depth === 0) { close = k; break; } }
      }
      if (close !== -1) { out += `^{${s.slice(j + 1, close)}}`; i = close; continue; }
    }
    let k = j;
    while (k < s.length && /[A-Za-z0-9._]/.test(s[k])) k++;
    out += `^{${s.slice(j, k)}}`;
    i = k - 1;
  }
  return out;
}

// Convert an expr-eval function body (e.g. "b^x", "1/(1+exp(-x))", "sin(k*x)")
// into Desmos-friendly LaTeX. Covers the operators/functions the CHART_GUIDE
// documents; anything exotic is passed through and Desmos does its best.
function toDesmosLatex(raw) {
  let s = String(raw ?? '').trim();
  if (!s) return '';
  s = replaceCall(s, 'exp', (arg) => `e^{${arg}}`);
  s = replaceCall(s, 'sqrt', (arg) => `\\sqrt{${arg}}`);
  s = replaceCall(s, 'abs', (arg) => `\\left|${arg}\\right|`);
  s = s.replace(/\b(sinh|cosh|tanh|asin|acos|atan|sin|cos|tan|ln|log)\s*\(/g, (_m, f) => `\\${f}(`);
  s = braceExponents(s);
  s = s.replace(/\*/g, ' \\cdot ');
  s = s.replace(/\bpi\b/g, '\\pi');
  return s;
}

// A live Desmos calculator for function mode. Mounts once, plots each function as
// its own y = … curve, and mirrors the external slider values into Desmos variables
// so dragging a slider re-plots. Deliberately no formula panel / settings menu.
function DesmosGraph({ data, vals, height }) {
  const holderRef = useRef(null);
  const calcRef = useRef(null);
  const [failed, setFailed] = useState(false);

  // Mount / tear down the calculator. Bounds are set once from the initial
  // slider values; the user can pan/zoom from there.
  useEffect(() => {
    let disposed = false;
    let calc = null;
    loadDesmos()
      .then((Desmos) => {
        if (disposed || !holderRef.current) return;
        calc = Desmos.GraphingCalculator(holderRef.current, {
          expressions: false,   // no formula/expression panel on the left
          settingsMenu: false,
          keypad: false,
          zoomButtons: true,
          lockViewport: false,
          border: false,
          expressionsCollapsed: true,
        });
        calcRef.current = calc;

        (data.functions || []).forEach((f, i) => {
          const rhs = toDesmosLatex(f?.expr);
          if (!rhs) return;
          const latex = rhs.includes('=') ? rhs : `y=${rhs}`;
          calc.setExpression({ id: `fn_${i}`, latex });
        });
        Object.entries(vals || {}).forEach(([k, v]) => {
          calc.setExpression({ id: `p_${k}`, latex: `${k}=${v}` });
        });

        // Frame the graph: x from x_range, y sampled from the current curves.
        try {
          const [xmin, xmax] = data.x_range.map(Number);
          const sampled = evalFunctions(data, vals).series
            .flatMap((s) => s.points)
            .filter(isFiniteNum);
          let ymin = Math.min(...sampled);
          let ymax = Math.max(...sampled);
          if (!Number.isFinite(ymin) || !Number.isFinite(ymax) || ymin === ymax) { ymin = -10; ymax = 10; }
          const padY = (ymax - ymin) * 0.1 || 1;
          calc.setMathBounds({ left: xmin, right: xmax, bottom: ymin - padY, top: ymax + padY });
        } catch { /* keep Desmos' default viewport */ }
      })
      .catch(() => { if (!disposed) setFailed(true); });

    return () => {
      disposed = true;
      try { calc?.destroy(); } catch { /* already gone */ }
      calcRef.current = null;
    };
    // Mount once per widget instance; slider changes flow through the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mirror slider values into the Desmos variables live.
  useEffect(() => {
    const calc = calcRef.current;
    if (!calc) return;
    Object.entries(vals || {}).forEach(([k, v]) => {
      calc.setExpression({ id: `p_${k}`, latex: `${k}=${v}` });
    });
  }, [vals]);

  if (failed) {
    return (
      <div className="mt-1 flex items-center justify-center rounded-lg border border-gray-200 bg-gray-50 text-xs text-gray-400"
           style={{ height }}>
        Couldn’t load the interactive graph.
      </div>
    );
  }
  return <div ref={holderRef} className="fac-enter mt-1 rounded-lg overflow-hidden" style={{ width: '100%', height }} />;
}

function Renderer({ data }) {
  const [full, setFull] = useState(false);

  const fnMode = isFunctionMode(data);
  const params = fnMode && Array.isArray(data.params) ? data.params.filter((p) => p && p.name) : [];
  const [vals, setVals] = useState(() => initParamValues(params));
  const setParam = useCallback((name, v) => setVals((prev) => ({ ...prev, [name]: v })), []);

  const view = useMemo(() => resolveView(data, vals), [data, vals]);

  useEffect(() => {
    if (!full) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setFull(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [full]);

  // Function mode → Desmos. The graph is drag/zoom-interactive, so "Expand" is an
  // explicit button (not a whole-card click, which would fight the panning). Our
  // slider strip stays below and drives the Desmos variables. Static data charts
  // fall through to the in-house SVG path below.
  if (fnMode) {
    const fnSliders = <ParamSliders params={params} vals={vals} onChange={setParam} />;
    const modalHeight = Math.round(
      Math.min(560, typeof window !== 'undefined' ? window.innerHeight * 0.6 : 480)
    );
    return (
      <>
        <div className="mt-2 rounded-xl border border-gray-200 bg-white p-3">
          <div className="flex items-center justify-between mb-1 px-1">
            {data.title ? <p className="text-lg font-semibold text-[#222]">{data.title}</p> : <span />}
            <button
              type="button"
              onClick={() => setFull(true)}
              className="text-[11px] font-medium text-gray-400 hover:text-[#FA6C43] transition-colors"
            >
              Expand ⤢
            </button>
          </div>
          <DesmosGraph data={data} vals={vals} height={248} />
          {fnSliders}
          {data.caption && <p className="text-xs text-gray-500 mt-2 px-1">{data.caption}</p>}
        </div>

        {full && (
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 sm:p-8"
            onClick={() => setFull(false)}
            role="dialog"
            aria-modal="true"
          >
            <div
              className="fac-enter relative w-full max-w-5xl rounded-2xl bg-white p-5 sm:p-7 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => setFull(false)}
                className="absolute top-3 right-3 w-8 h-8 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 flex items-center justify-center"
                aria-label="Close"
              >
                ✕
              </button>
              {data.title && <p className="text-lg font-semibold text-[#222] mb-1 pr-8">{data.title}</p>}
              <p className="text-[11px] text-gray-400 mb-3">Drag the sliders to change the parameters and watch the graph update.</p>
              <DesmosGraph data={data} vals={vals} height={modalHeight} />
              {fnSliders}
              {data.caption && <p className="text-sm text-gray-500 mt-3">{data.caption}</p>}
            </div>
          </div>
        )}
      </>
    );
  }

  if (view.xLabels.length < 2 || view.series.length === 0) return null;

  const legend = view.series.length > 1 && (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 px-2">
      {view.series.map((s, idx) => (
        <span key={idx} className="inline-flex items-center gap-1.5 text-xs text-gray-600">
          <span className="inline-block w-3 h-0.5 rounded" style={{ backgroundColor: PALETTE[idx % PALETTE.length] }} />
          {s.name}
        </span>
      ))}
    </div>
  );

  const sliders = fnMode ? <ParamSliders params={params} vals={vals} onChange={setParam} /> : null;

  return (
    <>
      <div
        className="mt-2 rounded-xl border border-gray-200 bg-white p-3 cursor-zoom-in hover:border-gray-300 transition-colors"
        onClick={() => setFull(true)}
        title="Click to expand"
      >
        <div className="flex items-center justify-between mb-1.5 px-1">
          {data.title ? <p className="text-lg font-semibold text-[#222]">{data.title}</p> : <span />}
          <span className="text-[11px] text-gray-400">Click to expand ⤢</span>
        </div>
        <ChartSvg view={view} />
        {sliders}
        {legend}
        {data.caption && <p className="text-xs text-gray-500 mt-2 px-1">{data.caption}</p>}
      </div>

      {full && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 sm:p-8"
          onClick={() => setFull(false)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="fac-enter relative w-full max-w-5xl rounded-2xl bg-white p-5 sm:p-7 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setFull(false)}
              className="absolute top-3 right-3 w-8 h-8 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 flex items-center justify-center"
              aria-label="Close"
            >
              ✕
            </button>
            {data.title && <p className="text-lg font-semibold text-[#222] mb-1 pr-8">{data.title}</p>}
            <p className="text-[11px] text-gray-400 mb-3">
              {fnMode ? 'Drag the sliders to change the parameters and watch the graph update.' : 'Hover the chart to read each value.'}
            </p>
            <ChartSvg view={view} animate={false} />
            {sliders}
            {legend}
            {data.caption && <p className="text-sm text-gray-500 mt-3">{data.caption}</p>}
          </div>
        </div>
      )}
    </>
  );
}

export default {
  id: 'chart',
  label: 'Chart',
  interactive: false,
  Renderer,
};
