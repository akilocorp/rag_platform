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

function Renderer({ data, onSubmit, disabled }) {
  const regions = Array.isArray(data?.regions) ? data.regions : [];
  const [features, setFeatures] = useState(null); // null=loading, []=failed/empty
  const [hover, setHover] = useState(null);        // { name, role, note, x, y }
  const wrapRef = useRef(null);

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

  const clickCountry = (region) => {
    if (disabled || !region || region.role === 'neutral' || !onSubmit) return;
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
          <svg viewBox={`0 0 ${VW} ${VH}`} className="block h-auto w-full" onMouseLeave={() => setHover(null)}>
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
                  strokeWidth={0.3}
                  className={`fac-im-country ${interactive ? 'fac-im-hit' : ''}`}
                  onMouseMove={(e) => showTip(e, feat, region)}
                  onClick={() => clickCountry(region)}
                />
              );
            })}
          </svg>
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
              <p className="mt-0.5 text-[10px] font-medium text-[#FA6C43]">Click to ask more</p>
            )}
          </div>
        )}
      </div>

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
