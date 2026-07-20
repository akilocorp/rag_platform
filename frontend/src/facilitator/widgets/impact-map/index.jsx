import React, { useEffect, useMemo, useRef, useState } from 'react';

// impact_map — a world choropleth that shades countries by their role in a
// scenario's ripple effects.
// data shape (from the backend widget contract):
//   { title?, scenario?, regions:[{country, iso3, role, intensity?, note?}],
//     legend?, caption? }
// The world atlas lives in /public/geo (fetched lazily, once, so it never bloats
// the main bundle) and is drawn with a plain equirectangular projection — no map
// libraries. Hover a country for its note; click a highlighted one to ask the
// bot to elaborate (interactive).

const ATLAS_URL = '/geo/world-110m.geojson';
// viewBox is lon/lat space directly: x = lon + 180 (0..360), y = 90 - lat (0..180).
const VW = 360;
const VH = 180;
// Zoom/pan: the SVG viewBox is driven from state. Aspect is locked 2:1 (w = 2h),
// so we only track {x, y, w}. MIN_W caps how far you can zoom in (360/MIN_W ×).
const FULL_VIEW = { x: 0, y: 0, w: VW };
const MIN_W = 18;          // ~20× max zoom
const ZOOM_STEP = 1.5;     // per +/− button press
const FIT_PAD = 1.6;       // padding factor when zoom-fitting a country

const ROLE_COLOR = {
  trigger: '#FA6C43',
  increase: '#16A34A',
  decrease: '#DC2626',
  neutral: '#E5E7EB',
};
const ROLE_LABEL = {
  trigger: 'Trigger',
  increase: 'Increase',
  decrease: 'Decrease',
  neutral: 'Neutral',
};

// Fetch + parse the atlas once, shared across every widget instance.
let atlasPromise = null;
function loadAtlas() {
  if (!atlasPromise) {
    atlasPromise = fetch(ATLAS_URL)
      .then((r) => { if (!r.ok) throw new Error(`atlas ${r.status}`); return r.json(); })
      .then((fc) => (Array.isArray(fc?.features) ? fc.features : []))
      .catch((e) => { atlasPromise = null; throw e; });
  }
  return atlasPromise;
}

// Build an SVG path from a GeoJSON Polygon/MultiPolygon in projected space.
function pathFor(geometry) {
  if (!geometry) return '';
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  if (!Array.isArray(polys)) return '';
  let d = '';
  for (const poly of polys) {
    for (const ring of poly) {
      ring.forEach(([lon, lat], i) => {
        const x = (lon + 180).toFixed(1);
        const y = (90 - lat).toFixed(1);
        d += (i ? 'L' : 'M') + x + ' ' + y;
      });
      d += 'Z';
    }
  }
  return d;
}

// Projected-space bounding box of a Polygon/MultiPolygon (same x=lon+180, y=90-lat).
function bboxFor(geometry) {
  if (!geometry) return null;
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  if (!Array.isArray(polys)) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const poly of polys) for (const ring of poly) for (const [lon, lat] of ring) {
    const x = lon + 180, y = 90 - lat;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

// Snap a candidate {x, y, w} to the legal range: w within [MIN_W, VW], aspect
// locked (h = w/2), and pan clamped so the map can't be dragged off-canvas.
function clampView(v) {
  const w = Math.min(VW, Math.max(MIN_W, v.w));
  const h = w / 2;
  const x = Math.min(VW - w, Math.max(0, v.x));
  const y = Math.min(VH - h, Math.max(0, v.y));
  return { x, y, w };
}

function Renderer({ data, onSubmit, disabled }) {
  const regions = Array.isArray(data?.regions) ? data.regions : [];
  const [features, setFeatures] = useState(null); // null=loading, []=failed/empty
  const [hover, setHover] = useState(null);        // { name, role, note, x, y }
  const [view, setView] = useState(FULL_VIEW);     // { x, y, w } — SVG viewBox
  const [selected, setSelected] = useState(null);  // region we zoomed into
  const wrapRef = useRef(null);
  const dragRef = useRef(null);                    // active pan gesture, or null

  useEffect(() => {
    let alive = true;
    loadAtlas().then((f) => { if (alive) setFeatures(f); }).catch(() => { if (alive) setFeatures([]); });
    return () => { alive = false; };
  }, []);

  const byIso = useMemo(() => {
    const m = {};
    for (const r of regions) if (r?.iso3) m[String(r.iso3).toUpperCase()] = r;
    return m;
  }, [regions]);

  // Which roles actually appear — drives the legend.
  const rolesShown = useMemo(() => {
    const s = new Set(regions.map((r) => r.role).filter((r) => r && r !== 'neutral'));
    return ['trigger', 'increase', 'decrease'].filter((r) => s.has(r));
  }, [regions]);

  if (regions.length === 0) return null;

  const legendLabel = (role) => data?.legend?.[role] || ROLE_LABEL[role];

  const fillFor = (region) => {
    if (!region) return ROLE_COLOR.neutral;
    const base = ROLE_COLOR[region.role] || ROLE_COLOR.neutral;
    return base;
  };
  const opacityFor = (region) => {
    if (!region || region.role === 'neutral') return 1;
    const i = typeof region.intensity === 'number' ? region.intensity : 0.6;
    return 0.5 + 0.5 * Math.max(0, Math.min(1, i)); // 0.5..1.0
  };

  const showTip = (e, feat, region) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    setHover({
      name: region?.country || feat?.properties?.name || feat?.properties?.iso,
      role: region?.role,
      note: region?.note,
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  };

  const isZoomed = view.w < VW - 0.5;

  // Zoom in/out around the current center by a fixed step.
  const zoomBy = (factor) => setView((v) => {
    const cx = v.x + v.w / 2, cy = v.y + v.w / 4; // h = w/2 → half-h = w/4
    const w = Math.min(VW, Math.max(MIN_W, v.w * factor));
    return clampView({ x: cx - w / 2, y: cy - w / 4, w });
  });
  const resetView = () => { setView(FULL_VIEW); setSelected(null); };

  // Frame a single country: fit its bbox (with padding) into the 2:1 viewBox.
  const zoomToFeature = (feat) => {
    const bb = bboxFor(feat?.geometry);
    if (!bb) return;
    const bw = bb.maxX - bb.minX, bh = bb.maxY - bb.minY;
    const w = Math.min(VW, Math.max(MIN_W, Math.max(bw, bh * 2) * FIT_PAD));
    const cx = (bb.minX + bb.maxX) / 2, cy = (bb.minY + bb.maxY) / 2;
    setView(clampView({ x: cx - w / 2, y: cy - w / 4, w }));
  };

  // Drag-to-pan. Convert pixel deltas to viewBox units via the SVG's on-screen width.
  const startPan = (e) => {
    if (e.button !== 0) return;
    const pxW = wrapRef.current?.clientWidth || 1;
    dragRef.current = { sx: e.clientX, sy: e.clientY, view, pxW, moved: false };
  };
  const movePan = (e) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (!d.moved && Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    const perPx = d.view.w / d.pxW; // viewBox units per screen pixel
    setView(clampView({ x: d.view.x - dx * perPx, y: d.view.y - dy * perPx, w: d.view.w }));
  };
  const endPan = () => { if (dragRef.current) dragRef.current = null; };

  const clickCountry = (feat, region) => {
    if (dragRef.current?.moved) return; // this was a pan, not a click
    if (disabled || !region || region.role === 'neutral') return;
    zoomToFeature(feat);
    setSelected(region);
  };

  const askAbout = (region) => {
    if (disabled || !region || !onSubmit) return;
    onSubmit(`Tell me more about ${region.country}'s role in this scenario.`);
  };

  return (
    <div className="mt-2 rounded-xl border border-gray-200 bg-[#F0F6FB] p-3">
      {data.title && <p className="text-sm font-semibold text-[#222]">{data.title}</p>}
      {data.scenario && <p className="mt-0.5 text-xs text-gray-500">{data.scenario}</p>}

      <div ref={wrapRef} className="relative mt-2 overflow-hidden rounded-lg border border-gray-200 bg-white">
        {features === null ? (
          <div className="flex h-48 items-center justify-center gap-2 text-xs text-gray-400">
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-gray-300 border-t-[#FA6C43]" />
            Loading map…
          </div>
        ) : features.length === 0 ? (
          // Atlas unavailable — fall back to a compact chip list so the data still shows.
          <div className="flex flex-wrap gap-1.5 p-3">
            {regions.filter((r) => r.role !== 'neutral').map((r) => (
              <span key={r.iso3} className="rounded-full px-2 py-0.5 text-xs font-medium text-white" style={{ backgroundColor: fillFor(r), opacity: opacityFor(r) }}>
                {r.country}
              </span>
            ))}
          </div>
        ) : (
          <svg
            viewBox={`${view.x} ${view.y} ${view.w} ${view.w / 2}`}
            className={`block h-auto w-full select-none ${isZoomed ? 'cursor-grab active:cursor-grabbing' : ''}`}
            onMouseDown={startPan}
            onMouseMove={movePan}
            onMouseUp={endPan}
            onMouseLeave={() => { endPan(); setHover(null); }}
          >
            {features.map((feat, i) => {
              const iso = String(feat?.properties?.iso || '').toUpperCase();
              const region = byIso[iso];
              const interactive = !disabled && region && region.role !== 'neutral';
              return (
                <path
                  key={iso || i}
                  d={pathFor(feat.geometry)}
                  fill={fillFor(region)}
                  fillOpacity={opacityFor(region)}
                  stroke="#FFFFFF"
                  strokeWidth={(0.3 * view.w) / VW}
                  className={`fac-im-country ${interactive ? 'fac-im-hit' : ''}`}
                  onMouseMove={(e) => showTip(e, feat, region)}
                  onClick={() => clickCountry(feat, region)}
                />
              );
            })}
          </svg>
        )}

        {/* zoom controls */}
        {features && features.length > 0 && (
          <div className="animate-chip-in absolute right-2 top-2 z-10 flex flex-col overflow-hidden rounded-lg border border-gray-200 bg-white/90 shadow-sm backdrop-blur">
            <button
              type="button" aria-label="Zoom in" onClick={() => zoomBy(1 / ZOOM_STEP)}
              disabled={view.w <= MIN_W + 0.5}
              className="h-7 w-7 text-base leading-none text-gray-600 transition hover:bg-gray-100 active:scale-90 disabled:opacity-30"
            >+</button>
            <button
              type="button" aria-label="Zoom out" onClick={() => zoomBy(ZOOM_STEP)}
              disabled={!isZoomed}
              className="h-7 w-7 border-t border-gray-200 text-base leading-none text-gray-600 transition hover:bg-gray-100 active:scale-90 disabled:opacity-30"
            >−</button>
            <button
              type="button" aria-label="Reset view" onClick={resetView}
              disabled={!isZoomed}
              className="h-7 w-7 border-t border-gray-200 text-xs leading-none text-gray-600 transition hover:bg-gray-100 active:scale-90 disabled:opacity-30"
            >⟲</button>
          </div>
        )}

        {hover && (
          <div
            className="pointer-events-none absolute z-10 max-w-[220px] rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs shadow-md"
            style={{ left: Math.min(hover.x + 12, (wrapRef.current?.clientWidth || 300) - 180), top: hover.y + 12 }}
          >
            <div className="flex items-center gap-1.5">
              {hover.role && <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: ROLE_COLOR[hover.role] }} />}
              <span className="font-semibold text-[#222]">{hover.name}</span>
            </div>
            {hover.note && <p className="mt-0.5 text-gray-500">{hover.note}</p>}
            {hover.role && hover.role !== 'neutral' && !disabled && (
              <p className="mt-0.5 text-[10px] font-medium text-[#FA6C43]">Click to zoom in</p>
            )}
          </div>
        )}
      </div>

      {/* selection bar — appears after clicking (zooming into) a country */}
      {selected && !disabled && (
        <div className="animate-chip-in mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: ROLE_COLOR[selected.role] }} />
          <span className="text-xs font-semibold text-[#222]">{selected.country}</span>
          <button
            type="button" onClick={() => askAbout(selected)}
            className="ml-auto rounded-full bg-[#FA6C43] px-2.5 py-1 text-[11px] font-medium text-white transition hover:brightness-95 active:scale-95"
          >Ask about {selected.country}</button>
        </div>
      )}

      {/* legend */}
      {rolesShown.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
          {rolesShown.map((role) => (
            <span key={role} className="flex items-center gap-1.5 text-[11px] text-gray-600">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: ROLE_COLOR[role] }} />
              {legendLabel(role)}
            </span>
          ))}
        </div>
      )}

      {data.caption && <p className="mt-1.5 text-xs text-gray-500">{data.caption}</p>}
    </div>
  );
}

export default {
  id: 'impact_map',
  label: 'Impact map',
  interactive: true,
  Renderer,
};
