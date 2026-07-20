/* @language JSX  @updated 2026-07-20  @changed Memorize phase renders the briefing as side-by-side candidate cards (parsed from doc_text; hover lifts + orange-accents each card; stacks on phones; falls back to raw text for non-list docs). Prior: everyone renders by ROLE NAME so AI seats are indistinguishable; waiting-screen auto-start countdown; roster shows no AI markers. */
//
// ManagerExercisePage — the student experience for a "manager_exercise" bot_type.
//
// Phases (mirror the backend state machine in the contract §3):
//   loading  → local-only, before the socket has matched us into a room
//   waiting  → room formed, seats filling (N of M joined + no-show auto-fill countdown)
//   memorize → this student's PRIVATE document is shown + a prominent countdown;
//              on `document_locked` the doc card animates out and is discarded forever
//   discuss  → chat UI + countdown chip; AI-Manager nudges arrive as normal `message`s;
//              the composer is disabled unless phase === "discuss" (server also enforces)
//   decide   → individual single-select ballot, then the SEPARATE collective group ballot;
//              live "k of N voted" tally animates on `vote_update`
//   grading  → brief "grading in progress" interstitial
//   done     → per-student scorecard: count-up numbers, animated bars, correct-answer reveal
//
// Countdowns derive from the server's `phase_deadline_ts` corrected against
// `server_now_ts` (clock-skew safe), so a refresh / reconnect stays accurate.
// The socket/uid resolution reuses GroupChatPage's patterns verbatim.

import React, { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  FaSpinner, FaPaperPlane, FaUsers, FaArrowLeft, FaLock,
  FaUserTie, FaCheckCircle, FaBrain, FaRegClock, FaTrophy, FaVoteYea,
} from 'react-icons/fa';
import { RiUser3Line } from 'react-icons/ri';
import axios from 'axios';
import { renderMarkdown } from '../utils/markdown';
import { io } from 'socket.io-client';

const getToken = () => localStorage.getItem('jwtToken') || localStorage.getItem('access_token');

// ---------------------------------------------------------------------------
// Small presentational helpers
// ---------------------------------------------------------------------------

// Renders AI-manager / peer messages as markdown (matches GroupChatPage idiom);
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

// Count-up animated number (used on the scorecard). Eases from 0 → value once mounted.
const CountUp = ({ value, decimals = 0, suffix = '', durationMs = 900 }) => {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    let raf;
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / durationMs);
      // easeOutCubic for a lively settle
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(value * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, durationMs]);
  return <span>{display.toFixed(decimals)}{suffix}</span>;
};

// Parse a private-briefing doc into candidate blocks: a non-numbered line is a
// candidate name; the "1." / "2)" lines beneath it are that person's quals.
// Returns [] when the text isn't a candidate list (fewer than 2 named people or
// none with quals) so the caller can fall back to the raw briefing block.
const parseBriefingCandidates = (text) => {
  if (!text) return [];
  const cards = [];
  let cur = null;
  for (const raw of String(text).split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const qual = line.match(/^\d+[.)]\s*(.+)/);
    if (qual) {
      if (cur) cur.quals.push(qual[1]);
    } else {
      cur = { name: line, quals: [] };
      cards.push(cur);
    }
  }
  const usable = cards.filter((c) => c.quals.length > 0);
  return usable.length >= 2 ? usable : [];
};

// One candidate's briefing card. Hover lifts + scales it and paints an orange
// accent border/shadow (matches the ballot card idiom); entry is staggered.
const CandidateBriefingCard = ({ candidate, index }) => (
  <div
    style={{ animationDelay: `${index * 80}ms` }}
    className="group flex-1 min-w-0 rounded-2xl border-2 border-gray-200 bg-white p-5 shadow-sm transition-all duration-200 animate-in fade-in slide-in-from-bottom-2 hover:-translate-y-1 hover:scale-[1.02] hover:border-[#FA6C43] hover:shadow-lg"
  >
    <div className="flex items-center gap-2 pb-3 mb-3 border-b border-gray-100">
      <span className="flex-shrink-0 w-8 h-8 rounded-full bg-[#FA6C43]/10 text-[#C2410C] flex items-center justify-center transition-colors group-hover:bg-[#FA6C43] group-hover:text-white">
        <FaUserTie className="text-sm" />
      </span>
      <span className="font-bold text-[#222] truncate">{candidate.name}</span>
    </div>
    <ol className="space-y-2 list-none">
      {candidate.quals.map((q, i) => (
        <li key={i} className="flex gap-2 text-sm text-gray-600 leading-snug">
          <span className="flex-shrink-0 font-semibold text-[#FA6C43]">{i + 1}.</span>
          <span>{q}</span>
        </li>
      ))}
    </ol>
  </div>
);

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

const ManagerExercisePage = () => {
  const { configId } = useParams();
  const navigate = useNavigate();

  // ---- lifecycle / identity ----
  const [config, setConfig] = useState(null);
  const [phase, setPhase] = useState('loading'); // loading|waiting|memorize|discuss|decide|grading|done
  const [roomId, setRoomId] = useState(null);
  const [queuePosition, setQueuePosition] = useState(null);

  // ---- exercise snapshot (from `exercise_state`) ----
  const [numManagers, setNumManagers] = useState(0);
  const [seatedRoles, setSeatedRoles] = useState([]);   // ordered by seat index
  const [candidates, setCandidates] = useState([]);
  const [yourSeatIndex, setYourSeatIndex] = useState(null);
  const [yourRoleName, setYourRoleName] = useState(null);

  // ---- private document (memorize phase) ----
  const [privateDoc, setPrivateDoc] = useState(null);   // { seat_index, role_name, doc_text }
  const [docLocked, setDocLocked] = useState(false);    // permanent once memorize ends

  // ---- countdown, server-clock corrected ----
  const [deadlineTs, setDeadlineTs] = useState(null);   // server epoch secs
  const clockSkewRef = useRef(0);                        // serverNow - clientNow (secs)
  const [remaining, setRemaining] = useState(null);     // secs left (derived)

  // ---- chat ----
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [chatLocked, setChatLocked] = useState(true);

  // ---- voting ----
  const [individualPick, setIndividualPick] = useState(null);
  const [votedIndividual, setVotedIndividual] = useState(false);
  const [collectivePick, setCollectivePick] = useState(null);
  const [collectiveOpen, setCollectiveOpen] = useState(false);
  const [votedCollective, setVotedCollective] = useState(false);
  const [voteProgress, setVoteProgress] = useState({ individual: null, collective: null }); // {submitted,total}
  const [collectiveResult, setCollectiveResult] = useState(null); // { collective_vote, tally }

  // ---- grades ----
  const [grades, setGrades] = useState(null);            // full `grades` payload
  const [userInfo, setUserInfo] = useState(null);

  // ---- refs ----
  const socketRef = useRef(null);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const userIdRef = useRef(null);
  const phaseRef = useRef('loading');
  const roomIdRef = useRef(null);

  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { roomIdRef.current = roomId; }, [roomId]);

  // Resolve a persistent user identity: JWT user_id → Qualtrics responseId → localStorage.
  // (Copied verbatim from GroupChatPage per contract §9.)
  const resolveUid = async () => {
    const token = getToken();
    if (token) {
      try {
        const res = await axios.get('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
        setUserInfo(res.data);
        const id = res.data?.user_id || res.data?.id || res.data?.email;
        if (id) {
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
    // During waiting there's no phase timer — fall back to the no-show/auto-start
    // deadline so the waiting countdown keeps running.
    const dl = typeof s.phase_deadline_ts === 'number'
      ? s.phase_deadline_ts
      : (typeof s.no_show_deadline_ts === 'number' ? s.no_show_deadline_ts : null);
    setDeadlineTs(dl);
    if (typeof s.num_managers === 'number') setNumManagers(s.num_managers);
    if (Array.isArray(s.seated_roles)) setSeatedRoles(s.seated_roles);
    if (Array.isArray(s.candidates)) setCandidates(s.candidates);
    if (s.your_seat_index !== undefined) setYourSeatIndex(s.your_seat_index);
    if (s.your_role_name !== undefined) setYourRoleName(s.your_role_name);
    if (typeof s.you_voted_individual === 'boolean') setVotedIndividual(s.you_voted_individual);
    if (typeof s.collective_open === 'boolean') setCollectiveOpen(s.collective_open);
    if (typeof s.you_voted_collective === 'boolean') setVotedCollective(s.you_voted_collective);
    // Chat is only unlocked during discuss (server is authoritative; this is cosmetic).
    setChatLocked(s.phase !== 'discuss');
    // Once we've moved past memorize, the doc is permanently gone.
    if (s.phase && !['loading', 'waiting', 'memorize'].includes(s.phase)) setDocLocked(true);
  }, []);

  // 1. Fetch config + connect socket + wire every contract event.
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
        setConfig(configResponse.data.config);

        socketRef.current = io('/', { path: '/socket.io' });
        const socket = socketRef.current;

        // Join queue on connect; guard so reconnects never re-queue mid-exercise.
        socket.on('connect', () => {
          if (phaseRef.current !== 'loading' && phaseRef.current !== 'waiting') {
            // Already in an active phase — just rehydrate our room state.
            if (roomIdRef.current) socket.emit('get_history', { room_id: roomIdRef.current });
            return;
          }
          socket.emit('join_queue', { uid: userIdRef.current, config_id: configId });
        });

        // Still waiting for seats to fill. The no-show deadline drives the waiting
        // countdown; correct for clock skew so all queued clients agree on it.
        socket.on('queued', (data) => {
          setQueuePosition(data.position ?? null);
          if (typeof data.server_now_ts === 'number') {
            clockSkewRef.current = data.server_now_ts - (Date.now() / 1000);
          }
          if (typeof data.no_show_deadline_ts === 'number') setDeadlineTs(data.no_show_deadline_ts);
          if (phaseRef.current === 'loading') setPhase('waiting');
        });

        // Matched into a room — pull history + exercise state.
        socket.on('match_found', (data) => {
          setRoomId(data.room_id);
          roomIdRef.current = data.room_id;
          socket.emit('get_history', { room_id: data.room_id });
          if (phaseRef.current === 'loading' || phaseRef.current === 'waiting') setPhase('waiting');
        });

        // Full snapshot for (re)hydration.
        socket.on('exercise_state', (s) => applyExerciseState(s));

        // This student's private doc — only arrives at memorize start, targeted.
        socket.on('private_document', (d) => {
          setPrivateDoc(d);
          setDocLocked(false);
        });

        // Phase transitions broadcast to the whole room.
        socket.on('phase_change', (p) => {
          if (typeof p.server_now_ts === 'number') {
            clockSkewRef.current = p.server_now_ts - (Date.now() / 1000);
          }
          setDeadlineTs(typeof p.phase_deadline_ts === 'number' ? p.phase_deadline_ts : null);
          if (p.phase) setPhase(p.phase);
          setChatLocked(p.phase !== 'discuss');
          if (p.phase && !['loading', 'waiting', 'memorize'].includes(p.phase)) setDocLocked(true);
        });

        // Memorize ended — permanently hide the doc (card animates out).
        socket.on('document_locked', () => setDocLocked(true));

        // Chat lock toggled (or our own message was rejected).
        socket.on('chat_locked', (d) => {
          if (typeof d.locked === 'boolean') setChatLocked(d.locked);
          else setChatLocked(true);
        });

        // Reused group-chat transport for transcript replay + live messages.
        socket.on('chat_history', (data) => {
          if (data.messages) {
            setMessages(data.messages.map((m) => ({ sender: m.sender, sender_seat: m.sender_seat, text: m.text })));
          }
        });
        socket.on('message', (data) => {
          setMessages((prev) => [...prev, { sender: data.sender, sender_seat: data.sender_seat, text: data.text }]);
        });

        // Live vote progress (no per-voter pick leaked).
        socket.on('vote_update', (d) => {
          setVoteProgress((prev) => ({
            ...prev,
            [d.stage]: { submitted: d.submitted, total: d.total },
          }));
          if (d.stage === 'collective') setCollectiveOpen(true);
        });

        // Group ballot resolved.
        socket.on('collective_result', (d) => {
          setCollectiveResult({ collective_vote: d.collective_vote, tally: d.tally || {} });
          setCollectiveOpen(false);
        });

        // Final per-student scorecard (also reveals ground truth).
        socket.on('grades', (d) => {
          setGrades(d);
          setPhase('done');
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

  // 3. Signal readiness once we've rendered our private doc (bounded by no-show timer server-side).
  useEffect(() => {
    if (phase === 'memorize' && privateDoc && roomId && socketRef.current) {
      socketRef.current.emit('exercise_ready', { room_id: roomId, uid: userIdRef.current });
    }
  }, [phase, privateDoc, roomId]);

  // Auto-scroll the transcript.
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

  const submitIndividual = () => {
    if (!individualPick || votedIndividual || !socketRef.current) return;
    socketRef.current.emit('submit_individual_vote', {
      room_id: roomId, uid: userIdRef.current, candidate: individualPick,
    });
    setVotedIndividual(true);
  };

  const submitCollective = () => {
    if (!collectivePick || votedCollective || !collectiveOpen || !socketRef.current) return;
    socketRef.current.emit('submit_collective_vote', {
      room_id: roomId, uid: userIdRef.current, candidate: collectivePick,
    });
    setVotedCollective(true);
  };

  // Whole-second remaining, or null.
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

  // Roster of seated roles (who's in the room). Every seat renders identically —
  // AI seats are intentionally indistinguishable from human managers.
  const RoleRoster = () => (
    <div className="flex flex-wrap items-center justify-center gap-2">
      {seatedRoles.map((role, i) => {
        const isYou = i === yourSeatIndex;
        return (
          <span
            key={i}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold shadow-sm transition-transform hover:-translate-y-0.5 animate-in fade-in slide-in-from-bottom-1 ${
              isYou
                ? 'border-[#FA6C43] bg-[#FA6C43] text-white'
                : 'border-gray-200 bg-white text-gray-600'
            }`}
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <FaUserTie className="text-[10px]" />
            {role || `Seat ${i + 1}`}{isYou ? ' (you)' : ''}
          </span>
        );
      })}
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
  // Phase: waiting (N of M joined + no-show auto-fill countdown)
  // -------------------------------------------------------------------------
  if (phase === 'waiting') {
    const joined = seatedRoles.length || (queuePosition != null ? 1 : 0);
    const target = numManagers || config?.group_size || 0;
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
            <h2 className="text-xl font-bold text-[#222] mb-2">Assembling your management team…</h2>
            <p className="text-gray-500 text-sm">Waiting for the other managers to arrive.</p>
          </div>

          {target > 0 && (
            <div className="inline-flex items-center gap-2 rounded-full border border-[#FA6C43]/35 bg-gradient-to-r from-[#F9D0C4]/50 to-[#FA6C43]/15 px-4 py-2 shadow-sm">
              <span className="text-xs font-bold uppercase tracking-widest text-[#C2410C]">
                {joined} of {target} joined
              </span>
            </div>
          )}

          {queuePosition != null && !numManagers && (
            <div className="text-xs font-semibold text-gray-500">Position in queue: {queuePosition}</div>
          )}

          {/* Auto-start countdown (the no-show deadline). Neutral wording — never
              reveal that empty seats are filled by AI. */}
          {secsLeft != null && (
            <div className="text-center animate-in fade-in duration-300">
              <p className="text-[11px] uppercase tracking-widest text-gray-400 font-bold mb-1">
                Session begins in
              </p>
              <p className="text-2xl font-extrabold tabular-nums text-[#FA6C43]">{fmtClock(secsLeft)}</p>
            </div>
          )}

          {seatedRoles.length > 0 && <RoleRoster />}

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
  // Phase: memorize (private doc + prominent countdown; card animates out on lock)
  // -------------------------------------------------------------------------
  if (phase === 'memorize') {
    const urgent = secsLeft != null && secsLeft <= 15;
    // Candidate list → side-by-side cards; anything else falls back to raw text.
    const briefingCards = privateDoc ? parseBriefingCandidates(privateDoc.doc_text) : [];
    return (
      <div className="h-screen flex flex-col bg-[#F0F6FB] text-[#222]" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
        <header className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-white/95 backdrop-blur shadow-sm">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-lg bg-gray-100 text-[#1F1F1F]"><FaUserTie className="text-xl" /></div>
            <div className="min-w-0">
              <h1 className="font-semibold text-[#222] text-base truncate">
                {yourRoleName || privateDoc?.role_name || 'Your role'}
              </h1>
              <p className="text-xs text-gray-500">Memorize your briefing — it disappears when the timer ends.</p>
            </div>
          </div>
          <CountdownChip label="Memorize" urgent={urgent} />
        </header>

        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:px-12 xl:px-20 scrollbar-thin flex justify-center">
          {(!docLocked && privateDoc) ? (
            <div
              key="doc"
              className={`w-full my-4 rounded-3xl bg-white border border-gray-200 shadow-md p-8 transition-all duration-500 ${
                briefingCards.length ? 'max-w-5xl' : 'max-w-3xl'
              } ${
                docLocked
                  ? 'animate-out fade-out zoom-out-95 opacity-0'
                  : 'animate-in fade-in slide-in-from-bottom-3 duration-500'
              }`}
            >
              <div className="flex items-center gap-2 mb-4 pb-4 border-b border-gray-100">
                <FaBrain className="text-[#FA6C43]" />
                <span className="text-xs font-bold uppercase tracking-widest text-[#C2410C]">
                  Private briefing — {privateDoc.role_name || `Seat ${(privateDoc.seat_index ?? 0) + 1}`}
                </span>
              </div>
              {briefingCards.length ? (
                // Candidate list: one card per person, side by side (stacks on phones).
                <div className="flex flex-col md:flex-row gap-4 items-stretch">
                  {briefingCards.map((c, i) => (
                    <CandidateBriefingCard key={c.name} candidate={c} index={i} />
                  ))}
                </div>
              ) : (
                <div className="chat-message-md chat-message-md--light max-w-none whitespace-pre-wrap leading-[1.7]">
                  {privateDoc.doc_text}
                </div>
              )}
              <p className="mt-6 text-xs text-gray-400 italic">
                You won't be able to see this again once discussion begins — pool the details that others may not have.
              </p>
            </div>
          ) : (
            <div className="w-full max-w-3xl my-4 flex flex-col items-center justify-center text-center py-24 animate-in fade-in duration-500">
              <div className="w-20 h-20 rounded-3xl bg-gray-100 flex items-center justify-center mb-6">
                <FaLock className="text-3xl text-gray-400" />
              </div>
              <h2 className="text-xl font-bold text-[#222] mb-2">Your briefing is sealed</h2>
              <p className="text-gray-500 text-sm max-w-sm">
                {privateDoc ? 'Time is up — the discussion will begin shortly.' : 'Waiting for your private briefing…'}
              </p>
            </div>
          )}
        </main>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Phase: decide (individual ballot → collective ballot with live tally)
  // -------------------------------------------------------------------------
  if (phase === 'decide') {
    const showCollective = collectiveOpen || votedCollective || collectiveResult;
    const iProg = voteProgress.individual;
    const cProg = voteProgress.collective;
    return (
      <div className="h-screen flex flex-col bg-[#F0F6FB] text-[#222]" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
        <header className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-white/95 backdrop-blur shadow-sm">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-gray-100 text-[#1F1F1F]"><FaVoteYea className="text-xl" /></div>
            <h1 className="font-semibold text-[#222] text-base">Decision time</h1>
          </div>
          {secsLeft != null && <CountdownChip label="Decide" urgent={secsLeft <= 15} />}
        </header>

        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:px-12 xl:px-20 scrollbar-thin flex justify-center">
          <div className="w-full max-w-2xl my-4 space-y-8">

            {/* --- Individual ballot --- */}
            <section className="rounded-3xl bg-white border border-gray-200 shadow-md p-8 animate-in fade-in slide-in-from-bottom-3 duration-400">
              <div className="flex items-center justify-between mb-1">
                <h2 className="text-lg font-bold text-[#222]">Your individual pick</h2>
                {votedIndividual && (
                  <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600 animate-in zoom-in-95">
                    <FaCheckCircle /> Submitted
                  </span>
                )}
              </div>
              <p className="text-sm text-gray-500 mb-5">
                Who is the best <strong>fit</strong> for the role? (Most qualified isn't always the best fit.)
              </p>
              <div className="grid gap-3">
                {candidates.map((c, i) => {
                  const selected = individualPick === c.name;
                  return (
                    <button
                      key={c.name}
                      disabled={votedIndividual}
                      onClick={() => setIndividualPick(c.name)}
                      style={{ animationDelay: `${i * 50}ms` }}
                      className={`text-left rounded-2xl border-2 px-5 py-4 transition-all animate-in fade-in slide-in-from-bottom-1 disabled:cursor-default active:scale-[0.99] ${
                        selected
                          ? 'border-[#FA6C43] bg-[#FA6C43]/5 shadow-sm'
                          : 'border-gray-200 bg-white hover:border-[#FA6C43]/50 hover:-translate-y-0.5'
                      } ${votedIndividual && !selected ? 'opacity-40' : ''}`}
                    >
                      <div className="flex items-center gap-3">
                        <span className={`flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                          selected ? 'border-[#FA6C43] bg-[#FA6C43]' : 'border-gray-300'
                        }`}>
                          {selected && <span className="w-2 h-2 rounded-full bg-white" />}
                        </span>
                        <div>
                          <div className="font-semibold text-[#222]">{c.name}</div>
                          {c.blurb && <div className="text-xs text-gray-500">{c.blurb}</div>}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
              {!votedIndividual && (
                <button
                  onClick={submitIndividual}
                  disabled={!individualPick}
                  className="mt-6 w-full rounded-2xl bg-[#FA6C43] hover:bg-[#E55B34] text-white font-bold py-3.5 shadow-sm disabled:opacity-50 transition-all active:scale-[0.98]"
                >
                  Submit my pick
                </button>
              )}
              {iProg && (
                <VoteTally submitted={iProg.submitted} total={iProg.total} />
              )}
            </section>

            {/* --- Collective ballot (separate, explicit) --- */}
            {showCollective && (
              <section className="rounded-3xl bg-white border border-gray-200 shadow-md p-8 animate-in fade-in slide-in-from-bottom-3 duration-500">
                <div className="flex items-center justify-between mb-1">
                  <h2 className="text-lg font-bold text-[#222]">The group's collective decision</h2>
                  {votedCollective && (
                    <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600 animate-in zoom-in-95">
                      <FaCheckCircle /> Voted
                    </span>
                  )}
                </div>
                <p className="text-sm text-gray-500 mb-5">
                  Cast your vote for the team's shared choice. This is a separate ballot from your individual pick.
                </p>

                {collectiveResult ? (
                  // Resolved: show the winner + animated tally bars.
                  <div className="animate-in fade-in zoom-in-95 duration-400">
                    <div className="rounded-2xl bg-[#FA6C43]/5 border-2 border-[#FA6C43] px-5 py-4 mb-4 flex items-center gap-3">
                      <FaTrophy className="text-[#FA6C43] text-xl" />
                      <div>
                        <div className="text-[10px] uppercase tracking-widest font-bold text-[#C2410C]">Group chose</div>
                        <div className="text-lg font-extrabold text-[#222]">{collectiveResult.collective_vote}</div>
                      </div>
                    </div>
                    <TallyBars tally={collectiveResult.tally} winner={collectiveResult.collective_vote} />
                  </div>
                ) : (
                  <>
                    <div className="grid gap-3">
                      {candidates.map((c, i) => {
                        const selected = collectivePick === c.name;
                        return (
                          <button
                            key={c.name}
                            disabled={votedCollective || !collectiveOpen}
                            onClick={() => setCollectivePick(c.name)}
                            style={{ animationDelay: `${i * 50}ms` }}
                            className={`text-left rounded-2xl border-2 px-5 py-4 transition-all animate-in fade-in slide-in-from-bottom-1 disabled:cursor-default active:scale-[0.99] ${
                              selected
                                ? 'border-indigo-500 bg-indigo-50 shadow-sm'
                                : 'border-gray-200 bg-white hover:border-indigo-300 hover:-translate-y-0.5'
                            } ${votedCollective && !selected ? 'opacity-40' : ''}`}
                          >
                            <div className="flex items-center gap-3">
                              <span className={`flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                                selected ? 'border-indigo-500 bg-indigo-500' : 'border-gray-300'
                              }`}>
                                {selected && <span className="w-2 h-2 rounded-full bg-white" />}
                              </span>
                              <span className="font-semibold text-[#222]">{c.name}</span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                    {!votedCollective && (
                      <button
                        onClick={submitCollective}
                        disabled={!collectivePick || !collectiveOpen}
                        className="mt-6 w-full rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3.5 shadow-sm disabled:opacity-50 transition-all active:scale-[0.98]"
                      >
                        Cast collective vote
                      </button>
                    )}
                    {cProg && <VoteTally submitted={cProg.submitted} total={cProg.total} indigo />}
                  </>
                )}
              </section>
            )}
          </div>
        </main>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Phase: grading (interstitial)
  // -------------------------------------------------------------------------
  if (phase === 'grading') {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-[#F0F6FB] text-[#222]" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
        <div className="flex flex-col items-center gap-6 animate-in fade-in zoom-in-95 duration-400">
          <div className="relative flex items-center justify-center w-24 h-24 rounded-3xl bg-[#F9D0C4]/40">
            <FaBrain className="text-4xl text-[#FA6C43] animate-pulse" />
          </div>
          <h2 className="text-2xl font-bold">Grading in progress…</h2>
          <p className="text-gray-500 text-sm max-w-sm text-center">
            An AI judge is reviewing the discussion and your decisions. Your scorecard will appear shortly.
          </p>
          <FaSpinner className="animate-spin text-2xl text-[#FA6C43] opacity-70" />
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Phase: done (per-student scorecard w/ count-up + animated bars + reveal)
  // -------------------------------------------------------------------------
  if (phase === 'done' && grades) {
    const mine = grades.grades?.[userIdRef.current];
    const correct = grades.correct_candidate;
    const groupPick = grades.collective_vote;
    const bars = mine
      ? [
          { label: 'Communication', value: mine.communication ?? 0, color: '#FA6C43' },
          { label: 'Individual decision', value: mine.individual_correct ? 1 : 0, color: '#6366F1', binary: true, ok: mine.individual_correct },
          { label: 'Collective decision', value: mine.collective_correct ? 1 : 0, color: '#10B981', binary: true, ok: mine.collective_correct },
        ]
      : [];
    return (
      <div className="h-screen overflow-y-auto bg-[#F0F6FB] text-[#222] scrollbar-thin" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
        <div className="max-w-2xl mx-auto px-4 py-12 space-y-6">

          {/* Ground-truth reveal */}
          <div className="rounded-3xl bg-white border border-gray-200 shadow-md p-8 text-center animate-in fade-in zoom-in-95 duration-400">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-3xl bg-[#F9D0C4]/40 mb-4">
              <FaTrophy className="text-3xl text-[#FA6C43]" />
            </div>
            <h1 className="text-2xl font-extrabold mb-1">Exercise complete</h1>
            <p className="text-gray-500 text-sm mb-6">Here's how the decision measured up.</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4">
                <div className="text-[10px] uppercase tracking-widest font-bold text-emerald-600 mb-1">Best-fit answer</div>
                <div className="text-lg font-extrabold text-[#222]">{correct}</div>
              </div>
              <div className={`rounded-2xl border px-4 py-4 ${groupPick === correct ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50'}`}>
                <div className={`text-[10px] uppercase tracking-widest font-bold mb-1 ${groupPick === correct ? 'text-emerald-600' : 'text-red-500'}`}>Your group chose</div>
                <div className="text-lg font-extrabold text-[#222]">{groupPick || '—'}</div>
              </div>
            </div>
          </div>

          {/* Personal scorecard */}
          {mine ? (
            <div className="rounded-3xl bg-white border border-gray-200 shadow-md p-8 animate-in fade-in slide-in-from-bottom-3 duration-500">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <div className="text-[10px] uppercase tracking-widest font-bold text-gray-400">Your total score</div>
                  <h2 className="text-lg font-bold text-[#222]">{mine.role_name || yourRoleName || 'Your scorecard'}</h2>
                </div>
                <div className="text-4xl font-extrabold text-[#FA6C43] tabular-nums">
                  <CountUp value={(mine.total ?? 0) * 100} decimals={0} suffix="%" />
                </div>
              </div>

              <div className="space-y-5">
                {bars.map((b, i) => (
                  <div key={b.label} style={{ animationDelay: `${i * 120}ms` }} className="animate-in fade-in slide-in-from-left-2 duration-500">
                    <div className="flex items-center justify-between text-sm mb-1.5">
                      <span className="font-semibold text-[#333]">{b.label}</span>
                      <span className="font-bold tabular-nums" style={{ color: b.color }}>
                        {b.binary ? (b.ok ? 'Correct' : 'Incorrect') : <CountUp value={b.value * 100} decimals={0} suffix="%" />}
                      </span>
                    </div>
                    <AnimatedBar value={b.value} color={b.color} delayMs={i * 120} />
                  </div>
                ))}
              </div>

              {/* Individual vote recap */}
              {mine.individual_vote && (
                <div className="mt-5 text-xs text-gray-500">
                  Your individual pick: <strong className="text-[#333]">{mine.individual_vote}</strong>
                  {mine.individual_correct
                    ? <span className="text-emerald-600 font-semibold"> — matched the best fit.</span>
                    : <span className="text-red-500 font-semibold"> — the best fit was {correct}.</span>}
                </div>
              )}

              {/* LLM feedback */}
              {mine.feedback && (
                <div className="mt-6 rounded-2xl bg-[#F0F6FB] border border-gray-100 p-5 animate-in fade-in duration-700">
                  <div className="text-[10px] uppercase tracking-widest font-bold text-[#C2410C] mb-2">Feedback</div>
                  <p className="text-sm text-[#333] leading-relaxed whitespace-pre-wrap">{mine.feedback}</p>
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-3xl bg-white border border-gray-200 shadow-md p-8 text-center text-gray-500">
              Your scorecard isn't available.
            </div>
          )}

          <button
            onClick={() => navigate('/config_list')}
            className="w-full rounded-2xl bg-[#FA6C43] hover:bg-[#E55B34] text-white font-bold py-3.5 shadow-sm transition-all active:scale-[0.98]"
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Phase: discuss (default render — chat UI + countdown chip)
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
            {yourRoleName && (
              <span className="hidden sm:inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-semibold text-gray-600 shadow-sm">
                <FaUserTie className="text-[10px]" /> {yourRoleName}
              </span>
            )}
          </div>
        </div>
        {secsLeft != null && <CountdownChip label="Discuss" urgent={secsLeft <= 20} />}
      </header>

      <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:px-12 xl:px-20 scrollbar-thin">
        <div className="w-full space-y-6 pb-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 opacity-80 animate-in fade-in duration-500">
              <div className="w-20 h-20 bg-gray-100 rounded-3xl flex items-center justify-center mb-6 text-[#1F1F1F]">
                <FaUsers className="text-4xl" />
              </div>
              <h2 className="text-2xl font-bold text-[#222] mb-2">The floor is open</h2>
              <p className="text-gray-500 text-center max-w-sm">
                Share the details from your briefing that others may not have — pool your unique facts to find the best fit.
              </p>
            </div>
          )}

          {messages.map((msg, i) => {
            // Own messages are identified by SEAT (not uid), so the client never needs
            // to know which participants are AI — everyone shows by role name.
            const isMe = msg.sender_seat != null && msg.sender_seat === yourSeatIndex;
            const isSystem = msg.sender === 'System';
            if (isSystem) {
              return (
                <div key={i} className="flex justify-center my-4 animate-in fade-in">
                  <span className="bg-gray-100 text-gray-500 text-xs px-3 py-1 rounded-full font-medium">{msg.text}</span>
                </div>
              );
            }
            return (
              <div key={i} className={`flex gap-4 ${isMe ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-2 duration-300`}>
                {!isMe && (
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[#F9D0C4]/60 flex items-center justify-center mt-1">
                    <span className="text-[#FA6C43] text-xs font-bold">{(msg.sender || '?').substring(0, 2).toUpperCase()}</span>
                  </div>
                )}
                <div className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                  {!isMe && <span className="text-[10px] font-bold text-gray-500 ml-1 mb-1">{msg.sender}</span>}
                  <div className={`min-w-0 max-w-[88%] rounded-2xl px-5 py-3 shadow-sm text-[15px] leading-[1.65] break-words overflow-hidden ${
                    isMe ? 'bg-[#FA6C43] text-white rounded-br-none' : 'bg-white border border-gray-200 text-[#222] rounded-bl-none'
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
            placeholder={chatLocked ? 'Discussion is not open yet…' : 'Share what you know…'}
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

// ---------------------------------------------------------------------------
// Vote-progress helpers (below the main component to keep the render tree lean)
// ---------------------------------------------------------------------------

// "k of N voted" chip + progress bar; NO per-voter pick is ever leaked.
const VoteTally = ({ submitted, total, indigo }) => {
  const pct = total ? Math.round((submitted / total) * 100) : 0;
  const color = indigo ? '#6366F1' : '#FA6C43';
  return (
    <div className="mt-5 animate-in fade-in duration-300">
      <div className="flex items-center justify-between text-xs font-semibold text-gray-500 mb-1.5">
        <span>{submitted} of {total} voted</span>
        <span className="tabular-nums">{pct}%</span>
      </div>
      <div className="h-2 w-full rounded-full bg-gray-100 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500 ease-out"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
};

// Animated horizontal tally bars for the resolved collective ballot.
const TallyBars = ({ tally, winner }) => {
  const entries = Object.entries(tally || {}).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map(([, v]) => v));
  return (
    <div className="space-y-3">
      {entries.map(([name, count], i) => {
        const pct = Math.round((count / max) * 100);
        const isWinner = name === winner;
        return (
          <div key={name} style={{ animationDelay: `${i * 100}ms` }} className="animate-in fade-in slide-in-from-left-2 duration-500">
            <div className="flex items-center justify-between text-sm mb-1">
              <span className={`font-semibold ${isWinner ? 'text-[#FA6C43]' : 'text-[#333]'}`}>{name}</span>
              <span className="text-xs font-bold text-gray-500 tabular-nums">{count}</span>
            </div>
            <div className="h-3 w-full rounded-full bg-gray-100 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700 ease-out"
                style={{ width: `${pct}%`, backgroundColor: isWinner ? '#FA6C43' : '#CBD5E1' }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};

// A single scorecard bar that animates its fill from 0 → value on mount.
const AnimatedBar = ({ value, color, delayMs = 0 }) => {
  const [w, setW] = useState(0);
  useEffect(() => {
    const id = setTimeout(() => setW(Math.max(0, Math.min(1, value)) * 100), 60 + delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return (
    <div className="h-3 w-full rounded-full bg-gray-100 overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-1000 ease-out"
        style={{ width: `${w}%`, backgroundColor: color }}
      />
    </div>
  );
};

export default ManagerExercisePage;
