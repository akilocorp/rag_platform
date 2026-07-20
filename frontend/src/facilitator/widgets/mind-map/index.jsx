import React, { useCallback, useMemo, useRef, useState } from 'react';

// mind_map — an interactive build-a-mind-map exercise.
// data shape (from the backend widget contract):
//   { central, nodes:[{id,label}], correct_links:[{from,to,order?}],
//     distractors?:[{id,label}], instructions? }
// The central idea is pinned at the canvas center; the concept tiles (nodes +
// distractors) sit around it and can be dragged to reposition. The user draws
// threads by dragging from a tile's connector handle onto another tile/center,
// clicks a thread to delete it, then "Check answer" scores their map against
// correct_links (undirected connectivity — direction/order are not scored).
// On submit a text summary + score is sent as the next user message.

const CENTER_ID = 'central';
const HIT_PX = 48;            // pointer-up snap radius when finishing a thread
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const pct = (v) => `${v * 100}%`;
const keyOf = (a, b) => [a, b].sort().join('|');

function Renderer({ data, onSubmit, disabled }) {
  const central = data?.central;
  const nodes = Array.isArray(data?.nodes) ? data.nodes : [];
  const distractors = Array.isArray(data?.distractors) ? data.distractors : [];
  const correctLinks = Array.isArray(data?.correct_links) ? data.correct_links : [];

  // All draggable tiles (real nodes + distractors), kept in a stable order.
  const tiles = useMemo(() => [...nodes, ...distractors], [nodes, distractors]);

  // id -> label (center resolves to the central idea text)
  const labelFor = useCallback(
    (id) => (id === CENTER_ID ? central : (tiles.find((t) => t.id === id)?.label ?? id)),
    [tiles, central]
  );

  const containerRef = useRef(null);

  // Tile positions as fractions of the container. Center is pinned; the rest
  // start evenly spread on a ring around it.
  const [positions, setPositions] = useState(() => {
    const p = { [CENTER_ID]: { x: 0.5, y: 0.5 } };
    const n = Math.max(tiles.length, 1);
    tiles.forEach((t, i) => {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
      p[t.id] = { x: clamp01(0.5 + 0.34 * Math.cos(a)), y: clamp01(0.5 + 0.36 * Math.sin(a)) };
    });
    return p;
  });

  const [links, setLinks] = useState([]);          // [{from,to}] user threads
  const [drag, setDrag] = useState(null);          // {type:'move',id,offX,offY} | {type:'link',from,cx,cy}
  const [result, setResult] = useState(null);      // set after "Check answer"
  const [submitted, setSubmitted] = useState(false);

  const locked = disabled || submitted;
  const editable = !locked && !result;

  const cursorFrac = (e) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0.5, y: 0.5, rect: null };
    return {
      x: clamp01((e.clientX - rect.left) / rect.width),
      y: clamp01((e.clientY - rect.top) / rect.height),
      rect,
    };
  };

  const startMove = (e, id) => {
    if (!editable) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const { x, y } = cursorFrac(e);
    const pos = positions[id];
    setDrag({ type: 'move', id, offX: x - pos.x, offY: y - pos.y });
  };

  const startLink = (e, id) => {
    if (!editable) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const { x, y } = cursorFrac(e);
    setDrag({ type: 'link', from: id, cx: x, cy: y });
  };

  const onPointerMove = (e) => {
    if (!drag) return;
    const { x, y } = cursorFrac(e);
    if (drag.type === 'move') {
      setPositions((prev) => ({ ...prev, [drag.id]: { x: clamp01(x - drag.offX), y: clamp01(y - drag.offY) } }));
    } else {
      setDrag((d) => (d ? { ...d, cx: x, cy: y } : d));
    }
  };

  const onPointerUp = (e) => {
    if (drag?.type === 'link') {
      const { x, y, rect } = cursorFrac(e);
      // snap to the nearest tile/center within HIT_PX (measured in real pixels)
      let best = null;
      let bestDist = Infinity;
      const ids = [CENTER_ID, ...tiles.map((t) => t.id)];
      for (const id of ids) {
        if (id === drag.from) continue;
        const p = positions[id];
        const dx = (p.x - x) * (rect?.width || 1);
        const dy = (p.y - y) * (rect?.height || 1);
        const dist = Math.hypot(dx, dy);
        if (dist < bestDist) { bestDist = dist; best = id; }
      }
      if (best && bestDist <= HIT_PX) {
        const k = keyOf(drag.from, best);
        setLinks((prev) => (prev.some((l) => keyOf(l.from, l.to) === k) ? prev : [...prev, { from: drag.from, to: best }]));
      }
    }
    setDrag(null);
  };

  const deleteLink = (k) => {
    if (!editable) return;
    setLinks((prev) => prev.filter((l) => keyOf(l.from, l.to) !== k));
  };

  const check = () => {
    const correctKeys = new Set(correctLinks.map((l) => keyOf(l.from, l.to)));
    const userKeys = links.map((l) => keyOf(l.from, l.to));
    const matched = userKeys.filter((k) => correctKeys.has(k));
    const wrong = userKeys.filter((k) => !correctKeys.has(k));
    const missing = [...correctKeys].filter((k) => !userKeys.includes(k));
    const score = correctKeys.size ? Math.round((matched.length / correctKeys.size) * 100) : 0;
    setResult({ correctKeys, score, matched, wrong: wrong.length, missing });
  };

  const send = () => {
    if (!result || !onSubmit) return;
    const pairText = (k) => k.split('|').map(labelFor).join(' ↔ ');
    const missedText = result.missing.length
      ? `Missed: ${result.missing.map(pairText).join('; ')}.`
      : 'No missed connections.';
    const summary =
      `Mind map "${central}" — scored ${result.score}% ` +
      `(${result.matched.length}/${result.correctKeys.size} correct links, ${result.wrong} incorrect). ${missedText}`;
    setSubmitted(true);
    onSubmit(summary);
  };

  if (!central || tiles.length === 0) return null;

  // Threads to draw: user links (colored after a check) + missed correct links
  // shown dashed once checked so the user sees what they left out.
  const correctKeys = result?.correctKeys;
  const missedThreads = result
    ? result.missing.map((k) => { const [from, to] = k.split('|'); return { from, to, k, missed: true }; })
    : [];

  return (
    <div className="mt-2 rounded-xl border border-gray-200 bg-[#F0F6FB] p-3">
      {data.instructions && <p className="mb-1 text-sm font-semibold text-[#222]">{data.instructions}</p>}
      {!result && !locked && (
        <p className="mb-2 text-[11px] text-gray-500">
          Drag the ◦ handle from a tile onto another tile or the center to connect them. Tap a thread to remove it.
        </p>
      )}

      <div
        ref={containerRef}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className="relative h-[360px] w-full touch-none select-none overflow-hidden rounded-lg border border-gray-200 bg-white"
      >
        <svg className="absolute inset-0 h-full w-full" style={{ pointerEvents: 'none' }}>
          {links.map((l) => {
            const k = keyOf(l.from, l.to);
            const a = positions[l.from];
            const b = positions[l.to];
            if (!a || !b) return null;
            const color = result ? (correctKeys.has(k) ? '#16A34A' : '#DC2626') : '#FA6C43';
            return (
              <g key={k}>
                <line x1={pct(a.x)} y1={pct(a.y)} x2={pct(b.x)} y2={pct(b.y)} stroke={color} strokeWidth={2.5} className="fac-thread" />
                {editable && (
                  <line
                    x1={pct(a.x)} y1={pct(a.y)} x2={pct(b.x)} y2={pct(b.y)}
                    stroke="transparent" strokeWidth={16}
                    style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
                    onPointerDown={(e) => { e.stopPropagation(); deleteLink(k); }}
                  />
                )}
              </g>
            );
          })}
          {missedThreads.map((m) => {
            const a = positions[m.from];
            const b = positions[m.to];
            if (!a || !b) return null;
            return (
              <line key={`miss-${m.k}`} x1={pct(a.x)} y1={pct(a.y)} x2={pct(b.x)} y2={pct(b.y)}
                stroke="#9CA3AF" strokeWidth={2} strokeDasharray="5 4" className="fac-thread" />
            );
          })}
          {drag?.type === 'link' && positions[drag.from] && (
            <line x1={pct(positions[drag.from].x)} y1={pct(positions[drag.from].y)} x2={pct(drag.cx)} y2={pct(drag.cy)}
              stroke="#FA6C43" strokeWidth={2.5} strokeDasharray="4 4" style={{ pointerEvents: 'none' }} />
          )}
        </svg>

        {/* center — pinned */}
        <div
          className="fac-mm-center absolute z-10 flex max-w-[150px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-[#FA6C43] bg-[#FFF3EF] px-3 py-2 text-center text-xs font-bold text-[#7a2e18] shadow-sm"
          style={{ left: pct(positions[CENTER_ID].x), top: pct(positions[CENTER_ID].y) }}
        >
          {central}
        </div>

        {/* concept tiles */}
        {tiles.map((t) => {
          const p = positions[t.id];
          if (!p) return null;
          return (
            <div
              key={t.id}
              onPointerDown={(e) => startMove(e, t.id)}
              className={`fac-mm-tile absolute z-20 max-w-[130px] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-center text-xs font-medium text-[#222] shadow-sm ${editable ? 'cursor-grab active:cursor-grabbing hover:border-[#FA6C43]' : ''}`}
              style={{ left: pct(p.x), top: pct(p.y) }}
            >
              {t.label}
              {editable && (
                <span
                  onPointerDown={(e) => startLink(e, t.id)}
                  title="Drag to connect"
                  className="fac-mm-handle absolute -right-2 -top-2 flex h-4 w-4 cursor-crosshair items-center justify-center rounded-full border border-[#FA6C43] bg-white text-[9px] leading-none text-[#FA6C43] hover:bg-[#FA6C43] hover:text-white"
                >
                  ◦
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* result badge */}
      {result && (
        <div className="mt-2.5 flex items-center gap-2 text-sm">
          <span className={`fac-mm-badge rounded-full px-2.5 py-0.5 text-xs font-bold ${result.score >= 70 ? 'bg-[#DCFCE7] text-[#166534]' : result.score >= 40 ? 'bg-[#FEF3C7] text-[#92400E]' : 'bg-[#FEE2E2] text-[#991B1B]'}`}>
            {result.score}%
          </span>
          <span className="text-gray-600">
            {result.matched.length}/{result.correctKeys.size} correct
            {result.wrong ? `, ${result.wrong} incorrect` : ''}
            {result.missing.length ? `, ${result.missing.length} missed` : ''}
          </span>
        </div>
      )}

      {/* controls */}
      {!locked && (
        <div className="mt-2.5 flex flex-wrap gap-2">
          {!result ? (
            <>
              <button
                type="button"
                onClick={check}
                disabled={links.length === 0}
                className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${links.length === 0 ? 'cursor-not-allowed bg-gray-100 text-gray-400' : 'bg-[#FA6C43] text-white hover:bg-[#e85f39]'}`}
              >
                Check answer
              </button>
              {links.length > 0 && (
                <button type="button" onClick={() => setLinks([])} className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-600 transition-colors hover:border-gray-300">
                  Clear
                </button>
              )}
            </>
          ) : (
            <>
              <button type="button" onClick={send} className="rounded-lg bg-[#FA6C43] px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-[#e85f39]">
                Send result to tutor
              </button>
              <button type="button" onClick={() => setResult(null)} className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-600 transition-colors hover:border-gray-300">
                Edit map
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default {
  id: 'mind_map',
  label: 'Mind map',
  interactive: true,
  Renderer,
};
