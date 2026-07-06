import React, { useMemo } from 'react';

// chart — the single canonical renderer every chart in the app flows through.
// Dependency-free SVG (line or bar). data shape (from the backend widget
// contract, already validated so every series lines up with x_labels):
//   { title?, type:'line'|'bar', x_labels:[str], series:[{name, points:[num]}],
//     y_label?, caption? }
// Display-only: nothing is sent back on interaction.

const PALETTE = ['#FA6C43', '#2563EB', '#16A34A', '#9333EA', '#D97706'];

const WIDTH = 560;
const HEIGHT = 248;
const PAD = { top: 16, right: 16, bottom: 30, left: 44 };

function Renderer({ data }) {
  const type = data?.type === 'bar' ? 'bar' : 'line';
  const xLabels = Array.isArray(data?.x_labels) ? data.x_labels : [];
  const series = Array.isArray(data?.series) ? data.series : [];

  const geom = useMemo(() => {
    const plotW = WIDTH - PAD.left - PAD.right;
    const plotH = HEIGHT - PAD.top - PAD.bottom;
    const n = xLabels.length;
    if (n < 2 || series.length === 0) return null;

    const all = series.flatMap((s) => (Array.isArray(s.points) ? s.points : []));
    let min = Math.min(0, ...all);
    let max = Math.max(0, ...all);
    if (min === max) { min -= 1; max += 1; }
    const span = max - min;
    min -= span * 0.08;
    max += span * 0.08;

    const yPos = (v) => PAD.top + plotH - ((v - min) / (max - min)) * plotH;
    // line: points sit on gridline positions; bar: centered in each band
    const xLine = (i) => PAD.left + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
    const bandW = plotW / n;
    const xBand = (i) => PAD.left + bandW * i + bandW / 2;

    const ticks = [];
    for (let t = 0; t <= 4; t++) {
      const v = min + (t / 4) * (max - min);
      ticks.push({ v, yp: yPos(v) });
    }

    const lines = series.map((s, idx) => ({
      name: s.name,
      color: PALETTE[idx % PALETTE.length],
      d: s.points.map((v, i) => `${i === 0 ? 'M' : 'L'} ${xLine(i).toFixed(1)} ${yPos(v).toFixed(1)}`).join(' '),
      pts: s.points.map((v, i) => ({ x: xLine(i), y: yPos(v) })),
    }));

    // grouped bars: split each band across the series
    const groupW = bandW * 0.7;
    const barW = groupW / series.length;
    const bars = series.map((s, sIdx) => ({
      name: s.name,
      color: PALETTE[sIdx % PALETTE.length],
      rects: s.points.map((v, i) => {
        const x0 = xBand(i) - groupW / 2 + barW * sIdx;
        const yTop = yPos(Math.max(v, 0));
        const yBot = yPos(Math.min(v, 0));
        return { x: x0, y: yTop, w: barW * 0.86, h: Math.max(1, yBot - yTop) };
      }),
    }));

    return { min, max, yPos, xLine, xBand, ticks, lines, bars, n, plotH, zeroY: yPos(0) };
  }, [xLabels, series, type]);

  if (!geom) return null;

  return (
    <div className="mt-2 rounded-xl border border-gray-200 bg-white p-3">
      {data.title && <p className="text-sm font-semibold text-[#222] mb-1.5 px-1">{data.title}</p>}
      <div className="w-full overflow-x-auto">
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full max-w-full" role="img"
             aria-label={data.title || 'Chart'}>
          {/* y gridlines + labels */}
          {geom.ticks.map((t, i) => (
            <g key={i}>
              <line x1={PAD.left} x2={WIDTH - PAD.right} y1={t.yp} y2={t.yp} stroke="#EEF2F6" strokeWidth="1" />
              <text x={PAD.left - 6} y={t.yp + 3} textAnchor="end" fontSize="10" fill="#94A3B8">
                {Number.isInteger(t.v) ? t.v : t.v.toFixed(1)}
              </text>
            </g>
          ))}

          {/* zero baseline (only if 0 is inside the range) */}
          {geom.min < 0 && geom.max > 0 && (
            <line x1={PAD.left} x2={WIDTH - PAD.right} y1={geom.zeroY} y2={geom.zeroY}
                  stroke="#CBD5E1" strokeWidth="1.25" strokeDasharray="2 2" />
          )}

          {/* x labels */}
          {xLabels.map((lbl, i) => (
            <text key={i} x={type === 'bar' ? geom.xBand(i) : geom.xLine(i)} y={HEIGHT - 10}
                  textAnchor="middle" fontSize="10" fill="#94A3B8">
              {lbl}
            </text>
          ))}

          {/* y axis label */}
          {data.y_label && (
            <text x={12} y={PAD.top + geom.plotH / 2} fontSize="10" fill="#94A3B8" textAnchor="middle"
                  transform={`rotate(-90 12 ${PAD.top + geom.plotH / 2})`}>
              {data.y_label}
            </text>
          )}

          {type === 'line'
            ? geom.lines.map((p, idx) => (
                <g key={idx}>
                  <path className="fac-chart-line" d={p.d} fill="none" stroke={p.color}
                        strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" pathLength="1"
                        style={{ animationDelay: `${idx * 120}ms` }} />
                  {p.pts.map((pt, i) => (
                    <circle key={i} className="fac-chart-dot" cx={pt.x} cy={pt.y} r="2.5" fill={p.color}
                            style={{ animationDelay: `${600 + i * 40}ms` }} />
                  ))}
                </g>
              ))
            : geom.bars.map((b, idx) => (
                <g key={idx}>
                  {b.rects.map((r, i) => (
                    <rect key={i} className="fac-chart-bar" x={r.x} y={r.y} width={r.w} height={r.h}
                          fill={b.color} rx="1.5" style={{ animationDelay: `${idx * 80 + i * 30}ms` }} />
                  ))}
                </g>
              ))}
        </svg>
      </div>

      {/* legend (only when >1 series) */}
      {series.length > 1 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 px-2">
          {series.map((s, idx) => (
            <span key={idx} className="inline-flex items-center gap-1.5 text-xs text-gray-600">
              <span className="inline-block w-3 h-0.5 rounded" style={{ backgroundColor: PALETTE[idx % PALETTE.length] }} />
              {s.name}
            </span>
          ))}
        </div>
      )}

      {data.caption && <p className="text-xs text-gray-500 mt-2 px-1">{data.caption}</p>}
    </div>
  );
}

export default {
  id: 'chart',
  label: 'Chart',
  interactive: false,
  Renderer,
};
