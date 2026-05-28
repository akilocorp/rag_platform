import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  FaArrowLeft, FaDownload, FaSpinner, FaChevronDown, FaChevronUp,
  FaUser, FaBrain, FaCheckCircle, FaArrowRight, FaChartBar, FaPlus,
} from 'react-icons/fa';
import { marked } from 'marked';
import apiClient from '../api/apiClient';

marked.use({ gfm: true, breaks: true });

// ─── helpers ────────────────────────────────────────────────────────────────

const chunkArray = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

const formatDate = (iso) => {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  catch { return iso; }
};

const extractText = (msg) => {
  const content = msg?.data?.content ?? msg?.content ?? '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(b => b?.text ?? '').join(' ');
  return '';
};

const extractRole = (msg) => msg?.type === 'human' ? 'Student' : 'AI';

const stripMarkdown = (text) =>
  text.replace(/^#{1,6}\s+/gm, '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1')
    .replace(/__(.+?)__/g, '$1').replace(/_(.+?)_/g, '$1').replace(/`{3}[\s\S]*?`{3}/g, '')
    .replace(/`(.+?)`/g, '$1').replace(/\[(.+?)\]\(.+?\)/g, '$1')
    .replace(/^[-*+]\s+/gm, '').replace(/^\d+\.\s+/gm, '').replace(/^>\s+/gm, '').trim();

const scoreColor = (score) => {
  if (score >= 85) return { bg: 'bg-green-100', text: 'text-green-700', border: 'border-green-200', bar: 'bg-green-400' };
  if (score >= 70) return { bg: 'bg-blue-100', text: 'text-blue-700', border: 'border-blue-200', bar: 'bg-blue-400' };
  if (score >= 50) return { bg: 'bg-amber-100', text: 'text-amber-700', border: 'border-amber-200', bar: 'bg-amber-400' };
  return { bg: 'bg-red-100', text: 'text-red-600', border: 'border-red-200', bar: 'bg-red-400' };
};

const MEDALS = ['🥇', '🥈', '🥉'];

// ─── sub-components ─────────────────────────────────────────────────────────

const ScoreBadge = ({ score, large }) =>
  score === 0 ? (
    <span className={`${large ? 'text-2xl font-black' : 'text-sm font-bold'} inline-flex items-center px-2.5 py-0.5 rounded-lg border bg-gray-100 text-gray-400 border-gray-200`}>
      —
    </span>
  ) : (
    <span className={`${large ? 'text-2xl font-black px-3 py-1' : 'text-sm font-bold px-2.5 py-0.5'} inline-flex items-center rounded-lg border ${scoreColor(score).bg} ${scoreColor(score).text} ${scoreColor(score).border}`}>
      {score}
    </span>
  );

const TranscriptView = ({ sessionId }) => {
  const [messages, setMessages] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    apiClient.get(`/history/${sessionId}`)
      .then(r => setMessages(r.data.history || []))
      .catch(() => setMessages([]))
      .finally(() => setLoading(false));
  }, [sessionId]);
  if (loading) return <div className="flex justify-center py-6"><FaSpinner className="animate-spin text-[#FA6C43] text-xl" /></div>;
  if (!messages.length) return <p className="text-sm text-gray-400 py-4 text-center">No messages found.</p>;
  return (
    <div className="space-y-3 py-4 max-h-80 overflow-y-auto pr-2">
      {messages.map((msg, i) => {
        const role = extractRole(msg); const text = extractText(msg);
        if (!text) return null;
        return (
          <div key={i} className={`flex gap-3 ${role === 'AI' ? 'flex-row-reverse' : ''}`}>
            <div className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${role === 'AI' ? 'bg-[#FA6C43] text-white' : 'bg-gray-200 text-gray-600'}`}>
              {role === 'AI' ? 'AI' : <FaUser className="text-[10px]" />}
            </div>
            <div className={`max-w-[80%] px-4 py-2.5 rounded-2xl text-sm ${role === 'AI' ? 'bg-[#FA6C43]/10 text-gray-800 rounded-tr-sm' : 'bg-gray-100 text-gray-800 rounded-tl-sm'}`}>
              {role === 'AI'
                ? <div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: marked.parse(text) }} />
                : text}
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ─── Analytics tab ───────────────────────────────────────────────────────────

const DistributionBar = ({ label, count, total, colorClass }) => (
  <div className="flex items-center gap-3">
    <span className="text-xs text-gray-500 w-16 text-right">{label}</span>
    <div className="flex-1 h-2.5 bg-gray-100 rounded-full overflow-hidden">
      <div className={`h-full rounded-full ${colorClass} transition-all duration-500`} style={{ width: total ? `${(count / total) * 100}%` : '0%' }} />
    </div>
    <span className="text-xs font-bold text-gray-600 w-5">{count}</span>
  </div>
);

const TopPerformerCard = ({ student, rank }) => {
  const c = scoreColor(student.score);
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5 flex flex-col gap-3 hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between">
        <span className="text-2xl">{MEDALS[rank] || '🏅'}</span>
        <ScoreBadge score={student.score} />
      </div>
      <div>
        <p className="font-bold text-[#222] text-sm truncate">{student.display_name}</p>
        <p className="text-xs text-gray-500 mt-1 line-clamp-2">{student.summary}</p>
      </div>
      {student.strengths?.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {student.strengths.slice(0, 2).map((s, i) => (
            <span key={i} className="text-[11px] px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-100">{s}</span>
          ))}
        </div>
      )}
    </div>
  );
};

const StudentRow = ({ student, rank, expanded, onToggle }) => {
  const c = scoreColor(student.score);
  return (
    <div className="border-b border-gray-50 last:border-b-0">
      <button
        className="w-full flex items-start gap-4 px-6 py-4 text-left hover:bg-gray-50/80 transition-colors"
        onClick={onToggle}
      >
        <span className="text-sm text-gray-400 font-bold w-5 pt-0.5 flex-shrink-0">{rank}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="font-semibold text-[#222] text-sm truncate max-w-[200px]">{student.display_name}</span>
            <ScoreBadge score={student.score} />
            {student.message_count > 0 && (
              <span className="text-[11px] text-gray-400">{student.message_count} msgs</span>
            )}
          </div>
          <p className="text-sm text-gray-500 mt-1 line-clamp-2">{student.summary}</p>
        </div>
        <span className="text-gray-400 flex-shrink-0 mt-1">
          {expanded ? <FaChevronUp className="text-xs" /> : <FaChevronDown className="text-xs" />}
        </span>
      </button>

      {expanded && (
        <div className="px-6 pb-5 grid grid-cols-1 sm:grid-cols-2 gap-4 bg-gray-50/40 border-t border-gray-100">
          {student.strengths?.length > 0 && (
            <div className="pt-3">
              <p className="text-[11px] font-bold uppercase tracking-wider text-green-600 mb-2">Strengths</p>
              <ul className="space-y-1.5">
                {student.strengths.map((s, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                    <FaCheckCircle className="text-green-500 text-xs mt-0.5 flex-shrink-0" />
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {student.improvements?.length > 0 && (
            <div className="pt-3">
              <p className="text-[11px] font-bold uppercase tracking-wider text-amber-600 mb-2">Areas to Improve</p>
              <ul className="space-y-1.5">
                {student.improvements.map((s, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                    <FaArrowRight className="text-amber-500 text-xs mt-0.5 flex-shrink-0" />
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const GRADING_TEMPLATES = [
  {
    id: 'hr_interview',
    label: 'HR Interview',
    emoji: '💼',
    criteria: 'Score based on: (1) Use of STAR method (Situation, Task, Action, Result) in behavioral answers, (2) Professional tone and clarity, (3) Relevance of examples to the role, (4) Confidence and composure in handling tough questions.',
  },
  {
    id: 'participation',
    label: 'Participation',
    emoji: '🙋',
    criteria: 'Score based on: (1) Active engagement with the AI — asking follow-up questions, clarifying, responding fully, (2) Number and depth of messages, (3) Staying on-topic, (4) Demonstrating curiosity and initiative.',
  },
  {
    id: 'critical_thinking',
    label: 'Critical Thinking',
    emoji: '🧠',
    criteria: 'Score based on: (1) Quality of reasoning and logical arguments, (2) Ability to challenge assumptions or explore multiple perspectives, (3) Use of evidence or examples to support claims, (4) Depth of analysis beyond surface-level answers.',
  },
  {
    id: 'sales_negotiation',
    label: 'Sales & Negotiation',
    emoji: '🤝',
    criteria: 'Score based on: (1) Ability to identify customer pain points and tailor the pitch, (2) Handling objections with concrete, value-focused responses, (3) Persistence and adaptability, (4) Moving toward a close or agreement.',
  },
  {
    id: 'presentation',
    label: 'Presentation Skills',
    emoji: '🎤',
    criteria: 'Score based on: (1) Clear structure (intro, body, conclusion), (2) Concise and confident language, (3) Ability to explain complex ideas simply, (4) Responsiveness to questions from the audience (AI).',
  },
  {
    id: 'socratic',
    label: 'Socratic Dialogue',
    emoji: '🏛️',
    criteria: 'Score based on: (1) Depth of engagement with guiding questions, (2) Evidence of conceptual understanding developed through dialogue, (3) Intellectual honesty — acknowledging gaps and building on them, (4) Quality of questions the student asks back.',
  },
];

const AnalyticsTab = ({ sessions, configId, systemPrompt, configName }) => {
  const [analysis, setAnalysis] = useState(null);
  const [loadingSaved, setLoadingSaved] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState('');
  const [error, setError] = useState('');
  const [expandedStudent, setExpandedStudent] = useState(null);
  const [gradingCriteria, setGradingCriteria] = useState('');
  const [activeTemplate, setActiveTemplate] = useState(null);

  useEffect(() => {
    apiClient.get(`/config/${configId}/analysis`)
      .then(res => setAnalysis(res.data))
      .catch(() => {})
      .finally(() => setLoadingSaved(false));
  }, [configId]);

// ─── Sidebar helpers ─────────────────────────────────────────────────────────

const fmtTs = (ts) => {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const SidebarItem = ({ a, isViewing, isComparing, pickable, onSelect }) => {
  const c = scoreColor(a.avg_score || 0);
  return (
    <button
      onClick={onSelect}
      className={`w-full text-left px-3 py-3 rounded-xl border transition-all ${
        isViewing   ? 'border-[#FA6C43] bg-[#FA6C43]/5' :
        isComparing ? 'border-blue-400 bg-blue-50' :
        pickable    ? 'border-dashed border-blue-300 hover:border-blue-500 hover:bg-blue-50/50 cursor-pointer' :
                      'border-gray-200 bg-white hover:border-gray-300'
      }`}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] font-bold text-gray-400">{fmtTs(a.analyzed_at)}</span>
        {a.avg_score != null && (
          <span className={`text-xs font-black px-1.5 py-0.5 rounded-lg ${c.bg} ${c.text}`}>{a.avg_score}</span>
        )}
      </div>
      <p className="text-[11px] text-gray-400 line-clamp-2 leading-relaxed">
        {a.grading_criteria ? a.grading_criteria.slice(0, 60) + (a.grading_criteria.length > 60 ? '…' : '') : 'No custom criteria'}
      </p>
      {isComparing && <span className="text-[10px] font-bold text-blue-500 mt-1 block">Comparing</span>}
      {pickable && <span className="text-[10px] font-bold text-blue-400 mt-1 block">Click to compare →</span>}
    </button>
  );
};

// ─── Compare view ─────────────────────────────────────────────────────────────

const CompareView = ({ data1, data2, meta1, meta2 }) => {
  const s1Map = Object.fromEntries((data1.students || []).map(s => [s.session_id, s]));
  const s2Map = Object.fromEntries((data2.students || []).map(s => [s.session_id, s]));
  const allSids = [...new Map([...(data1.students || []), ...(data2.students || [])].map(s => [s.session_id, s])).keys()];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4">
        {[{ data: data1, meta: meta1, accent: '[#FA6C43]', accentBg: '[#FA6C43]/10', label: 'Analysis A' },
          { data: data2, meta: meta2, accent: 'blue-500',  accentBg: 'blue-50',       label: 'Analysis B' }]
          .map(({ data, meta, accent, accentBg, label }, i) => {
            const cs = data.class_summary || {};
            const n = (data.students || []).length;
            const buckets = [
              { label: '85–100', count: (data.students || []).filter(s => s.score >= 85).length, color: 'bg-green-400' },
              { label: '70–84', count: (data.students || []).filter(s => s.score >= 70 && s.score < 85).length, color: 'bg-blue-400' },
              { label: '50–69', count: (data.students || []).filter(s => s.score >= 50 && s.score < 70).length, color: 'bg-amber-400' },
              { label: '0–49',  count: (data.students || []).filter(s => s.score > 0 && s.score < 50).length,  color: 'bg-red-400' },
            ];
            return (
              <div key={i} className={`bg-white rounded-[2rem] border-2 shadow-sm p-5 ${i === 0 ? 'border-[#FA6C43]/40' : 'border-blue-300/60'}`}>
                <p className={`text-[10px] font-bold uppercase tracking-wider mb-3 ${i === 0 ? 'text-[#FA6C43]' : 'text-blue-500'}`}>
                  {label} · {fmtTs(meta?.analyzed_at)}
                </p>
                <div className="flex items-center gap-4 mb-3">
                  <div className={`flex flex-col items-center rounded-xl p-3 ${i === 0 ? 'bg-[#FA6C43]/10' : 'bg-blue-50'}`}>
                    <span className="text-[10px] font-bold text-gray-400 uppercase">Avg</span>
                    <span className={`text-3xl font-black ${scoreColor(cs.avg_score).text}`}>{cs.avg_score ?? '—'}</span>
                  </div>
                  <div className="flex-1 space-y-1.5">
                    {buckets.map(b => <DistributionBar key={b.label} label={b.label} count={b.count} total={n} colorClass={b.color} />)}
                  </div>
                </div>
                {meta?.grading_criteria && (
                  <p className="text-[11px] text-gray-400 italic line-clamp-2">{meta.grading_criteria}</p>
                )}
              </div>
            );
          })}
      </div>

      <div className="bg-white rounded-[2rem] border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-6 py-3 border-b border-gray-100 bg-gray-50 text-sm font-bold text-[#222]">Student Scores</div>
        <div className="grid grid-cols-[1fr_72px_72px_56px] gap-3 px-6 py-2 border-b border-gray-100 text-[11px] font-bold text-gray-400 uppercase tracking-wider">
          <span>Student</span>
          <span className="text-center text-[#FA6C43]">A</span>
          <span className="text-center text-blue-500">B</span>
          <span className="text-center">Δ</span>
        </div>
        {allSids.map(sid => {
          const s1 = s1Map[sid]; const s2 = s2Map[sid];
          const name = (s1 || s2)?.display_name || sid.slice(0, 8);
          const sc1 = s1?.score ?? null; const sc2 = s2?.score ?? null;
          const diff = sc1 != null && sc2 != null ? sc2 - sc1 : null;
          return (
            <div key={sid} className="grid grid-cols-[1fr_72px_72px_56px] gap-3 px-6 py-3 border-b border-gray-50 last:border-0 items-center">
              <span className="text-sm font-semibold text-[#222] truncate">{name}</span>
              <span className="flex justify-center">{sc1 != null ? <ScoreBadge score={sc1} /> : <span className="text-gray-300 text-sm">—</span>}</span>
              <span className="flex justify-center">{sc2 != null ? <ScoreBadge score={sc2} /> : <span className="text-gray-300 text-sm">—</span>}</span>
              <span className={`text-center text-sm font-bold ${diff > 0 ? 'text-green-500' : diff < 0 ? 'text-red-500' : 'text-gray-400'}`}>
                {diff != null ? (diff > 0 ? `+${diff}` : `${diff}`) : '—'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ─── Analytics tab ────────────────────────────────────────────────────────────

const AnalyticsTab = ({ sessions, configId, systemPrompt, configName }) => {
  const [analyses, setAnalyses] = useState([]);
  const [loadingList, setLoadingList] = useState(true);
  const [loaded, setLoaded] = useState({});
  const loadedRef = useRef({});
  const [viewId, setViewId] = useState(null);
  const [compareId, setCompareId] = useState(null);
  const [pickingCompare, setPickingCompare] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState('');
  const [error, setError] = useState('');
  const [expandedStudent, setExpandedStudent] = useState(null);
  const [gradingCriteria, setGradingCriteria] = useState('');
  const [activeTemplate, setActiveTemplate] = useState(null);

  const refreshList = useCallback(async () => {
    try {
      const res = await apiClient.get(`/config/${configId}/analyses`);
      const list = res.data.analyses || [];
      setAnalyses(list);
      return list;
    } catch { return []; }
  }, [configId]);

  const loadDetail = useCallback(async (id) => {
    if (loadedRef.current[id]) return loadedRef.current[id];
    const res = await apiClient.get(`/config/${configId}/analyses/${id}`);
    loadedRef.current[id] = res.data;
    setLoaded(prev => ({ ...prev, [id]: res.data }));
    return res.data;
  }, [configId]);

  useEffect(() => {
    refreshList().then(list => {
      if (list.length > 0) {
        const id = list[0]._id;
        setViewId(id);
        loadDetail(id).catch(() => {});
      } else {
        setShowForm(true);
      }
      setLoadingList(false);
    });
  }, [configId]);  // eslint-disable-line

  const selectView = async (id) => {
    try { await loadDetail(id); } catch {}
    setViewId(id); setCompareId(null); setPickingCompare(false); setShowForm(false); setExpandedStudent(null);
  };

  const pickForCompare = async (id) => {
    try { await loadDetail(id); } catch {}
    setCompareId(id); setPickingCompare(false);
  };

  const handleAnalyze = async () => {
    setAnalyzing(true); setError(''); setAnalysisProgress('Starting…');
    try {
      const { data: { job_id } } = await apiClient.post(`/config/${configId}/analyze`, { grading_criteria: gradingCriteria });
      while (true) {
        await new Promise(r => setTimeout(r, 3000));
        const { data: job } = await apiClient.get(`/config/${configId}/analyze/${job_id}`);
        if (job.progress) setAnalysisProgress(job.progress);
        if (job.status === 'done') {
          const list = await refreshList();
          if (list.length > 0) {
            const id = list[0]._id;
            const enriched = { ...job.result, analyzed_at: Date.now() / 1000, grading_criteria: gradingCriteria };
            loadedRef.current[id] = enriched;
            setLoaded(prev => ({ ...prev, [id]: enriched }));
            setViewId(id); setCompareId(null); setShowForm(false);
          }
          break;
        }
        if (job.status === 'error') { setError(job.error || 'Analysis failed.'); break; }
      }
    } catch (e) {
      setError(e.response?.data?.error || 'Analysis failed. Please try again.');
    } finally { setAnalyzing(false); setAnalysisProgress(''); }
  };

  const applyTemplate = (t) => { setGradingCriteria(t.criteria); setActiveTemplate(t.id); };

  if (loadingList) return (
    <div className="flex flex-col items-center justify-center h-64 bg-white rounded-[2rem] border border-gray-100">
      <FaSpinner className="animate-spin text-3xl text-[#FA6C43] mb-3" />
      <p className="text-gray-500 text-sm font-medium">Loading analysis history…</p>
    </div>
  );

  if (sessions.length === 0) return (
    <div className="flex flex-col items-center justify-center h-64 bg-white rounded-[2rem] border border-gray-100">
      <div className="text-5xl mb-4">📭</div>
      <h3 className="text-xl font-bold text-[#222] mb-2">No sessions yet</h3>
      <p className="text-gray-500 text-sm">Students haven't used this assistant yet.</p>
    </div>
  );

  const viewData = viewId ? loaded[viewId] : null;
  const compareData = compareId ? loaded[compareId] : null;
  const viewMeta = analyses.find(a => a._id === viewId);
  const compareMeta = analyses.find(a => a._id === compareId);

  const renderMain = () => {
    if (analyzing) return (
      <div className="bg-white rounded-[2rem] border border-gray-100 shadow-sm p-16 flex flex-col items-center gap-4">
        <FaSpinner className="animate-spin text-4xl text-[#FA6C43]" />
        <p className="font-semibold text-[#222]">Analyzing {sessions.length} sessions…</p>
        <p className="text-sm text-gray-400">{analysisProgress}</p>
      </div>
    );

    if (showForm) return (
      <div className="bg-white rounded-[2rem] border border-gray-100 shadow-sm p-8 flex flex-col gap-7">
        <div className="flex flex-col items-center text-center gap-3">
          <div className="w-16 h-16 bg-[#F9D0C4]/40 rounded-2xl flex items-center justify-center">
            <FaBrain className="text-3xl text-[#FA6C43]" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-[#222] mb-1">New Analysis</h3>
            <p className="text-gray-500 text-sm">Score each student with a class summary — tailored to your criteria.</p>
          </div>
          <div className="text-xs text-gray-400">{sessions.length} session{sessions.length !== 1 ? 's' : ''} · est. {Math.ceil(sessions.length * 1.5)}–{sessions.length * 3}s</div>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3">Quick Templates</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {GRADING_TEMPLATES.map(t => (
              <button key={t.id}
                onClick={() => activeTemplate === t.id ? (setActiveTemplate(null), setGradingCriteria('')) : applyTemplate(t)}
                className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-sm font-semibold transition-all text-left ${activeTemplate === t.id ? 'bg-[#FA6C43]/10 border-[#FA6C43]/40 text-[#FA6C43]' : 'bg-gray-50 border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-white'}`}>
                <span>{t.emoji}</span> {t.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-2 block">
            Grading Criteria <span className="normal-case font-normal text-gray-400">(optional)</span>
          </label>
          <textarea value={gradingCriteria}
            onChange={e => { setGradingCriteria(e.target.value); setActiveTemplate(null); }}
            placeholder="Describe how you want the AI to evaluate students…"
            rows={4}
            className="w-full text-sm border border-gray-200 rounded-xl px-4 py-3 text-gray-700 placeholder-gray-300 focus:outline-none focus:border-[#FA6C43] focus:ring-1 focus:ring-[#FA6C43]/30 resize-none transition-colors"
          />
        </div>
        {error && <p className="text-sm text-red-500 text-center">{error}</p>}
        <button onClick={handleAnalyze}
          className="px-8 py-3 bg-[#FA6C43] hover:bg-[#E55B34] text-white font-bold rounded-xl transition-all shadow-sm active:scale-[0.98] flex items-center justify-center gap-2 w-full">
          <FaBrain className="text-sm" /> Generate Analysis
        </button>
      </div>
    );

    if (viewData && compareData) return (
      <CompareView data1={viewData} data2={compareData} meta1={viewMeta} meta2={compareMeta} />
    );

    if (viewData) {
      const { class_summary, top_performers, students } = viewData;
      const buckets = [
        { label: '85–100', count: students.filter(s => s.score >= 85).length, color: 'bg-green-400' },
        { label: '70–84', count: students.filter(s => s.score >= 70 && s.score < 85).length, color: 'bg-blue-400' },
        { label: '50–69', count: students.filter(s => s.score >= 50 && s.score < 70).length, color: 'bg-amber-400' },
        { label: '0–49',  count: students.filter(s => s.score > 0 && s.score < 50).length,  color: 'bg-red-400' },
      ];
      return (
        <div className="space-y-8">
          {pickingCompare && (
            <div className="bg-blue-50 border border-blue-200 rounded-2xl px-5 py-3 flex items-center justify-between">
              <span className="text-sm font-semibold text-blue-700">Select an analysis from the sidebar to compare</span>
              <button onClick={() => setPickingCompare(false)} className="text-xs text-blue-500 font-bold hover:underline">Cancel</button>
            </div>
          )}
          <div className="bg-white rounded-[2rem] border border-gray-100 shadow-sm p-6 lg:p-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-bold text-[#222]">Class Overview</h2>
              {analyses.length > 1 && !pickingCompare && (
                <button onClick={() => setPickingCompare(true)}
                  className="text-xs font-bold text-gray-400 hover:text-blue-500 transition-colors">
                  Compare with another →
                </button>
              )}
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className="flex flex-col items-center justify-center bg-[#F0F6FB] rounded-2xl p-6 gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400">Class Average</span>
                <span className={`text-6xl font-black ${scoreColor(class_summary.avg_score).text}`}>{class_summary.avg_score}</span>
                <span className="text-gray-400 text-sm font-medium">/ 100</span>
                <span className="text-xs text-gray-400 mt-1">{class_summary.total_sessions} session{class_summary.total_sessions !== 1 ? 's' : ''}</span>
              </div>
              <div className="flex flex-col justify-center gap-3 lg:col-span-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-1">Score Distribution</span>
                {buckets.map(b => <DistributionBar key={b.label} label={b.label} count={b.count} total={students.length} colorClass={b.color} />)}
              </div>
            </div>
            <div className="mt-6 pt-6 border-t border-gray-100">
              <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-2">Class Insight</p>
              <p className="text-sm text-gray-700 leading-relaxed">{class_summary.overall_insight}</p>
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                {class_summary.common_strengths?.length > 0 && (
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-wider text-green-600 mb-2">Common Strengths</p>
                    <ul className="space-y-1">
                      {class_summary.common_strengths.map((s, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                          <FaCheckCircle className="text-green-500 text-xs mt-0.5 flex-shrink-0" /> {s}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {class_summary.common_weaknesses?.length > 0 && (
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-wider text-amber-600 mb-2">Common Areas to Improve</p>
                    <ul className="space-y-1">
                      {class_summary.common_weaknesses.map((s, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                          <FaArrowRight className="text-amber-500 text-xs mt-0.5 flex-shrink-0" /> {s}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          </div>

          {top_performers?.length > 0 && (
            <div>
              <h2 className="text-lg font-bold text-[#222] mb-4">Top Performers</h2>
              <div className={`grid gap-4 ${top_performers.length === 1 ? 'grid-cols-1 max-w-sm' : top_performers.length === 2 ? 'grid-cols-2 max-w-lg' : 'grid-cols-1 sm:grid-cols-3'}`}>
                {top_performers.map((s, i) => <TopPerformerCard key={s.session_id} student={s} rank={i} />)}
              </div>
            </div>
          )}

          <div>
            <h2 className="text-lg font-bold text-[#222] mb-4">All Students</h2>
            <div className="bg-white rounded-[2rem] border border-gray-100 shadow-sm overflow-hidden">
              <div className="grid grid-cols-[24px_1fr_80px] gap-4 px-6 py-3 border-b border-gray-100 bg-gray-50 text-[11px] font-bold text-gray-400 uppercase tracking-wider">
                <span>#</span><span>Student</span><span>Score</span>
              </div>
              {students.map((s, i) => (
                <StudentRow key={s.session_id} student={s} rank={i + 1}
                  expanded={expandedStudent === s.session_id}
                  onToggle={() => setExpandedStudent(expandedStudent === s.session_id ? null : s.session_id)} />
              ))}
            </div>
          </div>
        </div>
      );
    }

    return null;
  };

  return (
    <div className="flex gap-5 items-start">
      {/* Sidebar */}
      <div className="w-52 shrink-0 space-y-2">
        <button
          onClick={() => { setShowForm(true); setViewId(null); setCompareId(null); setPickingCompare(false); setError(''); setGradingCriteria(''); setActiveTemplate(null); }}
          className="w-full flex items-center justify-center gap-2 px-3 py-2.5 bg-[#FA6C43] hover:bg-[#E55B34] text-white rounded-xl font-bold text-sm transition-colors">
          <FaPlus className="text-xs" /> New Analysis
        </button>
        {analyses.length > 0 && (
          <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 px-1 pt-2">History</p>
        )}
        {analyses.map(a => (
          <SidebarItem key={a._id} a={a}
            isViewing={!showForm && viewId === a._id}
            isComparing={compareId === a._id}
            pickable={pickingCompare && viewId !== a._id}
            onSelect={() => {
              if (pickingCompare && viewId !== a._id) pickForCompare(a._id);
              else if (!pickingCompare) selectView(a._id);
            }}
          />
        ))}
      </div>

      {/* Main content */}
      <div className="flex-1 min-w-0">
        {renderMain()}
      </div>
    </div>
  );
};

// ─── Sessions tab (existing) ─────────────────────────────────────────────────

const SessionsTab = ({ sessions }) => {
  const [expandedId, setExpandedId] = useState(null);
  const labeled = (() => {
    let c = 1;
    return sessions.map(s => ({ ...s, displayName: s.student_label || s.user_email || (s.qualtrics_id ? `Q:${s.qualtrics_id}` : null) || `Session ${s.session_id?.slice(0,8)}` }));
  })();

  if (!sessions.length) return (
    <div className="flex flex-col items-center justify-center h-64 bg-white rounded-[2rem] border border-gray-100">
      <div className="text-5xl mb-4">📭</div>
      <h3 className="text-xl font-bold text-[#222] mb-2">No sessions yet</h3>
    </div>
  );

  return (
    <div className="bg-white rounded-[2rem] border border-gray-100 shadow-sm overflow-hidden">
      <div className="grid grid-cols-[1fr_180px_70px_1fr_40px] gap-4 px-6 py-3 border-b border-gray-100 bg-gray-50 text-[11px] font-bold text-gray-400 uppercase tracking-wider">
        <span>Student</span><span>Date</span><span>Msgs</span><span>Title</span><span />
      </div>
      {labeled.map(s => (
        <div key={s.session_id} className="border-b border-gray-50 last:border-b-0">
          <button
            className="w-full grid grid-cols-[1fr_180px_70px_1fr_40px] gap-4 px-6 py-4 text-left hover:bg-gray-50 transition-colors items-center"
            onClick={() => setExpandedId(expandedId === s.session_id ? null : s.session_id)}
          >
            <span className="text-sm font-semibold text-[#222] truncate">{s.displayName}</span>
            <span className="text-sm text-gray-500">{formatDate(s.timestamp)}</span>
            <span className="text-sm text-gray-500">{s.message_count}</span>
            <span className="text-sm text-gray-400 truncate">{s.title || '—'}</span>
            <span className="text-gray-400 flex justify-end">
              {expandedId === s.session_id ? <FaChevronUp className="text-xs" /> : <FaChevronDown className="text-xs" />}
            </span>
          </button>
          {expandedId === s.session_id && (
            <div className="px-6 pb-4 border-t border-gray-100 bg-gray-50/50">
              <TranscriptView sessionId={s.session_id} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

// ─── Main Page ───────────────────────────────────────────────────────────────

const ResponsesPage = () => {
  const { configId } = useParams();
  const navigate = useNavigate();
  const [sessions, setSessions] = useState([]);
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('analytics');
  const [csvLoading, setCsvLoading] = useState(false);
  const [csvProgress, setCsvProgress] = useState('');

  useEffect(() => {
    Promise.all([
      apiClient.get(`/config/${configId}/sessions`),
      apiClient.get(`/config/${configId}`).catch(() => ({ data: null })),
    ]).then(([sessRes, cfgRes]) => {
      setSessions(sessRes.data.sessions || []);
      setConfig(cfgRes.data?.config || null);
    }).catch(err => {
      if (err.response?.status === 403) navigate('/config_list');
    }).finally(() => setLoading(false));
  }, [configId, navigate]);

  const handleExportCsv = async () => {
    const labeled = (() => { let c = 1; return sessions.map(s => ({ ...s, displayName: s.student_label || s.user_email || (s.qualtrics_id ? `Q:${s.qualtrics_id}` : null) || `Session ${s.session_id?.slice(0,8)}` })); })();
    setCsvLoading(true); setCsvProgress('Fetching transcripts…');
    try {
      const chunks = chunkArray(labeled, 10);
      const allRows = [];
      let done = 0;
      for (const chunk of chunks) {
        const results = await Promise.all(chunk.map(s => apiClient.get(`/history/${s.session_id}`).then(r => r.data.history || []).catch(() => [])));
        chunk.forEach((s, i) => {
          const transcript = results[i].map(m => {
            const t = extractText(m); if (!t) return null;
            const clean = extractRole(m) === 'AI' ? stripMarkdown(t) : t;
            return `[${extractRole(m)}]: ${clean}`;
          }).filter(Boolean).join('\n');
          allRows.push([s.session_id, s.displayName, s.timestamp, s.message_count, s.title || '', transcript]);
        });
        done += chunk.length;
        setCsvProgress(`Fetching transcripts… ${done}/${labeled.length}`);
      }
      const escape = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const csv = [['Session ID', 'Student', 'Date', 'Messages', 'Title', 'Transcript'], ...allRows].map(row => row.map(escape).join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `${(config?.bot_name || 'responses').replace(/\s+/g, '_')}_responses.csv`; a.click();
      URL.revokeObjectURL(url);
    } finally { setCsvLoading(false); setCsvProgress(''); }
  };

  const configName = config?.bot_name || 'Assistant';
  const systemPrompt = config?.instructions || '';
  const uniqueStudents = new Set(sessions.map(s => s.student_label || s.user_email || s.qualtrics_id || s.session_id)).size;

  return (
    <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }} className="min-h-screen bg-[#F0F6FB]">

      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 lg:px-10 py-4 flex items-center gap-4">
        <button onClick={() => navigate('/config_list')} className="p-2 rounded-xl hover:bg-gray-100 text-gray-500 transition-colors">
          <FaArrowLeft />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold text-[#222] truncate">{configName}</h1>
          {!loading && (
            <p className="text-xs text-gray-400 font-medium mt-0.5">
              {sessions.length} session{sessions.length !== 1 ? 's' : ''} · {uniqueStudents} identified student{uniqueStudents !== 1 ? 's' : ''}
            </p>
          )}
        </div>
        <button
          onClick={handleExportCsv}
          disabled={csvLoading || loading || sessions.length === 0}
          className="flex items-center gap-2 px-4 py-2 text-sm font-bold bg-white border border-gray-200 hover:border-[#FA6C43] hover:text-[#FA6C43] text-gray-600 rounded-xl transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {csvLoading ? <FaSpinner className="animate-spin text-sm" /> : <FaDownload className="text-sm" />}
          {csvLoading ? csvProgress : 'Export CSV'}
        </button>
      </div>

      {/* Tabs */}
      <div className="bg-white border-b border-gray-200 px-6 lg:px-10">
        <div className="flex gap-1">
          {[
            { id: 'analytics', label: 'Analytics', icon: FaBrain },
            { id: 'sessions', label: 'Sessions', icon: FaChartBar },
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-bold border-b-2 transition-colors ${
                tab === id ? 'border-[#FA6C43] text-[#FA6C43]' : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              <Icon className="text-xs" /> {label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="max-w-5xl mx-auto px-6 lg:px-10 py-8">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-64 bg-white rounded-[2rem] border border-gray-100">
            <FaSpinner className="animate-spin text-4xl text-[#FA6C43] mb-4" />
            <p className="text-gray-500 font-medium">Loading…</p>
          </div>
        ) : tab === 'analytics' ? (
          <AnalyticsTab sessions={sessions} configId={configId} systemPrompt={systemPrompt} configName={configName} />
        ) : (
          <SessionsTab sessions={sessions} />
        )}
      </div>
    </div>
  );
};

export default ResponsesPage;
