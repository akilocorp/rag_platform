/* @language JSX  @updated 2026-07-30  @changed M5: the `choose` phase is now a timed live vote — running tally, "Decide now" (quorum) button, decision countdown, and a beep through the final 30s. */
//
// ManagerExercisePage — the student experience for a "manager_exercise" bot_type.
//
// The decision itself happens OFFLINE, on printed packets, before anyone opens
// this page. What's left is the debrief:
//   loading → local-only, before the lobby has loaded
//   lobby   → pick a breakout room (Group 1..N) with live occupancy
//   waiting → in a room; start whenever the team is ready, full or not
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

// M6: the "6 months later" time-skip — a brief full-screen blackout with a clock
// spinning forward, shown after a student presses Continue and before their outcome
// reveal. Module-level so the auto-advance timer isn't reset by parent re-renders.
const TimeSkipAnimation = ({ onDone }) => {
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  useEffect(() => {
    const id = setTimeout(() => doneRef.current && doneRef.current(), 2600);
    return () => clearTimeout(id);
  }, []);
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#0B1220] text-white animate-in fade-in duration-500">
      <div className="relative w-28 h-28 rounded-full border-4 border-white/80 shadow-2xl">
        {/* hour + minute hands rotate about the clock centre (transform-origin at
            bottom); animate-spin owns the transform, so positioning uses left/bottom. */}
        <div className="absolute animate-spin" style={{ left: 'calc(50% - 1.5px)', bottom: '50%', width: '3px', height: '30px', background: 'white', transformOrigin: 'bottom center', animationDuration: '1.6s' }} />
        <div className="absolute animate-spin" style={{ left: 'calc(50% - 1px)', bottom: '50%', width: '2px', height: '42px', background: '#FA6C43', transformOrigin: 'bottom center', animationDuration: '0.6s' }} />
        <div className="absolute rounded-full bg-white" style={{ left: 'calc(50% - 4px)', top: 'calc(50% - 4px)', width: '8px', height: '8px' }} />
      </div>
      <p className="mt-8 text-lg font-bold tracking-wide animate-in fade-in slide-in-from-bottom-2 duration-1000">Six months later…</p>
    </div>
  );
};

// M6: the kiosk gate — a deliberate full-screen stop so students look up at the
// instructor. Pressing Continue advances only THIS student (the phase machine
// holds the shared discussion until everyone has).
const KioskGate = ({ onContinue }) => (
  <div className="h-screen flex flex-col items-center justify-center bg-[#0B1220] text-white p-6 text-center animate-in fade-in duration-500" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
    <div className="max-w-md">
      <div className="mx-auto mb-6 w-14 h-14 rounded-2xl bg-white/10 flex items-center justify-center"><FaRegClock className="text-2xl" /></div>
      <h1 className="text-2xl font-extrabold mb-3">Your group has decided.</h1>
      <p className="text-white/70 mb-8 leading-relaxed">Eyes up front — your instructor will set the scene. Press Continue when you're ready to see how the hire played out.</p>
      <button onClick={onContinue} className="rounded-2xl bg-[#FA6C43] hover:bg-[#E55B34] text-white font-bold px-10 py-4 shadow-lg transition-all active:scale-[0.97]">Continue</button>
    </div>
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
  const [phase, setPhase] = useState('loading'); // loading|lobby|waiting|choose|kiosk|discuss|done
  const [roomId, setRoomId] = useState(null);

  // ---- breakout lobby ----
  const [rooms, setRooms] = useState([]);              // [{room_id,index,label,names,occupants,capacity,started}]
  const [roomError, setRoomError] = useState('');

  // ---- exercise snapshot (from `exercise_state`) ----
  const [capacity, setCapacity] = useState(0);
  const [roster, setRoster] = useState([]);            // [{name}]
  const [canStart, setCanStart] = useState(false);
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
  // M5: the ballot is a live tally now. `tally` is votes-per-candidate, `yourVote`
  // is this client's current pick (restored on reconnect), `finalCall` flags the
  // 30s anxiety window. `ballotWasOpenRef` distinguishes a fresh open (reset the
  // local pick) from a mid-ballot tally update (keep it).
  const [tally, setTally] = useState({});
  const [yourVote, setYourVote] = useState(null);
  const [finalCall, setFinalCall] = useState(false);
  const ballotWasOpenRef = useRef(false);
  const audioCtxRef = useRef(null);

  // ---- kiosk gate (M6) ----
  // `kioskStage` walks THIS client through gate → time-skip → reveal on its own;
  // `kioskAcked/Total` drive the "waiting for your group" line; `forecastText` is
  // the chosen candidate's outcome, shown to each student after their time-skip.
  const [kioskStage, setKioskStage] = useState('gate'); // gate|timeskip|reveal
  const [kioskAcked, setKioskAcked] = useState(0);
  const [kioskTotal, setKioskTotal] = useState(0);
  const [youContinued, setYouContinued] = useState(false);
  const [forecastText, setForecastText] = useState(null);
  const kioskInitedRef = useRef(false);

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
    if (typeof s.capacity === 'number') setCapacity(s.capacity);
    if (typeof s.can_start === 'boolean') setCanStart(s.can_start);
    if (Array.isArray(s.roster)) setRoster(s.roster);
    if (Array.isArray(s.candidates)) setCandidates(s.candidates);
    if (s.chosen_candidate !== undefined) setChosenCandidate(s.chosen_candidate);
    if (typeof s.collective_open === 'boolean') {
      setBallotOpen(s.collective_open);
      ballotWasOpenRef.current = s.collective_open;
    }
    if (typeof s.you_voted_collective === 'boolean') setVoted(s.you_voted_collective);
    // M5: restore the live tally, this viewer's own vote, and the final-call flag
    // so a reconnecting student re-enters the ballot exactly where they left it.
    if (s.collective_tally) setTally(s.collective_tally);
    if (s.your_vote !== undefined) { setYourVote(s.your_vote); if (s.your_vote) setPick(s.your_vote); }
    if (typeof s.collective_final_call === 'boolean') setFinalCall(s.collective_final_call);
    // M6: kiosk progress + the outcome text (shown per-student after the time-skip).
    if (typeof s.forecast_text === 'string') setForecastText(s.forecast_text);
    if (typeof s.kiosk_acked === 'number') setKioskAcked(s.kiosk_acked);
    if (typeof s.kiosk_total === 'number') setKioskTotal(s.kiosk_total);
    if (typeof s.you_continued === 'boolean') setYouContinued(s.you_continued);
    // Initialize the kiosk walkthrough once per entry into the phase — a reconnecting
    // student who already pressed Continue lands straight on their reveal.
    if (s.phase === 'kiosk') {
      if (!kioskInitedRef.current) {
        kioskInitedRef.current = true;
        setKioskStage(s.you_continued ? 'reveal' : 'gate');
      }
    } else {
      kioskInitedRef.current = false;
    }
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

        // Already in a room → rejoin it. Otherwise watch the breakout lobby.
        socket.on('connect', () => {
          if (roomIdRef.current) { enterRoom(roomIdRef.current); return; }
          socket.emit('list_breakout_rooms', { config_id: configId, uid: userIdRef.current });
        });

        // Live room list, pushed whenever anyone joins, leaves, or starts.
        socket.on('breakout_rooms', (d) => {
          setRooms(Array.isArray(d.rooms) ? d.rooms : []);
          if (phaseRef.current === 'loading' && !roomIdRef.current) setPhase('lobby');
        });

        socket.on('breakout_error', (d) => {
          setRoomError(d.reason === 'finished'
            ? 'That group has already finished — pick another.'
            : 'That group is full — pick another.');
        });

        // We're in a room. Not started yet: the room screen shows who else is here.
        socket.on('match_found', (data) => {
          setRoomError('');
          setRoomId(data.room_id);
          roomIdRef.current = data.room_id;
          enterRoom(data.room_id);
          if (phaseRef.current === 'loading' || phaseRef.current === 'lobby') setPhase('waiting');
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

        // Ballot opened/closed + live tally (M5). A FRESH open (closed→open) clears
        // the local pick so a re-choice is a deliberate re-entry; a mid-ballot tally
        // update keeps it. `final_call` flips the UI into the anxiety window.
        socket.on('ballot_update', (d) => {
          const nowOpen = Boolean(d.open);
          if (nowOpen && !ballotWasOpenRef.current) { setVoted(false); setPick(null); setYourVote(null); }
          ballotWasOpenRef.current = nowOpen;
          setBallotOpen(nowOpen);
          if (Array.isArray(d.candidates) && d.candidates.length) setCandidates(d.candidates);
          if (d.tally) setTally(d.tally);
          if (typeof d.final_call === 'boolean') setFinalCall(d.final_call);
          if (!nowOpen) setFinalCall(false);
        });

        socket.on('collective_result', (d) => {
          setChosenCandidate(d.chosen_candidate);
          setBallotOpen(false);
          setFinalCall(false);
          if (d.tally) setTally(d.tally);
        });

        // M6: live kiosk tally — how many of the room have pressed Continue.
        socket.on('kiosk_update', (d) => {
          if (typeof d.acked === 'number') setKioskAcked(d.acked);
          if (typeof d.total === 'number') setKioskTotal(d.total);
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
  // Claim a place in a breakout room. The server refuses a full or already-started
  // room and answers with `breakout_error`, so no client-side guard is needed.
  const joinBreakout = (index) => {
    setRoomError('');
    socketRef.current?.emit('join_breakout_room', {
      config_id: configId,
      room_index: index,
      uid: userIdRef.current,
      display_name: displayNameRef.current,
    });
  };

  // Step back out to the lobby before the exercise begins, freeing the slot.
  const leaveBreakout = () => {
    socketRef.current?.emit('leave_breakout_room', { uid: userIdRef.current });
    setRoomId(null);
    roomIdRef.current = null;
    setRoster([]);
    setPhase('lobby');
    socketRef.current?.emit('list_breakout_rooms', { config_id: configId, uid: userIdRef.current });
  };

  // Begin with whoever is currently in the room. Whatever the configured capacity,
  // the people present at this moment are the group, and ACTR is told so.
  const startExercise = () => {
    socketRef.current?.emit('start_exercise', { room_id: roomId, uid: userIdRef.current });
  };

  const handleSend = () => {
    if (!input.trim() || !socketRef.current || chatLocked) return;
    socketRef.current.emit('send_message', {
      room_id: roomId, uid: userIdRef.current, text: input,
    });
    setInput('');
  };

  // M5: a real vote the student may change while the ballot is open, not a one-shot
  // team entry. The server tallies and auto-resolves on a majority.
  const submitPick = () => {
    if (!pick || !ballotOpen || !socketRef.current) return;
    socketRef.current.emit('submit_collective_vote', {
      room_id: roomId, uid: userIdRef.current, candidate: pick,
    });
    setVoted(true);
    setYourVote(pick);
  };

  // "Decide now" — asks the server to finalize early. The server ignores it unless
  // a majority of the room has already voted (quorum lives server-side).
  const earlyDecision = () => {
    socketRef.current?.emit('early_decision', { room_id: roomId, uid: userIdRef.current });
  };

  // M6: press Continue at the kiosk. Advances THIS client into the time-skip at
  // once; the server holds the shared discussion until the whole room has pressed.
  const continueAck = () => {
    socketRef.current?.emit('continue_ack', { room_id: roomId, uid: userIdRef.current });
    setYouContinued(true);
    setKioskStage('timeskip');
  };

  const secsLeft = remaining == null ? null : Math.max(0, remaining);

  // M5: beep once a second through the final-call window to induce decision anxiety.
  // The AudioContext is created lazily off the student's earlier click (start/vote),
  // which satisfies the browser autoplay gesture requirement.
  useEffect(() => {
    if (phase !== 'choose' || !finalCall) return;
    const beep = () => {
      try {
        let ctx = audioCtxRef.current;
        if (!ctx) {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return;
          ctx = new AC();
          audioCtxRef.current = ctx;
        }
        if (ctx.state === 'suspended') ctx.resume();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.0001, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.14, ctx.currentTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.2);
      } catch { /* audio is a nice-to-have; never let it break the phase */ }
    };
    beep();
    const id = setInterval(beep, 1000);
    return () => clearInterval(id);
  }, [phase, finalCall]);

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

  // The candidate voting grid (M5). Shared by the `choose` phase and the inline
  // re-choice mid-discussion. Each row shows a live vote count; students may change
  // their vote while the ballot is open, and the server resolves on a majority.
  const CandidateGrid = ({ compact }) => {
    const totalVotes = Object.values(tally).reduce((a, b) => a + b, 0);
    const headcount = roster.length || capacity || 0;
    return (
    <>
      <div className="grid gap-3">
        {candidates.map((c, i) => {
          const selected = pick === c.name;
          const count = tally[c.name] || 0;
          return (
            <button
              key={c.name}
              disabled={!ballotOpen}
              onClick={() => setPick(c.name)}
              style={{ animationDelay: `${i * 50}ms` }}
              className={`text-left rounded-2xl border-2 transition-all animate-in fade-in slide-in-from-bottom-1 disabled:cursor-default active:scale-[0.99] ${
                compact ? 'px-4 py-3' : 'px-5 py-4'
              } ${
                selected
                  ? 'border-[#FA6C43] bg-[#FA6C43]/5 shadow-sm'
                  : 'border-gray-200 bg-white hover:border-[#FA6C43]/50 hover:-translate-y-0.5'
              }`}
            >
              <div className="flex items-center gap-3">
                <span className={`flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                  selected ? 'border-[#FA6C43] bg-[#FA6C43]' : 'border-gray-300'
                }`}>
                  {selected && <span className="w-2 h-2 rounded-full bg-white" />}
                </span>
                <span className="flex-1 font-semibold text-[#222]">{c.name}</span>
                {count > 0 && (
                  <span className="flex-shrink-0 inline-flex items-center text-xs font-extrabold text-[#C2410C] bg-[#F9D0C4]/50 rounded-full px-2.5 py-0.5 tabular-nums animate-in zoom-in-75 duration-200">
                    {count}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
      <div className="mt-5 flex flex-col sm:flex-row gap-3">
        <button
          onClick={submitPick}
          disabled={!pick || !ballotOpen}
          className="flex-1 rounded-2xl bg-[#FA6C43] hover:bg-[#E55B34] text-white font-bold py-3.5 shadow-sm disabled:opacity-50 transition-all active:scale-[0.98]"
        >
          {voted ? 'Update our vote' : 'Cast our vote'}
        </button>
        <button
          onClick={earlyDecision}
          disabled={!ballotOpen}
          title="Finalize now (once most of the group has voted)"
          className="rounded-2xl border-2 border-[#FA6C43]/40 text-[#C2410C] font-bold px-5 py-3.5 hover:bg-[#F9D0C4]/20 disabled:opacity-40 transition-all active:scale-[0.98]"
        >
          Decide now
        </button>
      </div>
      {voted ? (
        <p className="mt-3 inline-flex items-center gap-1.5 text-xs font-bold text-emerald-600">
          <FaCheckCircle /> You voted for {yourVote}. {totalVotes}{headcount ? ` of ${headcount}` : ''} in.
        </p>
      ) : (
        totalVotes > 0 && (
          <p className="mt-3 text-xs font-semibold text-gray-500">{totalVotes}{headcount ? ` of ${headcount}` : ''} voted so far.</p>
        )
      )}
    </>
    );
  };

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
  // Phase: lobby (pick a breakout room)
  // -------------------------------------------------------------------------
  if (phase === 'lobby') {
    return (
      <div className="min-h-screen bg-[#F0F6FB] text-[#222] py-10 px-4" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
        <div className="max-w-2xl mx-auto">
          <div className="text-center mb-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-[#F9D0C4]/40">
              <FaUsers className="text-3xl text-[#FA6C43]" />
            </div>
            <h1 className="text-2xl font-bold text-[#222] mb-1">{config?.bot_name || 'Manager Exercise'}</h1>
            <p className="text-gray-500 text-sm">Join your group. You can start as soon as your team is here.</p>
          </div>

          {roomError && (
            <p className="mb-4 text-center text-sm font-semibold text-red-500 animate-in fade-in">{roomError}</p>
          )}

          <div className="space-y-3">
            {/* A room in progress is still joinable — you get the whole transcript
                on the way in. Only full or finished rooms are closed. */}
            {rooms.map((r, i) => {
              const joinable = r.joinable !== false;
              return (
                <button
                  key={r.room_id}
                  onClick={() => joinBreakout(r.index)}
                  disabled={!joinable}
                  style={{ animationDelay: `${i * 50}ms` }}
                  className={`w-full text-left rounded-2xl border-2 px-5 py-4 transition-all animate-in fade-in slide-in-from-bottom-1 ${
                    !joinable
                      ? 'border-gray-200 bg-gray-50 cursor-not-allowed opacity-60'
                      : r.started
                        ? 'border-[#FA6C43]/40 bg-[#F9D0C4]/10 hover:border-[#FA6C43] hover:-translate-y-0.5 hover:shadow-md active:scale-[0.99]'
                        : 'border-gray-200 bg-white hover:border-[#FA6C43] hover:-translate-y-0.5 hover:shadow-md active:scale-[0.99]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-bold text-[#222] flex items-center gap-2">
                        {r.label}
                        {r.started && joinable && (
                          <span className="text-[9px] font-bold uppercase tracking-wider text-[#C2410C] bg-[#F9D0C4]/60 px-1.5 py-0.5 rounded-full">
                            In progress — you can still join
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-gray-500 truncate">
                        {r.names.length ? r.names.join(', ') : 'Empty — be the first'}
                      </div>
                    </div>
                    <span className={`flex-shrink-0 rounded-full px-3 py-1 text-xs font-bold ${
                      joinable ? 'bg-[#FA6C43]/10 text-[#C2410C]' : 'bg-gray-200 text-gray-500'
                    }`}>
                      {r.phase === 'done' ? 'Finished' : `${r.occupants} / ${r.capacity}`}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {rooms.length === 0 && (
            <div className="flex justify-center py-10">
              <FaSpinner className="animate-spin text-2xl text-[#FA6C43] opacity-60" />
            </div>
          )}
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Phase: waiting (in a room, not yet started)
  // -------------------------------------------------------------------------
  if (phase === 'waiting') {
    const label = rooms.find((r) => r.room_id === roomId)?.label || 'Your group';
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
            <h2 className="text-xl font-bold text-[#222] mb-2">{label}</h2>
            <p className="text-gray-500 text-sm">
              {roster.length} of {capacity || roster.length} here. Start whenever your team is ready.
            </p>
          </div>

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

          {/* No need to wait for a full room — whoever is here is the group, and
              ACTR is told the real headcount when this fires. */}
          <button
            onClick={startExercise}
            disabled={!canStart}
            className="w-full rounded-2xl bg-[#FA6C43] hover:bg-[#E55B34] text-white font-bold py-3.5 shadow-sm disabled:opacity-50 transition-all active:scale-[0.98]"
          >
            Start with {roster.length} {roster.length === 1 ? 'person' : 'people'}
          </button>

          <button
            onClick={leaveBreakout}
            className="inline-flex items-center gap-2 text-sm font-semibold text-gray-500 hover:text-[#FA6C43] transition-colors active:scale-95"
          >
            <FaArrowLeft className="text-xs" /> Switch group
          </button>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Phase: kiosk (M6 — instructor-paced gate → time-skip → per-student outcome)
  // -------------------------------------------------------------------------
  if (phase === 'kiosk') {
    if (kioskStage === 'timeskip') {
      return <TimeSkipAnimation onDone={() => setKioskStage('reveal')} />;
    }
    if (kioskStage === 'gate' && !youContinued) {
      return <KioskGate onContinue={continueAck} />;
    }
    // reveal: this student has passed the time-skip; show the outcome and wait on
    // the rest of the room before the shared discussion opens.
    const everyoneReady = kioskTotal > 0 && kioskAcked >= kioskTotal;
    return (
      <div className="h-screen flex flex-col bg-[#F0F6FB] text-[#222]" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
        <header className="flex items-center justify-between px-6 py-3 border-b border-gray-200 bg-white/95 backdrop-blur z-10 h-16 shadow-sm">
          <div className="flex items-center gap-4 min-w-0">
            <div className="p-2 rounded-lg bg-gray-100 text-[#1F1F1F]"><FaUsers className="text-xl" /></div>
            <h1 className="font-semibold text-[#222] text-base truncate">{config?.bot_name || 'Manager Exercise'}</h1>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:px-12 xl:px-20 scrollbar-thin">
          <div className="max-w-2xl mx-auto space-y-6">
            <div className="text-center pt-2">
              <span className="text-xs font-bold uppercase tracking-widest text-[#FA6C43]">Six months later</span>
            </div>
            {forecastText
              ? <OutcomeCard title={`${chosenCandidate || 'Your hire'} — Outcome`} text={forecastText} />
              : <p className="text-center text-gray-500">Loading the outcome…</p>}
            <div className="rounded-2xl border border-gray-200 bg-white p-5 text-center shadow-sm animate-in fade-in duration-500">
              {everyoneReady
                ? <p className="text-sm font-semibold text-emerald-600">Everyone's ready — opening the discussion…</p>
                : <p className="text-sm font-semibold text-gray-600">Waiting for your group — {kioskAcked} of {kioskTotal} ready.</p>}
            </div>
          </div>
        </main>
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
              <div className="flex items-center justify-between gap-3 mb-1">
                <h2 className="text-lg font-bold text-[#222]">Your group's decision</h2>
                {secsLeft != null && (
                  <CountdownChip label={finalCall ? 'Final call' : 'Decide'} urgent={finalCall || secsLeft <= 30} />
                )}
              </div>
              <p className="text-sm text-gray-500 mb-5">
                Vote for the candidate your group should hire. The room resolves on a majority — or press <span className="font-semibold text-[#222]">Decide now</span> once most of you have voted.
              </p>
              {finalCall && (
                <div className="mb-5 rounded-xl border border-red-300 bg-red-50 px-4 py-2.5 text-sm font-bold text-red-600 animate-pulse">
                  Final call — lock in your vote now.
                </div>
              )}
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
