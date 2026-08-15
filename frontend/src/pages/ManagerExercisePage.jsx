/* @language JSX  @updated 2026-08-15  @changed WhatsApp-style quote-reply in the transcript: hover reply affordance, composer chip, a quote block above each bubble, and click-to-scroll to the parent (mid/reply_to threaded through the socket handlers). Prior: OutcomeCard renders in a centered reading column (max-w-3xl mx-auto) instead of clinging to the card's left edge. Prior: Always play the "6 months later" time-skip clock after a pick: a kiosk-walkthrough latch keeps the local time-skip→reveal rendering even when a solo room advances the phase to debrief the instant Continue is pressed; latch releases (→ debrief) once everyone's continued or the server moves on. Prior: Pin the round-1 outcome ("six months later") to the top of the round-2 debrief chat so it stays visible after Continue (solo runs replaced the transient kiosk reveal instantly), deduped against the server 📊 outcome card. Prior: M9 three-round rework: new `solo` phase (round 0) that owns the premise/cards prelude and adds a "decide alone" notice, a private ballot with no tally, and a "now as a group" handoff; `discuss` (round 1) now renders the chat straight away and is students-only; new `debrief` branch (round 2, the only round ACTR appears in); the done screen swaps the removed scorecard for the private-pick-vs-group comparison; the dead "Choose again" re-choice ballot and all grading state are gone. Prior: Reset now clears the room's premise-seen flags deterministically (resetBreakout + room_reset), so the prelude replays after a reset even though the owner never passes through `waiting`. Prior: premise drops a masthead heading the body's opening restates (no duplicate company name) and tightens the drop-cap kerning. Prior: enterRoom sends uid on get_history so the roster reseeds correctly across reconnects (fixes the kiosk "0 of N ready" strand). Prior: kiosk reveal wait screen gets a "Back to lobby" escape so a student isn't stranded when the Continue gate can't advance. Prior: OutcomeCard re-flows the outcome prose into blank-line-separated paragraphs so it renders as spaced <p> blocks instead of one dense block (marked runs with breaks:true). Prior: premise renders the author byline/attribution as a tiny grey copyright-style footer (from premise.credits), not brief body. Prior: kiosk reveal loads the outcome live via kiosk_update + empty-doc fallback; failed-hire callout uses the brand palette; premise brief as a structured case-document card (subheads + serif body + drop cap) with the doubled "Manager Manager" suffix fixed; CandidateDeck seen-badge rides up on hover; M4 premise-seen flag cleared in `waiting`. */
//
// ManagerExercisePage — the student experience for a "manager_exercise" bot_type.
//
// Hidden-profile flow (M9): each student holds a different role's slice of the
// candidates' credentials, and the exercise runs in three rounds:
//   loading → local-only, before the lobby has loaded
//   lobby   → pick a breakout room (Group 1..N) with live occupancy
//   waiting → in a room; start whenever the team is ready, full or not
//   solo    → ROUND 0. A client-local walkthrough: premise brief → role-sliced
//             credential cards → "decide alone" notice → private ballot → "now as
//             a group" handoff. Nobody sees anyone else's pick, ever.
//   discuss → ROUND 1. The group's own deliberation. NO FACILITATOR — ACTR is not
//             invoked at all until round 2 (server-side, `facilitator_active`).
//   choose  → the timed ballot; the vote clock only starts here, after deliberation
//   kiosk   → each student presses Continue → time-skip → the pick's outcome reveal
//   debrief → ROUND 2. ACTR joins for the first and only time. No second ballot.
//   done    → the session is over. Not graded.
//
// Countdowns derive from the server's `phase_deadline_ts` corrected against
// `server_now_ts` (clock-skew safe), so a refresh / reconnect stays accurate.
// The socket/uid resolution reuses GroupChatPage's patterns verbatim.

import React, { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  FaSpinner, FaPaperPlane, FaUsers, FaArrowLeft, FaLock,
  FaUserTie, FaCheckCircle, FaRegClock, FaChartLine, FaComments,
  FaRedo, FaTimes, FaReply,
} from 'react-icons/fa';
import { RiUser3Line } from 'react-icons/ri';
import axios from 'axios';
import { renderMarkdown } from '../utils/markdown';
import { io } from 'socket.io-client';
import UserInfo from '../components/UserInfo';
import LoadingScreen from '../components/LoadingScreen';
import { dashboardPath } from '../utils/auth';

const getToken = () => localStorage.getItem('jwtToken') || localStorage.getItem('access_token');

// Where "back" goes reads differently by role: a student's home is their class list,
// a professor's is their assistant list. Paired with dashboardPath() for the route.
const homeLabel = () =>
  localStorage.getItem('userRole') === 'student' ? 'Back to my classes' : 'Back to my AIs';

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

// Role titles in the case pack are sometimes authored bare ("Logistics") and
// sometimes with the suffix ("Logistics Manager"). Strip a trailing "Manager" so
// the UI can append its own " Manager" without doubling it ("... Manager Manager").
const roleLabel = (role) => ((role || '').replace(/\s*managers?\s*$/i, '').trim() || 'Hiring');

// Turn the raw general_info extraction into a structured brief. Full-sentence chunks
// are body paragraphs; short label/title lines (ALL-CAPS, ending in ':', or ≤8 words
// with no terminal punctuation) become tracked subheads. Consecutive duplicate labels
// collapse (comparing only the part before a ':'), so a doc that repeats a section
// title — e.g. "General Information: ..." then a bare "General Information" — shows it
// once instead of dumping the document's boilerplate as flat paragraphs.
const parseBrief = (scenario) => {
  const chunks = (scenario || '').split(/\n{2,}/).map((c) => c.trim()).filter(Boolean);
  const isHeading = (t) => {
    if (t.length > 70 || /[.!?]$/.test(t)) return false;
    return /:$/.test(t) || t === t.toUpperCase() || t.split(/\s+/).length <= 8;
  };
  const key = (s) => s.toLowerCase().split(':')[0].trim();
  const out = [];
  for (const c of chunks) {
    const heading = isHeading(c);
    const prev = out[out.length - 1];
    if (heading && prev && prev.heading && key(prev.text) === key(c)) continue;
    out.push({ heading, text: c });
  }
  // Drop a masthead heading the opening body paragraph just restates — e.g. the
  // company-name title above a first line that names the company again. Scoped to
  // headings BEFORE the first body block (the title zone), and requires 2+ shared
  // significant words, so real mid-body section headings are never removed.
  const firstBody = out.find((b) => !b.heading);
  if (firstBody) {
    const tokens = (s) => s.toLowerCase().match(/[a-z]{3,}/g) || [];
    const bodyOpen = new Set(tokens(firstBody.text).slice(0, 12));
    for (let i = out.indexOf(firstBody) - 1; i >= 0; i--) {
      if (out[i].heading && tokens(out[i].text).filter((t) => bodyOpen.has(t)).length >= 2) {
        out.splice(i, 1);
      }
    }
  }
  return out;
};

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
// The outcome document is plain prose whose paragraphs are separated by single
// newlines. The markdown renderer runs with `breaks: true`, so single newlines
// become <br> and the whole thing collapses into one dense block. Re-flow it into
// blank-line-separated paragraphs first so each renders as its own spaced <p>.
const paragraphize = (t) =>
  (t || '').split(/\n+/).map((s) => s.trim()).filter(Boolean).join('\n\n');

const OutcomeCard = ({ title, text }) => {
  const mdRef = useRef(null);
  useLayoutEffect(() => {
    if (mdRef.current) mdRef.current.innerHTML = renderMarkdown(paragraphize(text));
  }, [text]);
  return (
    <div className="rounded-3xl border-2 border-[#FA6C43]/40 bg-gradient-to-br from-[#F9D0C4]/25 to-white shadow-md p-6 sm:p-8 animate-in fade-in zoom-in-95 duration-500">
      {/* Header + body share one centered reading column so the report reads as an
          intentional document instead of prose clinging to the card's left edge. */}
      <div className="max-w-3xl mx-auto w-full flex items-center gap-2 pb-3 mb-4 border-b border-[#FA6C43]/25">
        <FaChartLine className="text-[#FA6C43]" />
        <span className="text-xs font-bold uppercase tracking-widest text-[#C2410C]">{title}</span>
      </div>
      <div ref={mdRef} className="chat-message-md chat-message-md--light max-w-3xl mx-auto text-[15px] leading-[1.7]" />
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
    const id = setTimeout(() => doneRef.current && doneRef.current(), 4500);
    return () => clearTimeout(id);
  }, []);
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-white text-[#0B1220] animate-in fade-in duration-500">
      {/* On the white screen the face, border, hour hand and centre pin all flip to
          dark navy so they stay legible; the minute hand keeps its brand orange. */}
      <div className="relative w-28 h-28 rounded-full border-4 border-[#0B1220]/80 shadow-2xl">
        {/* hour + minute hands rotate about the clock centre (transform-origin at
            bottom); animate-spin owns the transform, so positioning uses left/bottom. */}
        <div className="absolute animate-spin" style={{ left: 'calc(50% - 1.5px)', bottom: '50%', width: '3px', height: '30px', background: '#0B1220', transformOrigin: 'bottom center', animationDuration: '1.6s' }} />
        <div className="absolute animate-spin" style={{ left: 'calc(50% - 1px)', bottom: '50%', width: '2px', height: '42px', background: '#FA6C43', transformOrigin: 'bottom center', animationDuration: '0.6s' }} />
        <div className="absolute rounded-full" style={{ left: 'calc(50% - 4px)', top: 'calc(50% - 4px)', width: '8px', height: '8px', background: '#0B1220' }} />
      </div>
      <p className="mt-8 text-lg font-bold tracking-wide animate-in fade-in slide-in-from-bottom-2 duration-1000">Six months later…</p>
    </div>
  );
};

// M6: the kiosk gate — a deliberate full-screen stop so students look up at the
// instructor. Pressing Continue advances only THIS student (the phase machine
// holds the shared discussion until everyone has).
const KioskGate = ({ onContinue }) => (
  <div className="h-screen flex flex-col items-center justify-center bg-white text-[#222] p-6 text-center animate-in fade-in duration-500" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
    <div className="max-w-md">
      {/* On the white screen the icon chip flips to the brand-peach tile + orange
          glyph used on the other light screens, and the body copy to muted grey. */}
      <div className="mx-auto mb-6 w-14 h-14 rounded-2xl bg-[#F9D0C4]/40 flex items-center justify-center"><FaRegClock className="text-2xl text-[#FA6C43]" /></div>
      <h1 className="text-2xl font-extrabold mb-3">Your group has decided.</h1>
      <p className="text-gray-500 mb-8 leading-relaxed">Eyes up front — your instructor will set the scene. Press Continue when you're ready to see how the hire played out.</p>
      <button onClick={onContinue} className="rounded-2xl bg-[#FA6C43] hover:bg-[#E55B34] text-white font-bold px-10 py-4 shadow-lg transition-all active:scale-[0.97]">Continue</button>
    </div>
  </div>
);

// M10: the `case` alternative to the card deck. The student reads their own role's
// uploaded packet as a continuous case document rather than as filtered bullets.
// Reuses `parseBrief` and the premise screen's document styling so the two things a
// student reads in round 0 look like one case, not two products.
const RoleCaseDocument = ({ role, text, onContinue }) => {
  const blocks = parseBrief(text);
  const firstBodyIdx = blocks.findIndex((b) => !b.heading);
  return (
    <div className="min-h-screen flex flex-col items-center bg-[#F0F6FB] text-[#1F1F1F] px-6 py-12 overflow-y-auto scrollbar-thin">
      <div className="max-w-2xl mx-auto w-full">
        <div className="text-center mb-8">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#C2410C] mb-2">Your case</p>
          <h2 className="text-2xl sm:text-3xl mb-2" style={{ fontFamily: "'Newsreader', serif", fontWeight: 600 }}>
            What you know as the <span className="text-[#FA6C43]">{roleLabel(role)}</span> Manager
          </h2>
          <p className="text-sm text-gray-500">
            This is yours alone. Your teammates are reading something different.
          </p>
        </div>

        <div className="rounded-3xl bg-white border border-gray-200 shadow-sm p-8 sm:p-10 text-left mb-8">
          {blocks.map((b, i) => (
            b.heading ? (
              <p key={i} className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#C2410C] mt-7 first:mt-0 mb-2.5">{b.text}</p>
            ) : (
              <p
                key={i}
                className={`text-[17px] leading-[1.75] text-[#1F1F1F]/85 mb-4 last:mb-0 ${i === firstBodyIdx ? 'first-letter:float-left first-letter:text-[2.9rem] first-letter:leading-[0.7] first-letter:pr-2 first-letter:mt-1 first-letter:font-semibold first-letter:text-[#FA6C43]' : ''}`}
                style={{ fontFamily: "'Newsreader', serif" }}
              >{b.text}</p>
            )
          ))}
        </div>

        <div className="text-center">
          <button
            onClick={onContinue}
            className="inline-flex items-center gap-2 rounded-2xl bg-[#FA6C43] hover:bg-[#E55B34] text-white font-bold px-8 py-3.5 shadow-sm hover:shadow-md transition-all active:scale-95"
          >
            I've read it →
          </button>
        </div>
      </div>
    </div>
  );
};

// M9: the round-0 interstitials — a deliberate full-screen stop that names what the
// student is about to do before they do it. Same shape as KioskGate (icon tile,
// headline, one line of body, one action), so the three pauses in the exercise read
// as the same kind of moment. `action` is omitted on the handoff screen, where the
// room is waiting on other people rather than on this student.
const NoticeScreen = ({ icon, eyebrow, title, body, action, onAction, footer }) => (
  <div className="h-screen flex flex-col items-center justify-center bg-[#F0F6FB] text-[#222] p-6 text-center animate-in fade-in duration-500" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
    <div className="max-w-md">
      <div className="mx-auto mb-6 w-14 h-14 rounded-2xl bg-[#F9D0C4]/40 flex items-center justify-center text-2xl text-[#FA6C43]">{icon}</div>
      {eyebrow && <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#C2410C] mb-3">{eyebrow}</p>}
      <h1 className="text-2xl font-extrabold mb-3">{title}</h1>
      <p className="text-gray-500 mb-8 leading-relaxed">{body}</p>
      {action && (
        <button onClick={onAction} className="rounded-2xl bg-[#FA6C43] hover:bg-[#E55B34] text-white font-bold px-10 py-4 shadow-lg transition-all active:scale-[0.97]">
          {action}
        </button>
      )}
      {footer}
    </div>
  </div>
);

// M4: one labelled group of credential lines on a candidate card. `tone` colours the
// marker — strengths read positive, concerns cautionary, "also noted" neutral. Renders
// nothing when the list is empty so a card only shows the sections it actually has.
const CredList = ({ label, items, tone }) => {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  if (list.length === 0) return null;
  const dot = tone === 'pos' ? 'bg-emerald-500' : tone === 'neg' ? 'bg-[#FA6C43]' : 'bg-gray-300';
  const head = tone === 'pos' ? 'text-emerald-700' : tone === 'neg' ? 'text-[#C2410C]' : 'text-gray-400';
  return (
    <div className="mb-4 last:mb-0">
      <p className={`text-[11px] font-bold uppercase tracking-wider mb-1.5 ${head}`}>{label}</p>
      <ul className="space-y-1.5">
        {list.map((t, i) => (
          <li key={i} className="flex items-start gap-2 text-sm text-[#333] leading-snug">
            <span className={`mt-1.5 h-1.5 w-1.5 rounded-full shrink-0 ${dot}`} />
            <span>{t}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

// M6: the candidate card deck. Three poker-style cards side by side; hovering peeks a
// card up out of the row; clicking brings it to the front, enlarged, with that
// candidate's full role-sliced credentials. The hover TARGET is a fixed-size slot that
// never moves — only the card face inside it translates up — so a peeking card can't
// slide out from under the cursor and flicker (per the repo's no-hover-lift rule).
const CandidateDeck = ({ role, credentials, onContinue }) => {
  const [selected, setSelected] = useState(null);
  const [seen, setSeen] = useState(() => new Set());
  const open = (i) => { setSelected(i); setSeen((prev) => { const n = new Set(prev); n.add(i); return n; }); };
  const active = selected != null ? credentials[selected] : null;

  return (
    <div className="h-screen flex flex-col bg-[#F0F6FB] text-[#1F1F1F]">
      <div className="flex-1 overflow-y-auto px-6 py-10 scrollbar-thin flex flex-col items-center justify-center">
        <div className="max-w-4xl w-full text-center">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#C2410C] mb-2">Your notes</p>
          <h2 className="text-2xl sm:text-3xl mb-2" style={{ fontFamily: "'Newsreader', serif", fontWeight: 600 }}>
            What you know as the <span className="text-[#FA6C43]">{roleLabel(role)}</span> Manager
          </h2>
          <p className="text-sm text-gray-500 mb-10">
            Tap a card to read it. These are yours alone — memorize them, they're hidden once the discussion starts.
          </p>

          {credentials.length === 0 ? (
            <p className="text-gray-500 py-16">No notes were provided for your role.</p>
          ) : (
            <div className="flex justify-center items-end mb-10 pt-6">
              {credentials.map((c, i) => (
                <button
                  key={c.name || i}
                  onClick={() => open(i)}
                  className="group relative block hover:z-30 focus:z-30 focus:outline-none"
                  style={{ marginLeft: i === 0 ? 0 : '-1.25rem', zIndex: 10 + i }}
                  aria-label={`Read ${c.name}`}
                >
                  {/* inner face translates up on hover; the button slot stays put. The
                      seen-badge lives INSIDE this face (anchored to it via `relative`)
                      so it rides up with the card on hover instead of lagging behind. */}
                  <div className="relative w-40 sm:w-44 h-56 sm:h-60 rounded-2xl bg-white border border-gray-200 shadow-lg flex flex-col items-center justify-between p-4 transition-all duration-300 ease-out group-hover:-translate-y-6 group-hover:shadow-2xl group-hover:border-[#FA6C43]/40">
                    <span className="self-start text-[11px] font-bold text-gray-300">{String(i + 1).padStart(2, '0')}</span>
                    <span className="text-lg leading-tight text-[#222]" style={{ fontFamily: "'Newsreader', serif", fontWeight: 600 }}>{c.name}</span>
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-[#FA6C43] opacity-0 group-hover:opacity-100 transition-opacity">
                      {seen.has(i) ? 'Read again' : 'Tap to read'}
                    </span>
                    {seen.has(i) && (
                      <span className="absolute top-2 right-2 h-5 w-5 rounded-full bg-emerald-500 text-white text-[10px] flex items-center justify-center shadow">✓</span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}

          <button
            onClick={onContinue}
            className="inline-flex items-center gap-2 rounded-2xl bg-[#FA6C43] hover:bg-[#E55B34] text-white font-bold px-8 py-3.5 shadow-sm hover:shadow-md transition-all active:scale-95"
          >
            Continue to discussion →
          </button>
          {credentials.length > 0 && seen.size < credentials.length && (
            <p className="mt-3 text-xs text-gray-400">You've read {seen.size} of {credentials.length}.</p>
          )}
        </div>
      </div>

      {/* Selected card, brought to the front: enlarged, with full credentials. */}
      {active && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center p-6 bg-[#0B1220]/40 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={() => setSelected(null)}
        >
          <div
            className="w-full max-w-md max-h-[85vh] overflow-y-auto scrollbar-thin rounded-3xl bg-white border border-gray-200 shadow-2xl p-8 animate-in fade-in zoom-in-95 slide-in-from-bottom-2 duration-300"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-5">
              <div className="text-left">
                <p className="text-[11px] font-bold uppercase tracking-wider text-gray-300 mb-1">Candidate</p>
                <h3 className="text-2xl text-[#222]" style={{ fontFamily: "'Newsreader', serif", fontWeight: 600 }}>{active.name}</h3>
              </div>
              <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-[#222] text-xl leading-none px-2" aria-label="Back to deck">×</button>
            </div>
            <CredList label="Strengths" items={active.strengths} tone="pos" />
            <CredList label="Concerns" items={active.concerns} tone="neg" />
            <CredList label="Also noted" items={active.neutral} tone="neutral" />
            {(!active.strengths?.length && !active.concerns?.length && !active.neutral?.length) && (
              <p className="text-sm text-gray-400">You have no specific notes on this candidate.</p>
            )}
            <button
              onClick={() => setSelected(null)}
              className="mt-6 w-full rounded-2xl border border-gray-200 hover:border-[#FA6C43]/40 hover:bg-[#F0F6FB] text-sm font-semibold text-[#222] py-2.5 transition-all"
            >
              Back to deck
            </button>
          </div>
        </div>
      )}
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
  const [phase, setPhase] = useState('loading'); // loading|lobby|waiting|solo|discuss|choose|kiosk|debrief|done
  const [roomId, setRoomId] = useState(null);

  // ---- breakout lobby ----
  const [rooms, setRooms] = useState([]);              // [{room_id,index,label,names,occupants,capacity,started}]
  const [roomError, setRoomError] = useState('');
  // Faculty-only lobby reset. `confirmReset` holds the room index awaiting a second
  // click (inline confirm, so a mis-tap never wipes a group); `resettingRoom` is the
  // index whose reset is in flight, cleared on the `breakout_reset` / error reply.
  const [confirmReset, setConfirmReset] = useState(null);
  const [resettingRoom, setResettingRoom] = useState(null);

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
  // Quote-reply: the parent being replied to, and the mid briefly flashed after a
  // click-to-scroll lands on it.
  const [replyingTo, setReplyingTo] = useState(null);
  const [flashMid, setFlashMid] = useState(null);

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
  // Latch: once THIS client presses Continue, keep rendering its local kiosk
  // walkthrough (time-skip clock → outcome reveal) even after the server advances
  // the phase. In a solo room the phase jumps to 'debrief' the instant you press
  // Continue, which would otherwise skip the "6 months later" clock entirely.
  const [inKioskWalkthrough, setInKioskWalkthrough] = useState(false);
  // M11: round-1 "we've decided" signal. A majority of the room opens the ballot
  // early; below that these counts just show the others someone is waiting.
  const [readyCount, setReadyCount] = useState(0);
  const [readyTotal, setReadyTotal] = useState(0);
  const [youAreReady, setYouAreReady] = useState(false);

  const [kioskAcked, setKioskAcked] = useState(0);
  const [kioskTotal, setKioskTotal] = useState(0);
  const [youContinued, setYouContinued] = useState(false);
  const [forecastText, setForecastText] = useState(null);
  const [chosenVerdict, setChosenVerdict] = useState(null); // M2: 'success' | 'failure'
  const kioskInitedRef = useRef(false);

  // ---- round 0: the private decision (M9) ----
  // A per-student, client-local walkthrough that owns the whole `solo` phase:
  //   premise → the brief         cards   → this student's role-sliced credentials
  //   notice  → "decide alone"    decide  → the private ballot
  //   handoff → "now as a group", waiting on the rest of the room
  // `soloStage` gates it. `yourRole`/`credentials` come from the M1/M2 snapshot
  // fields; `yourSoloVote` is this student's own pick, restored on reconnect so a
  // refresh mid-round-0 doesn't ask them to decide twice. There is deliberately no
  // solo tally in state — the server never sends one.
  const [soloStage, setSoloStage] = useState('premise'); // premise|cards|notice|decide|handoff
  const [soloPick, setSoloPick] = useState(null);        // local selection, pre-submit
  const [yourSoloVote, setYourSoloVote] = useState(null);
  const [soloSubmitted, setSoloSubmitted] = useState(0);
  const [soloTotal, setSoloTotal] = useState(0);
  const [yourRole, setYourRole] = useState(null);
  const [credentials, setCredentials] = useState([]);   // [{name, strengths, concerns, neutral}]
  // M10: 'cards' (filtered deck) or 'case' (this role's uploaded packet as a
  // document). `yourCase` is '' when the professor authored no packet for this
  // role, which is what makes the cards fallback possible.
  const [studentView, setStudentView] = useState('cards');
  const [yourCase, setYourCase] = useState('');
  const [scenario, setScenario] = useState('');         // M5: shared general_info prose for the premise
  const [credits, setCredits] = useState('');           // author byline / attribution — tiny footer only
  const soloInitedRef = useRef(false);

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

  // M9: decide where in the round-0 walkthrough this client lands, once per entry
  // into `solo`. A useEffect (rather than applyExerciseState) because the
  // waiting→solo transition arrives as a bare `phase_change`, not a full snapshot.
  // Order matters: a student who has already submitted goes straight to the handoff,
  // otherwise a refresh that already got past the cards skips back to the ballot.
  useEffect(() => {
    if (phase === 'solo') {
      if (!soloInitedRef.current) {
        soloInitedRef.current = true;
        if (yourSoloVote) { setSoloStage('handoff'); return; }
        let seen = false;
        try { seen = localStorage.getItem(`me_premise_seen_${roomIdRef.current}`) === '1'; } catch { /* localStorage may be unavailable */ }
        setSoloStage(seen ? 'decide' : 'premise');
      }
    } else {
      soloInitedRef.current = false;
    }
  }, [phase, yourSoloVote]);

  // M4 fix: breakout room ids are deterministic (`{config_id}_g{index}`), so the
  // per-room "premise seen" flag written below would otherwise stick forever and
  // skip the prelude on every later run of that group — even after an instructor
  // reset (which clears server state but not this browser's localStorage).
  const clearPremiseSeen = (rid) => {
    if (!rid) return;
    try {
      localStorage.removeItem(`me_premise_seen_${rid}`);
      // Keys written by the pre-M9 per-round scheme; cleared so an upgraded client
      // doesn't leave them behind forever.
      localStorage.removeItem(`me_premise_seen_${rid}_r1`);
      localStorage.removeItem(`me_premise_seen_${rid}_r2`);
    } catch { /* localStorage may be unavailable */ }
  };

  // Clear the flag whenever this client is in the pre-start `waiting` phase: every
  // fresh run passes through `waiting` before `solo`, so the prelude replays each
  // run, while a mid-round-0 refresh (which lands straight in `solo`, never
  // `waiting`) still honours the flag set during that run and doesn't replay. Reset
  // also clears it directly (see resetBreakout / room_reset), since the resetting
  // owner sits in the lobby and never passes through `waiting`.
  useEffect(() => {
    if (phase === 'waiting') clearPremiseSeen(roomIdRef.current);
  }, [phase]);

  // Mark the brief + cards as read (persisted per room) and move to the notice that
  // tells them they are about to decide on their own.
  const finishPremiseIntro = () => {
    try { localStorage.setItem(`me_premise_seen_${roomIdRef.current}`, '1'); } catch { /* localStorage may be unavailable */ }
    setSoloStage('notice');
  };

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
    // M1/M2: this viewer's confidential role + their role-sliced credential cards.
    // Kept in their own state (not `candidates`) so a later ballot_update, which
    // sends name-only candidate lists, can't wipe the credentials.
    if (s.your_role !== undefined) setYourRole(s.your_role);
    if (Array.isArray(s.your_credentials)) setCredentials(s.your_credentials);
    // M10: cards vs case, and this viewer's OWN packet (never another role's).
    if (typeof s.student_view === 'string') setStudentView(s.student_view);
    if (typeof s.your_case === 'string') setYourCase(s.your_case);
    if (s.premise && typeof s.premise.scenario === 'string') setScenario(s.premise.scenario);
    if (s.premise && typeof s.premise.credits === 'string') setCredits(s.premise.credits);
    // M9 round 0. `your_solo_vote` is this viewer's own pick and the only one they
    // will ever see; the counts drive the "waiting for your group" line. The server
    // sends no solo tally, so there is nothing here to accidentally render.
    if (s.your_solo_vote !== undefined) {
      setYourSoloVote(s.your_solo_vote);
      if (s.your_solo_vote) setSoloPick(s.your_solo_vote);
    }
    if (typeof s.solo_submitted === 'number') setSoloSubmitted(s.solo_submitted);
    if (typeof s.solo_total === 'number') setSoloTotal(s.solo_total);
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
    if (s.chosen_verdict !== undefined) setChosenVerdict(s.chosen_verdict);
    if (typeof s.ready_count === 'number') setReadyCount(s.ready_count);
    if (typeof s.ready_total === 'number') setReadyTotal(s.ready_total);
    if (typeof s.you_are_ready === 'boolean') setYouAreReady(s.you_are_ready);
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
    // Chat is unlocked for the two conversations only (server is authoritative;
    // this is cosmetic).
    setChatLocked(s.phase !== 'discuss' && s.phase !== 'debrief');
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

        // The uid + display name ride along on every room entry so the server can
        // (re)seed the roster ACTR addresses and the kiosk/go-around quorum is
        // measured against. Sending the uid — not relying on the sid→uid map — keeps
        // the roster correct across reconnects (a new socket sid has no map entry),
        // which is what otherwise stranded a student at "0 of N ready".
        const enterRoom = (rid) => socket.emit('get_history', {
          room_id: rid, uid: userIdRef.current, display_name: displayNameRef.current,
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
          // A failed reset unwinds the in-flight/confirm state so the button recovers
          // rather than spinning forever; join failures keep their existing copy.
          if (d.reason === 'unauthorized' || d.reason === 'reset_failed') {
            setResettingRoom(null);
            setConfirmReset(null);
            setRoomError(d.reason === 'unauthorized'
              ? "You don't have permission to reset that group."
              : 'Could not reset that group — try again.');
            return;
          }
          setRoomError(d.reason === 'finished'
            ? 'That group has already finished — pick another.'
            : 'That group is full — pick another.');
        });

        // Faculty reset landed: the lobby is re-broadcast by the server, so just
        // clear this client's transient reset state.
        socket.on('breakout_reset', () => {
          setResettingRoom(null);
          setConfirmReset(null);
          setRoomError('');
        });

        // The owner reset the room this client is sitting in — bounce back to the
        // lobby so nobody stares at state the server has just wiped.
        socket.on('room_reset', (d) => {
          if (roomIdRef.current && d.room_id === roomIdRef.current) {
            // The room is starting over: drop its premise-seen flag and every
            // round-0 answer so the next run replays the walkthrough from the top.
            clearPremiseSeen(d.room_id);
            soloInitedRef.current = false;
            setSoloStage('premise');
            setSoloPick(null);
            setYourSoloVote(null);
            setRoomId(null);
            roomIdRef.current = null;
            setRoster([]);
            setMessages([]);
            setPhase('lobby');
            setRoomError('This group was reset by your instructor.');
            socket.emit('list_breakout_rooms', { config_id: configId, uid: userIdRef.current });
          }
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
          setChatLocked(p.phase !== 'discuss' && p.phase !== 'debrief');
        });

        // M9: how many of the room have committed privately. Counts only — the
        // server never sends who picked what, so nothing here can leak a pick.
        socket.on('solo_update', (d) => {
          if (typeof d.submitted === 'number') setSoloSubmitted(d.submitted);
          if (typeof d.total === 'number') setSoloTotal(d.total);
        });

        socket.on('chat_locked', (d) => {
          setChatLocked(typeof d.locked === 'boolean' ? d.locked : true);
        });

        socket.on('chat_history', (data) => {
          if (data.messages) {
            setMessages(data.messages.map((m) => ({
              sender: m.sender_role || m.sender, sender_uid: m.sender_uid, text: m.text,
              mid: m.mid, reply_to: m.reply_to,
            })));
          }
        });
        socket.on('message', (data) => {
          setMessages((prev) => [...prev, {
            sender: data.sender, sender_uid: data.sender_uid, text: data.text,
            mid: data.mid, reply_to: data.reply_to,
          }]);
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

        // M6: live kiosk tally — how many of the room have pressed Continue. Kiosk
        // entry also carries the reveal payload (chosen candidate/verdict/outcome)
        // so the per-student reveal loads live; no full snapshot is pushed here.
        // M11: how many of the room have said they're done deliberating.
        socket.on('ready_update', (d) => {
          if (typeof d.ready === 'number') setReadyCount(d.ready);
          if (typeof d.total === 'number') setReadyTotal(d.total);
        });

        socket.on('kiosk_update', (d) => {
          if (typeof d.acked === 'number') setKioskAcked(d.acked);
          if (typeof d.total === 'number') setKioskTotal(d.total);
          if (typeof d.forecast_text === 'string') setForecastText(d.forecast_text);
          if (d.chosen_verdict !== undefined) setChosenVerdict(d.chosen_verdict);
          if (d.chosen_candidate !== undefined && d.chosen_candidate) setChosenCandidate(d.chosen_candidate);
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

  // Faculty-only: wipe a breakout room back to an empty slot. First click on a room
  // arms the inline confirm; the second click fires. The JWT rides along so the
  // server can authorize (owner-only) — the client-sent uid is never trusted for a
  // destructive action. `config.owned` gates whether the control is even rendered.
  const resetBreakout = (index) => {
    if (confirmReset !== index) { setConfirmReset(index); return; }
    setConfirmReset(null);
    setResettingRoom(index);
    setRoomError('');
    // The room is being wiped, so drop its premise-seen flags now: the owner resets
    // from the lobby and never passes through `waiting`, so the next run would
    // otherwise skip the prelude. Room ids are deterministic (`{config_id}_g{index}`).
    clearPremiseSeen(`${configId}_g${index}`);
    socketRef.current?.emit('reset_breakout_room', {
      config_id: configId,
      room_index: index,
      token: getToken(),
    });
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
      reply_to: replyingTo?.mid || null,
    });
    setInput('');
    setReplyingTo(null);
  };

  // Click a quote block → scroll to the parent and flash it. A gone parent is a no-op.
  const scrollToMid = (mid) => {
    if (!mid) return;
    const el = document.getElementById(`me-msg-${mid}`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setFlashMid(mid);
    setTimeout(() => setFlashMid((cur) => (cur === mid ? null : cur)), 1200);
  };

  // M9 round 0: commit privately. Moves this client to the handoff notice at once;
  // the room only opens round 1 once every student has submitted, which the handoff
  // screen shows as a count. Nobody's pick is ever broadcast.
  const submitSoloPick = () => {
    if (!soloPick || !socketRef.current) return;
    socketRef.current.emit('submit_solo_vote', {
      room_id: roomId, uid: userIdRef.current, candidate: soloPick,
    });
    setYourSoloVote(soloPick);
    setSoloStage('handoff');
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
  // M11: "we've made our decision" — the group's way out of round 1 before the
  // clock. Toggles this student's signal; the server opens the ballot once a
  // majority have pressed it, so one person can't end the discussion alone.
  const toggleReadyToVote = () => {
    socketRef.current?.emit('ready_to_vote', { room_id: roomId, uid: userIdRef.current });
    setYouAreReady((prev) => !prev);
  };

  const continueAck = () => {
    socketRef.current?.emit('continue_ack', { room_id: roomId, uid: userIdRef.current });
    setYouContinued(true);
    setKioskStage('timeskip');
    setInKioskWalkthrough(true);
  };

  // Release the kiosk latch once this client is on its outcome reveal AND either
  // the whole room has continued or the server has already moved past kiosk — a
  // short beat on "opening the discussion…", then the view falls through to the
  // debrief chat. Without the latch a solo room skips straight past the time-skip.
  useEffect(() => {
    if (!inKioskWalkthrough || kioskStage !== 'reveal') return;
    const everyoneReady = kioskTotal > 0 && kioskAcked >= kioskTotal;
    if (!everyoneReady && phase === 'kiosk') return;
    const t = setTimeout(() => setInKioskWalkthrough(false), 1500);
    return () => clearTimeout(t);
  }, [inKioskWalkthrough, kioskStage, kioskAcked, kioskTotal, phase]);

  const secsLeft = remaining == null ? null : Math.max(0, remaining);

  // The AudioContext is created lazily off the student's earlier click (start /
  // private pick / vote), which satisfies the browser autoplay gesture requirement.
  const playBeep = useCallback(() => {
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
  }, []);

  // M5: beep once a second through the choose final-call window to induce decision anxiety.
  useEffect(() => {
    if (phase !== 'choose' || !finalCall) return;
    playBeep();
    const id = setInterval(playBeep, 1000);
    return () => clearInterval(id);
  }, [phase, finalCall, playBeep]);

  // The discussion/debrief clock is visible the whole window, but the beep only kicks
  // in for the final 10 seconds. Gated on a boolean (not raw secsLeft) so the 1s
  // interval isn't torn down and restarted on every 250ms tick.
  const discussBeepOn =
    (phase === 'discuss' || phase === 'debrief') && secsLeft != null && secsLeft > 0 && secsLeft <= 10;
  useEffect(() => {
    if (!discussBeepOn) return;
    playBeep();
    const id = setInterval(playBeep, 1000);
    return () => clearInterval(id);
  }, [discussBeepOn, playBeep]);

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
            // Hover response is border tint + soft shadow only. A translate-y lift
            // here moved the option out from under the pointer, dropping the hover
            // state and snapping it back — a shake. active:scale keeps a press feel.
            <button
              key={c.name}
              disabled={!ballotOpen}
              onClick={() => setPick(c.name)}
              style={{ animationDelay: `${i * 50}ms` }}
              className={`relative text-left rounded-2xl border-2 transition-all animate-in fade-in slide-in-from-bottom-1 disabled:cursor-default active:scale-[0.99] ${
                compact ? 'px-4 py-3' : 'px-5 py-4'
              } ${
                selected
                  ? 'border-[#FA6C43] bg-[#FA6C43]/5 shadow-sm'
                  : 'border-gray-200 bg-white hover:border-[#FA6C43]/50 hover:shadow-sm hover:bg-[#FA6C43]/[0.03]'
              }`}
            >
              <div className="flex items-center gap-3">
                <span className={`flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                  selected ? 'border-[#FA6C43] bg-[#FA6C43]' : 'border-gray-300'
                }`}>
                  {selected && <span className="w-2 h-2 rounded-full bg-white" />}
                </span>
                <span className="flex-1 font-semibold text-[#222]">{c.name}</span>
              </div>
              {/* App-style vote badge: how many of the group have voted for this
                  option. Keyed on `count` so it re-pops (zoom-in) each time it
                  ticks up; ring-2 ring-white floats it over the card edge like an
                  app-icon badge. Hidden at 0, matching app-badge behaviour. */}
              {count > 0 && (
                <span
                  key={count}
                  title={`${count} ${count === 1 ? 'vote' : 'votes'}`}
                  aria-label={`${count} ${count === 1 ? 'vote' : 'votes'}`}
                  className="absolute -top-2 -right-2 min-w-[1.375rem] h-[1.375rem] px-1 flex items-center justify-center rounded-full bg-[#FA6C43] text-white text-xs font-extrabold tabular-nums ring-2 ring-white shadow-md animate-in zoom-in-50 duration-200"
                >
                  {count}
                </span>
              )}
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
  const Transcript = () => {
    // After round 1 the "six months later" outcome lives only on the transient
    // kiosk reveal screen, which is replaced the instant the room drops into the
    // round-2 debrief (in a solo room that happens the moment you press Continue).
    // Pin it to the top of the debrief chat so it's always visible while the group
    // discusses "what happened". `forecastText` is only set post-vote (via
    // kiosk_update), so this never shows during the round-1 discussion. Skip it
    // when the server already posted the 📊 outcome card, to avoid a duplicate.
    const hasOutcomeMsg = messages.some((m) => (m.sender || '').startsWith(OUTCOME_PREFIX));
    return (
    <div className="w-full space-y-6 pb-4">
      {forecastText && !hasOutcomeMsg && (
        <OutcomeCard title={`${chosenCandidate || 'Your hire'} — Outcome`} text={forecastText} />
      )}
      {messages.map((msg, i) => {
        const sender = msg.sender || '';
        if (sender.startsWith(OUTCOME_PREFIX)) {
          return <OutcomeCard key={i} title={sender.replace(OUTCOME_PREFIX, '').trim()} text={msg.text} />;
        }
        const isFacilitator = sender === FACILITATOR_SENDER;
        // Match own messages by stable uid, falling back to the display name for
        // legacy messages that predate sender_uid. Comparing by name alone rendered
        // your own text as someone else's whenever a name drifted from the roster.
        const isMe = !isFacilitator && (
          (msg.sender_uid && msg.sender_uid === userIdRef.current) ||
          (!msg.sender_uid && sender === displayNameRef.current)
        );
        // Hover affordance on the bubble's inner side (opacity only, no layout shift).
        const replyBtn = (
          <button
            type="button"
            onClick={() => setReplyingTo({ mid: msg.mid, sender, text: msg.text })}
            title="Reply"
            className="self-center shrink-0 p-2 text-gray-400 rounded-lg opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-[#FA6C43] transition-opacity"
          >
            <FaReply className="text-xs" />
          </button>
        );
        return (
          <div
            key={msg.mid ?? i}
            id={msg.mid ? `me-msg-${msg.mid}` : undefined}
            className={`group flex gap-4 ${isMe ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-2 duration-300 rounded-2xl transition-shadow ${flashMid && flashMid === msg.mid ? 'ring-2 ring-[#FA6C43]/60' : ''}`}
          >
            {!isMe && (
              <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center mt-1 ${
                isFacilitator ? 'bg-[#FA6C43] text-white' : 'bg-[#F9D0C4]/60 text-[#FA6C43]'
              }`}>
                {isFacilitator
                  ? <FaComments className="text-xs" />
                  : <span className="text-xs font-bold">{sender.substring(0, 2).toUpperCase()}</span>}
              </div>
            )}
            {isMe && replyBtn}
            <div className={`flex flex-col min-w-0 max-w-[88%] ${isMe ? 'items-end' : 'items-start'}`}>
              {!isMe && <span className="text-[10px] font-bold text-gray-500 ml-1 mb-1">{sender}</span>}
              <div className={`min-w-0 max-w-full rounded-2xl px-5 py-3 shadow-sm text-[15px] leading-[1.65] break-words overflow-hidden ${
                isMe
                  ? 'bg-[#FA6C43] text-white rounded-br-none'
                  : isFacilitator
                    ? 'bg-white border-2 border-[#FA6C43]/30 text-[#222] rounded-bl-none'
                    : 'bg-white border border-gray-200 text-[#222] rounded-bl-none'
              }`}>
                {/* Quote block — frozen preview of the parent; click scrolls to it. */}
                {msg.reply_to && (
                  <button
                    type="button"
                    onClick={() => scrollToMid(msg.reply_to.mid)}
                    className={`mb-2 w-full text-left rounded-lg border-l-2 pl-2.5 pr-2 py-1 transition-colors ${
                      isMe
                        ? 'border-white/70 bg-white/15 hover:bg-white/25'
                        : 'border-[#FA6C43] bg-[#FA6C43]/5 hover:bg-[#FA6C43]/10'
                    }`}
                  >
                    <span className={`block text-[11px] font-bold truncate ${isMe ? 'text-white/90' : 'text-[#C2410C]'}`}>{msg.reply_to.sender}</span>
                    <span className={`block text-[12px] truncate ${isMe ? 'text-white/80' : 'text-gray-500'}`}>{msg.reply_to.snippet}</span>
                  </button>
                )}
                <MessageBody text={msg.text} isMe={isMe} />
              </div>
            </div>
            {!isMe && replyBtn}
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
  };

  // -------------------------------------------------------------------------
  // Phase: loading
  // -------------------------------------------------------------------------
  if (phase === 'loading') return <LoadingScreen message="Setting up your exercise…" />;

  // -------------------------------------------------------------------------
  // Phase: lobby (pick a breakout room)
  // -------------------------------------------------------------------------
  if (phase === 'lobby') {
    return (
      <div className="min-h-screen bg-[#F0F6FB] text-[#222] py-10 px-4" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
        <div className="max-w-2xl mx-auto">
          {/* Escape hatch home — the lobby is otherwise a dead end if a student
              lands on the wrong exercise. Colour-only hover (no lift) per the
              house micro-animation rule. dashboardPath() rather than a hardcoded
              /config_list: that route is professor-only and bounced students. */}
          <div className="mb-6 flex items-center justify-between gap-4">
            <button
              onClick={() => navigate(dashboardPath())}
              className="inline-flex items-center gap-2 rounded-lg -ml-2 px-2 py-1 text-sm font-semibold text-gray-500 hover:text-[#C2410C] transition-colors"
            >
              <FaArrowLeft className="text-xs" /> {homeLabel()}
            </button>
            <UserInfo />
          </div>
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
              // Owner-only reset only makes sense for a room that holds state — one
              // that has begun, finished, or still has someone sitting in it. A fresh
              // empty slot has nothing to wipe, so the control stays hidden.
              const resettable = config?.owned && (r.phase === 'done' || r.started || r.occupants > 0);
              const isResetting = resettingRoom === r.index;
              const isConfirming = confirmReset === r.index;
              return (
                <div key={r.room_id} className="space-y-1.5">
                  {/* Same rule as the candidate options: hover raises border + shadow,
                      never position — a translate lift shook the card under the cursor. */}
                  <button
                    onClick={() => joinBreakout(r.index)}
                    disabled={!joinable}
                    style={{ animationDelay: `${i * 50}ms` }}
                    className={`w-full text-left rounded-2xl border-2 px-5 py-4 transition-all animate-in fade-in slide-in-from-bottom-1 ${
                      !joinable
                        ? 'border-gray-200 bg-gray-50 cursor-not-allowed opacity-60'
                        : r.started
                          ? 'border-[#FA6C43]/40 bg-[#F9D0C4]/10 hover:border-[#FA6C43] hover:shadow-md active:scale-[0.99]'
                          : 'border-gray-200 bg-white hover:border-[#FA6C43] hover:shadow-md active:scale-[0.99]'
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

                  {/* Faculty control, rendered as a sibling (not nested in the join
                      button, which would be invalid HTML). Arms an inline confirm on
                      the first click so a mis-tap can't erase a group. */}
                  {resettable && (
                    <div className="flex items-center justify-end gap-2 pr-1 text-xs animate-in fade-in">
                      {isResetting ? (
                        <span className="inline-flex items-center gap-1.5 font-semibold text-gray-400">
                          <FaSpinner className="animate-spin" /> Resetting…
                        </span>
                      ) : isConfirming ? (
                        <>
                          <span className="font-semibold text-gray-500">Erase this group?</span>
                          <button
                            onClick={() => resetBreakout(r.index)}
                            className="inline-flex items-center gap-1 rounded-full bg-red-500 px-3 py-1 font-bold text-white shadow-sm transition-colors hover:bg-red-600 active:scale-95"
                          >
                            <FaCheckCircle /> Reset
                          </button>
                          <button
                            onClick={() => setConfirmReset(null)}
                            className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1 font-semibold text-gray-500 transition-colors hover:bg-gray-200 active:scale-95"
                          >
                            <FaTimes /> Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => resetBreakout(r.index)}
                          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-semibold text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 active:scale-95"
                        >
                          <FaRedo className="text-[10px]" /> Reset group
                        </button>
                      )}
                    </div>
                  )}
                </div>
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
  if (phase === 'kiosk' || inKioskWalkthrough) {
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
          <UserInfo />
        </header>
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:px-12 xl:px-20 scrollbar-thin">
          <div className="max-w-2xl mx-auto space-y-6">
            {/* M2: frame the reveal as a celebration (the hire worked out) or an
                aftermath (it went badly), branched on the pick's outcome verdict. */}
            {(() => {
              const win = chosenVerdict === 'success';
              // Success stays emerald (a meaningful "it worked out" signal); a failed
              // hire uses the brand palette instead of the old off-brand amber/cream.
              return (
                <div className={`rounded-2xl px-5 py-4 text-center border animate-in fade-in slide-in-from-bottom-2 duration-500 ${
                  win ? 'bg-emerald-50 border-emerald-200' : 'bg-[#F9D0C4]/25 border-[#FA6C43]/40'
                }`}>
                  <div className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-1">Six months later</div>
                  <div className={`text-lg font-extrabold ${win ? 'text-emerald-700' : 'text-[#C2410C]'}`}>
                    {win
                      ? `Hiring ${chosenCandidate || 'them'} paid off.`
                      : `Hiring ${chosenCandidate || 'them'} went badly.`}
                  </div>
                </div>
              );
            })()}
            {/* null = outcome not received yet (loading); '' = revealed but no document
                authored (graceful fallback, never a perpetual spinner); text = show it. */}
            {forecastText
              ? <OutcomeCard title={`${chosenCandidate || 'Your hire'} — Outcome`} text={forecastText} />
              : forecastText === ''
                ? <p className="text-center text-gray-500">No outcome document was recorded for this hire.</p>
                : <p className="text-center text-gray-500">Loading the outcome…</p>}
            <div className="rounded-2xl border border-gray-200 bg-white p-5 text-center shadow-sm animate-in fade-in duration-500">
              {everyoneReady
                ? <p className="text-sm font-semibold text-emerald-600">Everyone's ready — opening the discussion…</p>
                : <p className="text-sm font-semibold text-gray-600">Waiting for your group — {kioskAcked} of {kioskTotal} ready.</p>}
              {/* Escape hatch: the gate holds until everyone presses Continue, so a
                  dropped/uncounted ack could otherwise strand a student here. */}
              {!everyoneReady && (
                <button
                  onClick={leaveBreakout}
                  className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-gray-500 hover:text-[#FA6C43] transition-colors active:scale-95"
                >
                  <FaArrowLeft className="text-xs" /> Back to lobby
                </button>
              )}
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
          <UserInfo />
        </header>

        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:px-12 xl:px-20 scrollbar-thin">
          <div className="max-w-2xl mx-auto space-y-6">
            {/* The transcript stays visible while chat is locked so the discussion
                they just had sits above the ballot rather than disappearing. */}
            {Transcript()}

            <section className="rounded-3xl bg-white border border-gray-200 shadow-md p-8 animate-in fade-in slide-in-from-bottom-3 duration-400">
              <div className="flex items-center justify-between gap-3 mb-1">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-bold text-[#222]">Your group's decision</h2>
                </div>
                {secsLeft != null && (
                  CountdownChip({ label: finalCall ? 'Final call' : 'Decide', urgent: finalCall || secsLeft <= 30 })
                )}
              </div>
              <p className="text-sm text-gray-500 mb-5">
                Vote for the candidate your group should hire. The room resolves on a majority — or press <span className="font-semibold text-[#222]">Decide now</span> once most of you have voted. This is the group's only decision.
              </p>
              {finalCall && (
                <div className="mb-5 rounded-xl border border-red-300 bg-red-50 px-4 py-2.5 text-sm font-bold text-red-600 animate-pulse">
                  Final call — lock in your vote now.
                </div>
              )}
              {CandidateGrid({})}
            </section>
          </div>
        </main>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Phase: done — the session is over. Not graded, by design.
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
                onClick={() => navigate(dashboardPath())}
                className="mt-7 inline-flex items-center gap-2 rounded-2xl bg-[#FA6C43] hover:bg-[#E55B34] text-white font-bold px-6 py-3 shadow-sm transition-all active:scale-95"
              >
                <FaArrowLeft className="text-xs" /> Back
              </button>
            </div>

            {/* M9: the payoff of having captured a private answer — what this
                student walked in believing, against what the group did. Rendered
                only for the student's OWN pick; nobody else's is ever shown, here
                or anywhere. Silent when they never submitted one. */}
            {yourSoloVote && (
              <div className="rounded-3xl bg-white border border-gray-200 shadow-md p-6 sm:p-8 animate-in fade-in slide-in-from-bottom-2 duration-400">
                <h3 className="text-sm font-bold uppercase tracking-widest text-gray-500 mb-5">Where you started</h3>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="rounded-2xl border border-gray-200 p-4">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">Your private pick</p>
                    <p className="text-lg font-bold text-[#222]">{yourSoloVote}</p>
                  </div>
                  <div className="rounded-2xl border border-gray-200 p-4">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">Your group hired</p>
                    <p className="text-lg font-bold text-[#222]">{chosenCandidate || '—'}</p>
                  </div>
                </div>
                {chosenCandidate && (
                  <p className={`mt-4 rounded-2xl px-4 py-3 text-sm font-semibold border ${
                    yourSoloVote === chosenCandidate
                      ? 'bg-gray-50 text-gray-600 border-gray-200'
                      : 'bg-[#F9D0C4]/25 text-[#C2410C] border-[#FA6C43]/40'
                  }`}>
                    {yourSoloVote === chosenCandidate
                      ? 'The group went where you already were.'
                      : 'You came in wanting someone else, and the group went the other way.'}
                  </p>
                )}
              </div>
            )}
            {Transcript()}
          </div>
        </main>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Phase: solo — ROUND 0 (M9). Read the brief, read your own cards, then decide
  // ALONE before anyone in the group has said a word.
  // (Serif premise polish = M5; poker-card deck animation = M6.)
  // -------------------------------------------------------------------------
  if (phase === 'solo' && soloStage === 'premise') {
    const names = candidates.map((c) => c.name).filter(Boolean);
    // Structured brief from the raw general_info extraction (see parseBrief); falls
    // back to a generic line when the case has no general_info authored.
    const brief = parseBrief(scenario);
    const firstBodyIdx = brief.findIndex((b) => !b.heading);
    // Subtle staggered entry (minimalistic — fade + small rise, no hover lift).
    const rise = (i) => ({ animationDelay: `${i * 90}ms`, animationFillMode: 'both' });
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#F0F6FB] text-[#1F1F1F] px-6 py-12 overflow-y-auto scrollbar-thin">
        <div className="max-w-2xl mx-auto w-full text-center">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#C2410C] mb-4 animate-in fade-in slide-in-from-bottom-2 duration-500" style={rise(0)}>The brief</p>
          <h1 className="text-4xl sm:text-5xl mb-8 leading-tight animate-in fade-in slide-in-from-bottom-2 duration-500" style={{ fontFamily: "'Newsreader', serif", fontWeight: 600, ...rise(1) }}>
            You are the <span className="text-[#FA6C43]">{roleLabel(yourRole)}</span> Manager
          </h1>

          {/* The brief reads as a case document: a white card with tracked orange
              subheads for the source's label lines and relaxed serif prose for the
              body, a drop-cap opening the first paragraph — not the raw doc dump. */}
          {brief.length > 0 ? (
            <div className="rounded-3xl bg-white border border-gray-200 shadow-sm p-8 sm:p-10 text-left mb-8 animate-in fade-in slide-in-from-bottom-2 duration-500" style={rise(2)}>
              {brief.map((b, i) => (
                b.heading ? (
                  <p key={i} className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#C2410C] mt-7 first:mt-0 mb-2.5">{b.text}</p>
                ) : (
                  <p
                    key={i}
                    className={`text-[17px] leading-[1.75] text-[#1F1F1F]/85 mb-4 last:mb-0 ${i === firstBodyIdx ? 'first-letter:float-left first-letter:text-[2.9rem] first-letter:leading-[0.7] first-letter:pr-2 first-letter:mt-1 first-letter:font-semibold first-letter:text-[#FA6C43]' : ''}`}
                    style={{ fontFamily: "'Newsreader', serif" }}
                  >{b.text}</p>
                )
              ))}
            </div>
          ) : (
            <p className="text-lg text-[#1F1F1F]/85 leading-relaxed mb-8 animate-in fade-in slide-in-from-bottom-2 duration-500" style={{ fontFamily: "'Newsreader', serif", ...rise(2) }}>
              {config?.bot_name || 'The committee'} is making a hire, and your group has to choose
              the right person. You each hold a different piece of what's known about the candidates.
            </p>
          )}

          {names.length > 0 && (
            <p className="text-lg mb-8 animate-in fade-in slide-in-from-bottom-2 duration-500" style={{ fontFamily: "'Newsreader', serif", ...rise(3) }}>
              <span className="text-[#1F1F1F]/70">The candidates: </span>
              <span className="font-semibold text-[#2563EB]">{names.join(', ')}</span>
            </p>
          )}

          <p className="text-base italic text-[#1F1F1F]/70 mb-10 animate-in fade-in slide-in-from-bottom-2 duration-500" style={{ fontFamily: "'Newsreader', serif", ...rise(4) }}>
            Here are their credentials, for your judgement.
          </p>
          <button
            onClick={() => setSoloStage('cards')}
            className="inline-flex items-center gap-2 rounded-2xl bg-[#FA6C43] hover:bg-[#E55B34] text-white font-bold px-8 py-3.5 shadow-sm hover:shadow-md transition-all active:scale-95 animate-in fade-in duration-500"
            style={rise(5)}
          >
            Next →
          </button>

          {/* Author byline / attribution — a tiny grey copyright-style footer at the
              very bottom, split out of the brief on the backend so it never reads as
              student content. */}
          {credits && (
            <p className="mt-14 text-[8px] leading-relaxed text-gray-400">
              {credits.split('\n').map((line, i) => (
                <span key={i} className="block">{line}</span>
              ))}
            </p>
          )}
        </div>
      </div>
    );
  }

  // M10: the professor chooses how this material is read. `case` falls back to the
  // deck when the student's role has no packet uploaded, so switching the toggle on
  // a config whose packets aren't in yet degrades instead of showing a blank page.
  if (phase === 'solo' && soloStage === 'cards') {
    if (studentView === 'case' && yourCase.trim()) {
      return <RoleCaseDocument role={yourRole} text={yourCase} onContinue={finishPremiseIntro} />;
    }
    return <CandidateDeck role={yourRole} credentials={credentials} onContinue={finishPremiseIntro} />;
  }

  // The pause that makes round 0 a round: they are told, before they see the ballot,
  // that this call is theirs alone and nobody will see it.
  if (phase === 'solo' && soloStage === 'notice') {
    return (
      <NoticeScreen
        icon={<RiUser3Line />}
        eyebrow="On your own"
        title="First, decide on your own."
        body="Before you talk to anyone, make the call yourself. Nobody in your group will see who you picked, and you won't see theirs. Go with what your own notes tell you."
        action="I'm ready"
        onAction={() => setSoloStage('decide')}
      />
    );
  }

  // The private ballot. Deliberately NOT the CandidateGrid used for the group vote:
  // no live counts, no "Decide now", no sense of a room to read. There is nothing to
  // see but the candidates, which is the whole point of asking here.
  if (phase === 'solo' && soloStage === 'decide') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#F0F6FB] text-[#222] px-6 py-12 overflow-y-auto scrollbar-thin" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
        <div className="max-w-lg w-full animate-in fade-in slide-in-from-bottom-2 duration-500">
          <div className="text-center mb-8">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#C2410C] mb-3">Your decision</p>
            <h1 className="text-3xl mb-3" style={{ fontFamily: "'Newsreader', serif", fontWeight: 600 }}>Who would you hire?</h1>
            <p className="text-sm text-gray-500">This one is yours alone. It stays private.</p>
          </div>

          <div className="grid gap-3">
            {candidates.map((c, i) => {
              const selected = soloPick === c.name;
              return (
                // Hover response is border tint + soft shadow only, matching the group
                // ballot — a translate-y lift moves the option out from under the
                // pointer and the hover state flickers.
                <button
                  key={c.name}
                  onClick={() => setSoloPick(c.name)}
                  style={{ animationDelay: `${i * 60}ms` }}
                  className={`text-left rounded-2xl border-2 px-5 py-4 transition-all animate-in fade-in slide-in-from-bottom-1 active:scale-[0.99] ${
                    selected
                      ? 'border-[#FA6C43] bg-[#FA6C43]/5 shadow-sm'
                      : 'border-gray-200 bg-white hover:border-[#FA6C43]/50 hover:shadow-sm hover:bg-[#FA6C43]/[0.03]'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className={`flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                      selected ? 'border-[#FA6C43] bg-[#FA6C43]' : 'border-gray-300'
                    }`}>
                      {selected && <span className="w-2 h-2 rounded-full bg-white" />}
                    </span>
                    <span className="flex-1 font-semibold text-[#222]">{c.name}</span>
                  </div>
                </button>
              );
            })}
          </div>

          <button
            onClick={submitSoloPick}
            disabled={!soloPick}
            className="mt-6 w-full rounded-2xl bg-[#FA6C43] hover:bg-[#E55B34] text-white font-bold py-4 shadow-sm disabled:opacity-50 transition-all active:scale-[0.98]"
          >
            Lock in my choice
          </button>
          <p className="mt-3 text-center text-xs text-gray-400">You won't be able to change this once your group starts talking.</p>
        </div>
      </div>
    );
  }

  // The handoff the exercise turns on: they have committed, and now they are told
  // the next decision is a shared one. Waits here until the whole room has submitted
  // (the server opens round 1 on its own), so nobody walks into the discussion
  // having skipped the private call.
  if (phase === 'solo' && soloStage === 'handoff') {
    const waiting = soloTotal > 0 && soloSubmitted < soloTotal;
    return (
      <NoticeScreen
        icon={<FaUsers />}
        eyebrow="As a group"
        title="Now you decide as a group."
        body="You've made your own call. Next you'll talk it through with your team and settle on one hire between you. You each know different things about these candidates, so what you say out loud is all the others get."
        footer={
          <div className="mt-2">
            {waiting ? (
              <p className="inline-flex items-center gap-2 text-sm font-semibold text-gray-500">
                <FaSpinner className="animate-spin text-xs" />
                Waiting for your group — {soloSubmitted} of {soloTotal} ready.
              </p>
            ) : (
              <p className="text-sm font-semibold text-emerald-600">Everyone's in — opening the discussion…</p>
            )}
            {yourSoloVote && (
              <p className="mt-4 text-xs text-gray-400">Your private pick: <span className="font-semibold text-gray-500">{yourSoloVote}</span></p>
            )}
          </div>
        }
      />
    );
  }

  // -------------------------------------------------------------------------
  // Phases: discuss (round 1, students only) and debrief (round 2, facilitated).
  // One chat render for both — the difference is the framing, not the mechanics.
  // -------------------------------------------------------------------------
  const isDebrief = phase === 'debrief';
  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[#F0F6FB] font-sans text-[#222]" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
      <header className="flex items-center justify-between px-6 py-3 border-b border-gray-200 bg-white/95 backdrop-blur z-10 h-16 shadow-sm">
        <div className="flex items-center gap-4 min-w-0">
          {/* Escape hatch back to the lobby, matching the one on the kiosk wait
              screen. Round 1 only — leaving mid-debrief has nothing to return to. */}
          {!isDebrief && (
            <button
              onClick={leaveBreakout}
              title="Leave this group and go back to the lobby"
              className="flex-shrink-0 inline-flex items-center gap-2 text-sm font-semibold text-gray-500 hover:text-[#FA6C43] transition-colors active:scale-95"
            >
              <FaArrowLeft className="text-xs" /> <span className="hidden sm:inline">Back</span>
            </button>
          )}
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
        <div className="flex items-center gap-4 shrink-0">
          {/* Clock visible for the whole window; only the last 10s reads as urgent
              (and only then does the beep start — see discussBeepOn). */}
          {secsLeft != null && CountdownChip({ label: isDebrief ? 'Debrief' : 'Discuss', urgent: secsLeft <= 10 })}
          <UserInfo />
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:px-12 xl:px-20 scrollbar-thin">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 opacity-80 animate-in fade-in duration-500">
            <div className="w-20 h-20 bg-gray-100 rounded-3xl flex items-center justify-center mb-6 text-[#1F1F1F]">
              <FaUsers className="text-4xl" />
            </div>
            <h2 className="text-2xl font-bold text-[#222] mb-2">The floor is open</h2>
            {/* Round 1 has no facilitator at all, so promising one here would be a
                lie the students would sit and wait on. */}
            <p className="text-gray-500 text-center max-w-sm">
              {isDebrief
                ? 'Talk it through. ACTR will step in when it\'s useful.'
                : 'This one is yours. Talk it through with your group and settle on a hire between you.'}
            </p>
          </div>
        )}

        {Transcript()}
      </main>

      <footer className="p-4 sm:p-6 lg:px-12 xl:px-20 bg-white border-t border-gray-200">
        {chatLocked && (
          <div className="mb-3 flex items-center justify-center gap-2 text-xs font-semibold text-gray-400 animate-in fade-in">
            <FaLock className="text-[11px]" /> Chat is locked right now.
          </div>
        )}

        {/* M11: the group's way out of round 1 before the clock. Sits above the
            composer rather than in the header so it reads as an action about the
            discussion, not a piece of room furniture. Round 1 only — there is no
            ballot after the debrief. */}
        {!isDebrief && !chatLocked && (
          <div className="mb-3 flex flex-wrap items-center justify-center gap-3 animate-in fade-in">
            <button
              onClick={toggleReadyToVote}
              className={`inline-flex items-center gap-2 rounded-2xl border-2 px-5 py-2.5 text-sm font-bold transition-all active:scale-[0.98] ${
                youAreReady
                  ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                  : 'border-[#FA6C43]/40 text-[#C2410C] hover:bg-[#F9D0C4]/20'
              }`}
            >
              {youAreReady
                ? <><FaCheckCircle className="text-xs" /> We've decided — waiting on the others</>
                : <>We've made our decision</>}
            </button>
            {readyCount > 0 && (
              <span className="text-xs font-semibold text-gray-500 tabular-nums">
                {readyCount}{readyTotal ? ` of ${readyTotal}` : ''} ready to vote
              </span>
            )}
          </div>
        )}
        {/* Reply preview chip — what the next message will quote, with a cancel. */}
        {replyingTo && !chatLocked && (
          <div className="mb-3 flex items-center gap-3 rounded-xl border-l-2 border-[#FA6C43] bg-[#F9D0C4]/20 pl-3 pr-2 py-2 animate-chip-in">
            <div className="flex-1 min-w-0">
              <span className="block text-[11px] font-bold text-[#C2410C] truncate">Replying to {replyingTo.sender}</span>
              <span className="block text-[12px] text-gray-500 truncate">{replyingTo.text}</span>
            </div>
            <button
              onClick={() => setReplyingTo(null)}
              title="Cancel reply"
              className="p-1.5 rounded-lg text-gray-400 hover:text-[#FA6C43] hover:bg-white transition-colors"
            >
              <FaTimes className="text-sm" />
            </button>
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
