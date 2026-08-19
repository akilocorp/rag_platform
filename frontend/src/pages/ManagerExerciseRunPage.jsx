/* @language JSX  @updated 2026-08-19  @changed Shows the facilitator's current step during the debrief. Prior: New page: the professor's view of a manager-exercise test run — the whole room's transcript, polled while it plays, with the phase it is in, who sat in which seat, the private round-0 spread and the hire. */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { FaArrowLeft, FaFlask, FaSpinner, FaCheckCircle } from 'react-icons/fa';
import apiClient from '../api/apiClient';
import UserInfo from '../components/UserInfo';
import { renderMarkdown } from '../utils/markdown';

const FACILITATOR = 'ACTR';
const OUTCOME_PREFIX = '\u{1F4CA}';
const SYSTEM_SENDERS = ['Exercise', 'System'];

// How often the transcript is re-read while a run is in flight. A run posts a
// message every few seconds at most, so this is well inside "feels live" without
// making a five-minute run into three hundred requests.
const POLL_MS = 4000;

// The phases in order, with what each one IS rather than its internal name — the
// professor never saw the state machine and should not have to learn it to read
// this page.
const PHASES = [
  { id: 'waiting', label: 'Seating' },
  { id: 'solo', label: 'Round 0 — private picks' },
  { id: 'discuss', label: 'Round 1 — the group decides' },
  { id: 'choose', label: 'The hire' },
  { id: 'kiosk', label: 'Six months later' },
  { id: 'debrief', label: 'Round 2 — debrief with ACTR' },
  { id: 'done', label: 'Finished' },
];

export default function ManagerExerciseRunPage() {
  const { configId, roomId } = useParams();
  const navigate = useNavigate();
  const [run, setRun] = useState(null);
  const [error, setError] = useState('');
  const bottomRef = useRef(null);
  // Only autoscroll while the reader is already at the bottom. Yanking the view
  // down while someone is rereading an earlier exchange is the whole reason live
  // transcripts get closed.
  const stickRef = useRef(true);

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get(`/manager-exercise/run/${roomId}`);
      setRun(res.data);
      return res.data;
    } catch (e) {
      setError(e?.response?.data?.error || 'Could not load this run.');
      return null;
    }
  }, [roomId]);

  useEffect(() => {
    let timer = null;
    let cancelled = false;
    const tick = async () => {
      const data = await load();
      if (cancelled) return;
      // Stop polling once the room is finished — the transcript cannot change
      // after that, and a page left open overnight should not keep asking.
      if (data && data.phase !== 'done') timer = setTimeout(tick, POLL_MS);
    };
    tick();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [load]);

  useEffect(() => {
    if (stickRef.current) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [run?.messages?.length]);

  const onScroll = (e) => {
    const el = e.currentTarget;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  const phase = run?.phase || 'waiting';
  const running = phase !== 'done';
  const phaseIndex = Math.max(0, PHASES.findIndex((p) => p.id === phase));
  const messages = run?.messages || [];
  const roster = run?.roster || [];
  const spread = run?.solo_spread || {};

  if (error) {
    return (
      <div className="min-h-screen bg-[#F0F6FB] flex items-center justify-center p-6">
        <div className="max-w-md text-center bg-white rounded-3xl border border-gray-200 shadow-md p-10">
          <p className="text-sm font-semibold text-gray-700">{error}</p>
          <button
            onClick={() => navigate('/config_list')}
            className="mt-6 rounded-2xl bg-[#FA6C43] hover:bg-[#E55B34] text-white font-bold px-5 py-2.5 text-sm transition-all active:scale-95"
          >
            Back to the config
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-[#F0F6FB] text-[#222]" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
      <header className="flex items-center justify-between px-6 py-3 border-b border-gray-200 bg-white/95 backdrop-blur z-10 h-16 shadow-sm">
        <div className="flex items-center gap-4 min-w-0">
          <button
            onClick={() => navigate(-1)}
            title="Back"
            className="p-2 rounded-lg text-gray-400 hover:text-[#FA6C43] hover:bg-gray-100 transition-colors"
          >
            <FaArrowLeft />
          </button>
          <div className="p-2 rounded-lg bg-[#F9D0C4]/40 text-[#FA6C43]"><FaFlask /></div>
          <div className="min-w-0">
            <h1 className="font-semibold text-base truncate">Test run</h1>
            <p className="text-[11px] text-gray-400 truncate">Simulated students · not a real class</p>
          </div>
        </div>
        <UserInfo />
      </header>

      <main onScroll={onScroll} className="flex-1 overflow-y-auto p-4 sm:p-6 lg:px-12 xl:px-20 scrollbar-thin">
        <div className="max-w-3xl mx-auto space-y-5">
          {/* Where the room is. A test run is unattended, so the single most
              useful thing this page can say is whether it is still going. */}
          <section className="rounded-3xl bg-white border border-gray-200 shadow-sm p-5">
            <div className="flex items-center gap-2 mb-4">
              {running
                ? <FaSpinner className="animate-spin text-[#FA6C43] text-sm" />
                : <FaCheckCircle className="text-emerald-500 text-sm" />}
              <span className="text-sm font-bold">
                {PHASES[phaseIndex]?.label || phase}
              </span>
              {/* Which step of the facilitator's sequence the debrief is on. Only
                  meaningful during the debrief, and it is where a session that skips
                  its own pedagogy does the skipping. */}
              {run?.facilitator_step && phase === 'debrief' && (
                <span className="rounded-full bg-[#F9D0C4]/50 px-2 py-0.5 text-[10px] font-extrabold tracking-wide text-[#C2410C]">
                  step {run.facilitator_step}
                </span>
              )}
              {running && <span className="text-[11px] font-semibold text-gray-400">live</span>}
            </div>
            <div className="flex gap-1">
              {PHASES.map((p, i) => (
                <div
                  key={p.id}
                  title={p.label}
                  className={`h-1.5 flex-1 rounded-full transition-colors ${
                    i < phaseIndex ? 'bg-[#FA6C43]' : i === phaseIndex ? 'bg-[#FA6C43]/60' : 'bg-gray-200'
                  }`}
                />
              ))}
            </div>

            {(roster.length > 0 || Object.keys(spread).length > 0 || run?.chosen_candidate) && (
              <div className="mt-5 grid gap-4 sm:grid-cols-3 text-[11px]">
                <div>
                  <p className="font-bold text-gray-400 uppercase tracking-wider mb-1.5">Seats</p>
                  {roster.map((e) => (
                    <p key={e.uid} className="text-gray-600">
                      <span className="font-semibold text-gray-800">{e.name}</span>
                      {e.role ? ` — ${e.role}` : ''}
                    </p>
                  ))}
                </div>
                <div>
                  {/* The one number that says whether the case pack works: if every
                      seat picks the same person alone, nothing was hidden. */}
                  <p className="font-bold text-gray-400 uppercase tracking-wider mb-1.5">Private picks</p>
                  {Object.keys(spread).length === 0
                    ? <p className="text-gray-400">—</p>
                    : Object.entries(spread).map(([name, n]) => (
                      <p key={name} className="text-gray-600">
                        <span className="font-semibold text-gray-800">{n}</span> {name}
                      </p>
                    ))}
                </div>
                <div>
                  <p className="font-bold text-gray-400 uppercase tracking-wider mb-1.5">Hired</p>
                  <p className="text-gray-600 font-semibold">{run?.chosen_candidate || '—'}</p>
                </div>
              </div>
            )}
          </section>

          {/* The transcript. Rendered as a document rather than as chat bubbles:
              this is being read afterwards, in one pass, by one person. */}
          <section className="rounded-3xl bg-white border border-gray-200 shadow-sm p-6 sm:p-8 space-y-5">
            {messages.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-8">
                The room is getting started — the first messages land shortly.
              </p>
            )}
            {messages.map((m, i) => {
              const sender = m.sender || '';
              const isActr = sender === FACILITATOR;
              const isOutcome = sender.startsWith(OUTCOME_PREFIX);
              const isSystem = SYSTEM_SENDERS.includes(sender);
              if (isOutcome || isSystem) {
                return (
                  <div key={i} className="rounded-2xl bg-gray-50 border border-gray-100 px-5 py-4">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">
                      {isOutcome ? sender.replace(OUTCOME_PREFIX, '').trim() || 'Outcome' : sender}
                    </p>
                    <div
                      className="chat-message-md text-sm text-gray-600"
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(m.text || '') }}
                    />
                  </div>
                );
              }
              return (
                <div key={i} className={isActr ? 'border-l-2 border-[#FA6C43] pl-4' : 'pl-4'}>
                  <p className={`text-[11px] font-bold mb-1 ${isActr ? 'text-[#C2410C]' : 'text-gray-400'}`}>
                    {sender}
                  </p>
                  <div
                    className="chat-message-md text-sm text-gray-700"
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(m.text || '') }}
                  />
                  {/* ACTR's private note on why it took the turn. Stored on the
                      message and never shown to students; this page is the only
                      place it is readable, and it is the fastest way to tell a
                      good facilitator turn from a lucky one. */}
                  {m.reasoning && (
                    <p className="mt-1.5 text-[11px] italic text-gray-400">{m.reasoning}</p>
                  )}
                </div>
              );
            })}
            <div ref={bottomRef} />
          </section>
        </div>
      </main>
    </div>
  );
}
