/**
 * @language  JavaScript (React / JSX)
 * @updated   2026-08-03
 * @changed   New file: guide shell — sidebar, mobile jump menu, search, prev/next, print.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FaSearch, FaPrint, FaArrowLeft, FaArrowRight, FaTimes } from 'react-icons/fa';
import logo from '../assets/logo.png';
import { TRACKS, PAGES, searchPages, getNeighbours } from './content';

// Search box + result list. Kept local because nothing outside the shell needs the query,
// and the results panel closes on outside click / Escape so it never traps the reader.
function GuideSearch() {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);
  const navigate = useNavigate();
  const results = open ? searchPages(query) : [];

  useEffect(() => {
    const onDocClick = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const go = (id) => {
    setQuery('');
    setOpen(false);
    navigate(`/userguide/${id}`);
  };

  return (
    <div ref={boxRef} className="relative w-full sm:w-72">
      <FaSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs" />
      <input
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false);
          if (e.key === 'Enter' && results.length) go(results[0].id);
        }}
        placeholder="Search the guide…"
        className="w-full bg-white border border-gray-200 rounded-xl pl-9 pr-8 py-2 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:border-[#FA6C43]"
      />
      {query && (
        <button
          onClick={() => { setQuery(''); setOpen(false); }}
          aria-label="Clear search"
          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 bg-transparent border-0 p-1"
        >
          <FaTimes className="text-xs" />
        </button>
      )}

      {open && query.trim().length >= 2 && (
        <div className="absolute z-50 mt-2 w-full sm:w-96 right-0 bg-white border border-gray-100 rounded-xl shadow-lg max-h-80 overflow-y-auto py-1">
          {results.length === 0 ? (
            <p className="px-4 py-3 text-xs text-gray-500">No pages match “{query}”.</p>
          ) : results.map((r) => (
            <button
              key={r.id}
              onClick={() => go(r.id)}
              className="block w-full text-left px-4 py-2.5 bg-white hover:bg-orange-50 border-0 rounded-none"
            >
              <span className="block text-[11px] uppercase tracking-wide text-[#FA6C43] font-bold">{r.trackLabel}</span>
              <span className="block text-sm font-semibold text-gray-800">{r.title}</span>
              {r.snippet && <span className="block text-xs text-gray-500 mt-0.5 leading-snug">{r.snippet}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Below 768px the app normally refuses to render at all; the guide is the one exception,
// so the sidebar collapses into a single jump menu rather than eating the whole screen.
function MobileJump({ currentId }) {
  const navigate = useNavigate();
  return (
    <select
      value={currentId || ''}
      onChange={(e) => navigate(`/userguide/${e.target.value}`)}
      className="lg:hidden w-full bg-white border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-800 mb-6 no-print"
    >
      <option value="" disabled>Jump to a page…</option>
      {TRACKS.map((track) => (
        <optgroup key={track.id} label={track.label}>
          {track.pages.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
        </optgroup>
      ))}
    </select>
  );
}

function Sidebar({ currentId }) {
  return (
    <nav className="hidden lg:block w-64 shrink-0 no-print">
      <div className="sticky top-8 space-y-7">
        {TRACKS.map((track) => (
          <div key={track.id}>
            <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-2 px-3">{track.label}</p>
            <ul className="space-y-0.5">
              {track.pages.map((p) => {
                const active = p.id === currentId;
                return (
                  <li key={p.id}>
                    <Link
                      to={`/userguide/${p.id}`}
                      className={`block px-3 py-1.5 rounded-lg text-sm transition-colors ${
                        active
                          ? 'bg-[#FA6C43] text-white font-bold'
                          : 'text-gray-600 font-medium hover:bg-white hover:text-[#FA6C43]'
                      }`}
                    >
                      {p.title}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}

// Walks the flat reading order so "Next" carries the reader across track boundaries
// instead of dead-ending at the last page of a section.
function PrevNext({ currentId }) {
  const { prev, next } = getNeighbours(currentId);
  if (!prev && !next) return null;
  return (
    <div className="mt-12 pt-6 border-t border-gray-200 flex flex-col sm:flex-row gap-3 justify-between no-print">
      {prev ? (
        <Link to={`/userguide/${prev.id}`} className="group flex items-center gap-3 bg-white border border-gray-200 rounded-xl px-4 py-3 hover:border-[#FA6C43] transition-colors max-w-xs">
          <FaArrowLeft className="text-gray-400 group-hover:text-[#FA6C43] text-xs shrink-0" />
          <span className="min-w-0">
            <span className="block text-[11px] text-gray-400">Previous</span>
            <span className="block text-sm font-semibold text-gray-800 truncate">{prev.title}</span>
          </span>
        </Link>
      ) : <span />}
      {next && (
        <Link to={`/userguide/${next.id}`} className="group flex items-center gap-3 bg-white border border-gray-200 rounded-xl px-4 py-3 hover:border-[#FA6C43] transition-colors max-w-xs sm:ml-auto text-right">
          <span className="min-w-0">
            <span className="block text-[11px] text-gray-400">Next</span>
            <span className="block text-sm font-semibold text-gray-800 truncate">{next.title}</span>
          </span>
          <FaArrowRight className="text-gray-400 group-hover:text-[#FA6C43] text-xs shrink-0" />
        </Link>
      )}
    </div>
  );
}

export default function GuideLayout({ currentId, children }) {
  // Land at the top when moving between pages — without this the router keeps the old
  // scroll offset and a short page opens halfway down.
  useEffect(() => { window.scrollTo(0, 0); }, [currentId]);

  return (
    <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }} className="min-h-screen bg-[#F0F6FB]">
      <header className="no-print border-b border-gray-200/70 bg-[#F0F6FB]/95 backdrop-blur sticky top-0 z-40">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-4 flex items-center gap-4 flex-wrap">
          <Link to="/home" className="flex items-center gap-3 hover:opacity-90 transition-opacity shrink-0">
            <img src={logo} alt="Actr Lab" className="h-9 w-auto object-contain" />
          </Link>
          <span className="hidden sm:block text-sm font-bold text-gray-700 border-l border-gray-300 pl-4">User guide</span>
          <div className="flex-1 min-w-[180px] flex justify-end items-center gap-2">
            <GuideSearch />
            <button
              onClick={() => window.print()}
              title="Print or save as PDF"
              className="hidden sm:flex items-center gap-2 bg-white border border-gray-200 text-gray-600 rounded-xl px-3 py-2 text-sm font-medium hover:border-[#FA6C43] hover:text-[#FA6C43] transition-colors"
            >
              <FaPrint className="text-xs" /> Print
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-8 lg:py-12 flex gap-10">
        <Sidebar currentId={currentId} />
        <main className="flex-1 min-w-0">
          <MobileJump currentId={currentId} />
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 sm:p-10">
            {children}
          </div>
          <PrevNext currentId={currentId} />
          <p className="mt-8 text-center text-xs text-gray-400 no-print">
            {PAGES.length} pages · Something out of date or missing?{' '}
            <Link to="/config_list" className="text-[#FA6C43] font-semibold">Report it from the app</Link>.
          </p>
        </main>
      </div>
    </div>
  );
}
