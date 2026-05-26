import React, { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { FaChevronDown, FaChevronUp, FaSpinner, FaCheck, FaTimes, FaCheckCircle, FaArrowUp } from 'react-icons/fa';
import apiClient from '../api/apiClient';

const COMPOSITES = [
  { key: 'confidence', label: 'Confidence', blurb: 'Composure, steadiness, low filler' },
  { key: 'competence', label: 'Competence', blurb: 'Content, structure, evidence' },
  { key: 'passion', label: 'Passion', blurb: 'Energy, variation, expressivity' },
];

function color(v) {
  if (v == null) return '#9ca3af';
  if (v >= 80) return '#22c55e';
  if (v >= 65) return '#3b82f6';
  if (v >= 50) return '#f59e0b';
  return '#ef4444';
}

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
      .then((res) => { setData(res.data); setError(''); })
      .catch((e) => setError(e.response?.status === 403 ? 'forbidden' : 'notfound'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [submissionId, token]);

  // Presigned playback URL (available as soon as the video is uploaded).
  useEffect(() => {
    const q = token ? `?token=${encodeURIComponent(token)}` : '';
    apiClient.get(`/video/submissions/${submissionId}/video-url${q}`)
      .then((res) => setVideoUrl(res.data.url))
      .catch(() => setVideoUrl(null));
    // eslint-disable-next-line
  }, [submissionId, token]);

  // Plain JSX value (not a nested component) so re-renders don't remount the
  // <video> element and interrupt playback.
  const player = videoUrl ? (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3 mb-5">
      <video src={videoUrl} controls playsInline className="w-full rounded-xl bg-black max-h-[420px]" />
    </div>
  ) : null;

  // Poll while still processing.
  useEffect(() => {
    if (data && data.submission?.status !== 'scored' && data.submission?.status !== 'failed') {
      const t = setInterval(load, 6000);
      return () => clearInterval(t);
    }
    // eslint-disable-next-line
  }, [data]);

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

  const fb = scores?.feedback || {};
  const checks = scores?.content_checks || [];

  return wrap(
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold text-[#222]">Your Results</h1>
        <p className="text-sm text-gray-500">{submission?.name} · {submission?.assignment_type?.replace(/_/g, ' ')}</p>
      </div>

      {player}

      {/* Overall */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 mb-5 flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Overall</p>
          <p className="text-sm text-gray-600 mt-1">Weighted across all three dimensions</p>
        </div>
        <span className="text-5xl font-extrabold" style={{ color: color(scores?.overall) }}>{scores?.overall == null ? '—' : Math.round(scores.overall)}</span>
      </div>

      {/* Three composites */}
      <div className="grid sm:grid-cols-3 gap-4 mb-6">
        {COMPOSITES.map((c) => <CompositeCard key={c.key} label={c.label} blurb={c.blurb} data={scores?.scores?.[c.key]} />)}
      </div>

      {/* Content checks */}
      {checks.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 mb-6">
          <h3 className="font-bold text-[#222] mb-3">Content Checklist</h3>
          <div className="space-y-2">
            {checks.map((c, i) => (
              <div key={i} className="flex items-start gap-3">
                <span className={`mt-0.5 ${c.passed ? 'text-green-500' : 'text-gray-300'}`}>{c.passed ? <FaCheck /> : <FaTimes />}</span>
                <div>
                  <p className="text-sm font-semibold text-gray-700">{c.label || c.id}</p>
                  {c.note && <p className="text-xs text-gray-500">{c.note}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Feedback */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
        <h3 className="font-bold text-[#222]">Feedback</h3>
        {fb.summary && <p className="text-sm text-gray-700 leading-relaxed">{fb.summary}</p>}
        {(fb.strengths || []).length > 0 && (
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-green-600 mb-2">Strengths</p>
            <ul className="space-y-1.5">{fb.strengths.map((s, i) => <li key={i} className="text-sm text-gray-700 flex gap-2"><FaCheckCircle className="text-green-500 mt-0.5 shrink-0" />{s}</li>)}</ul>
          </div>
        )}
        {(fb.improvements || []).length > 0 && (
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-amber-600 mb-2">To Improve</p>
            <ul className="space-y-1.5">{fb.improvements.map((s, i) => <li key={i} className="text-sm text-gray-700 flex gap-2"><FaArrowUp className="text-amber-500 mt-0.5 shrink-0" />{s}</li>)}</ul>
          </div>
        )}
      </div>
    </>
  );
}
