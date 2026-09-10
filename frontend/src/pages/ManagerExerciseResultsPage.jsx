/* @language JSX  @updated 2026-09-11  @changed Two AI reads added to the page: a "Class summary" card
   (a few sentences on what the whole class did, generated once per page load, not per 15s poll) and a
   click-through per-group modal — four sentences covering what the group did, what each member picked
   alone, what they decided together, and what their debrief surfaced, cached per room. Group labels in
   the roster are now buttons that open it.
   Prior: "Group by group" rebuilt as one continuous roster (Group /
   Name / Role / Individual decision / Group decision) instead of a boxed mini-table per room: `rowSpan`
   merges the Group and Group-decision cells down each group's row block (a professor asked for exactly this
   shape — the layout they'd get pasting the data into a spreadsheet by hand), styled as an app table rather
   than a literal grid — alternating soft tint per GROUP (not per row), a rounded `GroupDecisionBadge`
   carrying the right/wrong verdict as color, initials `Avatar` per student, and a blank spacer `<tr>`
   marking the boundary between groups. Prior: New page: the professor's class results for a manager
   exercise — every group's answer, every student's own private pick and which case file they held,
   plus class-wide percentages. It exists because the `investigation` template deliberately never
   tells a room whether it was right; this is where that conversation happens instead. */
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { FaArrowLeft, FaCheck, FaTimes, FaChartBar, FaSpinner, FaRedo } from 'react-icons/fa';
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

// A student's initial in a soft circle, so the "Group by group" table reads
// like a roster rather than a plain column of text.
const initials = (name) => (name || '?').trim().charAt(0).toUpperCase();
const Avatar = ({ name }) => (
  <span className="shrink-0 w-7 h-7 rounded-full bg-[#F9D0C4]/50 text-[#C2410C] text-[11px] font-bold flex items-center justify-center">
    {initials(name)}
  </span>
);

// The one thing a group ends on, styled as a single badge rather than a bare
// name: color carries the verdict (right/wrong against the pack's answer key,
// or neutral when there is none to check against — the `investigation`
// template never reveals one in the room), and an in-progress room says so
// underneath instead of implying a decision that hasn't happened yet.
const GroupDecisionBadge = ({ choice, correct, phase }) => {
  const tone = correct === true
    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : correct === false
      ? 'bg-[#F9D0C4]/40 text-[#C2410C] border-[#FA6C43]/30'
      : 'bg-gray-100 text-gray-700 border-gray-200';
  return (
    <div className="inline-flex flex-col items-center gap-1.5">
      <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-bold ${tone}`}>
        {choice || '—'}
        {correct === true && <FaCheck className="text-xs" />}
        {correct === false && <FaTimes className="text-xs" />}
      </span>
      {phase !== 'done' && (
        <span className="text-[10px] font-bold uppercase tracking-wider text-[#C2410C]">{phase}</span>
      )}
    </div>
  );
};

// One group's four sentences, over the page. Opened by clicking a group in the roster
// below; the text is generated on open and kept per room for the life of the page, so
// clicking back into a group you already read costs nothing.
const GroupSummaryModal = ({ room, text, loading, error, onRegenerate, onClose }) => {
  if (!room) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-5 bg-black/45"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-xl max-h-[80vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <h3 className="text-base font-extrabold text-[#222]">{room.label}</h3>
            <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
              {room.students.length} student{room.students.length === 1 ? '' : 's'}
              {room.group_choice ? ` · ${room.group_choice}` : ''}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-2 rounded-lg text-gray-400 hover:bg-gray-100">
            <FaTimes />
          </button>
        </div>
        {loading ? (
          <p className="flex items-center gap-2 text-sm text-gray-400 py-4">
            <FaSpinner className="animate-spin" /> Reading this group’s session…
          </p>
        ) : error ? (
          <p className="text-sm text-red-500 py-2">{error}</p>
        ) : (
          <p className="text-sm leading-relaxed text-gray-700 whitespace-pre-line">{text}</p>
        )}
        <div className="flex justify-end mt-5">
          <button
            onClick={onRegenerate}
            disabled={loading}
            className="text-xs font-semibold text-gray-500 hover:text-[#FA6C43] flex items-center gap-1.5 disabled:opacity-40"
          >
            <FaRedo /> Regenerate
          </button>
        </div>
      </div>
    </div>
  );
};

export default function ManagerExerciseResultsPage() {
  const { configId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  // Class-level summary — asked for once the results have loaded, and only when at
  // least one group has actually decided something to summarize.
  const [classSummary, setClassSummary] = useState('');
  const [classLoading, setClassLoading] = useState(false);
  const [classError, setClassError] = useState('');

  // Per-group summaries, cached by room id so reopening a group is instant.
  const [openRoom, setOpenRoom] = useState(null);
  const [groupSummaries, setGroupSummaries] = useState({});
  const [groupLoading, setGroupLoading] = useState(false);
  const [groupError, setGroupError] = useState('');

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

  const loadClassSummary = useCallback(async (d) => {
    if (!d || !(d.rooms || []).some((r) => r.group_choice)) return;
    setClassLoading(true);
    setClassError('');
    try {
      const res = await apiClient.post(`/manager-exercise/${configId}/class-summary`, {
        rooms: d.rooms, answer: d.answer, template: d.template,
      });
      setClassSummary(res.data.summary || '');
    } catch (e) {
      setClassError(e?.response?.data?.error || 'Could not generate a class summary.');
    } finally {
      setClassLoading(false);
    }
  }, [configId]);

  // Generate once, when the first load lands with something worth summarizing. Polling
  // re-runs `load` every 15s while groups are live, so this deliberately does NOT key
  // off `data` — a professor watching a class finish should not get a new paragraph
  // (and a new bill) every fifteen seconds.
  useEffect(() => {
    if (data && !classSummary && !classLoading && !classError) loadClassSummary(data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!data]);

  const loadGroupSummary = useCallback(async (room, force) => {
    if (!force && groupSummaries[room.room_id]) return;
    setGroupLoading(true);
    setGroupError('');
    try {
      const res = await apiClient.post(`/manager-exercise/${configId}/group-summary/${room.room_id}`, {});
      setGroupSummaries((prev) => ({ ...prev, [room.room_id]: res.data.summary || '' }));
    } catch (e) {
      setGroupError(e?.response?.data?.error || 'Could not summarize this group.');
    } finally {
      setGroupLoading(false);
    }
  }, [configId, groupSummaries]);

  const openGroup = (room) => {
    setOpenRoom(room);
    setGroupError('');
    loadGroupSummary(room, false);
  };

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

          {/* What the class did, in prose — the thing a professor reads out before
              opening the discussion, written from the same tallies rendered below. */}
          {(rooms.some((r) => r.group_choice)) && (
            <section className="rounded-3xl border border-gray-200 bg-white p-6">
              <div className="flex items-center justify-between gap-3 mb-3">
                <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500">Class summary</h2>
                <button
                  onClick={() => loadClassSummary(data)}
                  disabled={classLoading}
                  className="text-xs font-semibold text-gray-500 hover:text-[#FA6C43] flex items-center gap-1.5 disabled:opacity-40"
                >
                  <FaRedo /> Regenerate
                </button>
              </div>
              {classLoading ? (
                <p className="flex items-center gap-2 text-sm text-gray-400">
                  <FaSpinner className="animate-spin" /> Reading the class…
                </p>
              ) : classError ? (
                <p className="text-sm text-gray-500">{classError}</p>
              ) : (
                <p className="text-sm leading-relaxed text-gray-700 whitespace-pre-line">{classSummary}</p>
              )}
            </section>
          )}

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

          {/* One continuous roster rather than a boxed table per group: every
              student, top to bottom, grouped by which room they sat in.
              `rowSpan` merges the Group and Group-decision cells down the height
              of their block (so the decision reads once, not once per student);
              a soft background tint on alternating groups plus a blank spacer
              row between them does the rest of the grouping work, without
              drawing it as a hard spreadsheet grid. */}
          <section className="rounded-3xl border border-gray-200 bg-white overflow-hidden">
            <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500 px-6 pt-6 pb-1">Group by group</h2>
            <p className="px-6 pb-4 text-xs text-gray-400">Click a group to read what happened in it.</p>
            {rooms.length === 0 && <p className="px-6 pb-6 text-sm text-gray-400">No group has started this exercise yet.</p>}
            {rooms.length > 0 && (
              <div className="overflow-x-auto px-2 pb-2 sm:px-4 sm:pb-4">
                <table className="w-full text-sm min-w-[600px]">
                  <thead>
                    <tr className="text-[11px] font-bold uppercase tracking-wider text-gray-400 text-left">
                      <th className="px-4 pb-3 font-bold">Group</th>
                      <th className="px-4 pb-3 font-bold">Name</th>
                      <th className="px-4 pb-3 font-bold">{investigating ? 'Case file' : 'Role'}</th>
                      <th className="px-4 pb-3 font-bold">Individual decision</th>
                      <th className="px-4 pb-3 font-bold text-center">Group decision</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rooms.map((room, ri) => {
                      // A room with nobody in it still gets one row, so the group
                      // itself (and its "nobody sat here" state) is never silently
                      // dropped from the roster.
                      const rowCount = Math.max(room.students.length, 1);
                      // Alternating tint per GROUP (not per row) is the main visual
                      // grouping cue — the gap between groups reads as a boundary,
                      // and the shared tint reads as "these rows belong together".
                      const tint = ri % 2 === 1 ? 'bg-gray-50/70' : 'bg-white';
                      return (
                        <React.Fragment key={room.room_id}>
                          {room.students.length === 0 ? (
                            <tr className={tint}>
                              <td className="px-4 py-3 rounded-l-xl">
                                <button
                                  onClick={() => openGroup(room)}
                                  className="inline-flex px-2.5 py-1 rounded-lg bg-gray-100 text-gray-600 text-xs font-bold whitespace-nowrap hover:bg-[#FA6C43] hover:text-white transition-colors"
                                >
                                  {room.label}
                                </button>
                              </td>
                              <td colSpan={3} className="px-4 py-3 text-gray-400 italic">Nobody sat in this group.</td>
                              <td className="px-4 py-3 text-center rounded-r-xl">
                                {room.phase !== 'done' && (
                                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#C2410C]">{room.phase}</span>
                                )}
                              </td>
                            </tr>
                          ) : room.students.map((st, i) => (
                            <tr key={i} className={tint}>
                              {i === 0 && (
                                <td rowSpan={rowCount} className="px-4 py-3 align-middle rounded-l-xl">
                                  <span className="inline-flex px-2.5 py-1 rounded-lg bg-gray-100 text-gray-600 text-xs font-bold whitespace-nowrap">
                                    {room.label}
                                  </span>
                                </td>
                              )}
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2.5">
                                  <Avatar name={st.name} />
                                  <span className="font-semibold text-[#222]">{st.name || '—'}</span>
                                </div>
                              </td>
                              <td className="px-4 py-3 text-gray-500">{st.role || '—'}</td>
                              <td className="px-4 py-3">
                                <span className={st.changed ? 'font-semibold text-[#C2410C]' : 'text-gray-600'}>
                                  {st.solo_pick || 'no pick'}
                                </span>
                                {/* The one thing worth flagging per row: this person
                                    walked in believing something else and the group
                                    moved them. */}
                                {st.changed && (
                                  <span className="ml-2 text-[10px] font-bold uppercase tracking-wider text-[#C2410C] bg-[#F9D0C4]/40 rounded-full px-2 py-0.5">
                                    changed
                                  </span>
                                )}
                              </td>
                              {i === 0 && (
                                <td rowSpan={rowCount} className="px-4 py-3 text-center align-middle rounded-r-xl">
                                  <GroupDecisionBadge choice={room.group_choice} correct={room.correct} phase={room.phase} />
                                </td>
                              )}
                            </tr>
                          ))}
                          {/* Spacer row between groups — none after the last one. */}
                          {ri < rooms.length - 1 && (
                            <tr aria-hidden="true"><td colSpan={5} className="h-5" /></tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </main>

      <GroupSummaryModal
        room={openRoom}
        text={openRoom ? groupSummaries[openRoom.room_id] : ''}
        loading={groupLoading}
        error={groupError}
        onRegenerate={() => openRoom && loadGroupSummary(openRoom, true)}
        onClose={() => setOpenRoom(null)}
      />
    </div>
  );
}
