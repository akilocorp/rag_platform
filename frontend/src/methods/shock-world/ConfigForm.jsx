import React, { useEffect, useRef, useState } from 'react';
import { FiChevronDown, FiX, FiSearch } from 'react-icons/fi';

// A broad country list for the professor's multi-select. Kept in the island so
// Shock World stays self-contained.
const COUNTRIES = [
  'Argentina', 'Australia', 'Austria', 'Bangladesh', 'Belgium', 'Brazil', 'Bulgaria', 'Canada', 'Chile',
  'China', 'Colombia', 'Czechia', 'Denmark', 'Egypt', 'Ethiopia', 'Finland', 'France', 'Germany', 'Ghana',
  'Greece', 'Hong Kong', 'Hungary', 'India', 'Indonesia', 'Ireland', 'Israel', 'Italy', 'Japan', 'Kenya',
  'Malaysia', 'Mexico', 'Morocco', 'Netherlands', 'New Zealand', 'Nigeria', 'Norway', 'Pakistan', 'Peru',
  'Philippines', 'Poland', 'Portugal', 'Romania', 'Russia', 'Saudi Arabia', 'Singapore', 'South Africa',
  'South Korea', 'Spain', 'Sri Lanka', 'Sweden', 'Switzerland', 'Taiwan', 'Thailand', 'Turkey', 'Ukraine',
  'United Arab Emirates', 'United Kingdom', 'United States', 'Vietnam',
];

// Professor-facing structured inputs for a Shock World lab. Rendered generically
// by LabGenerator when this method is selected; the values are sent to
// /experiential/generate as `method_params` and are the SOURCE OF TRUTH for the
// country list / reply budget / course-only flag. Shape:
// { countries: string[], maxRounds: int, courseOnly: bool }.
export default function ConfigForm({ params, onChange }) {
  const p = params || {};
  const selected = Array.isArray(p.countries) ? p.countries : [];
  const maxRounds = Number.isInteger(p.maxRounds) ? p.maxRounds : 4;
  const courseOnly = !!p.courseOnly;

  const set = (patch) => onChange({ ...p, ...patch });

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const boxRef = useRef(null);

  // Seed the displayed default so an untouched form still sends maxRounds.
  useEffect(() => {
    if (!Number.isInteger(p.maxRounds)) set({ maxRounds: 4 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close the dropdown on outside click.
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const toggle = (country) => {
    const next = selected.includes(country)
      ? selected.filter((c) => c !== country)
      : [...selected, country];
    set({ countries: next });
  };

  const filtered = COUNTRIES.filter((c) => c.toLowerCase().includes(search.trim().toLowerCase()));

  return (
    <div className="rounded-2xl border border-gray-200 bg-gray-50/60 p-4 space-y-3">
      <div ref={boxRef} className="relative">
        <label className="block text-[13px] font-semibold text-gray-700 mb-1.5">Countries students can pick</label>

        {/* Selected chips + toggle */}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="w-full min-h-[42px] flex items-center justify-between gap-2 p-2 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F9D0C4] focus:border-[#FA6C43] transition-all text-left"
        >
          <span className="flex flex-wrap gap-1.5 items-center">
            {selected.length === 0 && <span className="text-gray-400 px-1">Select countries…</span>}
            {selected.map((c) => (
              <span key={c} className="inline-flex items-center gap-1 bg-[#F9D0C4]/50 text-[#b8452a] rounded-lg px-2 py-0.5 text-xs font-medium">
                {c}
                <FiX
                  className="cursor-pointer hover:text-red-600"
                  onClick={(e) => { e.stopPropagation(); toggle(c); }}
                />
              </span>
            ))}
          </span>
          <FiChevronDown className={`shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>

        {/* Dropdown panel */}
        {open && (
          <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg max-h-64 overflow-hidden flex flex-col">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100">
              <FiSearch className="text-gray-400 shrink-0" />
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search countries…"
                className="w-full text-sm outline-none bg-transparent"
              />
            </div>
            <div className="overflow-y-auto scrollbar-thin">
              {filtered.length === 0 && <p className="px-3 py-2 text-xs text-gray-400">No match</p>}
              {filtered.map((c) => {
                const on = selected.includes(c);
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => toggle(c)}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-[#F9D0C4]/20 ${on ? 'text-[#b8452a] font-semibold' : 'text-gray-700'}`}
                  >
                    <span className={`w-4 h-4 rounded border flex items-center justify-center text-[10px] ${on ? 'bg-[#FA6C43] border-[#FA6C43] text-white' : 'border-gray-300'}`}>
                      {on ? '✓' : ''}
                    </span>
                    {c}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <p className="text-[11px] text-gray-400 mt-1">Each student picks one of these; the shock is grounded to that country’s current conditions.</p>
      </div>

      <div className="flex items-center gap-3">
        <label className="text-[13px] font-semibold text-gray-700">Reply budget (N)</label>
        <input
          type="number"
          min={1}
          max={12}
          value={maxRounds}
          onChange={(e) => set({ maxRounds: Math.max(1, parseInt(e.target.value, 10) || 1) })}
          className="w-20 p-2 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F9D0C4] focus:border-[#FA6C43] transition-all"
        />
        <span className="text-[11px] text-gray-400">Max exchanges the tutor gets to guide the student to your end goal — they should reach it in fewer.</span>
      </div>

      <label className="flex items-center gap-2 text-[13px] text-gray-700 cursor-pointer">
        <input
          type="checkbox"
          checked={courseOnly}
          onChange={(e) => set({ courseOnly: e.target.checked })}
          className="w-4 h-4 rounded border-gray-300 text-[#FA6C43] focus:ring-[#FA6C43]"
        />
        <span><span className="font-semibold">Course-only</span> — confine the tutor strictly to uploaded course material</span>
      </label>
    </div>
  );
}
