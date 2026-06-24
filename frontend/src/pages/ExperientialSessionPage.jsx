import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { FiArrowLeft, FiAward } from 'react-icons/fi';
import apiClient from '../api/apiClient';
import { getExperientialConfig } from '../configs/experiential';
import SessionReplay from '../components/experiential/SessionReplay';
import SessionReport from '../components/experiential/SessionReport';

// Review a finished (or in-progress) experiential run. Two tabs:
//   Session — a faithful read-only replay of every card / back-and-forth
//   Report  — the score breakdown
// The backend enforces who may read which session (owner or lab owner).
export default function ExperientialSessionPage() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState({ loading: true, session: null, error: null });
  const [config, setConfig] = useState(null);
  const [tab, setTab] = useState('session');

  useEffect(() => {
    let cancelled = false;
    apiClient.get(`/experiential/sessions/${sessionId}`)
      .then((r) => { if (!cancelled) setState({ loading: false, session: r.data.session, error: null }); })
      .catch((e) => {
        if (cancelled) return;
        const code = e?.response?.status;
        setState({
          loading: false,
          session: null,
          error: code === 403 ? "You don't have access to this session."
            : code === 404 ? 'This session no longer exists.'
            : 'Could not load this session.',
        });
      });
    return () => { cancelled = true; };
  }, [sessionId]);

  // Load the lab config so the replay can render charts/narratives.
  const session = state.session;
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    if (session.config_id) {
      apiClient.get(`/config/${session.config_id}`)
        .then((r) => { if (!cancelled) setConfig(r.data?.config?.experiential_config || null); })
        .catch(() => { if (!cancelled) setConfig(null); });
    } else if (session.template_id) {
      setConfig(getExperientialConfig(session.template_id) || null);
    }
    return () => { cancelled = true; };
  }, [session]);

  const { loading, error } = state;
  const goBack = () => navigate(session?.config_id ? `/experiential-dashboard/${session.config_id}` : '/config_list');

  return (
    <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }} className="min-h-screen bg-[#F0F6FB] text-[#222]">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
        <button onClick={goBack} className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-500 hover:text-[#FA6C43] transition-colors mb-4">
          <FiArrowLeft /> Back
        </button>

        {loading && <div className="text-gray-500 text-sm">Loading…</div>}
        {error && <div className="bg-white border border-gray-200 rounded-2xl p-6 text-gray-600">{error}</div>}

        {session && (
          <div className="space-y-4">
            {/* Header */}
            <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
              <h1 className="text-xl font-bold text-[#222]">{session.title || 'Experiential lab'}</h1>
              <p className="text-sm text-gray-500 mt-0.5">
                {[session.discipline, session.level].filter(Boolean).join(' · ')}
                {session.username ? ` · ${session.username}` : ''}
                {session.created_at ? ` · ${new Date(session.created_at).toLocaleString()}` : ''}
              </p>
              <div className="mt-3 flex items-center gap-2">
                {session.status === 'in_progress' ? (
                  <span className="inline-flex items-center gap-1.5 bg-amber-50 text-amber-700 font-semibold rounded-xl px-3 py-1.5 text-sm">In progress</span>
                ) : session.total_score != null ? (
                  <span className="inline-flex items-center gap-2 bg-[#F9D0C4]/30 text-[#FA6C43] font-bold rounded-xl px-3 py-1.5">
                    <FiAward /> {session.total_score}/100
                    {session.graded_by ? <span className="text-xs font-medium text-gray-500">· graded by {session.graded_by}</span> : null}
                  </span>
                ) : null}
              </div>
            </div>

            {/* Tabs */}
            <div className="flex items-center gap-1.5">
              {[['session', 'Session'], ['report', 'Report']].map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setTab(k)}
                  className={`text-sm px-3.5 py-1.5 rounded-xl font-semibold transition-colors ${
                    tab === k ? 'bg-[#222] text-white' : 'bg-white border border-gray-200 text-gray-500 hover:text-[#FA6C43]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Session replay */}
            {tab === 'session' && (
              config ? <SessionReplay config={config} transcript={session.transcript} />
                : <div className="bg-white border border-gray-200 rounded-2xl p-6 text-gray-500 text-sm">Loading the lab…</div>
            )}

            {/* Report */}
            {tab === 'report' && <SessionReport session={session} />}
          </div>
        )}
      </div>
    </div>
  );
}
