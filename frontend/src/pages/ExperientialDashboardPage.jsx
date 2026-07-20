import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { FiArrowLeft, FiPlay, FiChevronRight } from 'react-icons/fi';
import apiClient from '../api/apiClient';

// Professor view: every student's run for one experiential lab. Reached by
// clicking the lab box (or its "Sessions" button) in the dashboard.
export default function ExperientialDashboardPage() {
  const { configId } = useParams();
  const navigate = useNavigate();
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [title, setTitle] = useState('Experiential lab');

  useEffect(() => {
    let cancelled = false;
    apiClient.get(`/experiential/sessions/by-config/${configId}`)
      .then((r) => { if (!cancelled) { setSessions(r.data.sessions || []); setLoading(false); } })
      .catch((e) => {
        if (cancelled) return;
        setError(e?.response?.status === 403 ? "You don't own this lab." : 'Could not load sessions.');
        setLoading(false);
      });
    apiClient.get(`/config/${configId}`)
      .then((r) => { if (!cancelled) setTitle(r.data?.config?.experiential_config?.meta?.title || r.data?.config?.bot_name || 'Experiential lab'); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [configId]);

  return (
    <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }} className="min-h-screen bg-[#F0F6FB] text-[#222]">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6">
        <button onClick={() => navigate('/config_list')} className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-500 hover:text-[#FA6C43] transition-colors mb-4">
          <FiArrowLeft /> Back to dashboard
        </button>

        <div className="flex items-center justify-between gap-3 mb-5">
          <div>
            <h1 className="text-xl font-bold text-[#222]">{title}</h1>
            <p className="text-sm text-gray-500">{sessions.length} session{sessions.length === 1 ? '' : 's'}</p>
          </div>
          <button
            onClick={() => navigate(`/experiential/c/${configId}`)}
            className="inline-flex items-center gap-1.5 bg-[#FA6C43] hover:bg-[#e85a30] text-white text-sm font-semibold px-3.5 py-2 rounded-xl transition-colors"
          >
            <FiPlay /> Preview / play lab
          </button>
        </div>

        {loading && <div className="text-gray-500 text-sm">Loading…</div>}
        {error && <div className="bg-white border border-gray-200 rounded-2xl p-6 text-gray-600">{error}</div>}

        {!loading && !error && (
          sessions.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-2xl p-6 text-gray-500 text-sm">
              No one has run this lab yet.
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-2xl shadow-sm divide-y divide-gray-100 overflow-hidden">
              {sessions.map((s) => (
                <Link
                  key={s.session_id}
                  to={`/experiential/c/${configId}?session=${s.session_id}`}
                  className="flex items-center justify-between gap-3 px-5 py-3.5 hover:bg-[#F0F6FB] transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-800 truncate">{s.username || 'Student'}</p>
                    <p className="text-xs text-gray-500">{s.timestamp ? new Date(s.timestamp).toLocaleString() : ''}</p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {s.status === 'in_progress' ? (
                      <span className="text-xs font-semibold text-amber-700 bg-amber-50 rounded-lg px-2.5 py-1">In progress</span>
                    ) : s.total_score != null ? (
                      <span className="text-sm font-bold text-[#FA6C43] tabular-nums">{s.total_score}/100</span>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                    <FiChevronRight className="text-gray-300" />
                  </div>
                </Link>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  );
}
