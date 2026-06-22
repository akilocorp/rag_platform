import React, { useEffect, useState } from 'react';
import { useParams, useSearchParams, useNavigate, Link } from 'react-router-dom';
import { FaSpinner, FaFilm } from 'react-icons/fa';
import apiClient from '../api/apiClient';

const C = (v) => v == null ? '#9ca3af' : v >= 80 ? '#22c55e' : v >= 65 ? '#3b82f6' : v >= 50 ? '#f59e0b' : '#ef4444';

// Collect the union of prof-defined boxes / content checks across all attempts,
// preserving first-seen order. Dimensions are consistent within a config, but a
// union keeps the table stable even if a config was edited between attempts.
const collectByOrder = (detailMap, pick) => {
  const seen = new Map();
  Object.values(detailMap || {}).forEach((d) => {
    (pick(d) || []).forEach((item) => {
      if (item?.id && !seen.has(item.id)) seen.set(item.id, item);
    });
  });
  return [...seen.values()];
};
const fmt = (v) => v != null ? (v / 10).toFixed(1) : '—';
const fmtDate = (ts) => ts ? new Date(ts * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—';

function StatusChip({ status }) {
  const map = { pending: ['Processing', '#f59e0b'], failed: ['Failed', '#ef4444'] };
  const [label, color] = map[status] || ['Processing', '#f59e0b'];
  return (
    <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full text-white" style={{ background: color }}>
      {label}
    </span>
  );
}

function CompareTable({ submissions, detailMap }) {
  const dimList = collectByOrder(detailMap, (d) => d?.scores?.dimensions);
  const checkList = collectByOrder(detailMap, (d) => d?.scores?.content_checks);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[400px] border-collapse">
        <thead>
          <tr>
            <th className="text-left text-xs font-bold text-gray-400 uppercase py-2 pr-4 w-36" />
            {submissions.map((s) => (
              <th key={s.submission_id} className="text-center py-2 px-3 min-w-[110px]">
                <Link to={`/video-results/${s.submission_id}`} className="text-sm font-bold text-[#222] hover:text-[#FA6C43]">
                  Attempt {s.attempt_number}
                </Link>
                <div className="text-[11px] text-gray-400">{fmtDate(s.created_at)}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {/* Overall */}
          <tr className="border-t border-gray-100">
            <td className="text-xs font-semibold text-gray-600 py-3 pr-4">Overall</td>
            {submissions.map((s) => {
              const d = detailMap[s.submission_id];
              const overall = d?.scores?.overall != null ? d.scores.overall : (d?.scores?.llm_overall ?? s.overall);
              return (
                <td key={s.submission_id} className="text-center py-3 px-3">
                  {s.status === 'scored'
                    ? <span className="text-2xl font-extrabold" style={{ color: C(overall) }}>{fmt(overall)}</span>
                    : <StatusChip status={s.status} />}
                </td>
              );
            })}
          </tr>

          {/* Prof-defined scoring boxes */}
          {dimList.map((dim) => (
            <tr key={dim.id} className="border-t border-gray-50">
              <td className="text-xs font-semibold text-gray-600 py-2.5 pr-4">{dim.name || dim.id}</td>
              {submissions.map((s) => {
                const d = detailMap[s.submission_id];
                const val = (d?.scores?.dimensions || []).find((x) => x.id === dim.id)?.score;
                return (
                  <td key={s.submission_id} className="px-3 py-2.5">
                    {s.status === 'scored' && val != null ? (
                      <div>
                        <div className="text-[11px] font-bold mb-1" style={{ color: C(val) }}>{fmt(val)}</div>
                        <div className="h-1.5 w-full bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${val}%`, background: C(val) }} />
                        </div>
                      </div>
                    ) : <span className="text-xs text-gray-300">—</span>}
                  </td>
                );
              })}
            </tr>
          ))}

          {/* Content checks */}
          {checkList.length > 0 && (
            <tr className="border-t-2 border-gray-200">
              <td colSpan={submissions.length + 1} className="text-[11px] font-bold uppercase tracking-wider text-gray-400 pt-4 pb-2">
                Content Checks
              </td>
            </tr>
          )}
          {checkList.map((kc) => (
            <tr key={kc.id} className="border-t border-gray-50">
              <td className="text-xs font-semibold text-gray-600 py-2 pr-4">{kc.label || kc.id}</td>
              {submissions.map((s) => {
                const d = detailMap[s.submission_id];
                const check = (d?.scores?.content_checks || []).find((c) => c.id === kc.id);
                const v = check?.score;
                return (
                  <td key={s.submission_id} className="text-center px-3 py-2">
                    {v != null
                      ? <span className="text-sm font-bold" style={{ color: C(v) }}>{fmt(v)}</span>
                      : <span className="text-xs text-gray-300">—</span>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function VideoComparePage() {
  const { configId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const email = searchParams.get('email') || '';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [historyData, setHistoryData] = useState(null);
  const [detailMap, setDetailMap] = useState({});
  const [configName, setConfigName] = useState('');

  useEffect(() => {
    if (!email || !configId) { setError('Missing email or config.'); setLoading(false); return; }
    Promise.all([
      apiClient.get(`/video/config/${configId}/student-history?email=${encodeURIComponent(email)}`),
      apiClient.get(`/config/${configId}`).catch(() => ({ data: {} })),
    ])
      .then(([hist, cfg]) => {
        setHistoryData(hist.data);
        setConfigName(cfg.data?.config?.bot_name || 'Assignment');
        const scored = (hist.data.submissions || []).filter((s) => s.status === 'scored');
        return Promise.all(
          scored.map((s) =>
            apiClient.get(`/video/submissions/${s.submission_id}/results`)
              .then((r) => ({ id: s.submission_id, data: r.data }))
              .catch(() => ({ id: s.submission_id, data: null }))
          )
        );
      })
      .then((details) => {
        const map = {};
        details.forEach((d) => { map[d.id] = d.data; });
        setDetailMap(map);
      })
      .catch(() => setError('Could not load your submission history.'))
      .finally(() => setLoading(false));
  }, [configId, email]);

  const wrap = (inner) => (
    <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }} className="min-h-screen bg-[#F0F6FB] py-10 px-4">
      <div className="max-w-3xl mx-auto">{inner}</div>
    </div>
  );

  if (loading) return wrap(
    <div className="text-center py-20"><FaSpinner className="animate-spin text-3xl text-[#FA6C43] mx-auto" /></div>
  );
  if (error) return wrap(
    <div className="bg-white rounded-2xl p-8 text-center">
      <h2 className="font-bold text-lg text-[#222]">{error}</h2>
    </div>
  );

  const subs = historyData?.submissions || [];

  if (subs.length === 0) return wrap(
    <div className="bg-white rounded-2xl p-8 text-center">
      <FaFilm className="text-3xl text-gray-300 mx-auto mb-4" />
      <h2 className="font-bold text-lg text-[#222]">No submissions yet</h2>
      <button onClick={() => navigate(`/video-upload/${configId}`)}
        className="mt-4 px-5 py-2.5 rounded-xl font-bold text-white bg-[#FA6C43] hover:bg-[#E55B34] text-sm">
        Upload your first attempt
      </button>
    </div>
  );

  return wrap(
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold text-[#222]">Your Attempts</h1>
        <p className="text-sm text-gray-500">{configName} · {subs.length}/15 submissions</p>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-5">
        <CompareTable submissions={subs} detailMap={detailMap} />
      </div>

      {historyData?.can_submit && (
        <div className="text-center">
          <button onClick={() => navigate(`/video-upload/${configId}`)}
            className="px-6 py-2.5 rounded-xl font-bold text-white bg-[#FA6C43] hover:bg-[#E55B34] text-sm shadow-sm">
            Upload another attempt
          </button>
        </div>
      )}
    </>
  );
}
