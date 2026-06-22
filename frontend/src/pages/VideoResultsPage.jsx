import React, { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { FaSpinner, FaChevronDown, FaChevronUp, FaMedal, FaFlag, FaLightbulb, FaFilePdf, FaWalking, FaFilm, FaBell } from 'react-icons/fa';
import apiClient from '../api/apiClient';
import VideoNav from '../components/VideoNav';

// Rotating pitch tips for the multi-minute analysis wait.
const TIPS = [
  'Open with a hook in the first 8 seconds — a question, a surprising fact, or a bold claim.',
  'Name the pain before the solution. People buy relief, not features.',
  'Specifics beat adjectives: “cuts onboarding from 3 days to 2 hours” lands harder than “much faster.”',
  'Confident pace is ~110–160 words per minute. When in doubt, slow down.',
  'Quantify the market and your ask — numbers signal you’ve done the work.',
  'Steady posture and eye contact read as confidence before you even speak.',
  'Tell them why *this* team can pull it off.',
  'End on one memorable line — not “any questions?”',
];

function notifyResultsReady() {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try {
    const n = new Notification('Your pitch results are ready 🎉', {
      body: 'Tap to see your feedback and scores.',
      tag: 'video-results',
    });
    n.onclick = () => { window.focus(); n.close(); };
  } catch (_) { /* ignore */ }
}

// 0-100 → colour
const C = (v) => v == null ? '#9ca3af' : v >= 80 ? '#22c55e' : v >= 65 ? '#3b82f6' : v >= 50 ? '#f59e0b' : '#ef4444';
// display as X.X / 10 from a 0-100 value
const fmt = (v) => v != null ? (v / 10).toFixed(1) : '—';
const mmss = (s) => { if (!s) return ''; const m = Math.floor(s / 60); return `${m}:${String(Math.round(s % 60)).padStart(2, '0')}`; };

// ─── Scoring box (prof-defined dimension): score /10 + one-paragraph rationale ──
function DimensionCard({ dim }) {
  const v = dim?.score;                                   // 0-100, drives the bar
  const shown = dim?.score_10 != null ? dim.score_10.toFixed(1) : fmt(v);
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
      <div className="flex items-start justify-between mb-3">
        <div className="pr-3">
          <h3 className="text-base font-bold text-[#222]">{dim?.name || 'Dimension'}</h3>
          {dim?.definition && <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{dim.definition}</p>}
        </div>
        <div className="text-right shrink-0">
          <span className="text-3xl font-extrabold" style={{ color: C(v) }}>{shown}</span>
          <span className="text-sm text-gray-300 font-bold"> / 10</span>
        </div>
      </div>
      <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden mb-3">
        <div className="h-full rounded-full transition-all" style={{ width: `${v || 0}%`, background: C(v) }} />
      </div>
      {dim?.rationale
        ? <p className="text-sm text-gray-700 leading-relaxed">{dim.rationale}</p>
        : <p className="text-sm text-gray-300 italic">No rationale available.</p>}
    </div>
  );
}

// ─── Content check card (Pain, Solution, … — graded against the transcript) ─────
function ComponentCard({ check }) {
  const v = check?.score;
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
      <div className="flex items-start justify-between mb-2">
        <span className="text-sm font-bold text-[#222]">{check?.label || check?.id}</span>
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
  const navigate = useNavigate();
  const token = searchParams.get('token');

  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [videoUrl, setVideoUrl] = useState(null);
  const [tipIndex, setTipIndex] = useState(0);
  const [notifyState, setNotifyState] = useState(
    () => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission)
  );
  const prevStatusRef = useRef(null);

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

  // Rotate pitch tips while still analyzing.
  const stillWaiting = data && data.submission?.status !== 'scored' && data.submission?.status !== 'failed';
  useEffect(() => {
    if (!stillWaiting) return undefined;
    const t = setInterval(() => setTipIndex((i) => (i + 1) % TIPS.length), 5000);
    return () => clearInterval(t);
  }, [stillWaiting]);

  // Fire a browser notification the moment results flip to scored.
  useEffect(() => {
    const s = data?.submission?.status;
    if (prevStatusRef.current && prevStatusRef.current !== 'scored' && s === 'scored') notifyResultsReady();
    prevStatusRef.current = s;
  }, [data?.submission?.status]);

  const enableNotify = async () => {
    if (typeof Notification === 'undefined') return;
    try { setNotifyState(await Notification.requestPermission()); } catch (_) { /* ignore */ }
  };

  const autoPrint = searchParams.get('print') === '1';
  useEffect(() => {
    if (autoPrint && data?.submission?.status === 'scored') {
      const t = setTimeout(() => window.print(), 600);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line
  }, [autoPrint, data?.submission?.status]);

  const wrap = inner => (
    <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }} className="min-h-screen bg-[#F0F6FB] py-10 px-4">
      <div className="max-w-3xl mx-auto">{inner}</div>
    </div>
  );

  if (loading) return wrap(<><VideoNav className="mb-4" /><div className="text-center py-20"><FaSpinner className="animate-spin text-3xl text-[#FA6C43] mx-auto" /></div></>);
  if (error === 'forbidden') return wrap(
    <>
      <VideoNav className="mb-4" />
      <div className="bg-white rounded-2xl p-8 text-center">
        <h2 className="font-bold text-lg text-[#222]">Access denied</h2>
        <p className="text-sm text-gray-500 mt-2">This results link is invalid or has expired.</p>
      </div>
    </>
  );
  if (error) return wrap(<><VideoNav className="mb-4" /><div className="bg-white rounded-2xl p-8 text-center"><h2 className="font-bold text-lg text-[#222]">Not found</h2></div></>);

  const { submission, scores } = data;
  const status = submission?.status;

  if (status !== 'scored') {
    if (status === 'failed') {
      return wrap(
        <>
          <VideoNav className="mb-4" />
          <div className="bg-white rounded-2xl p-10 text-center">
            <h2 className="font-bold text-lg text-red-600">Processing failed</h2>
            <p className="text-sm text-gray-500 mt-2">{submission?.error || 'Please try uploading again.'}</p>
          </div>
        </>
      );
    }
    return wrap(
      <>
      <VideoNav className="mb-4" />
      <div className="bg-white rounded-3xl shadow-sm p-8 sm:p-10 text-center">
        <div className="relative w-16 h-16 mx-auto mb-5">
          <span className="absolute inset-0 rounded-full bg-[#FA6C43]/20 animate-ping" />
          <span className="relative flex items-center justify-center w-16 h-16 rounded-full bg-[#F9D0C4]/40 text-[#FA6C43]">
            <FaFilm className="text-2xl" />
          </span>
        </div>
        <h2 className="font-bold text-lg text-[#222]">Analyzing your pitch…</h2>
        <p className="text-sm text-gray-500 mt-1">This usually takes 2–4 minutes. You can switch tabs — results appear here automatically.</p>

        <div className="mt-4 w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div className="h-full w-full bg-[#FA6C43]/70 rounded-full animate-pulse" />
        </div>

        <div className="mt-6 bg-[#F0F6FB] rounded-2xl p-4 text-left min-h-[88px]">
          <p className="text-[11px] font-bold uppercase tracking-wider text-[#FA6C43] mb-1">💡 Pitch tip</p>
          <p key={tipIndex} className="text-sm text-gray-700 leading-relaxed">{TIPS[tipIndex]}</p>
        </div>

        <div className="mt-5">
          {notifyState === 'granted' ? (
            <p className="text-xs text-gray-500 flex items-center justify-center gap-1.5">
              <FaBell className="text-[#FA6C43]" /> We’ll notify you the moment your results are ready.
            </p>
          ) : (notifyState === 'unsupported' || notifyState === 'denied') ? null : (
            <button onClick={enableNotify}
              className="text-xs font-semibold text-[#FA6C43] hover:underline flex items-center justify-center gap-1.5 mx-auto">
              <FaBell /> Notify me when it’s ready
            </button>
          )}
        </div>
      </div>
      </>
    );
  }

  const coaching   = scores?.coaching || {};
  const dimensions = scores?.dimensions || [];
  const checks     = scores?.content_checks || [];
  const gambit     = checks.find(c => c.id === 'gambit');
  const components = checks.filter(c => c.id !== 'gambit');
  const overall    = scores?.overall != null ? scores.overall : scores?.llm_overall;
  const talkTime   = scores?.analytics?.talk_time_sec;
  const bodyLanguage = scores?.body_language;
  const dimNames   = dimensions.map(d => d.name).filter(Boolean);

  return wrap(
    <>
      <VideoNav className="mb-4" />

      {/* ── Header ── */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-[#222]">Pitch Results</h1>
          <p className="text-sm text-gray-500">{submission?.name}{talkTime ? ` · ${mmss(talkTime)}` : ''}</p>
        </div>
        <button
          onClick={() => window.print()}
          className="no-print shrink-0 flex items-center gap-2 text-xs font-semibold text-white bg-[#FA6C43] hover:bg-[#e85a30] px-3 py-2 rounded-lg transition-colors"
        >
          <FaFilePdf /> Export PDF
        </button>
      </div>

      {/* ── Video player ── */}
      {videoUrl && (
        <div className="no-print bg-white rounded-2xl border border-gray-100 shadow-sm p-3 mb-5">
          <video src={videoUrl} controls playsInline className="w-full rounded-xl bg-black max-h-[420px]" />
        </div>
      )}

      {/* ── Navigation strip ── */}
      {submission?.config_id && (
        <div className="no-print flex gap-3 mb-4">
          <button onClick={() => navigate(`/video-upload/${submission.config_id}`)}
            className="text-xs font-semibold text-gray-500 hover:text-[#FA6C43] px-3 py-1.5 rounded-lg border border-gray-200 hover:border-[#FA6C43] transition-colors">
            ← Upload another
          </button>
          {submission?.email && (
            <button onClick={() => navigate(`/video/compare/${submission.config_id}?email=${encodeURIComponent(submission.email)}`)}
              className="text-xs font-semibold text-[#FA6C43] px-3 py-1.5 rounded-lg border border-[#FA6C43]/30 hover:border-[#FA6C43] transition-colors">
              Compare all attempts →
            </button>
          )}
        </div>
      )}

      {/* ── Overall score banner ── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-5 flex items-center justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-gray-400">Overall Score</p>
          <p className="text-sm text-gray-500 mt-0.5">
            {dimNames.length ? `Average across ${dimNames.join(', ')}` : 'Across all scoring boxes'}
          </p>
        </div>
        <div className="text-right shrink-0 ml-4">
          <span className="text-5xl font-extrabold" style={{ color: C(overall) }}>{fmt(overall)}</span>
          <span className="text-lg text-gray-300 font-bold"> / 10</span>
        </div>
      </div>

      {/* ── Scoring boxes (dimensions) ── */}
      {dimensions.length > 0 && (
        <div className="space-y-4 mb-8">
          {dimensions.map(d => <DimensionCard key={d.id} dim={d} />)}
        </div>
      )}

      {/* ── Body Language & Delivery ── */}
      {bodyLanguage && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-8">
          <h2 className="font-bold text-[#222] flex items-center gap-2 mb-3">
            <FaWalking className="text-[#FA6C43]" /> Body Language &amp; Delivery
          </h2>
          <p className="text-sm text-gray-700 leading-relaxed">{bodyLanguage}</p>
        </div>
      )}

      {/* ── Content checks ── */}
      {components.length > 0 && (
        <div className="mb-8">
          <h2 className="text-base font-bold text-[#222] mb-3">Content Checks</h2>
          <div className="grid sm:grid-cols-2 gap-3">
            {components.map(c => <ComponentCard key={c.id} check={c} />)}
          </div>
        </div>
      )}

      {/* ── Opening Gambit / Hook ── */}
      {gambit && (
        <div className="bg-white rounded-2xl border-2 border-[#4f46e5]/20 shadow-sm p-5 mb-6">
          <div className="flex items-start justify-between mb-2">
            <div>
              <h2 className="font-bold text-[#222] flex items-center gap-2">
                <FaLightbulb className="text-[#4f46e5]" /> {gambit.label || 'Opening Gambit / Hook'}
              </h2>
              <p className="text-xs text-gray-400 mt-0.5">First 8 seconds — does it grab attention?</p>
            </div>
            <span className="text-3xl font-extrabold ml-4 shrink-0" style={{ color: C(gambit.score) }}>{fmt(gambit.score)}</span>
          </div>
          <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden mb-3">
            <div className="h-full rounded-full" style={{ width: `${gambit.score || 0}%`, background: C(gambit.score) }} />
          </div>
          {gambit.note && <p className="text-sm text-gray-700 leading-relaxed">{gambit.note}</p>}
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
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-5">
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

      {/* ── Full Transcript ── */}
      {data.transcript?.text && <FullTranscript transcript={data.transcript} />}
    </>
  );
}

function FullTranscript({ transcript }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between text-sm font-bold text-gray-600 hover:text-[#FA6C43] transition-colors">
        <span>Full Transcript</span>
        {open ? <FaChevronUp className="text-xs" /> : <FaChevronDown className="text-xs" />}
      </button>
      {open && (
        <div className="mt-4 pt-4 border-t border-gray-100 max-h-96 overflow-y-auto">
          <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{transcript.text}</p>
        </div>
      )}
    </div>
  );
}
