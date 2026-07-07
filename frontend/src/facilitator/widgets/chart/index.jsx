import React, { useMemo, useRef, useState, useCallback, useEffect } from 'react';
import { Parser } from 'expr-eval';

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
//              Dragging a param slider re-evaluates the functions and re-plots
//              live. Explicit y = f(x) only (this replaced the Desmos embed).

const PALETTE = ['#FA6C43', '#2563EB', '#16A34A', '#9333EA', '#D97706'];

const WIDTH = 560;
const HEIGHT = 248;
const PAD = { top: 16, right: 16, bottom: 30, left: 44 };

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

// Resolve either mode into a common view the SVG understands.
function resolveView(data, vals) {
  if (isFunctionMode(data)) return evalFunctions(data, vals);
  const xLabels = (Array.isArray(data?.x_labels) ? data.x_labels : []).map((l) => String(l));
  return {
    type: data?.type === 'bar' ? 'bar' : 'line',
    xLabels,
    xHeaders: xLabels,
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
    const { xLabels, series, type } = view;
    const plotW = WIDTH - PAD.left - PAD.right;
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

    const yPos = (v) => PAD.top + plotH - ((v - min) / (max - min)) * plotH;
    const xLine = (i) => PAD.left + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
    const bandW = plotW / n;
    const xBand = (i) => PAD.left + bandW * i + bandW / 2;
    const xAt = (i) => (type === 'bar' ? xBand(i) : xLine(i));

    const ticks = [];
    for (let t = 0; t <= 4; t++) {
      const v = min + (t / 4) * (max - min);
      ticks.push({ v, yp: yPos(v) });
    }

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

    return { min, max, yPos, xAt, ticks, lines, bars, n, plotH, plotW, zeroY: yPos(0) };
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
          <line x1={PAD.left} x2={WIDTH - PAD.right} y1={t.yp} y2={t.yp} stroke="#EEF2F6" strokeWidth="1" />
          <text x={PAD.left - 6} y={t.yp + 3} textAnchor="end" fontSize="10" fill="#94A3B8">{fmt(t.v)}</text>
        </g>
      ))}

      {/* zero baseline */}
      {geom.min < 0 && geom.max > 0 && (
        <line x1={PAD.left} x2={WIDTH - PAD.right} y1={geom.zeroY} y2={geom.zeroY} stroke="#CBD5E1" strokeWidth="1.25" strokeDasharray="2 2" />
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

      {/* y axis label */}
      {yLabel && (
        <text x={12} y={PAD.top + geom.plotH / 2} fontSize="10" fill="#94A3B8" textAnchor="middle"
              transform={`rotate(-90 12 ${PAD.top + geom.plotH / 2})`}>
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
