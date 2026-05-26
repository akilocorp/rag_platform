import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { FaSpinner, FaChevronDown, FaChevronUp, FaCopy, FaCheck, FaArrowLeft, FaRedo } from 'react-icons/fa';
import apiClient from '../api/apiClient';

const DIMS = [
  { key: 'confidence', label: 'Confidence' },
  { key: 'competence', label: 'Competence' },
  { key: 'passion', label: 'Passion' },
];
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

function StudentRow({ sub, configId, onRescored }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState(null);
  const [rescoring, setRescoring] = useState(false);

  const toggle = () => {
    setOpen(!open);
    if (!detail) {
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
  const fb = detail?.scores?.feedback || {};

  return (
    <div className="border-b border-gray-100 last:border-0">
      <div onClick={toggle} className="flex items-center gap-4 py-3 px-4 cursor-pointer hover:bg-gray-50">
        <span className="text-gray-400">{open ? <FaChevronUp /> : <FaChevronDown />}</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-800 truncate">{sub.name || 'Anonymous'}</p>
          <p className="text-xs text-gray-400 truncate">{sub.email}</p>
        </div>
        <div className="hidden sm:flex gap-3">
          {DIMS.map((d) => {
            const v = sc[d.key]?.value;
            return <span key={d.key} className="text-xs font-bold w-14 text-center" style={{ color: color(v) }}>{v == null ? '—' : Math.round(v)}</span>;
          })}
        </div>
        <span className="text-lg font-extrabold w-12 text-right" style={{ color: color(sub.overall) }}>{sub.overall == null ? '—' : Math.round(sub.overall)}</span>
      </div>
      {open && (
        <div className="bg-gray-50 px-6 py-4">
          {!detail ? <FaSpinner className="animate-spin text-gray-400" /> : detail.error ? (
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
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  const load = () => {
    Promise.all([
      apiClient.get(`/video/config/${configId}/dashboard`),
      apiClient.get(`/video/config/${configId}/submissions`),
    ]).then(([d, s]) => { setDash(d.data); setSubs(s.data.submissions || []); })
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [configId]);

  const uploadLink = `${window.location.origin}/video-upload/${configId}`;
  const copyLink = () => { navigator.clipboard.writeText(uploadLink); setCopied(true); setTimeout(() => setCopied(false), 2000); };

  if (loading) return <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }} className="min-h-screen bg-[#F0F6FB] flex items-center justify-center"><FaSpinner className="animate-spin text-3xl text-[#FA6C43]" /></div>;

  return (
    <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }} className="min-h-screen bg-[#F0F6FB] py-8 px-4">
      <div className="max-w-4xl mx-auto">
        <Link to="/config_list" className="text-sm text-gray-500 hover:text-[#FA6C43] flex items-center gap-2 mb-4"><FaArrowLeft /> Back to configs</Link>
        <h1 className="text-2xl font-extrabold text-[#222] mb-1">Video Analysis Dashboard</h1>
        <p className="text-sm text-gray-500 mb-6">{dash?.total_submissions || 0} submission{dash?.total_submissions === 1 ? '' : 's'}</p>

        {/* Shareable link */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-6 flex items-center gap-3">
          <span className="text-xs font-bold uppercase tracking-wider text-gray-400 shrink-0">Upload link</span>
          <code className="flex-1 text-sm text-gray-700 truncate bg-gray-50 px-3 py-2 rounded-lg">{uploadLink}</code>
          <button onClick={copyLink} className="px-3 py-2 rounded-lg bg-[#FA6C43] text-white text-sm font-semibold flex items-center gap-2">
            {copied ? <FaCheck /> : <FaCopy />} {copied ? 'Copied' : 'Copy'}
          </button>
        </div>

        {/* Class aggregates */}
        <div className="grid sm:grid-cols-3 gap-4 mb-6">
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

        {dash?.common_weakness_dimension && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-6 text-sm text-amber-800">
            <span className="font-bold">Most common weakness:</span> {DIMS.find(d => d.key === dash.common_weakness_dimension)?.label || dash.common_weakness_dimension} is the lowest dimension for the most students.
          </div>
        )}

        {/* Per-student table */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="flex items-center gap-4 py-2.5 px-4 bg-gray-50 border-b border-gray-100 text-[11px] font-bold uppercase tracking-wider text-gray-400">
            <span className="w-4" />
            <span className="flex-1">Student</span>
            <span className="hidden sm:flex gap-3">{DIMS.map(d => <span key={d.key} className="w-14 text-center">{d.label.slice(0, 4)}</span>)}</span>
            <span className="w-12 text-right">Overall</span>
          </div>
          {subs.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-10">No submissions yet. Share the upload link above.</p>
          ) : subs.map((s) => <StudentRow key={s.id} sub={s} configId={configId} onRescored={load} />)}
        </div>
      </div>
    </div>
  );
}
