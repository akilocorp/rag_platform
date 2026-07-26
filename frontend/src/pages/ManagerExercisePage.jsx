/* @language JSX  @updated 2026-07-27  @changed One member now enters the decision for the whole team: dropped the per-member vote-progress bar and reworded the choose / choose-again cards accordingly. */
//
// ManagerExercisePage — the student experience for a "manager_exercise" bot_type.
//
// The decision itself happens OFFLINE, on printed packets, before anyone opens
// this page. What's left is the debrief:
//   loading → local-only, before the socket has matched us into a room
//   waiting → room formed, waiting for the rest of the group to load in
//   choose  → the group enters the candidate it already agreed on (chat locked,
//             so the pick is one deliberate act rather than a chat negotiation)
//   discuss → that candidate's outcome document is revealed and ACTR facilitates;
//             a weak pick reopens the ballot inline so the group can choose again
//   done    → discuss window closed. No scorecard: nothing here is graded.
//
// Countdowns derive from the server's `phase_deadline_ts` corrected against
// `server_now_ts` (clock-skew safe), so a refresh / reconnect stays accurate.
// The socket/uid resolution reuses GroupChatPage's patterns verbatim.

import React, { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  FaSpinner, FaPaperPlane, FaUsers, FaArrowLeft, FaLock,
  FaUserTie, FaCheckCircle, FaRegClock, FaChartLine, FaComments,
} from 'react-icons/fa';
import { RiUser3Line } from 'react-icons/ri';
import axios from 'axios';
import { renderMarkdown } from '../utils/markdown';
import { io } from 'socket.io-client';

const getToken = () => localStorage.getItem('jwtToken') || localStorage.getItem('access_token');

// ACTR's messages arrive under this sender; the outcome document is posted under
// a "📊 <Name> — Outcome" sender so both can be styled apart from student chat.
const FACILITATOR_SENDER = 'ACTR';
const OUTCOME_PREFIX = '📊';

// ---------------------------------------------------------------------------
// Small presentational helpers
// ---------------------------------------------------------------------------

// Renders facilitator / peer messages as markdown (matches GroupChatPage idiom);
// the student's own bubble stays plain text.
const MessageBody = React.memo(({ text, isMe }) => {
  const mdRef = useRef(null);
  useLayoutEffect(() => {
    if (isMe) return;
    const el = mdRef.current;
    if (!el) return;
    el.innerHTML = renderMarkdown(text);
  }, [text, isMe]);
  if (isMe) return <p className="whitespace-pre-wrap">{text}</p>;
  return <div ref={mdRef} className="chat-message-md chat-message-md--light max-w-none" />;
});

// Format a whole-second remaining count as m:ss.
const fmtClock = (secs) => {
  const s = Math.max(0, Math.floor(secs));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
};

// The outcome document, rendered as a full-width report card rather than a chat
// bubble — it is the pivot of the session and needs to read as evidence, not as
// something someone said.
const OutcomeCard = ({ title, text }) => {
  const mdRef = useRef(null);
  useLayoutEffect(() => {
    if (mdRef.current) mdRef.current.innerHTML = renderMarkdown(text);
  }, [text]);
  return (
    <div className="rounded-3xl border-2 border-[#FA6C43]/40 bg-gradient-to-br from-[#F9D0C4]/25 to-white shadow-md p-6 sm:p-8 animate-in fade-in zoom-in-95 duration-500">
      <div className="flex items-center gap-2 pb-3 mb-4 border-b border-[#FA6C43]/25">
        <FaChartLine className="text-[#FA6C43]" />
        <span className="text-xs font-bold uppercase tracking-widest text-[#C2410C]">{title}</span>
      </div>
      <div ref={mdRef} className="chat-message-md chat-message-md--light max-w-none text-[15px] leading-[1.7]" />
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

const ManagerExercisePage = () => {
  const { configId } = useParams();
  const navigate = useNavigate();

  // ---- lifecycle / identity ----
  const [config, setConfig] = useState(null);
  const [phase, setPhase] = useState('loading'); // loading|waiting|choose|discuss|done
  const [roomId, setRoomId] = useState(null);
  const [queuePosition, setQueuePosition] = useState(null);

  // ---- exercise snapshot (from `exercise_state`) ----
  const [numStudents, setNumStudents] = useState(0);
  const [roster, setRoster] = useState([]);            // [{name}]
  const [candidates, setCandidates] = useState([]);    // [{name}]
  const [chosenCandidate, setChosenCandidate] = useState(null);

  // ---- countdown, server-clock corrected ----
  const [deadlineTs, setDeadlineTs] = useState(null);
  const clockSkewRef = useRef(0);                       // serverNow - clientNow (secs)
  const [remaining, setRemaining] = useState(null);

  // ---- chat ----
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [chatLocked, setChatLocked] = useState(true);

  // ---- the pick ----
  // One member enters the decision on the team's behalf, so `voted` only guards
  // this client's own double-submit; the ballot closes for everyone on the first
  // valid entry.
  const [ballotOpen, setBallotOpen] = useState(false);
  const [pick, setPick] = useState(null);
  const [voted, setVoted] = useState(false);

  const [userInfo, setUserInfo] = useState(null);

  // ---- refs ----
  const socketRef = useRef(null);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const userIdRef = useRef(null);
  const displayNameRef = useRef(null);
  const phaseRef = useRef('loading');
  const roomIdRef = useRef(null);

  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { roomIdRef.current = roomId; }, [roomId]);

  // Resolve a persistent user identity: JWT user_id → Qualtrics responseId → localStorage.
  // Also derives the DISPLAY NAME, which is what the server stores as the message
  // sender and what ACTR uses to address people, so it has to be resolved up front.
  const resolveUid = async () => {
    const token = getToken();
    if (token) {
      try {
        const res = await axios.get('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
        setUserInfo(res.data);
        const id = res.data?.user_id || res.data?.id || res.data?.email;
        if (id) {
          displayNameRef.current =
            res.data?.name || res.data?.username || String(res.data?.email || id).split('@')[0];
          localStorage.setItem('group_chat_uid', String(id));
          return String(id);
        }
      } catch {}
    }
    const qualtricsId = window.ragChatConfig?.responseId;
    if (qualtricsId && !qualtricsId.includes('${')) {
      const qid = `Q_${qualtricsId}`;
      localStorage.setItem('group_chat_uid', qid);
      return qid;
    }
    let stored = localStorage.getItem('group_chat_uid');
    if (!stored) {
      stored = `User_${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
      localStorage.setItem('group_chat_uid', stored);
    }
    return stored;
  };

  // Apply an `exercise_state` snapshot (from match / reconnect / phase change).
  // Records clock skew from server_now_ts and syncs all derived local state.
  const applyExerciseState = useCallback((s) => {
    if (!s) return;
    if (typeof s.server_now_ts === 'number') {
      clockSkewRef.current = s.server_now_ts - (Date.now() / 1000);
    }
    if (s.phase) setPhase(s.phase);
    setDeadlineTs(typeof s.phase_deadline_ts === 'number' ? s.phase_deadline_ts : null);
    if (typeof s.num_students === 'number') setNumStudents(s.num_students);
    if (Array.isArray(s.roster)) setRoster(s.roster);
    if (Array.isArray(s.candidates)) setCandidates(s.candidates);
    if (s.chosen_candidate !== undefined) setChosenCandidate(s.chosen_candidate);
    if (typeof s.collective_open === 'boolean') setBallotOpen(s.collective_open);
    if (typeof s.you_voted_collective === 'boolean') setVoted(s.you_voted_collective);
    // Chat is only unlocked during discuss (server is authoritative; this is cosmetic).
    setChatLocked(s.phase !== 'discuss');
  }, []);

  // 1. Fetch config + connect socket + wire every event.
  useEffect(() => {
    let isMounted = true;
    const init = async () => {
      try {
        const token = getToken();
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        const [configResponse, uid] = await Promise.all([
          axios.get(`/api/config/${configId}`, { headers }),
          resolveUid(),
        ]);
        if (!isMounted) return;
        userIdRef.current = uid;
        if (!displayNameRef.current) displayNameRef.current = uid;
        setConfig(configResponse.data.config);

        socketRef.current = io('/', { path: '/socket.io' });
        const socket = socketRef.current;

        // The display name rides along on every room entry so the server can seed
        // the roster ACTR addresses and the go-around quorum is measured against.
        const enterRoom = (rid) => socket.emit('get_history', {
          room_id: rid, display_name: displayNameRef.current,
        });

        // Join queue on connect; guard so reconnects never re-queue mid-exercise.
        socket.on('connect', () => {
          if (phaseRef.current !== 'loading' && phaseRef.current !== 'waiting') {
            if (roomIdRef.current) enterRoom(roomIdRef.current);
            return;
          }
          socket.emit('join_queue', { uid: userIdRef.current, config_id: configId });
        });

        socket.on('queued', (data) => {
          setQueuePosition(data.position ?? null);
          if (typeof data.server_now_ts === 'number') {
            clockSkewRef.current = data.server_now_ts - (Date.now() / 1000);
          }
          if (phaseRef.current === 'loading') setPhase('waiting');
        });

        // Matched into a room — pull history + exercise state.
        socket.on('match_found', (data) => {
          setRoomId(data.room_id);
          roomIdRef.current = data.room_id;
          enterRoom(data.room_id);
          if (phaseRef.current === 'loading' || phaseRef.current === 'waiting') setPhase('waiting');
        });

        socket.on('exercise_state', (s) => applyExerciseState(s));

        socket.on('phase_change', (p) => {
          if (typeof p.server_now_ts === 'number') {
            clockSkewRef.current = p.server_now_ts - (Date.now() / 1000);
          }
          setDeadlineTs(typeof p.phase_deadline_ts === 'number' ? p.phase_deadline_ts : null);
          if (p.phase) setPhase(p.phase);
          setChatLocked(p.phase !== 'discuss');
        });

        socket.on('chat_locked', (d) => {
          setChatLocked(typeof d.locked === 'boolean' ? d.locked : true);
        });

        socket.on('chat_history', (data) => {
          if (data.messages) {
            setMessages(data.messages.map((m) => ({ sender: m.sender_role || m.sender, text: m.text })));
          }
        });
        socket.on('message', (data) => {
          setMessages((prev) => [...prev, { sender: data.sender, text: data.text }]);
        });

        // Ballot opened/closed. Reopening during discuss is the "choose again"
        // path, so the local pick is cleared to force a fresh, deliberate entry.
        socket.on('ballot_update', (d) => {
          setBallotOpen(Boolean(d.open));
          if (Array.isArray(d.candidates) && d.candidates.length) setCandidates(d.candidates);
          if (d.open) { setVoted(false); setPick(null); }
        });

        socket.on('collective_result', (d) => {
          setChosenCandidate(d.chosen_candidate);
          setBallotOpen(false);
        });
      } catch (e) {
        console.error('Failed to load manager exercise', e);
      }
    };
    init();
    return () => {
      isMounted = false;
      if (socketRef.current) socketRef.current.disconnect();
    };
  }, [configId, applyExerciseState]);

  // 2. Countdown ticker — derives remaining seconds from the server deadline,
  //    corrected for clock skew, so refresh/reconnect stays accurate.
  useEffect(() => {
    if (!deadlineTs) { setRemaining(null); return; }
    const compute = () => {
      const serverNow = (Date.now() / 1000) + clockSkewRef.current;
      setRemaining(deadlineTs - serverNow);
    };
    compute();
    const id = setInterval(compute, 250);
    return () => clearInterval(id);
  }, [deadlineTs]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Auto-expand the composer textarea.
  const adjustInputHeight = useCallback(() => {
    const ta = inputRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
  }, []);
  useEffect(() => { adjustInputHeight(); }, [input, adjustInputHeight]);

  // ---- actions ----
  const handleLeave = () => {
    if (socketRef.current) {
      socketRef.current.emit('leave_queue', { uid: userIdRef.current });
      socketRef.current.disconnect();
    }
    navigate('/config_list');
  };

  const handleSend = () => {
    if (!input.trim() || !socketRef.current || chatLocked) return;
    socketRef.current.emit('send_message', {
      room_id: roomId, uid: userIdRef.current, text: input,
    });
    setInput('');
  };

  const submitPick = () => {
    if (!pick || voted || !ballotOpen || !socketRef.current) return;
    socketRef.current.emit('submit_collective_vote', {
      room_id: roomId, uid: userIdRef.current, candidate: pick,
    });
    setVoted(true);
  };

  const secsLeft = remaining == null ? null : Math.max(0, remaining);

  // -------------------------------------------------------------------------
  // Shared UI fragments
  // -------------------------------------------------------------------------

  // Prominent countdown chip driven by the server deadline.
  const CountdownChip = ({ label, urgent }) => (
    <div
      className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 shadow-sm transition-all animate-in fade-in zoom-in-95 duration-300 ${
        urgent
          ? 'border-red-300 bg-red-50 text-red-600'
          : 'border-[#FA6C43]/35 bg-gradient-to-r from-[#F9D0C4]/50 to-[#FA6C43]/15 text-[#C2410C]'
      }`}
    >
      <FaRegClock className={`text-sm ${secsLeft != null && secsLeft <= 10 ? 'animate-pulse' : ''}`} />
      <span className="text-xs font-bold uppercase tracking-widest">{label}</span>
      <span className="tabular-nums text-sm font-extrabold">
        {secsLeft == null ? '—:—' : fmtClock(secsLeft)}
      </span>
    </div>
  );

  // The candidate entry grid. Shared by the `choose` phase and the inline
  // re-choice that appears mid-discussion, so both entries look identical.
  const CandidateGrid = ({ compact }) => (
    <>
      <div className="grid gap-3">
        {candidates.map((c, i) => {
          const selected = pick === c.name;
          return (
            <button
              key={c.name}
              disabled={voted || !ballotOpen}
              onClick={() => setPick(c.name)}
              style={{ animationDelay: `${i * 50}ms` }}
              className={`text-left rounded-2xl border-2 transition-all animate-in fade-in slide-in-from-bottom-1 disabled:cursor-default active:scale-[0.99] ${
                compact ? 'px-4 py-3' : 'px-5 py-4'
              } ${
                selected
                  ? 'border-[#FA6C43] bg-[#FA6C43]/5 shadow-sm'
                  : 'border-gray-200 bg-white hover:border-[#FA6C43]/50 hover:-translate-y-0.5'
              } ${voted && !selected ? 'opacity-40' : ''}`}
            >
              <div className="flex items-center gap-3">
                <span className={`flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                  selected ? 'border-[#FA6C43] bg-[#FA6C43]' : 'border-gray-300'
                }`}>
                  {selected && <span className="w-2 h-2 rounded-full bg-white" />}
                </span>
                <span className="font-semibold text-[#222]">{c.name}</span>
              </div>
            </button>
          );
        })}
      </div>
      {!voted && (
        <button
          onClick={submitPick}
          disabled={!pick || !ballotOpen}
          className="mt-5 w-full rounded-2xl bg-[#FA6C43] hover:bg-[#E55B34] text-white font-bold py-3.5 shadow-sm disabled:opacity-50 transition-all active:scale-[0.98]"
        >
          Enter our choice
        </button>
      )}
      {voted && (
        <p className="mt-4 inline-flex items-center gap-1.5 text-xs font-bold text-emerald-600">
          <FaCheckCircle /> Submitted for the group
        </p>
      )}
    </>
  );

  // One transcript entry. Three kinds: the outcome document (a report card), an
  // ACTR turn (accented, never right-aligned), and a student turn.
  const Transcript = () => (
    <div className="w-full space-y-6 pb-4">
      {messages.map((msg, i) => {
        const sender = msg.sender || '';
        if (sender.startsWith(OUTCOME_PREFIX)) {
          return <OutcomeCard key={i} title={sender.replace(OUTCOME_PREFIX, '').trim()} text={msg.text} />;
        }
        const isFacilitator = sender === FACILITATOR_SENDER;
        const isMe = !isFacilitator && sender === displayNameRef.current;
        return (
          <div key={i} className={`flex gap-4 ${isMe ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-2 duration-300`}>
            {!isMe && (
              <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center mt-1 ${
                isFacilitator ? 'bg-[#FA6C43] text-white' : 'bg-[#F9D0C4]/60 text-[#FA6C43]'
              }`}>
                {isFacilitator
                  ? <FaComments className="text-xs" />
                  : <span className="text-xs font-bold">{sender.substring(0, 2).toUpperCase()}</span>}
              </div>
            )}
            <div className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
              {!isMe && <span className="text-[10px] font-bold text-gray-500 ml-1 mb-1">{sender}</span>}
              <div className={`min-w-0 max-w-[88%] rounded-2xl px-5 py-3 shadow-sm text-[15px] leading-[1.65] break-words overflow-hidden ${
                isMe
                  ? 'bg-[#FA6C43] text-white rounded-br-none'
                  : isFacilitator
                    ? 'bg-white border-2 border-[#FA6C43]/30 text-[#222] rounded-bl-none'
                    : 'bg-white border border-gray-200 text-[#222] rounded-bl-none'
              }`}>
                <MessageBody text={msg.text} isMe={isMe} />
              </div>
            </div>
            {isMe && (
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[#F9D0C4]/60 flex items-center justify-center mt-1">
                <RiUser3Line className="text-[#FA6C43] text-sm" />
              </div>
            )}
          </div>
        );
      })}
      <div ref={messagesEndRef} />
    </div>
  );

  // -------------------------------------------------------------------------
  // Phase: loading
  // -------------------------------------------------------------------------
  if (phase === 'loading') {
    return (
      <div className="h-screen flex items-center justify-center bg-[#F0F6FB] text-[#222]">
        <FaSpinner className="animate-spin text-4xl text-[#FA6C43]" />
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Phase: waiting (group assembling)
  // -------------------------------------------------------------------------
  if (phase === 'waiting') {
    const joined = roster.length || (queuePosition != null ? 1 : 0);
    const target = numStudents || config?.group_size || 0;
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-[#F0F6FB] text-[#222]" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
        <div className="flex flex-col items-center gap-6 bg-white rounded-3xl shadow-md border border-gray-100 px-12 py-14 max-w-md w-full mx-4 animate-in fade-in zoom-in-95 duration-300">
          <div className="relative flex items-center justify-center w-20 h-20 rounded-3xl bg-[#F9D0C4]/40">
            <FaUsers className="text-4xl text-[#FA6C43]" />
            <span className="absolute -top-1 -right-1 flex h-4 w-4">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#FA6C43] opacity-60" />
              <span className="relative inline-flex h-4 w-4 rounded-full bg-[#FA6C43]" />
            </span>
          </div>

          <div className="text-center">
            <h2 className="text-xl font-bold text-[#222] mb-2">Assembling your group…</h2>
            <p className="text-gray-500 text-sm">Waiting for the rest of your team to join.</p>
          </div>

          {target > 0 && (
            <div className="inline-flex items-center gap-2 rounded-full border border-[#FA6C43]/35 bg-gradient-to-r from-[#F9D0C4]/50 to-[#FA6C43]/15 px-4 py-2 shadow-sm">
              <span className="text-xs font-bold uppercase tracking-widest text-[#C2410C]">
                {joined} of {target} joined
              </span>
            </div>
          )}

          {queuePosition != null && !roster.length && (
            <div className="text-xs font-semibold text-gray-500">Position in queue: {queuePosition}</div>
          )}

          {roster.length > 0 && (
            <div className="flex flex-wrap items-center justify-center gap-2">
              {roster.map((m, i) => (
                <span
                  key={i}
                  style={{ animationDelay: `${i * 60}ms` }}
                  className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-semibold text-gray-600 shadow-sm animate-in fade-in slide-in-from-bottom-1"
                >
                  <FaUserTie className="text-[10px]" /> {m.name}
                </span>
              ))}
            </div>
          )}

          <FaSpinner className="animate-spin text-2xl text-[#FA6C43] opacity-60" />

          <button
            onClick={handleLeave}
            className="mt-1 inline-flex items-center gap-2 text-sm font-semibold text-gray-500 hover:text-[#FA6C43] transition-colors active:scale-95"
          >
            <FaArrowLeft className="text-xs" /> Leave
          </button>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Phase: choose (enter the pick the group already made on paper)
  // -------------------------------------------------------------------------
  if (phase === 'choose') {
    return (
      <div className="h-screen flex flex-col bg-[#F0F6FB] text-[#222]" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
        <header className="flex items-center justify-between px-6 py-3 border-b border-gray-200 bg-white/95 backdrop-blur z-10 h-16 shadow-sm">
          <div className="flex items-center gap-4 min-w-0">
            <div className="p-2 rounded-lg bg-gray-100 text-[#1F1F1F]"><FaUsers className="text-xl" /></div>
            <h1 className="font-semibold text-[#222] text-base truncate">
              {config?.bot_name || 'Manager Exercise'}
            </h1>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:px-12 xl:px-20 scrollbar-thin">
          <div className="max-w-2xl mx-auto space-y-6">
            {/* ACTR's opener arrives as a normal message even though chat is
                locked, so the question and the buttons read as one prompt. */}
            <Transcript />

            <section className="rounded-3xl bg-white border border-gray-200 shadow-md p-8 animate-in fade-in slide-in-from-bottom-3 duration-400">
              <h2 className="text-lg font-bold text-[#222] mb-1">Your group's decision</h2>
              <p className="text-sm text-gray-500 mb-5">
                One of you enters the candidate the group already agreed on — it counts for the whole team.
              </p>
              <CandidateGrid />
            </section>
          </div>
        </main>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Phase: done (no scorecard — this exercise is not graded)
  // -------------------------------------------------------------------------
  if (phase === 'done') {
    return (
      <div className="h-screen flex flex-col bg-[#F0F6FB] text-[#222]" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:px-12 xl:px-20 scrollbar-thin">
          <div className="max-w-2xl mx-auto py-10 space-y-6">
            <div className="rounded-3xl bg-white border border-gray-200 shadow-md p-10 text-center animate-in fade-in zoom-in-95 duration-400">
              <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-3xl bg-[#F9D0C4]/40">
                <FaCheckCircle className="text-3xl text-[#FA6C43]" />
              </div>
              <h2 className="text-2xl font-bold text-[#222] mb-2">Session complete</h2>
              <p className="text-gray-500 text-sm">
                {chosenCandidate
                  ? <>Your group's final choice was <strong className="text-[#222]">{chosenCandidate}</strong>.</>
                  : 'Thanks for taking part.'}
              </p>
              <button
                onClick={() => navigate('/config_list')}
                className="mt-7 inline-flex items-center gap-2 rounded-2xl bg-[#FA6C43] hover:bg-[#E55B34] text-white font-bold px-6 py-3 shadow-sm transition-all active:scale-95"
              >
                <FaArrowLeft className="text-xs" /> Back
              </button>
            </div>
            <Transcript />
          </div>
        </main>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Phase: discuss (default render — outcome + facilitated chat)
  // -------------------------------------------------------------------------
  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[#F0F6FB] font-sans text-[#222]" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
      <header className="flex items-center justify-between px-6 py-3 border-b border-gray-200 bg-white/95 backdrop-blur z-10 h-16 shadow-sm">
        <div className="flex items-center gap-4 min-w-0">
          <div className="p-2 rounded-lg bg-gray-100 text-[#1F1F1F]"><FaUsers className="text-xl" /></div>
          <div className="min-w-0 flex items-center gap-3">
            <h1 className="font-semibold text-[#222] text-base truncate">
              {config?.bot_name || 'Manager Exercise'}
            </h1>
            {chosenCandidate && (
              <span className="hidden sm:inline-flex items-center gap-1 rounded-full border border-[#FA6C43]/35 bg-[#FA6C43]/5 px-3 py-1 text-xs font-semibold text-[#C2410C] shadow-sm">
                <FaUserTie className="text-[10px]" /> {chosenCandidate}
              </span>
            )}
          </div>
        </div>
        {secsLeft != null && <CountdownChip label="Discuss" urgent={secsLeft <= 20} />}
      </header>

      <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:px-12 xl:px-20 scrollbar-thin">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 opacity-80 animate-in fade-in duration-500">
            <div className="w-20 h-20 bg-gray-100 rounded-3xl flex items-center justify-center mb-6 text-[#1F1F1F]">
              <FaUsers className="text-4xl" />
            </div>
            <h2 className="text-2xl font-bold text-[#222] mb-2">The floor is open</h2>
            <p className="text-gray-500 text-center max-w-sm">
              Talk it through with your group. ACTR will step in when it's useful.
            </p>
          </div>
        )}

        <Transcript />

        {/* Re-choice: the ballot reopens inside discuss rather than moving the
            room to a new phase, so the conversation keeps running around it. */}
        {ballotOpen && (
          <section className="mt-6 max-w-xl rounded-3xl bg-white border-2 border-[#FA6C43]/40 shadow-md p-6 animate-in fade-in slide-in-from-bottom-3 duration-400">
            <h2 className="text-base font-bold text-[#222] mb-1">Choose again</h2>
            <p className="text-sm text-gray-500 mb-4">One of you enters the group's new choice when you're ready.</p>
            <CandidateGrid compact />
          </section>
        )}
      </main>

      <footer className="p-4 sm:p-6 lg:px-12 xl:px-20 bg-white border-t border-gray-200">
        {chatLocked && (
          <div className="mb-3 flex items-center justify-center gap-2 text-xs font-semibold text-gray-400 animate-in fade-in">
            <FaLock className="text-[11px]" /> Chat is locked right now.
          </div>
        )}
        <div className="w-full relative flex items-center gap-3">
          <textarea
            ref={inputRef}
            value={input}
            disabled={chatLocked}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
            }}
            placeholder={chatLocked ? 'Discussion is not open yet…' : 'Talk it through…'}
            rows={1}
            className="flex-1 min-h-[52px] max-h-[200px] resize-none overflow-y-auto scrollbar-hide bg-[#F0F6FB] text-[#222] placeholder-gray-500 border border-gray-200 rounded-2xl px-5 py-4 focus:outline-none focus:ring-2 focus:ring-[#FA6C43]/50 focus:border-[#FA6C43]/50 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || chatLocked}
            className="p-4 bg-[#FA6C43] hover:bg-[#E55B34] text-white rounded-2xl disabled:opacity-50 transition-all active:scale-95"
          >
            <FaPaperPlane className="text-lg" />
          </button>
        </div>
      </footer>
    </div>
  );
};

export default ManagerExercisePage;
