import React, { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import {
  FaChevronDown, FaChevronUp, FaSpinner, FaCheck, FaTimes, FaCheckCircle,
  FaArrowUp, FaMedal, FaFlag, FaLightbulb, FaCommentDots, FaChartBar,
} from 'react-icons/fa';
import apiClient from '../api/apiClient';

const COMPOSITES = [
  { key: 'confidence', label: 'Confidence', blurb: 'Composure, steadiness, low filler' },
  { key: 'competence', label: 'Competence', blurb: 'Content, structure, evidence' },
  { key: 'passion', label: 'Passion', blurb: 'Energy, variation, expressivity' },
];

const STATUS = {
  good: { c: '#22c55e', bg: '#dcfce7', t: 'Strong' },
  warn: { c: '#f59e0b', bg: '#fef3c7', t: 'Watch' },
  bad: { c: '#ef4444', bg: '#fee2e2', t: 'Needs work' },
  na: { c: '#9ca3af', bg: '#f3f4f6', t: 'N/A' },
};

const color = (v) => (v == null ? '#9ca3af' : v >= 80 ? '#22c55e' : v >= 65 ? '#3b82f6' : v >= 50 ? '#f59e0b' : '#ef4444');
const mmss = (s) => { if (s == null) return ''; const m = Math.floor(s / 60); const r = Math.round(s % 60); return `${m}:${String(r).padStart(2, '0')}`; };

function CompositeCard({ label, blurb, data }) {
  const [open, setOpen] = useState(false);
  const value = data?.value;
  const submetrics = data?.submetrics || {};
  const subKeys = Object.keys(submetrics);
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="p-5">
        <div className="flex items-baseline justify-between">
          <div>
            <h3 className="text-base font-bold text-[#222]">{label}</h3>
            <p className="text-xs text-gray-400">{blurb}</p>
          </div>
          <div className="text-right">
            <span className="text-3xl font-extrabold" style={{ color: color(value) }}>{value == null ? '—' : Math.round(value)}</span>
            <p className="text-[11px] font-semibold" style={{ color: color(value) }}>{data?.label || ''}</p>
          </div>
        </div>
        <div className="mt-3 w-full h-2 bg-gray-100 rounded-full overflow-hidden">
          <div className="h-full rounded-full transition-all" style={{ width: `${value || 0}%`, background: color(value) }} />
        </div>
        {subKeys.length > 0 && (
          <button onClick={() => setOpen(!open)} className="mt-3 text-xs font-semibold text-gray-500 hover:text-[#FA6C43] flex items-center gap-1">
            {open ? <FaChevronUp /> : <FaChevronDown />} {open ? 'Hide' : 'Why this score?'}
          </button>
        )}
      </div>
      {open && (
        <div className="border-t border-gray-100 bg-gray-50 px-5 py-4 space-y-3">
          {subKeys.map((k) => {
            const m = submetrics[k];
            return (
              <div key={k}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="font-semibold text-gray-700">{m.label || k}</span>
                  <span className="text-gray-500">{m.available && m.score != null ? Math.round(m.score) : 'N/A'}</span>
                </div>
                <div className="w-full h-1.5 bg-gray-200 rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${(m.available && m.score) || 0}%`, background: color(m.available ? m.score : null) }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Expandable Yoodli-style metric row: label + status badge, expands to benchmark + flagged instances.
function MetricRow({ label, badge, status = 'na', benchmark, instances, extra }) {
  const [open, setOpen] = useState(false);
  const st = STATUS[status] || STATUS.na;
  const hasDetail = benchmark || (instances && instances.length) || extra;
  return (
    <div className="border border-gray-100 rounded-xl overflow-hidden">
      <button onClick={() => hasDetail && setOpen(!open)} className={`w-full flex items-center justify-between px-4 py-3 ${hasDetail ? 'hover:bg-gray-50 cursor-pointer' : 'cursor-default'}`}>
        <span className="flex items-center gap-2 text-sm font-semibold text-gray-700">
          {hasDetail && (open ? <FaChevronUp className="text-gray-300 text-xs" /> : <FaChevronDown className="text-gray-300 text-xs" />)}
          {label}
        </span>
        <span className="text-xs font-bold px-2.5 py-1 rounded-full" style={{ color: st.c, background: st.bg }}>{badge}</span>
      </button>
      {open && hasDetail && (
        <div className="px-4 pb-4 pt-1 bg-gray-50 border-t border-gray-100 space-y-2">
          {benchmark && <p className="text-xs text-gray-500">{benchmark}</p>}
          {extra}
          {instances && instances.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {instances.map((i, idx) => (
                <span key={idx} className="text-[11px] bg-white border border-gray-200 rounded-full px-2 py-0.5 text-gray-600">
                  {i.word ? <b className="text-gray-800">{i.word}</b> : '⏸'} {i.time != null ? `@ ${mmss(i.time)}` : ''}{i.duration != null ? ` · ${i.duration}s` : ''}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function VideoResultsPage() {
  const { submissionId } = useParams();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [videoUrl, setVideoUrl] = useState(null);
  const [tab, setTab] = useState('coaching');     // coaching | analytics
  const [acat, setAcat] = useState('word_choice'); // analytics sub-category

  const load = () => {
    const q = token ? `?token=${encodeURIComponent(token)}` : '';
    apiClient.get(`/video/submissions/${submissionId}/results${q}`)
      .then((res) => { setData(res.data); setError(''); })
      .catch((e) => setError(e.response?.status === 403 ? 'forbidden' : 'notfound'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [submissionId, token]);

  useEffect(() => {
    const q = token ? `?token=${encodeURIComponent(token)}` : '';
    apiClient.get(`/video/submissions/${submissionId}/video-url${q}`)
      .then((res) => setVideoUrl(res.data.url)).catch(() => setVideoUrl(null));
    // eslint-disable-next-line
  }, [submissionId, token]);

  useEffect(() => {
    if (data && data.submission?.status !== 'scored' && data.submission?.status !== 'failed') {
      const t = setInterval(load, 6000);
      return () => clearInterval(t);
    }
    // eslint-disable-next-line
  }, [data]);

  const player = videoUrl ? (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3 mb-5">
      <video src={videoUrl} controls playsInline className="w-full rounded-xl bg-black max-h-[420px]" />
    </div>
  ) : null;

  const wrap = (inner) => (
    <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }} className="min-h-screen bg-[#F0F6FB] py-10 px-4">
      <div className="max-w-3xl mx-auto">{inner}</div>
    </div>
  );

  if (loading) return wrap(<div className="text-center py-20"><FaSpinner className="animate-spin text-3xl text-[#FA6C43] mx-auto" /></div>);
  if (error === 'forbidden') return wrap(<div className="bg-white rounded-2xl p-8 text-center"><h2 className="font-bold text-lg text-[#222]">Access denied</h2><p className="text-sm text-gray-500 mt-2">This results link is invalid or has expired.</p></div>);
  if (error) return wrap(<div className="bg-white rounded-2xl p-8 text-center"><h2 className="font-bold text-lg text-[#222]">Not found</h2></div>);

  const { submission, scores } = data;
  const status = submission?.status;

  if (status !== 'scored') {
    return wrap(
      <>
        {player}
        <div className="bg-white rounded-2xl p-10 text-center">
          {status === 'failed'
            ? <><h2 className="font-bold text-lg text-red-600">Processing failed</h2><p className="text-sm text-gray-500 mt-2">{submission?.error || 'Please try uploading again.'}</p></>
            : <><FaSpinner className="animate-spin text-3xl text-[#FA6C43] mx-auto mb-4" /><h2 className="font-bold text-lg text-[#222]">Still analyzing…</h2><p className="text-sm text-gray-500 mt-2">Your results will appear here automatically.</p></>}
        </div>
      </>
    );
  }

  const coaching = scores?.coaching || {};
  const analytics = scores?.analytics || {};
  const toneTags = scores?.tone_tags || [];
  const checks = scores?.content_checks || [];

  const ROWS = {
    word_choice: (a) => {
      const w = a.word_choice || {};
      return [
        { label: 'Filler words', badge: `${w.filler_words?.pct ?? 0}%`, status: w.filler_words?.status, benchmark: w.filler_words?.benchmark, instances: w.filler_words?.instances },
        { label: 'Weak words', badge: `${w.weak_words?.count ?? 0} · ${w.weak_words?.pct ?? 0}%`, status: w.weak_words?.status, benchmark: w.weak_words?.benchmark, instances: w.weak_words?.instances },
        { label: 'Hedging', badge: `${w.hedging?.per_100 ?? 0}/100`, status: w.hedging?.status, benchmark: w.hedging?.benchmark },
        { label: 'Repetitive openers', badge: `${w.sentence_starters?.recurring ?? 0} recurring`, status: w.sentence_starters?.status, benchmark: w.sentence_starters?.benchmark, instances: (w.sentence_starters?.top || []).map((t) => ({ word: `"${t.starter}"`, time: null, duration: null })) },
        { label: 'Vocabulary variety', badge: w.vocabulary?.label, status: w.vocabulary?.status, benchmark: w.vocabulary?.benchmark },
      ];
    },
    delivery: (a) => {
      const d = a.delivery || {};
      const sections = d.pace?.sections || [];
      return [
        {
          label: 'Pace', badge: `${d.pace?.wpm ?? 0} wpm`, status: d.pace?.status, benchmark: d.pace?.benchmark,
          extra: sections.length ? (
            <div className="flex gap-2 pt-1">
              {sections.map((s) => <span key={s.label} className="text-[11px] bg-white border border-gray-200 rounded-full px-2 py-0.5 text-gray-600">{s.label}: <b>{s.wpm}</b> wpm</span>)}
            </div>
          ) : null,
        },
        { label: 'Long pauses', badge: `${d.pauses?.count ?? 0}`, status: d.pauses?.status, benchmark: d.pauses?.benchmark, instances: d.pauses?.instances },
        { label: 'Vocal variation', badge: d.pitch_variation?.value != null ? `${Math.round(d.pitch_variation.value)}/100` : 'N/A', status: d.pitch_variation?.status, benchmark: d.pitch_variation?.benchmark },
        { label: 'Vocal energy', badge: d.energy?.value != null ? `${Math.round(d.energy.value)}/100` : 'N/A', status: d.energy?.status, benchmark: d.energy?.benchmark },
      ];
    },
    presence: (a) => {
      const p = a.presence || {};
      return [
        { label: 'Facial expressivity', badge: p.facial_expressivity?.value != null ? `${Math.round(p.facial_expressivity.value)}/100` : 'N/A', status: p.facial_expressivity?.status, benchmark: p.facial_expressivity?.benchmark },
        { label: 'Composure', badge: p.composure?.value != null ? `${Math.round(p.composure.value)}/100` : 'N/A', status: p.composure?.status, benchmark: p.composure?.benchmark },
      ];
    },
  };

  return wrap(
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold text-[#222]">Your Results</h1>
        <p className="text-sm text-gray-500">{submission?.name} · {submission?.assignment_type?.replace(/_/g, ' ')}{analytics.talk_time_sec ? ` · ${mmss(analytics.talk_time_sec)}` : ''}</p>
      </div>

      {player}

      {/* Overall + composites */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 mb-5 flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Overall</p>
          <p className="text-sm text-gray-600 mt-1">Weighted across all three dimensions</p>
        </div>
        <span className="text-5xl font-extrabold" style={{ color: color(scores?.overall) }}>{scores?.overall == null ? '—' : Math.round(scores.overall)}</span>
      </div>
      <div className="grid sm:grid-cols-3 gap-4 mb-6">
        {COMPOSITES.map((c) => <CompositeCard key={c.key} label={c.label} blurb={c.blurb} data={scores?.scores?.[c.key]} />)}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-5 bg-gray-100 p-1 rounded-xl w-fit">
        {[['coaching', 'Coaching', FaCommentDots], ['analytics', 'Analytics', FaChartBar]].map(([k, lbl, Icon]) => (
          <button key={k} onClick={() => setTab(k)} className={`px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-all ${tab === k ? 'bg-white shadow-sm text-[#FA6C43]' : 'text-gray-500'}`}>
            <Icon /> {lbl}
          </button>
        ))}
      </div>

      {tab === 'coaching' ? (
        <div className="space-y-5">
          {/* Tone */}
          {toneTags.length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3">Detected Tone</h3>
              <div className="flex flex-wrap gap-2">
                {toneTags.map((t) => (
                  <span key={t.label} className={`text-sm px-3 py-1 rounded-full font-semibold ${t.active ? 'bg-[#4f46e5] text-white' : 'border border-gray-200 text-gray-400'}`}>{t.label}</span>
                ))}
              </div>
            </div>
          )}

          {/* PCCP Breakdown */}
          {coaching.pccp && Object.keys(coaching.pccp).length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-4">PCCP Evaluation</h3>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { key: 'project_competence', label: 'Project Competence' },
                  { key: 'competence', label: 'Competence' },
                  { key: 'confidence', label: 'Confidence' },
                  { key: 'passion', label: 'Passion' },
                ].map(({ key, label }) => {
                  const d = coaching.pccp[key] || {};
                  const v = d.score;
                  return (
                    <div key={key} className="bg-[#F0F6FB] rounded-xl p-3">
                      <div className="flex items-baseline justify-between mb-1">
                        <span className="text-xs font-bold text-gray-600">{label}</span>
                        <span className="text-lg font-extrabold" style={{ color: color(v) }}>{v != null ? Math.round(v) : '—'}</span>
                      </div>
                      <div className="w-full h-1.5 bg-gray-200 rounded-full overflow-hidden mb-2">
                        <div className="h-full rounded-full" style={{ width: `${v || 0}%`, background: color(v) }} />
                      </div>
                      {d.note && <p className="text-[11px] text-gray-500 leading-snug">{d.note}</p>}
                    </div>
                  );
                })}
              </div>
              {coaching.pccp.overall != null && (
                <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between">
                  <span className="text-sm font-semibold text-gray-600">PCCP Overall</span>
                  <span className="text-xl font-extrabold" style={{ color: color(coaching.pccp.overall) }}>{Math.round(coaching.pccp.overall)}</span>
                </div>
              )}
            </div>
          )}

          {/* Opening Gambit */}
          {coaching.gambit && coaching.gambit.identified && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3">Opening Gambit</h3>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <p className="text-sm font-bold text-[#222]">{coaching.gambit.identified}</p>
                  {coaching.gambit.relevance_note && <p className="text-xs text-gray-500 mt-1">{coaching.gambit.relevance_note}</p>}
                  {coaching.gambit.improvement && <p className="text-xs text-blue-600 mt-2 bg-blue-50 rounded-lg px-3 py-2">{coaching.gambit.improvement}</p>}
                </div>
                {coaching.gambit.effectiveness != null && (
                  <div className="text-right shrink-0">
                    <span className="text-2xl font-extrabold" style={{ color: color(coaching.gambit.effectiveness) }}>{Math.round(coaching.gambit.effectiveness)}</span>
                    <p className="text-[11px] text-gray-400">effectiveness</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Strength */}
          {coaching.strength && (
            <div className="bg-white rounded-2xl border border-green-200 shadow-sm p-5">
              <h3 className="font-bold text-green-600 flex items-center gap-2 mb-2"><FaMedal /> Strength</h3>
              <p className="text-sm text-gray-700 leading-relaxed">{coaching.strength}</p>
            </div>
          )}

          {/* Growth areas with Original → Improved rewrites */}
          {(coaching.growth_areas || []).length > 0 && (
            <div className="bg-white rounded-2xl border-2 border-[#FA6C43]/30 shadow-sm p-5">
              <h3 className="font-bold text-[#FA6C43] flex items-center gap-2 mb-4"><FaFlag /> Growth Areas</h3>
              <div className="space-y-5">
                {coaching.growth_areas.map((g, i) => (
                  <div key={i}>
                    <p className="text-sm font-bold text-[#222]">{g.title}</p>
                    {g.detail && <p className="text-sm text-gray-700 mt-1 leading-relaxed">{g.detail}</p>}
                    {(g.rewrites || []).map((r, j) => (
                      <div key={j} className="mt-2 ml-1 space-y-1">
                        <p className="text-xs text-gray-500"><span className="font-semibold text-red-500">Original:</span> “{r.original}”</p>
                        <p className="text-xs text-gray-500"><span className="font-semibold text-green-600">Improved:</span> “{r.improved}”</p>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Content checklist */}
          {checks.length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <h3 className="font-bold text-[#222] mb-3">Content Checklist</h3>
              <div className="space-y-2">
                {checks.map((c, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <span className={`mt-0.5 ${c.passed ? 'text-green-500' : 'text-gray-300'}`}>{c.passed ? <FaCheck /> : <FaTimes />}</span>
                    <div><p className="text-sm font-semibold text-gray-700">{c.label || c.id}</p>{c.note && <p className="text-xs text-gray-500">{c.note}</p>}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Follow-up questions */}
          {(coaching.follow_up_questions || []).length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <h3 className="font-bold text-[#222] flex items-center gap-2 mb-3"><FaLightbulb className="text-blue-400" /> Questions to Prepare For</h3>
              <ul className="space-y-2">
                {coaching.follow_up_questions.map((q, i) => <li key={i} className="text-sm text-gray-700 bg-[#F0F6FB] rounded-xl p-3">{q}</li>)}
              </ul>
            </div>
          )}

          {/* Summary */}
          {(coaching.summary || []).length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <h3 className="font-bold text-[#222] mb-3">Summary</h3>
              <ul className="space-y-1.5">{coaching.summary.map((s, i) => <li key={i} className="text-sm text-gray-700 flex gap-2"><span className="text-[#FA6C43]">•</span>{s}</li>)}</ul>
            </div>
          )}
        </div>
      ) : (
        <div>
          <div className="flex gap-2 mb-4">
            {[['word_choice', 'Word Choice'], ['delivery', 'Delivery'], ['presence', 'Presence']].map(([k, lbl]) => (
              <button key={k} onClick={() => setAcat(k)} className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${acat === k ? 'bg-[#FA6C43] text-white' : 'bg-white border border-gray-200 text-gray-500'}`}>{lbl}</button>
            ))}
          </div>
          <div className="space-y-2.5">
            {ROWS[acat](analytics).map((r, i) => <MetricRow key={i} {...r} />)}
          </div>
        </div>
      )}
    </>
  );
}
