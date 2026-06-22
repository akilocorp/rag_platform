import React from 'react';
import { FiLock, FiUnlock, FiShield } from 'react-icons/fi';

// Pinned strip at the top of the player column. Shows two pieces of persistent
// state that must never scroll away:
//   1. The LAYER STACK (RANK → +BGG → +HANK), filling in as layers unlock.
//   2. The TRUST METER, driven by provenance gates. Until a gate is satisfied
//      its claim renders blurred + tagged "illustrative"; once the matching
//      probe is used it un-blurs.

export default function StickyHeader({ layers, unlockedLayerIds, gates }) {
  const satisfied = gates.filter((g) => g.satisfied).length;
  const total = gates.length || 1;
  const pct = Math.round((satisfied / total) * 100);
  const allTrusted = satisfied >= gates.length && gates.length > 0;

  return (
    <div className="border-b border-gray-200 bg-white/95 backdrop-blur px-4 sm:px-6 py-2.5 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-6">
      {/* Layer stack */}
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mr-1">Models</span>
        {layers.map((l, i) => {
          const unlocked = unlockedLayerIds.includes(l.id);
          const short = i === 0 ? l.name.replace(/\s*\(.*\)/, '').split(' ').slice(-1)[0] || l.name : `+${l.name.replace(/^\+\s*/, '').match(/\(([^)]+)\)/)?.[1] || l.name}`;
          // Prefer the parenthetical short code (RANK / BGG / HANK) when present.
          const code = l.name.match(/\(([^)]+)\)/)?.[1];
          const label = code ? (i === 0 ? code : `+${code}`) : short;
          return (
            <React.Fragment key={l.id}>
              {i > 0 && <span className={`text-xs ${unlocked ? 'text-gray-400' : 'text-gray-200'}`}>→</span>}
              <span
                className={`px-2 py-0.5 rounded-md text-xs font-semibold border transition-colors ${
                  unlocked
                    ? 'bg-[#F9D0C4]/40 border-[#FA6C43]/40 text-[#b8452a]'
                    : 'bg-gray-50 border-dashed border-gray-200 text-gray-300'
                }`}
                title={unlocked ? l.name : `${l.name} — locked`}
              >
                {label}
              </span>
            </React.Fragment>
          );
        })}
      </div>

      {/* Trust meter */}
      <div className="flex items-center gap-2 sm:ml-auto min-w-0">
        <FiShield className={allTrusted ? 'text-green-600' : 'text-amber-500'} />
        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-28 rounded-full bg-gray-100 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${allTrusted ? 'bg-green-500' : 'bg-amber-400'}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className={`text-[11px] font-semibold ${allTrusted ? 'text-green-700' : 'text-amber-600'}`}>
              {allTrusted ? 'Provenance established' : 'Unverified'}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
            {gates.map((g) => (
              <span
                key={g.id}
                className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded ${
                  g.satisfied ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'
                }`}
                title={g.satisfied ? `${g.claim} — provenance established` : `${g.claim} — illustrative, calibrated not estimated`}
              >
                {g.satisfied ? <FiUnlock size={9} /> : <FiLock size={9} />}
                <span className={g.satisfied ? '' : 'blur-[2px] select-none'}>{g.claim}</span>
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
