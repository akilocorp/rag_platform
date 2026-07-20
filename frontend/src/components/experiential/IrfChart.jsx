import React, { useMemo } from 'react';

// Lightweight hand-rolled SVG line chart for 8-quarter impulse-response paths.
// No chart-library dependency. Renders one line per series plus an optional
// dashed "your guess" overlay. When `blurNumbers` is true the axis value labels
// are blurred (the provenance gate isn't satisfied yet) while the line shapes
// stay visible.

const PALETTE = ['#FA6C43', '#2563EB', '#16A34A', '#9333EA', '#D97706'];

const WIDTH = 560;
const HEIGHT = 240;
const PAD = { top: 16, right: 16, bottom: 28, left: 40 };

export default function IrfChart({
  series = [],          // [{ key, label, values: number[], color? }]
  guess = null,         // { values: number[], label } | null  — dashed overlay
  unit = '',            // e.g. '%'
  blurNumbers = false,
}) {
  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;

  const { paths, guessPath, yTicks, n, x, y } = useMemo(() => {
    const allValues = series.flatMap((s) => s.values);
    if (guess) allValues.push(...guess.values);
    const len = Math.max(1, ...series.map((s) => s.values.length), guess ? guess.values.length : 0);

    let min = Math.min(0, ...allValues);
    let max = Math.max(0, ...allValues);
    if (min === max) { min -= 1; max += 1; }
    // pad the range a touch
    const span = max - min;
    min -= span * 0.08;
    max += span * 0.08;

    const xPos = (i) => PAD.left + (len <= 1 ? plotW / 2 : (i / (len - 1)) * plotW);
    const yPos = (v) => PAD.top + plotH - ((v - min) / (max - min)) * plotH;

    const toPath = (values) =>
      values.map((v, i) => `${i === 0 ? 'M' : 'L'} ${xPos(i).toFixed(1)} ${yPos(v).toFixed(1)}`).join(' ');

    const ticks = [];
    const TICK_COUNT = 4;
    for (let t = 0; t <= TICK_COUNT; t++) {
      const v = min + (t / TICK_COUNT) * (max - min);
      ticks.push({ v, yp: yPos(v) });
    }

    return {
      paths: series.map((s, idx) => ({
        ...s,
        d: toPath(s.values),
        color: s.color || PALETTE[idx % PALETTE.length],
      })),
      guessPath: guess ? toPath(guess.values) : null,
      yTicks: ticks,
      n: len,
      x: xPos,
      y: yPos,
    };
  }, [series, guess, plotW, plotH]);

  const zeroY = useMemo(() => {
    // baseline at 0
    const allValues = series.flatMap((s) => s.values);
    if (guess) allValues.push(...guess.values);
    let min = Math.min(0, ...allValues);
    let max = Math.max(0, ...allValues);
    if (min === max) { min -= 1; max += 1; }
    const span = max - min;
    min -= span * 0.08;
    max += span * 0.08;
    return PAD.top + plotH - ((0 - min) / (max - min)) * plotH;
  }, [series, guess, plotH]);

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full max-w-full" role="img" aria-label="Impulse response chart">
        {/* y gridlines + labels */}
        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={PAD.left} x2={WIDTH - PAD.right} y1={t.yp} y2={t.yp} stroke="#EEF2F6" strokeWidth="1" />
            <text
              x={PAD.left - 6}
              y={t.yp + 3}
              textAnchor="end"
              fontSize="10"
              fill="#94A3B8"
              style={blurNumbers ? { filter: 'blur(4px)' } : undefined}
            >
              {t.v.toFixed(1)}{unit}
            </text>
          </g>
        ))}

        {/* zero baseline */}
        <line x1={PAD.left} x2={WIDTH - PAD.right} y1={zeroY} y2={zeroY} stroke="#CBD5E1" strokeWidth="1.25" strokeDasharray="2 2" />

        {/* x labels (quarters) */}
        {Array.from({ length: n }).map((_, i) => (
          <text key={i} x={x(i)} y={HEIGHT - 8} textAnchor="middle" fontSize="10" fill="#94A3B8">
            Q{i + 1}
          </text>
        ))}

        {/* guess overlay (dashed) */}
        {guessPath && (
          <path d={guessPath} fill="none" stroke="#64748B" strokeWidth="2" strokeDasharray="5 4" opacity="0.8" />
        )}

        {/* series */}
        {paths.map((p) => (
          <g key={p.key}>
            <path d={p.d} fill="none" stroke={p.color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
            {p.values.map((v, i) => (
              <circle key={i} cx={x(i)} cy={y(v)} r="2.5" fill={p.color} />
            ))}
          </g>
        ))}
      </svg>

      {/* legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 px-2">
        {paths.map((p) => (
          <span key={p.key} className="inline-flex items-center gap-1.5 text-xs text-gray-600">
            <span className="inline-block w-3 h-0.5 rounded" style={{ backgroundColor: p.color }} />
            {p.label}
          </span>
        ))}
        {guess && (
          <span className="inline-flex items-center gap-1.5 text-xs text-gray-500">
            <span className="inline-block w-3 border-t-2 border-dashed border-slate-400" />
            {guess.label}
          </span>
        )}
      </div>
    </div>
  );
}
