import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { FaSpinner, FaChevronDown, FaChevronUp, FaCopy, FaCheck, FaArrowLeft, FaRedo, FaPlus } from 'react-icons/fa';
import apiClient from '../api/apiClient';

const DIMS = [
  { key: 'confidence', label: 'Confidence' },
  { key: 'competence', label: 'Competence' },
  { key: 'passion', label: 'Passion' },
];
const KEY_COMPONENTS = [
  { id: 'pain',             label: 'The Pain' },
  { id: 'solution',         label: 'The Solution' },
  { id: 'customer',         label: 'The Customer' },
  { id: 'competition',      label: 'The Competition' },
  { id: 'deal',             label: 'The Deal' },
  { id: 'team',             label: 'The Team' },
  { id: 'summary_sentence', label: 'Summary Sentence' },
];
const fmt10 = (v) => v != null ? (v / 10).toFixed(1) : '—';
const BUCKETS = [
  { key: 'excellent', label: 'Excellent', color: '#22c55e' },
  { key: 'strong', label: 'Strong', color: '#3b82f6' },
  { key: 'developing', label: 'Developing', color: '#f59e0b' },
  { key: 'weak', label: 'Weak', color: '#ef4444' },
];

function color(v) {
  if (v == null) return '#9ca3af';
  if (v >= 80) return '#22c55e';
  if (v >= 65) return '#3b82f6';
  if (v >= 50) return '#f59e0b';
  return '#ef4444';
}

function fmtTs(ts) {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function SidebarItem({ a, selected, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-2.5 rounded-xl text-sm transition-colors ${selected ? 'bg-[#FA6C43] text-white' : 'hover:bg-gray-100 text-gray-700'}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold truncate text-[12px]">{fmtTs(a.analyzed_at)}</span>
        {a.avg_score != null && (
          <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded shrink-0 ${selected ? 'bg-white/30 text-white' : 'bg-[#FA6C43]/10 text-[#FA6C43]'}`}>{a.avg_score}</span>
        )}
      </div>
      {a.grading_prompt && (
        <p className={`text-[11px] mt-0.5 truncate ${selected ? 'text-white/70' : 'text-gray-400'}`}>{a.grading_prompt.slice(0, 55)}</p>
      )}
    </button>
  );
}

function StudentRow({ sub, configId, onRescored, analysisData }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState(null);
  const [rescoring, setRescoring] = useState(false);

  const toggle = () => {
    setOpen(!open);
    if (!detail && !analysisData) {
      apiClient.get(`/video/submissions/${sub.id}/results`)
        .then((res) => setDetail(res.data))
        .catch(() => setDetail({ error: true }));
    }
  };

  const rescore = async (e) => {
    e.stopPropagation();
    setRescoring(true);
    try {
      await apiClient.post(`/video/submissions/${sub.id}/rescore`, {});
      const res = await apiClient.get(`/video/submissions/${sub.id}/results`);
      setDetail(res.data);
      onRescored && onRescored();
    } catch (_) { /* ignore */ } finally { setRescoring(false); }
  };

  const sc = sub.scores || {};
  const displayScore = analysisData ? analysisData.score : sub.overall;
  const fb = detail?.scores?.feedback || {};

  return (
    <div className="border-b border-gray-100 last:border-0">
      <div onClick={toggle} className="flex items-center gap-4 py-3 px-4 cursor-pointer hover:bg-gray-50">
        <span className="text-gray-400">{open ? <FaChevronUp /> : <FaChevronDown />}</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-800 truncate">{sub.name || 'Anonymous'}</p>
          <p className="text-xs text-gray-400 truncate">{sub.email}</p>
        </div>
        {!analysisData && (
          <div className="hidden sm:flex gap-3">
            {DIMS.map((d) => {
              const v = sc[d.key]?.value;
              return <span key={d.key} className="text-xs font-bold w-14 text-center" style={{ color: color(v) }}>{v == null ? '—' : Math.round(v)}</span>;
            })}
          </div>
        )}
        <span className="text-lg font-extrabold w-12 text-right" style={{ color: color(displayScore) }}>
          {displayScore == null ? '—' : Math.round(displayScore)}
        </span>
      </div>
      {open && (
        <div className="bg-gray-50 px-6 py-4">
          {analysisData ? (
            <div className="space-y-3">
              {analysisData.summary && <p className="text-sm text-gray-700">{analysisData.summary}</p>}
              {(analysisData.strengths || []).length > 0 && (
                <div>
                  <p className="text-[11px] font-bold uppercase text-green-600 mb-1">Strengths</p>
                  <ul className="list-disc ml-5 text-sm text-gray-700">{analysisData.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul>
                </div>
              )}
              {(analysisData.improvements || []).length > 0 && (
                <div>
                  <p className="text-[11px] font-bold uppercase text-amber-600 mb-1">To improve</p>
                  <ul className="list-disc ml-5 text-sm text-gray-700">{analysisData.improvements.map((s, i) => <li key={i}>{s}</li>)}</ul>
                </div>
              )}
              <Link to={`/video-results/${sub.id}`} className="text-xs font-semibold text-[#FA6C43] hover:underline">Open full results →</Link>
            </div>
          ) : !detail ? (
            <FaSpinner className="animate-spin text-gray-400" />
          ) : detail.error ? (
            <p className="text-sm text-gray-500">{sub.status === 'scored' ? 'Could not load details.' : `Status: ${sub.status}`}</p>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-4">
                {DIMS.map((d) => {
                  const dd = detail.scores?.scores?.[d.key];
                  return (
                    <div key={d.key} className="text-xs">
                      <span className="font-semibold text-gray-600">{d.label}: </span>
                      <span style={{ color: color(dd?.value) }} className="font-bold">{dd?.value == null ? '—' : Math.round(dd.value)}</span>
                    </div>
                  );
                })}
              </div>
              {/* Competence signals: filler words + awkward gestures */}
              {(() => {
                const fillerSm = detail.scores?.scores?.competence?.submetrics?.filler_rate;
                const fillerInstances = detail.scores?.analytics?.word_choice?.filler_words?.instances || [];
                const fillerPct = detail.scores?.analytics?.word_choice?.filler_words?.pct;
                const awkwardSm = detail.scores?.scores?.competence?.submetrics?.awkward_gestures;
                if (!fillerSm && !awkwardSm) return null;
                return (
                  <div className="flex flex-wrap gap-x-5 gap-y-1 pt-1 border-t border-gray-100">
                    {fillerSm?.available && fillerSm?.score != null && (
                      <span className="text-xs">
                        <span className="font-semibold text-gray-600">Filler words: </span>
                        <span style={{ color: color(fillerSm.score) }} className="font-bold">{Math.round(fillerSm.score)}/100</span>
                        {fillerPct != null && <span className="text-gray-400"> · {fillerPct}%{fillerInstances.length > 0 && ` (${fillerInstances.length} detected)`}</span>}
                      </span>
                    )}
                    {awkwardSm && !awkwardSm.available && (
                      <span className="text-xs text-gray-300 italic">Awkward gestures: not yet measured</span>
                    )}
                  </div>
                );
              })()}
              {fb.summary && <p className="text-sm text-gray-700">{fb.summary}</p>}
              {(fb.improvements || []).length > 0 && (
                <div>
                  <p className="text-[11px] font-bold uppercase text-amber-600 mb-1">To improve</p>
                  <ul className="list-disc ml-5 text-sm text-gray-700">{fb.improvements.map((s, i) => <li key={i}>{s}</li>)}</ul>
                </div>
              )}
              <div className="flex gap-3 pt-1">
                <Link to={`/video-results/${sub.id}`} className="text-xs font-semibold text-[#FA6C43] hover:underline">Open full results →</Link>
                <button onClick={rescore} disabled={rescoring} className="text-xs font-semibold text-gray-500 hover:text-gray-700 flex items-center gap-1">
                  {rescoring ? <FaSpinner className="animate-spin" /> : <FaRedo />} Rescore
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function VideoDashboardPage() {
  const { configId } = useParams();
  const [dash, setDash] = useState(null);
  const [subs, setSubs] = useState([]);
  const [classCode, setClassCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [copiedInvite, setCopiedInvite] = useState(false);

  // Analysis sidebar state
  const [analyses, setAnalyses] = useState([]);
  const loadedRef = useRef({});
  const [viewId, setViewId] = useState(null);  // null = delivery view

  // New analysis form state
  const [prompt, setPrompt] = useState('');
  const [jobId, setJobId] = useState(null);
  const [jobProgress, setJobProgress] = useState('');
  const [jobError, setJobError] = useState('');
  const running = !!jobId;

  const loadDash = useCallback(() => {
    Promise.all([
      apiClient.get(`/video/config/${configId}/dashboard`),
      apiClient.get(`/video/config/${configId}/submissions`),
      apiClient.get(`/config/${configId}`).catch(() => ({ data: {} })),
    ]).then(([d, s, cfg]) => {
      setDash(d.data);
      setSubs(s.data.submissions || []);
      setClassCode(cfg.data?.config?.class_code || '');
    }).finally(() => setLoading(false));
  }, [configId]);

  const refreshAnalyses = useCallback(() => {
    apiClient.get(`/video/config/${configId}/ai-analyses`)
      .then((res) => setAnalyses(res.data.analyses || []))
      .catch(() => {});
  }, [configId]);

  const loadAnalysis = useCallback((id) => {
    if (loadedRef.current[id]) return Promise.resolve(loadedRef.current[id]);
    return apiClient.get(`/video/config/${configId}/ai-analyses/${id}`)
      .then((res) => { loadedRef.current[id] = res.data; return res.data; });
  }, [configId]);

  useEffect(() => { loadDash(); refreshAnalyses(); }, [loadDash, refreshAnalyses]);

  // Poll running job
  useEffect(() => {
    if (!jobId) return;
    const iv = setInterval(() => {
      apiClient.get(`/video/config/${configId}/ai-analyze/${jobId}`)
        .then((res) => {
          const { status, progress, result, error } = res.data;
          setJobProgress(progress || '');
          if (status === 'done') {
            clearInterval(iv);
            setJobId(null);
            refreshAnalyses();
            // auto-select the freshest entry after list refresh
            apiClient.get(`/video/config/${configId}/ai-analyses`)
              .then((r) => {
                const list = r.data.analyses || [];
                setAnalyses(list);
                if (list[0]) {
                  loadedRef.current[list[0]._id] = { ...list[0], students: result.students, class_summary: result.class_summary };
                  setViewId(list[0]._id);
                }
              });
          } else if (status === 'error') {
            clearInterval(iv);
            setJobId(null);
            setJobError(error || 'Analysis failed.');
          }
        })
        .catch(() => {});
    }, 2000);
    return () => clearInterval(iv);
  }, [jobId, configId, loadAnalysis, refreshAnalyses]);

  const startAnalysis = async () => {
    if (!prompt.trim() || running) return;
    setJobError('');
    setJobProgress('Starting…');
    try {
      const res = await apiClient.post(`/video/config/${configId}/ai-analyze`, { grading_prompt: prompt });
      setJobId(res.data.job_id);
    } catch (e) {
      setJobError(e.response?.data?.error || 'Failed to start analysis.');
      setJobProgress('');
    }
  };

  const selectView = (id) => {
    setViewId(id);
    loadAnalysis(id).catch(() => {});
  };

  const uploadLink = `${window.location.origin}/video-upload/${configId}`;
  const inviteLink = classCode ? `${window.location.origin}/join/${classCode}` : '';
  const copyLink = () => { navigator.clipboard.writeText(uploadLink); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  const copyInvite = () => { navigator.clipboard.writeText(inviteLink); setCopiedInvite(true); setTimeout(() => setCopiedInvite(false), 2000); };

  const activeAnalysis = viewId ? loadedRef.current[viewId] : null;
  const analysisStudentMap = activeAnalysis
    ? Object.fromEntries((activeAnalysis.students || []).map((s) => [s.submission_id, s]))
    : null;

  if (loading) return (
    <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }} className="min-h-screen bg-[#F0F6FB] flex items-center justify-center">
      <FaSpinner className="animate-spin text-3xl text-[#FA6C43]" />
    </div>
  );

  return (
    <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }} className="min-h-screen bg-[#F0F6FB] py-8 px-4">
      <div className="max-w-6xl mx-auto">
        <Link to="/config_list" className="text-sm text-gray-500 hover:text-[#FA6C43] flex items-center gap-2 mb-4"><FaArrowLeft /> Back to configs</Link>
        <h1 className="text-2xl font-extrabold text-[#222] mb-1">Video Analysis Dashboard</h1>
        <p className="text-sm text-gray-500 mb-6">{dash?.total_submissions || 0} submission{dash?.total_submissions === 1 ? '' : 's'}</p>

        <div className="flex gap-5 items-start">
          {/* Sidebar */}
          <aside className="w-52 shrink-0 space-y-2">
            <button
              onClick={() => setViewId(null)}
              className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-semibold transition-colors ${!viewId ? 'bg-[#FA6C43] text-white' : 'bg-white border border-gray-200 text-gray-700 hover:border-[#FA6C43] hover:text-[#FA6C43]'}`}
            >
              <FaPlus className="text-[10px]" /> Delivery View
            </button>
            {analyses.length > 0 && (
              <>
                <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 px-1 pt-1">Past Analyses</p>
                {analyses.map((a) => (
                  <SidebarItem key={a._id} a={a} selected={viewId === a._id} onClick={() => selectView(a._id)} />
                ))}
              </>
            )}
          </aside>

          {/* Main content */}
          <div className="flex-1 min-w-0 space-y-6">
            {/* Links */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
              <div className="flex items-center gap-3">
                <span className="text-xs font-bold uppercase tracking-wider text-gray-400 shrink-0 w-24">Upload link</span>
                <code className="flex-1 text-sm text-gray-700 truncate bg-gray-50 px-3 py-2 rounded-lg">{uploadLink}</code>
                <button onClick={copyLink} className="px-3 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-semibold flex items-center gap-2 shrink-0">
                  {copied ? <FaCheck className="text-green-500" /> : <FaCopy />} {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              {inviteLink && (
                <div className="flex items-center gap-3">
                  <span className="text-xs font-bold uppercase tracking-wider text-[#FA6C43] shrink-0 w-24">Invite link</span>
                  <code className="flex-1 text-sm text-gray-700 truncate bg-[#FFF5F2] border border-[#FA6C43]/20 px-3 py-2 rounded-lg">{inviteLink}</code>
                  <button onClick={copyInvite} className="px-3 py-2 rounded-lg bg-[#FA6C43] text-white text-sm font-semibold flex items-center gap-2 shrink-0">
                    {copiedInvite ? <FaCheck /> : <FaCopy />} {copiedInvite ? 'Copied' : 'Copy'}
                  </button>
                </div>
              )}
            </div>

            {/* Delivery view (no analysis selected) */}
            {!viewId && (
              <>
                {/* Composite score cards */}
                <div className="grid sm:grid-cols-3 gap-4">
                  {DIMS.map((d) => {
                    const avg = dash?.averages?.[d.key];
                    const dist = dash?.distributions?.[d.key] || {};
                    const total = BUCKETS.reduce((s, b) => s + (dist[b.key] || 0), 0) || 1;
                    return (
                      <div key={d.key} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                        <div className="flex items-baseline justify-between mb-3">
                          <h3 className="font-bold text-[#222]">{d.label}</h3>
                          <span className="text-2xl font-extrabold" style={{ color: color(avg) }}>{avg == null ? '—' : Math.round(avg)}</span>
                        </div>
                        <div className="flex w-full h-2.5 rounded-full overflow-hidden bg-gray-100">
                          {BUCKETS.map((b) => {
                            const w = ((dist[b.key] || 0) / total) * 100;
                            return w > 0 ? <div key={b.key} style={{ width: `${w}%`, background: b.color }} title={`${b.label}: ${dist[b.key]}`} /> : null;
                          })}
                        </div>
                        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
                          {BUCKETS.map((b) => (
                            <span key={b.key} className="text-[10px] text-gray-500 flex items-center gap-1">
                              <span className="w-2 h-2 rounded-full inline-block" style={{ background: b.color }} />{b.label} {dist[b.key] || 0}
                            </span>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* PCCP Delivery averages (LLM-graded) */}
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                  <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-3">PCCP Delivery (Class Avg)</h2>
                  <div className="grid grid-cols-3 gap-3">
                    {DIMS.map(d => {
                      const v = dash?.pccp_averages?.[d.key];
                      return (
                        <div key={d.key} className="text-center">
                          <p className="text-2xl font-extrabold" style={{ color: color(v) }}>{fmt10(v)}</p>
                          <p className="text-xs text-gray-500 font-semibold mt-0.5">{d.label}</p>
                          <div className="mt-1.5 w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${v || 0}%`, background: color(v) }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Opening Gambit average */}
                <div className="bg-white rounded-2xl border-2 border-[#4f46e5]/20 shadow-sm p-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="font-bold text-[#222]">Opening Gambit / Hook</h2>
                      <p className="text-xs text-gray-400 mt-0.5">Class average — first 8 seconds</p>
                    </div>
                    <span className="text-3xl font-extrabold" style={{ color: color(dash?.component_averages?.gambit) }}>
                      {fmt10(dash?.component_averages?.gambit)}
                    </span>
                  </div>
                  <div className="mt-3 w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${dash?.component_averages?.gambit || 0}%`, background: color(dash?.component_averages?.gambit) }} />
                  </div>
                </div>

                {/* Key Component cards */}
                <div>
                  <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-3">Key Components (Class Avg)</h2>
                  <div className="grid sm:grid-cols-2 gap-3">
                    {KEY_COMPONENTS.map(kc => {
                      const v = dash?.component_averages?.[kc.id];
                      return (
                        <div key={kc.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-sm font-bold text-[#222]">{kc.label}</span>
                            <span className="text-xl font-extrabold" style={{ color: color(v) }}>{fmt10(v)}</span>
                          </div>
                          <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${v || 0}%`, background: color(v) }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {dash?.common_weakness_dimension && (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
                    <span className="font-bold">Most common weakness:</span> {DIMS.find(d => d.key === dash.common_weakness_dimension)?.label || dash.common_weakness_dimension} is the lowest dimension for the most students.
                  </div>
                )}

                {dash?.class_analytics && dash.total_submissions > 0 && (() => {
                  const ca = dash.class_analytics;
                  const maxGrowth = Math.max(1, ...(ca.common_growth_areas || []).map(g => g.weight));
                  return (
                    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
                      <h2 className="font-bold text-[#222] mb-4">Class Analytics</h2>
                      <div className="grid grid-cols-3 gap-3 mb-6">
                        {[['Avg pace', ca.avg_wpm != null ? `${ca.avg_wpm} wpm` : '—'],
                          ['Avg filler', ca.avg_filler_pct != null ? `${ca.avg_filler_pct}%` : '—'],
                          ['Avg weak words', ca.avg_weak_pct != null ? `${ca.avg_weak_pct}%` : '—']].map(([l, v]) => (
                          <div key={l} className="bg-[#F0F6FB] rounded-xl p-4 text-center">
                            <p className="text-xl font-extrabold text-[#222]">{v}</p>
                            <p className="text-[11px] text-gray-500 font-semibold mt-0.5">{l}</p>
                          </div>
                        ))}
                      </div>
                      {(ca.common_growth_areas || []).length > 0 && (
                        <div className="mb-6">
                          <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3">Most common growth areas</h3>
                          <div className="space-y-2">
                            {ca.common_growth_areas.map((g) => (
                              <div key={g.label} className="flex items-center gap-3">
                                <span className="text-sm text-gray-700 w-44 shrink-0">{g.label}</span>
                                <div className="flex-1 h-2.5 bg-gray-100 rounded-full overflow-hidden">
                                  <div className="h-full bg-[#FA6C43] rounded-full" style={{ width: `${(g.weight / maxGrowth) * 100}%` }} />
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {(ca.tone_distribution || []).length > 0 && (
                        <div className="mb-6">
                          <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3">Tone across the class</h3>
                          <div className="flex flex-wrap gap-2">
                            {ca.tone_distribution.map((t) => (
                              <span key={t.label} className="text-sm bg-[#EEF2FF] text-[#4f46e5] font-semibold px-3 py-1 rounded-full">{t.label} <span className="opacity-60">×{t.count}</span></span>
                            ))}
                          </div>
                        </div>
                      )}
                      {(ca.common_words || []).length > 0 && (
                        <div>
                          <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3">Most common filler / weak words</h3>
                          <div className="flex flex-wrap gap-2">
                            {ca.common_words.map((w) => (
                              <span key={w.word} className="text-sm bg-gray-100 text-gray-700 px-3 py-1 rounded-full"><b>{w.word}</b> <span className="text-gray-400">{w.students} student{w.students === 1 ? '' : 's'}</span></span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </>
            )}

            {/* Analysis result view (when an analysis is selected) */}
            {viewId && activeAnalysis?.class_summary && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="font-bold text-[#222]">AI Analysis Results</h2>
                  <span className="text-2xl font-extrabold" style={{ color: color(activeAnalysis.class_summary.avg_score) }}>{activeAnalysis.class_summary.avg_score ?? '—'}</span>
                </div>
                {activeAnalysis.grading_prompt && (
                  <p className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2 mb-4 italic">"{activeAnalysis.grading_prompt}"</p>
                )}
                {activeAnalysis.class_summary.overall_insight && (
                  <p className="text-sm text-gray-700 mb-4">{activeAnalysis.class_summary.overall_insight}</p>
                )}
                <div className="grid sm:grid-cols-2 gap-4">
                  {(activeAnalysis.class_summary.common_strengths || []).length > 0 && (
                    <div>
                      <p className="text-[11px] font-bold uppercase text-green-600 mb-2">Common Strengths</p>
                      <ul className="list-disc ml-5 text-sm text-gray-700 space-y-1">
                        {activeAnalysis.class_summary.common_strengths.map((s, i) => <li key={i}>{s}</li>)}
                      </ul>
                    </div>
                  )}
                  {(activeAnalysis.class_summary.common_weaknesses || []).length > 0 && (
                    <div>
                      <p className="text-[11px] font-bold uppercase text-amber-600 mb-2">Common Weaknesses</p>
                      <ul className="list-disc ml-5 text-sm text-gray-700 space-y-1">
                        {activeAnalysis.class_summary.common_weaknesses.map((s, i) => <li key={i}>{s}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Per-student table */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="flex items-center gap-4 py-2.5 px-4 bg-gray-50 border-b border-gray-100 text-[11px] font-bold uppercase tracking-wider text-gray-400">
                <span className="w-4" />
                <span className="flex-1">Student</span>
                {!analysisStudentMap && (
                  <span className="hidden sm:flex gap-3">{DIMS.map(d => <span key={d.key} className="w-14 text-center">{d.label.slice(0, 4)}</span>)}</span>
                )}
                <span className="w-12 text-right">{analysisStudentMap ? 'Score' : 'Overall'}</span>
              </div>
              {subs.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-10">No submissions yet. Share the upload link above.</p>
              ) : subs.map((s) => (
                <StudentRow
                  key={s.id}
                  sub={s}
                  configId={configId}
                  onRescored={loadDash}
                  analysisData={analysisStudentMap ? (analysisStudentMap[s.id] || null) : null}
                />
              ))}
            </div>

            {/* Prompt form */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
              <h2 className="font-bold text-[#222] mb-1">AI Grading Analysis</h2>
              <p className="text-xs text-gray-500 mb-4">Describe what you want the AI to evaluate. Results will update the student cards above.</p>
              <textarea
                rows="4"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                disabled={running}
                className="w-full p-3 border border-gray-200 rounded-xl text-sm focus:border-[#FA6C43] outline-none resize-none disabled:opacity-50"
                placeholder="E.g. 'Grade students on: (1) clarity of their problem statement, (2) strength of their proposed solution, (3) use of concrete examples. A 90+ means all three were exceptional.'"
              />
              <div className="flex items-center justify-between mt-3">
                <div className="text-sm text-gray-500">
                  {running && (
                    <span className="flex items-center gap-2"><FaSpinner className="animate-spin text-[#FA6C43]" /> {jobProgress}</span>
                  )}
                  {jobError && <span className="text-red-500">{jobError}</span>}
                </div>
                <button
                  onClick={startAnalysis}
                  disabled={running || !prompt.trim()}
                  className="px-5 py-2.5 bg-[#FA6C43] text-white text-sm font-bold rounded-xl disabled:opacity-40 hover:opacity-90 transition-opacity"
                >
                  {running ? 'Running…' : 'Run Analysis'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
