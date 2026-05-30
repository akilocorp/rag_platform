import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FaSpinner, FaFilm, FaArrowRight } from 'react-icons/fa';
import apiClient from '../api/apiClient';

const C = v => v == null ? '#9ca3af' : v >= 80 ? '#22c55e' : v >= 65 ? '#3b82f6' : v >= 50 ? '#f59e0b' : '#ef4444';
const fmt = v => v != null ? (v / 10).toFixed(1) : null;

export default function StudentDashboardPage() {
  const navigate = useNavigate();
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    apiClient.get('/student/dashboard')
      .then(res => setAssignments(res.data.assignments || []))
      .catch(() => setError('Could not load your assignments.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }} className="min-h-screen bg-[#F0F6FB] flex items-center justify-center">
      <FaSpinner className="animate-spin text-3xl text-[#FA6C43]" />
    </div>
  );

  return (
    <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }} className="min-h-screen bg-[#F0F6FB] py-10 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-extrabold text-[#222]">My Assignments</h1>
          <p className="text-sm text-gray-500 mt-1">Your enrolled video assignments</p>
        </div>

        {error && (
          <div className="bg-white rounded-2xl p-6 text-center border border-gray-100 shadow-sm mb-4">
            <p className="text-sm text-red-500">{error}</p>
          </div>
        )}

        {!error && assignments.length === 0 && (
          <div className="bg-white rounded-2xl p-10 text-center border border-gray-100 shadow-sm">
            <FaFilm className="text-4xl text-gray-300 mx-auto mb-4" />
            <h2 className="text-lg font-bold text-[#222] mb-2">No assignments yet</h2>
            <p className="text-sm text-gray-500">Ask your professor for an invite link to join a class.</p>
          </div>
        )}

        <div className="space-y-4">
          {assignments.map(a => (
            <div key={a.class_code} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <div className="flex items-start justify-between gap-4 mb-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h2 className="text-base font-bold text-[#222] truncate">{a.bot_name}</h2>
                    <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-[#FFF5F2] text-[#FA6C43] border border-[#FA6C43]/20 shrink-0">
                      {a.class_code}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400">{a.submission_count} / 5 attempt{a.submission_count !== 1 ? 's' : ''}</p>
                </div>
                {a.best_score != null && (
                  <div className="text-right shrink-0">
                    <span className="text-2xl font-extrabold" style={{ color: C(a.best_score) }}>{fmt(a.best_score)}</span>
                    <p className="text-[10px] text-gray-400">Best score</p>
                  </div>
                )}
              </div>

              {a.best_score != null && (
                <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden mb-4">
                  <div className="h-full rounded-full" style={{ width: `${a.best_score}%`, background: C(a.best_score) }} />
                </div>
              )}

              <div className="flex gap-3">
                {a.can_submit && (
                  <button
                    onClick={() => navigate(`/video-upload/${a.config_id}`)}
                    className="flex-1 py-2.5 rounded-xl font-bold text-white bg-[#FA6C43] hover:bg-[#E55B34] text-sm transition-colors"
                  >
                    Submit Video
                  </button>
                )}
                {a.latest_scored_id && (
                  <button
                    onClick={() => navigate(`/video-results/${a.latest_scored_id}`)}
                    className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl font-semibold text-[#FA6C43] border border-[#FA6C43]/30 hover:border-[#FA6C43] text-sm transition-colors"
                  >
                    View Results <FaArrowRight className="text-xs" />
                  </button>
                )}
                {!a.can_submit && !a.latest_scored_id && (
                  <p className="text-xs text-gray-400 py-2">Maximum submissions reached</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
