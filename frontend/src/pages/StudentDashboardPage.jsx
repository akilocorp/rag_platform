// @language  JavaScript (React / JSX)
// @updated   2026-08-10
// @changed   Every class type, not just video: cards carry the type label, what the class is
//            for, and one "Enter class" button that routes by bot_type.
import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FaArrowRight, FaGraduationCap, FaRegQuestionCircle } from 'react-icons/fa';
import apiClient from '../api/apiClient';
import UserInfo from '../components/UserInfo';
import LoadingScreen from '../components/LoadingScreen';
import { botTypeInfo, studentPathFor } from '../utils/botTypes';

const C = v => v == null ? '#9ca3af' : v >= 80 ? '#22c55e' : v >= 65 ? '#3b82f6' : v >= 50 ? '#f59e0b' : '#ef4444';
const fmt = v => v != null ? (v / 10).toFixed(1) : null;
const isLocked = ts => ts && Date.now() / 1000 < ts;
const lockMsg = ts => {
  const d = new Date(ts * 1000);
  return `Results available ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} at ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
};

const when = (epoch) => {
  if (!epoch) return null;
  const days = Math.floor((Date.now() / 1000 - epoch) / 86400);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(epoch * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

// "3 conversations · last opened 2 days ago". Types whose progress isn't persisted
// anywhere (group chat, manager exercise) send count: null and get no line at all.
const activityLine = (a) => {
  const act = a.activity || {};
  if (act.count == null) return null;
  const parts = [];
  if (a.bot_type === 'video_analysis') {
    // Accounts that submitted before the cap settled can sit above it; "6 of 5
    // attempts" reads as a bug, so drop the denominator once it's been passed.
    const max = a.max_submissions ?? 5;
    parts.push(act.count > max
      ? `${act.count} attempt${act.count === 1 ? '' : 's'}`
      : `${act.count} of ${max} attempts`);
  } else if (act.count === 0) {
    parts.push('Not started yet');
  } else {
    parts.push(`${act.count} ${act.noun}${act.count === 1 ? '' : 's'}`);
  }
  const ago = when(act.last_at);
  if (ago) parts.push(`last opened ${ago}`);
  return parts.join(' · ');
};

export default function StudentDashboardPage() {
  const navigate = useNavigate();
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const isVerified = localStorage.getItem('isVerified') !== 'false';

  useEffect(() => {
    apiClient.get('/student/dashboard')
      .then(res => setAssignments(res.data.assignments || []))
      .catch(() => setError('Could not load your classes.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingScreen message="Loading your classes…" />;

  // Most recently touched first; never-opened classes settle at the bottom.
  const ordered = [...assignments].sort(
    (a, b) => (b.activity?.last_at || 0) - (a.activity?.last_at || 0)
  );

  return (
    <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }} className="min-h-screen bg-[#F0F6FB] py-10 px-4">
      <div className="max-w-2xl mx-auto">
        {!isVerified && (
          <div className="mb-6 flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4">
            <span className="text-amber-500 text-lg mt-0.5">⚠</span>
            <div>
              <p className="text-sm font-semibold text-amber-800">Email not verified</p>
              <p className="text-xs text-amber-700 mt-0.5">Please check your inbox for a verification link. Some features may be limited until your email is confirmed.</p>
            </div>
          </div>
        )}

        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-extrabold text-[#222]">My Classes</h1>
            <p className="text-sm text-gray-500 mt-1">Everything your professors have enrolled you in</p>
          </div>
          <UserInfo />
        </div>

        {error && (
          <div className="bg-white rounded-2xl p-6 text-center border border-gray-100 shadow-sm mb-4">
            <p className="text-sm text-red-500">{error}</p>
          </div>
        )}

        {!error && ordered.length === 0 && (
          <div className="bg-white rounded-2xl p-10 text-center border border-gray-100 shadow-sm">
            <FaGraduationCap className="text-4xl text-gray-300 mx-auto mb-4" />
            <h2 className="text-lg font-bold text-[#222] mb-2">No classes yet</h2>
            <p className="text-sm text-gray-500">Ask your professor for an invite link to join a class.</p>
            <Link to="/userguide/student-join" className="inline-block mt-3 text-sm font-semibold text-[#FA6C43]">
              Read the student guide →
            </Link>
          </div>
        )}

        <div className="space-y-4">
          {ordered.map(a => {
            const type = botTypeInfo(a.bot_type);
            const TypeIcon = type.icon;
            const line = activityLine(a);
            const isVideo = a.bot_type === 'video_analysis';

            return (
              <div key={a.class_code} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h2 className="text-base font-bold text-[#222] truncate">{a.bot_name}</h2>
                      <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-[#FFF5F2] text-[#FA6C43] border border-[#FA6C43]/20 shrink-0">
                        {a.class_code}
                      </span>
                    </div>
                    <p className="flex items-center gap-1.5 text-xs font-semibold text-gray-500">
                      <TypeIcon className="text-[#FA6C43]" /> {type.label}
                    </p>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    {isVideo && a.best_score != null && (
                      <div className="text-right">
                        <span className="text-2xl font-extrabold" style={{ color: C(a.best_score) }}>{fmt(a.best_score)}</span>
                        <p className="text-[10px] text-gray-400">Best score</p>
                      </div>
                    )}
                    {/* How-to for this kind of class, one click from the card it describes. */}
                    <Link
                      to={`/userguide/${type.guideAnchor}`}
                      title={`How ${type.label} works`}
                      aria-label={`How ${type.label} works`}
                      className="text-gray-300 hover:text-[#FA6C43] transition-colors"
                    >
                      <FaRegQuestionCircle className="text-lg" />
                    </Link>
                  </div>
                </div>

                <p className="text-sm text-gray-500 mb-1">{type.blurb}</p>
                {line && <p className="text-xs text-gray-400 mb-3">{line}</p>}

                {isVideo && a.best_score != null && (
                  <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden mb-4 mt-3">
                    <div className="h-full rounded-full" style={{ width: `${a.best_score}%`, background: C(a.best_score) }} />
                  </div>
                )}

                <button
                  onClick={() => navigate(studentPathFor(a.bot_type, a.config_id))}
                  className="mt-2 w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-bold text-white bg-[#FA6C43] hover:bg-[#E55B34] text-sm transition-colors"
                >
                  Enter class <FaArrowRight className="text-xs" />
                </button>

                {isVideo && isLocked(a.upload_locked_until) && (
                  <p className="text-xs text-gray-400 pt-2 text-center">{lockMsg(a.upload_locked_until)}</p>
                )}
                {isVideo && !a.can_submit && (
                  <p className="text-xs text-gray-400 pt-2 text-center">Maximum submissions reached — you can still review your results inside.</p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
