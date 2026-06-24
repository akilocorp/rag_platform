import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { FiArrowLeft, FiAward } from 'react-icons/fi';
import apiClient from '../api/apiClient';

// Read-only debrief of a finished experiential-lab run. Reachable from the
// sidebar — the student revisits their own run; the lab owner reviews any
// student's run (the backend enforces who may read which session).
export default function ExperientialSessionPage() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState({ loading: true, session: null, error: null });

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

  const { loading, session, error } = state;

  return (
    <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }} className="min-h-screen bg-[#F0F6FB] text-[#222]">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
        <button
          onClick={() => navigate('/experiential')}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-500 hover:text-[#FA6C43] transition-colors mb-4"
        >
          <FiArrowLeft /> Back to labs
        </button>

        {loading && <div className="text-gray-500 text-sm">Loading…</div>}
        {error && (
          <div className="bg-white border border-gray-200 rounded-2xl p-6 text-gray-600">{error}</div>
        )}

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
              {session.total_score != null && (
                <div className="mt-3 inline-flex items-center gap-2 bg-[#F9D0C4]/30 text-[#FA6C43] font-bold rounded-xl px-3 py-1.5">
                  <FiAward /> {session.total_score}/100
                  {session.graded_by ? <span className="text-xs font-medium text-gray-500">· graded by {session.graded_by}</span> : null}
                </div>
              )}
            </div>

            {/* Score breakdown */}
            {Array.isArray(session.breakdown) && session.breakdown.length > 0 && (
              <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
                <h2 className="font-bold text-[#222] mb-3">Score breakdown</h2>
                <div className="space-y-3">
                  {session.breakdown.map((b, i) => (
                    <div key={i} className="border-t border-gray-100 pt-3 first:border-0 first:pt-0">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-gray-800 text-sm">{b.key}</span>
                        <span className="text-sm tabular-nums text-gray-600">{b.score}/{b.weight}</span>
                      </div>
                      {b.detail && <p className="text-xs text-gray-500 mt-1">{b.detail}</p>}
                      {b.feedback && <p className="text-sm text-gray-700 mt-1.5 italic">{b.feedback}</p>}
                      {Array.isArray(b.rubric) && b.rubric.length > 0 && (
                        <ul className="mt-2 space-y-1">
                          {b.rubric.map((r, j) => (
                            <li key={j} className={`text-xs flex items-start gap-1.5 ${r.hit ? 'text-green-600' : 'text-gray-400'}`}>
                              <span>{r.hit ? '✓' : '✕'}</span>
                              <span>{r.r}{r.note ? ` — ${r.note}` : ''}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Predictions */}
            {Array.isArray(session.predictions) && session.predictions.length > 0 && (
              <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
                <h2 className="font-bold text-[#222] mb-3">Predictions</h2>
                <div className="space-y-1.5">
                  {session.predictions.map((p, i) => (
                    <div key={i} className="flex items-center justify-between text-sm">
                      <span className="text-gray-700">{p.label}</span>
                      <span className="text-gray-900 font-semibold">{p.call}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Path through the lab */}
            {(Array.isArray(session.layers_revealed) && session.layers_revealed.length > 0) ||
            (Array.isArray(session.probes_used) && session.probes_used.length > 0) ? (
              <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
                <h2 className="font-bold text-[#222] mb-3">What they explored</h2>
                {Array.isArray(session.layers_revealed) && session.layers_revealed.length > 0 && (
                  <p className="text-sm text-gray-700 mb-2">
                    <span className="font-semibold">Models revealed:</span> {session.layers_revealed.join(', ')}
                  </p>
                )}
                {Array.isArray(session.probes_used) && session.probes_used.length > 0 && (
                  <div className="text-sm text-gray-700">
                    <span className="font-semibold">Probes used:</span>
                    <ul className="list-disc list-inside mt-1 space-y-0.5 text-gray-600">
                      {session.probes_used.map((q, i) => <li key={i}>{q}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            ) : null}

            {/* Synthesis */}
            {session.synthesis_text && (
              <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
                <h2 className="font-bold text-[#222] mb-2">Synthesis</h2>
                <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">{session.synthesis_text}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
