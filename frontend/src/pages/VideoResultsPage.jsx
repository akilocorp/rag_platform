import React, { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { FaSpinner, FaChevronDown, FaChevronUp, FaMedal, FaFlag, FaLightbulb } from 'react-icons/fa';
import apiClient from '../api/apiClient';

const KEY_COMPONENTS = [
  { id: 'pain',             label: 'The Pain' },
  { id: 'solution',         label: 'The Solution' },
  { id: 'customer',         label: 'The Customer' },
  { id: 'competition',      label: 'The Competition' },
  { id: 'deal',             label: 'The Deal' },
  { id: 'team',             label: 'The Team' },
  { id: 'summary_sentence', label: 'Summary Sentence' },
];

const COMPOSITES = [
  { key: 'confidence', label: 'Confidence', blurb: 'Composure, steadiness, delivery' },
  { key: 'competence', label: 'Competence', blurb: 'Content, structure, clarity' },
  { key: 'passion',    label: 'Passion',    blurb: 'Energy, enthusiasm, expressivity' },
];

// 0-100 → colour
const C = (v) => v == null ? '#9ca3af' : v >= 80 ? '#22c55e' : v >= 65 ? '#3b82f6' : v >= 50 ? '#f59e0b' : '#ef4444';
// display as X.X / 10
const fmt = (v) => v != null ? (v / 10).toFixed(1) : '—';
const mmss = (s) => { if (!s) return ''; const m = Math.floor(s / 60); return `${m}:${String(Math.round(s % 60)).padStart(2, '0')}`; };

// ─── PCCP composite card ───────────────────────────────────────────────────────
// evalScore: LLM-graded (0-100), takes priority over computed value if present
function PccpCard({ label, blurb, data, evalScore, evalComment }) {
  const [open, setOpen] = useState(false);
  const v = evalScore != null ? evalScore : data?.value;
  const subs = Object.entries(data?.submetrics || {}).filter(([, m]) => m?.available && m?.score != null);
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="text-base font-bold text-[#222]">{label}</h3>
          <p className="text-xs text-gray-400 mt-0.5">{blurb}</p>
        </div>
        <div className="text-right ml-4 shrink-0">
          <span className="text-3xl font-extrabold" style={{ color: C(v) }}>{fmt(v)}</span>
          <p className="text-[10px] font-bold uppercase tracking-wide mt-0.5" style={{ color: C(v) }}>{data?.label || ''}</p>
        </div>
      </div>
      <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden mb-2">
        <div className="h-full rounded-full transition-all" style={{ width: `${v || 0}%`, background: C(v) }} />
      </div>
      {evalComment && <p className="text-xs text-gray-500 mt-1 mb-1 leading-relaxed">{evalComment}</p>}
      {subs.length > 0 && (
        <button onClick={() => setOpen(!open)} className="text-xs text-gray-400 hover:text-[#FA6C43] flex items-center gap-1 mt-1">
          {open ? <FaChevronUp /> : <FaChevronDown />} {open ? 'Hide signals' : 'Delivery signals'}
        </button>
      )}
      {open && (
        <div className="mt-3 pt-3 border-t border-gray-100 space-y-2.5">
          {subs.map(([k, m]) => (
            <div key={k}>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-gray-600">{m.label || k}</span>
                <span style={{ color: C(m.available ? m.score : null) }}>
                  {m.available && m.score != null ? Math.round(m.score) : 'N/A'}
                </span>
              </div>
              <div className="w-full h-1 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${(m.available && m.score) || 0}%`, background: C(m.available ? m.score : null) }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Key component card (Pain, Solution, …) ───────────────────────────────────
function ComponentCard({ label, check }) {
  const v = check?.score;
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
      <div className="flex items-start justify-between mb-2">
        <span className="text-sm font-bold text-[#222]">{label}</span>
        <span className="text-2xl font-extrabold shrink-0 ml-2" style={{ color: C(v) }}>{fmt(v)}</span>
      </div>
      <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden mb-2.5">
        <div className="h-full rounded-full" style={{ width: `${v || 0}%`, background: C(v) }} />
      </div>
      {check?.note
        ? <p className="text-xs text-gray-500 leading-relaxed">{check.note}</p>
        : <p className="text-xs text-gray-300 italic">Not evaluated</p>}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function VideoResultsPage() {
  const { submissionId } = useParams();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [videoUrl, setVideoUrl] = useState(null);

  const load = () => {
    const q = token ? `?token=${encodeURIComponent(token)}` : '';
    apiClient.get(`/video/submissions/${submissionId}/results${q}`)
      .then(res => { setData(res.data); setError(''); })
      .catch(e => setError(e.response?.status === 403 ? 'forbidden' : 'notfound'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [submissionId, token]);

  useEffect(() => {
    const q = token ? `?token=${encodeURIComponent(token)}` : '';
    apiClient.get(`/video/submissions/${submissionId}/video-url${q}`)
      .then(res => setVideoUrl(res.data.url)).catch(() => setVideoUrl(null));
    // eslint-disable-next-line
  }, [submissionId, token]);

  useEffect(() => {
    if (data && data.submission?.status !== 'scored' && data.submission?.status !== 'failed') {
      const t = setInterval(load, 6000);
      return () => clearInterval(t);
    }
    // eslint-disable-next-line
  }, [data]);

  const wrap = inner => (
    <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }} className="min-h-screen bg-[#F0F6FB] py-10 px-4">
      <div className="max-w-3xl mx-auto">{inner}</div>
    </div>
  );

  if (loading) return wrap(<div className="text-center py-20"><FaSpinner className="animate-spin text-3xl text-[#FA6C43] mx-auto" /></div>);
  if (error === 'forbidden') return wrap(
    <div className="bg-white rounded-2xl p-8 text-center">
      <h2 className="font-bold text-lg text-[#222]">Access denied</h2>
      <p className="text-sm text-gray-500 mt-2">This results link is invalid or has expired.</p>
    </div>
  );
  if (error) return wrap(<div className="bg-white rounded-2xl p-8 text-center"><h2 className="font-bold text-lg text-[#222]">Not found</h2></div>);

  const { submission, scores } = data;
  const status = submission?.status;

  if (status !== 'scored') {
    return wrap(
      <div className="bg-white rounded-2xl p-10 text-center">
        {status === 'failed'
          ? <><h2 className="font-bold text-lg text-red-600">Processing failed</h2><p className="text-sm text-gray-500 mt-2">{submission?.error || 'Please try uploading again.'}</p></>
          : <><FaSpinner className="animate-spin text-3xl text-[#FA6C43] mx-auto mb-4" /><h2 className="font-bold text-lg text-[#222]">Still analyzing…</h2><p className="text-sm text-gray-500 mt-2">Your results will appear here automatically.</p></>}
      </div>
    );
  }

  const coaching  = scores?.coaching || {};
  const checks    = scores?.content_checks || [];
  const checkMap  = Object.fromEntries(checks.map(c => [c.id, c]));
  const gambit    = checkMap['gambit'];
  const pccpEval  = scores?.pccp_eval || {};
  // LLM overall (1-10 * 10) takes priority over computed composite average
  const overall   = scores?.llm_overall != null ? scores.llm_overall : scores?.overall;
  const talkTime = scores?.analytics?.talk_time_sec;

  return wrap(
    <>
      {/* ── Header ── */}
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold text-[#222]">Elevator Pitch Results</h1>
        <p className="text-sm text-gray-500">{submission?.name}{talkTime ? ` · ${mmss(talkTime)}` : ''}</p>
      </div>

      {/* ── Video player ── */}
      {videoUrl && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3 mb-5">
          <video src={videoUrl} controls playsInline className="w-full rounded-xl bg-black max-h-[420px]" />
        </div>
      )}

      {/* ── Overall PCCP score banner ── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-5 flex items-center justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-gray-400">Overall PCCP Score</p>
          <p className="text-sm text-gray-500 mt-0.5">Weighted across Competence, Confidence &amp; Passion</p>
        </div>
        <span className="text-5xl font-extrabold" style={{ color: C(overall) }}>{fmt(overall)}</span>
      </div>

      {/* ── PCCP composite cards ── */}
      <div className="grid sm:grid-cols-3 gap-4 mb-8">
        {COMPOSITES.map(c => (
          <PccpCard
            key={c.key}
            label={c.label}
            blurb={c.blurb}
            data={scores?.scores?.[c.key]}
            evalScore={pccpEval[c.key]?.score}
            evalComment={pccpEval[c.key]?.comment}
          />
        ))}
      </div>

      {/* ── Key Components ── */}
      {checks.length > 0 && (
        <div className="mb-8">
          <h2 className="text-base font-bold text-[#222] mb-3">Key Components</h2>
          <div className="grid sm:grid-cols-2 gap-3">
            {KEY_COMPONENTS.map(kc => (
              <ComponentCard key={kc.id} label={kc.label} check={checkMap[kc.id]} />
            ))}
          </div>
        </div>
      )}

      {/* ── Opening Gambit / Hook ── */}
      {gambit && (
        <div className="bg-white rounded-2xl border-2 border-[#4f46e5]/20 shadow-sm p-5 mb-6">
          <div className="flex items-start justify-between mb-2">
            <div>
              <h2 className="font-bold text-[#222] flex items-center gap-2">
                <FaLightbulb className="text-[#4f46e5]" /> Opening Gambit / Hook
              </h2>
              <p className="text-xs text-gray-400 mt-0.5">First 8 seconds — does it grab attention?</p>
            </div>
            <span className="text-3xl font-extrabold ml-4 shrink-0" style={{ color: C(gambit.score) }}>{fmt(gambit.score)}</span>
          </div>
          <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden mb-3">
            <div className="h-full rounded-full" style={{ width: `${gambit.score || 0}%`, background: C(gambit.score) }} />
          </div>
          {gambit.note && <p className="text-sm text-gray-700 leading-relaxed mb-3">{gambit.note}</p>}
          <div className="bg-[#EEF2FF] rounded-xl p-3">
            <p className="text-xs font-bold text-[#4f46e5] mb-1">Hook Advice</p>
            <p className="text-xs text-[#4f46e5]/80 leading-relaxed">
              Open with one of the 17 classical gambits — Question, Anecdote, Factoid, Grabber, Curiosity Arousal, The Problem, etc.
              It must be relevant to the pain you're solving and land within the first 8 seconds to hold judge attention.
            </p>
          </div>
        </div>
      )}

      {/* ── Areas for Improvement ── */}
      {(coaching.growth_areas || []).length > 0 && (
        <div className="bg-white rounded-2xl border-2 border-[#FA6C43]/30 shadow-sm p-5 mb-5">
          <h2 className="font-bold text-[#FA6C43] flex items-center gap-2 mb-3"><FaFlag /> Areas for Improvement</h2>
          <ul className="space-y-2">
            {coaching.growth_areas.map((g, i) => (
              <li key={i} className="flex gap-2.5 text-sm text-gray-700">
                <span className="text-[#FA6C43] shrink-0 mt-0.5">→</span>
                <span>{g.title || g}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Strength ── */}
      {coaching.strength && (
        <div className="bg-white rounded-2xl border border-green-200 shadow-sm p-5 mb-5">
          <h2 className="font-bold text-green-600 flex items-center gap-2 mb-2"><FaMedal /> Strength</h2>
          <p className="text-sm text-gray-700 leading-relaxed">{coaching.strength}</p>
        </div>
      )}

      {/* ── Conclusion / Summary ── */}
      {(coaching.summary || []).length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-5">
          <h2 className="font-bold text-[#222] mb-3">Conclusion</h2>
          <ul className="space-y-2">
            {coaching.summary.map((s, i) => (
              <li key={i} className="text-sm text-gray-700 flex gap-2.5">
                <span className="text-[#FA6C43] shrink-0 mt-0.5">•</span>{s}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Additional Points ── */}
      {(coaching.additional_points || []).length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-5">
          <h2 className="font-bold text-[#222] mb-3">Additional Notes</h2>
          <ul className="space-y-1.5">
            {coaching.additional_points.map((s, i) => (
              <li key={i} className="text-sm text-gray-600 flex gap-2.5">
                <span className="text-gray-400 shrink-0">•</span>{s}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Follow-up questions ── */}
      {(coaching.follow_up_questions || []).length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <h2 className="font-bold text-[#222] flex items-center gap-2 mb-3">
            <FaLightbulb className="text-blue-400" /> Questions to Prepare For
          </h2>
          <ul className="space-y-2">
            {coaching.follow_up_questions.map((q, i) => (
              <li key={i} className="text-sm text-gray-700 bg-[#F0F6FB] rounded-xl p-3">{q}</li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
