/* @language JSX  @updated 2026-08-31  @changed New page: the professor's class results for a manager
   exercise — every group's answer, every student's own private pick and which case file they held,
   plus class-wide percentages. It exists because the `investigation` template deliberately never
   tells a room whether it was right; this is where that conversation happens instead. */
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { FaArrowLeft, FaCheck, FaTimes, FaChartBar, FaSpinner } from 'react-icons/fa';
import apiClient from '../api/apiClient';
import UserInfo from '../components/UserInfo';

// Re-read while a class is still running. Slower than the live-transcript page: this
// one changes once per group, not once per message.
const POLL_MS = 15000;

// A single labelled proportion bar. Used for both tallies so the group view and the
// individual view are read the same way and can be compared at a glance.
const TallyBar = ({ row, answer, highlight }) => {
  const correct = answer && row.name.trim().toLowerCase() === answer.trim().toLowerCase();
  return (
    <div className="mb-2.5 last:mb-0">
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <span className={`text-sm font-semibold truncate ${correct ? 'text-emerald-700' : 'text-[#222]'}`}>
          {row.name}
          {correct && <span className="ml-1.5 text-[10px] font-bold uppercase tracking-wider text-emerald-600">answer</span>}
        </span>
        <span className="shrink-0 text-xs font-bold text-gray-500">{row.pct}% · {row.count}</span>
      </div>
      <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${correct ? 'bg-emerald-500' : highlight}`}
          style={{ width: `${Math.max(row.pct, 2)}%` }}
        />
      </div>
    </div>
  );
};

// One headline number. Deliberately plain — these are read, not admired.
const Stat = ({ label, value, sub }) => (
  <div className="rounded-2xl border border-gray-200 bg-white p-5">
    <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">{label}</p>
    <p className="text-2xl font-extrabold text-[#222]">{value}</p>
    {sub && <p className="mt-1 text-xs text-gray-500">{sub}</p>}
  </div>
);

export default function ManagerExerciseResultsPage() {
  const { configId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get(`/manager-exercise/${configId}/results`);
      setData(res.data);
      return res.data;
    } catch (e) {
      setError(e?.response?.data?.error || 'Could not load these results.');
      return null;
    }
  }, [configId]);

  // Keep polling while any group is still mid-exercise; stop once they have all
  // finished, so a page left open after class doesn't keep asking forever.
  useEffect(() => {
    let timer = null;
    let cancelled = false;
    const tick = async () => {
      const d = await load();
      if (cancelled) return;
      const live = (d?.rooms || []).some((r) => r.phase !== 'done');
      if (!d || live) timer = setTimeout(tick, POLL_MS);
    };
    tick();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [load]);

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#F0F6FB] px-6 text-center">
        <p className="text-sm font-semibold text-red-500 mb-4">{error}</p>
        <button onClick={() => navigate(-1)} className="text-sm font-semibold text-gray-500 hover:text-[#FA6C43]">
          <FaArrowLeft className="inline mr-1.5 text-xs" /> Back
        </button>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F0F6FB] text-gray-400">
        <FaSpinner className="animate-spin mr-2" /> Loading results…
      </div>
    );
  }

  const { totals, answer, rooms, group_tally: groupTally, solo_tally: soloTally } = data;
  const investigating = data.template === 'investigation';
  // The wording follows the same split the student screens do — a hiring class read
  // "hired", so its results page should not suddenly say "named".
  const verb = investigating ? 'named' : 'hired';

  return (
    <div className="min-h-screen bg-[#F0F6FB] text-[#222]" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
      <header className="flex items-center justify-between px-6 py-3 border-b border-gray-200 bg-white/95 backdrop-blur sticky top-0 z-10 h-16 shadow-sm">
        <div className="flex items-center gap-4 min-w-0">
          <button onClick={() => navigate(-1)} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors">
            <FaArrowLeft />
          </button>
          <div className="p-2 rounded-lg bg-gray-100 text-[#1F1F1F]"><FaChartBar className="text-lg" /></div>
          <div className="min-w-0">
            <h1 className="font-semibold text-base truncate">{data.bot_name || 'Manager Exercise'}</h1>
            <p className="text-[11px] font-semibold text-gray-400">Class results</p>
          </div>
        </div>
        <UserInfo />
      </header>

      <main className="p-4 sm:p-6 lg:px-12 xl:px-20">
        <div className="max-w-4xl mx-auto py-6 space-y-8">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label="Groups" value={`${totals.rooms_decided} / ${totals.rooms}`} sub="answered" />
            <Stat label="Students" value={totals.students_voted} sub="picked alone" />
            {answer ? (
              <Stat
                label="Groups correct"
                value={`${totals.rooms_correct} / ${totals.rooms_decided}`}
                sub={`the answer is ${answer}`}
              />
            ) : (
              <Stat label="Answer key" value="—" sub="none recorded on this case" />
            )}
            <Stat
              label="Changed their mind"
              value={rooms.reduce((n, r) => n + r.students.filter((st) => st.changed).length, 0)}
              sub={`private pick ≠ what the group ${verb}`}
            />
          </div>

          {/* The two tallies side by side is the whole point of having captured a
              private round: the gap between them is what the class is about. */}
          <div className="grid md:grid-cols-2 gap-4">
            <section className="rounded-3xl border border-gray-200 bg-white p-6">
              <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500 mb-4">What the groups {verb}</h2>
              {groupTally.length
                ? groupTally.map((row) => <TallyBar key={row.name} row={row} answer={answer} highlight="bg-[#FA6C43]" />)
                : <p className="text-sm text-gray-400">No group has answered yet.</p>}
            </section>
            <section className="rounded-3xl border border-gray-200 bg-white p-6">
              <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500 mb-4">What individuals picked alone</h2>
              {soloTally.length
                ? soloTally.map((row) => <TallyBar key={row.name} row={row} answer={answer} highlight="bg-[#2563EB]" />)
                : <p className="text-sm text-gray-400">Nobody has submitted a private pick yet.</p>}
            </section>
          </div>

          <section className="rounded-3xl border border-gray-200 bg-white overflow-hidden">
            <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500 px-6 pt-6 pb-4">Group by group</h2>
            {rooms.length === 0 && <p className="px-6 pb-6 text-sm text-gray-400">No group has started this exercise yet.</p>}
            {rooms.map((room) => (
              <div key={room.room_id} className="border-t border-gray-100 px-6 py-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
                  <div className="flex items-center gap-2.5">
                    <span className="font-bold">{room.label}</span>
                    {room.phase !== 'done' && (
                      <span className="text-[10px] font-bold uppercase tracking-wider text-[#C2410C]">{room.phase}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-gray-400">{verb}</span>
                    <span className="font-bold">{room.group_choice || '—'}</span>
                    {room.correct === true && <FaCheck className="text-emerald-500 text-xs" />}
                    {room.correct === false && <FaTimes className="text-[#FA6C43] text-xs" />}
                  </div>
                </div>
                {/* Horizontally scrollable so a long case-file name never forces the
                    page itself to scroll sideways. */}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[440px]">
                    <thead>
                      <tr className="text-[11px] font-bold uppercase tracking-wider text-gray-400 text-left">
                        <th className="pb-2 pr-4 font-bold">Student</th>
                        <th className="pb-2 pr-4 font-bold">{investigating ? 'Case file' : 'Role'}</th>
                        <th className="pb-2 font-bold">Picked alone</th>
                      </tr>
                    </thead>
                    <tbody>
                      {room.students.length === 0 && (
                        <tr><td colSpan={3} className="py-2 text-gray-400">Nobody sat in this group.</td></tr>
                      )}
                      {room.students.map((st, i) => (
                        <tr key={i} className="border-t border-gray-50">
                          <td className="py-2 pr-4 font-semibold">{st.name || '—'}</td>
                          <td className="py-2 pr-4 text-gray-500">{st.role || '—'}</td>
                          <td className="py-2">
                            <span className={st.changed ? 'font-semibold text-[#C2410C]' : 'text-gray-600'}>
                              {st.solo_pick || 'no pick'}
                            </span>
                            {/* The one thing worth flagging per row: this person walked
                                in believing something else and the group moved them. */}
                            {st.changed && <span className="ml-2 text-[10px] font-bold uppercase tracking-wider text-gray-400">changed</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </section>
        </div>
      </main>
    </div>
  );
}
