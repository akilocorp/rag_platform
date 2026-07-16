// @language JavaScript (React)
// @updated 2026-07-16
// @changed Grade payload: send questions (not tutor replies) + keyIdeas + gradeFloor for the blind grader; debrief renders n/a dimensions.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FiArrowLeft, FiRefreshCw, FiMenu, FiZap, FiAward, FiAlertTriangle, FiCheckCircle } from 'react-icons/fi';
import { FaSpinner } from 'react-icons/fa';
import apiClient from '../../api/apiClient';
import { Card, FeedBlock } from './blocks.jsx';

const getToken = () => localStorage.getItem('jwtToken') || localStorage.getItem('access_token');
const API_BASE = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_URL) ? import.meta.env.VITE_API_URL : '/api';

// Stream one Socratic turn. Yields text chunks to onToken as they arrive and
// resolves to the hidden control verdict (verdict, advance, goal_reached,
// newly_demonstrated, effort_signals, next_question) emitted at the stream end.
async function streamTurn(payload, onToken) {
  const token = getToken();
  const resp = await fetch(`${API_BASE}/experiential/method/shock-world/turn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(payload),
  });
  if (!resp.ok || !resp.body) {
    let err = 'The tutor is unavailable right now.';
    try { err = (await resp.json()).error || err; } catch (_) { /* non-JSON */ }
    const e = new Error(err); e.status = resp.status; throw e;
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let control = null;
  const handleLine = (line) => {
    const s = line.trim();
    if (!s) return;
    let evt;
    try { evt = JSON.parse(s); } catch (_) { return; }
    if (evt.type === 'token') onToken(evt.data || '');
    else if (evt.type === 'control') control = evt;
    else if (evt.type === 'error') throw new Error(evt.error || 'stream error');
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      handleLine(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
    }
  }
  if (buffer.trim()) handleLine(buffer);
  return control;
}

// Column chrome — mirrors ExperientialPage's ColumnShell so the lab looks native,
// but self-contained here (this method owns its UI).
function Shell({ title, subtitle, onBack, headerExtra, footer, children, isAuthenticated, onOpenMobileSidebar }) {
  return (
    <>
      <header className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-gray-200 bg-white/95 backdrop-blur z-10 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          {isAuthenticated && (
            <button type="button" onClick={onOpenMobileSidebar} className="p-2 -ml-1 rounded-lg text-gray-500 hover:bg-[#F0F6FB] hover:text-[#FA6C43] transition-colors md:hidden" aria-label="Open sidebar">
              <FiMenu />
            </button>
          )}
          {onBack && (
            <button onClick={onBack} className="p-2 -ml-1 rounded-lg text-gray-500 hover:bg-[#F0F6FB] hover:text-[#FA6C43] transition-colors" aria-label="Back">
              <FiArrowLeft />
            </button>
          )}
          <div className="min-w-0">
            <h1 className="font-bold text-[#222] truncate">{title}</h1>
            {subtitle && <p className="text-xs text-gray-500 truncate">{subtitle}</p>}
          </div>
        </div>
        {headerExtra}
      </header>
      <main className="flex-1 overflow-y-auto px-4 sm:px-6 lg:px-12 xl:px-24 py-5 scrollbar-thin">
        <div className="w-full max-w-3xl mx-auto space-y-4">{children}</div>
      </main>
      {footer}
    </>
  );
}

// The compact "Why?" field: a single-line input + circular send button. Shared
// by the morphed MCQ answer and the free-text follow-up nudge so neither needs
// the tall chat composer. Send is disabled until a reason is typed.
function WhyInput({ why, setWhy, busy, onSend, placeholder }) {
  const canSend = !!why.trim() && !busy;
  return (
    <div className="sw-shell-bottom">
      <input
        autoFocus
        type="text"
        className="sw-why"
        placeholder={placeholder}
        value={why}
        disabled={busy}
        onChange={(e) => setWhy(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (canSend) onSend(); }
        }}
      />
      <button type="button" className="sw-send" onClick={onSend} disabled={!canSend} aria-label="Send" title="Send">
        {busy ? <FaSpinner className="animate-spin" /> : (
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden>
            <path d="M10 16V4M10 4l-5 5M10 4l5 5" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>
    </div>
  );
}

// The morphing MCQ input. The options ARE the input area — full-width buttons,
// no composer below. Picking one collapses the rest and morphs the chosen button
// into a "Why?" field (entrance + collapse are CSS — see .sw-morph in index.css).
function AnswerMorph({ options, pick, why, setWhy, busy, onPick, onChangeAnswer, onSend }) {
  return (
    <div className="sw-morph">
      {options.map((opt) => {
        const isChosen = pick === opt;
        const isHidden = pick && !isChosen; // a different option was picked
        return (
          <div key={opt} className={`sw-row${isHidden ? ' is-hidden' : ''}${isChosen ? ' is-chosen' : ''}`}>
            {isChosen ? (
              <div className="sw-input-shell">
                <div className="sw-shell-top">
                  <span className="sw-chip" title={opt}>{opt}</span>
                  <button type="button" className="sw-back" onClick={onChangeAnswer} disabled={busy}>
                    <FiArrowLeft /> Change
                  </button>
                </div>
                <WhyInput why={why} setWhy={setWhy} busy={busy} onSend={onSend} placeholder="Why?" />
              </div>
            ) : (
              <button type="button" className="sw-option-btn" onClick={() => onPick(opt)} disabled={busy}>
                {opt}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Empty tally, accumulated across adaptive exchanges (the warm-up gate is excluded).
// help_requests are counted for grading but NOT charged against the reply budget.
const EMPTY_TALLY = { exchanges: 0, goal_reached: false, demonstrated_count: 0, key_ideas_total: 0, explained_why: 0, revised_after_nudge: 0, worked_through_contradiction: 0, low_effort: 0, help_requests: 0 };

export default function Runner({ config, configId, templateId, onReset, onBack, isAuthenticated, onSessionSaved, onOpenMobileSidebar }) {
  const keyIdeas = useMemo(() => (Array.isArray(config.keyIdeas) ? config.keyIdeas : []), [config]);
  const budget = Math.max(1, config.maxRounds || 6);

  // Per-topic scope contract (what each course topic actually establishes) so the
  // tutor's live questions can't drift past the lecture. Narrowed to the topics
  // this lab tests when the generator reported them, else the whole course scope.
  const courseScope = useMemo(() => {
    const cts = Array.isArray(config.courseTopics) ? config.courseTopics : [];
    const cards = cts.flatMap((ct) => (Array.isArray(ct.scope) ? ct.scope : []));
    const sel = Array.isArray(config.selectedTopics) ? config.selectedTopics.map((s) => String(s).toLowerCase()) : [];
    const chosen = sel.length ? cards.filter((c) => sel.includes(String(c.topic || '').toLowerCase())) : cards;
    return chosen.length ? chosen : cards;
  }, [config]);

  const [phase, setPhase] = useState('country-pick'); // country-pick | grounding | gate | rounds | grading | done
  const [country, setCountry] = useState(config.countries?.[0] || '');
  // Optional learning analogy the student opts into before starting (blank = none).
  // Woven into the tutor's explanations without displacing the economics.
  const [analogy, setAnalogy] = useState('');
  const [grounding, setGrounding] = useState(null);
  const [feed, setFeed] = useState([]);
  const [mode, setMode] = useState('mc'); // mc | followup — within gate/adaptive
  const [currentQuestion, setCurrentQuestion] = useState(null); // {text, options, targets}
  const [questionNumber, setQuestionNumber] = useState(0); // display counter for posed questions
  const [exchanges, setExchanges] = useState(0); // adaptive exchanges spent (budget)
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [score, setScore] = useState(null);

  const tallyRef = useRef({ ...EMPTY_TALLY });
  const demonstratedRef = useRef(new Set());
  const exchangesRef = useRef(0);
  const historyRef = useRef([]); // rolling window; reset when leaving the gate
  const savedRef = useRef(false);
  const scrollRef = useRef(null);
  const feedRef = useRef([]);
  // A live pick isn't in React state (avoids re-render churn on option click);
  // an option button writes it and forces a light re-render for the highlight.
  const pickRef = useRef('');
  const [, forcePick] = useState(0);
  const choose = (opt) => { pickRef.current = opt; forcePick((n) => n + 1); };
  useEffect(() => { feedRef.current = feed; }, [feed]);
  useEffect(() => { scrollRef.current?.scrollIntoView({ behavior: 'smooth' }); });

  const appendFeed = (block) => setFeed((f) => [...f, block]);

  const scenarioForTurn = grounding
    ? {
        country: grounding.country,
        conditions: grounding.conditions,
        shock: grounding.shock,
        structure: grounding.structure,
        transmission_twist: grounding.transmission_twist,
        country_key_ideas: grounding.country_key_ideas,
      }
    : { country };

  // ── Start: pick a country → ground the scenario → warm-up gate ──────────────
  const startLab = async () => {
    if (!country) { setError('Pick a country to begin.'); return; }
    setError(null);
    setPhase('grounding');
    try {
      const { data } = await apiClient.post(
        '/experiential/method/shock-world/ground',
        { config, country, base_id: config.meta?.id || configId || templateId || 'shock', config_id: configId },
        { timeout: 120000 },
      );
      const g = data?.grounding || { country, shock: config.scenario?.shockKind };
      setGrounding(g);
      const intro = `**You're in ${g.country}.** ${g.conditions || ''}\n\n${g.shock || config.scenario?.brief || ''}${g.shock_first_hit ? `\n\nFirst hit: ${g.shock_first_hit}` : ''}`;
      appendFeed({ type: 'scenario', text: intro });
      appendFeed({ type: 'question', gate: true, text: config.gate?.prompt });
      setCurrentQuestion({ text: config.gate?.prompt, options: config.gate?.options || [], targets: 'shock' });
      setPhase('gate');
      setMode('mc');
    } catch (e) {
      setError(e.response?.data?.error || 'Could not build the scenario. Try again.');
      setPhase('country-pick');
    }
  };

  // ── Submit an answer (gate or adaptive; MC or free-text follow-up) ──────────
  const submit = async () => {
    if (busy) return;
    const isGate = phase === 'gate';
    const isMc = mode === 'mc';
    if (!why.trim()) { setError(isMc ? 'Add a short “why”.' : 'Type your reasoning.'); return; }
    if (isMc && !pickRef.current) { setError('Pick an option first.'); return; }
    setError(null);
    setBusy(true);

    const pick = isMc ? (pickRef.current || '') : '';
    appendFeed({ type: 'student', pick, why: why.trim() });
    historyRef.current.push({ role: 'student', pick, why: why.trim() });

    const tutorIdx = feed.length + 1; // after the student block just queued
    appendFeed({ type: 'tutor', text: '' });
    setWhy(''); pickRef.current = '';

    const payload = {
      labTitle: config.meta?.title || 'Shock World',
      scenario: scenarioForTurn,
      persona: config.analyst?.persona || '',
      courseOnly: !!config.courseOnly,
      config_id: configId,
      phase: isGate ? 'gate' : 'round',
      endGoal: config.endGoal || '',
      analogy: analogy.trim(),
      keyIdeas: keyIdeas.map((k) => ({ id: k.id, label: k.label })),
      courseScope: config.courseOnly ? courseScope : undefined,
      demonstrated: Array.from(demonstratedRef.current),
      exchangesUsed: exchangesRef.current,
      budget,
      currentQuestion,
      answer: { pick, why: why.trim() },
      history: historyRef.current.slice(-8),
    };

    let replyText = '';
    let control = null;
    try {
      control = await streamTurn(payload, (chunk) => {
        replyText += chunk;
        setFeed((f) => { const c = [...f]; if (c[tutorIdx]) c[tutorIdx] = { ...c[tutorIdx], text: replyText }; return c; });
      });
    } catch (e) {
      const fallback = config.analyst?.scriptedFallback || 'The tutor is unavailable right now — try again in a moment.';
      setFeed((f) => { const c = [...f]; if (c[tutorIdx]) c[tutorIdx] = { ...c[tutorIdx], text: fallback }; return c; });
      setError(e.message || 'The tutor is unavailable right now.');
      setBusy(false);
      return;
    }
    historyRef.current.push({ role: 'tutor', text: replyText });

    const advance = !!control?.advance;
    const nextQ = control?.next_question || null;

    // Accumulate effort + budget for scoring — but NOT the warm-up gate.
    // A help-ask ("I can't remember / help me") is tracked for grading but does
    // NOT spend a reply from the budget, so asking for help is never penalized
    // by running the student out of exchanges.
    if (!isGate) {
      const t = tallyRef.current;
      const s = control?.effort_signals || {};
      const isHelp = !!control?.help_request;
      if (isHelp) {
        t.help_requests += 1;
      } else {
        t.exchanges += 1;
        exchangesRef.current += 1;
        setExchanges(exchangesRef.current);
      }
      if (s.explained_why) t.explained_why += 1;
      if (s.revised_after_nudge) t.revised_after_nudge += 1;
      if (s.worked_through_contradiction) t.worked_through_contradiction += 1;
      if (s.low_effort) t.low_effort += 1;
      for (const id of (control?.newly_demonstrated || [])) demonstratedRef.current.add(id);
    }

    setBusy(false);

    // Warm-up gate → enter the adaptive phase on advance, seeding the first question.
    if (isGate) {
      if (!advance) { setMode('followup'); return; }
      historyRef.current = [];
      setPhase('rounds');
      if (nextQ) { presentQuestion(nextQ); }
      else { finishLab(); }
      return;
    }

    // Adaptive phase.
    if (control?.goal_reached) { tallyRef.current.goal_reached = true; finishLab(); return; }
    if (exchangesRef.current >= budget) { finishLab(); return; }
    if (advance && nextQ) { presentQuestion(nextQ); return; }
    if (advance && !nextQ) { finishLab(); return; }
    setMode('followup'); // stay on the same question; tutor's reply is the nudge
  };

  const presentQuestion = (q) => {
    setCurrentQuestion(q);
    setMode('mc');
    setQuestionNumber((n) => {
      const next = n + 1;
      appendFeed({ type: 'question', n: next, text: q.text });
      return next;
    });
  };

  // ── Wrap-up: effort-to-learn + goal grade, then (auth) session persistence ──
  const finishLab = async () => {
    setPhase('grading');
    const t = tallyRef.current;
    // Goal is reached if the control said so, or every key idea — generic AND
    // country-specific (★) — was demonstrated.
    const countryIdeas = Array.isArray(grounding?.country_key_ideas) ? grounding.country_key_ideas : [];
    const totalIdeas = keyIdeas.length + countryIdeas.length;
    if (totalIdeas > 0 && demonstratedRef.current.size >= totalIdeas) t.goal_reached = true;
    t.demonstrated_count = demonstratedRef.current.size;
    t.key_ideas_total = totalIdeas;

    // Grader transcript: the posed questions + the student's own picks/whys,
    // starting from the first REAL question (warm-up gate excluded). Tutor replies
    // are deliberately dropped — the tutor is scripted to praise, so feeding its
    // words to the grader would bias the grade up. Backend re-judges cold.
    const graded = [];
    let started = false;
    for (const b of feedRef.current) {
      if (b.type === 'question' && !b.gate) started = true;
      if (!started) continue;
      if (b.type === 'question' || b.type === 'student') graded.push(b);
    }

    let result = null;
    try {
      const { data } = await apiClient.post(
        '/experiential/method/shock-world/grade',
        {
          labTitle: config.meta?.title || 'Shock World',
          scenario: scenarioForTurn,
          endGoal: config.endGoal || '',
          keyIdeas,
          weights: config.scoring || {},
          gradeFloor: Number.isInteger(config.gradeFloor) ? config.gradeFloor : 0,
          rubric: config.gradeRubric || [],
          tally: t,
          transcript: graded.slice(-60),
        },
        { timeout: 120000 },
      );
      result = { ...data, goalReached: t.goal_reached, exchanges: exchangesRef.current };
    } catch (e) {
      result = { total: null, breakdown: [], feedback: 'Could not compute a score, but your run was saved.', goalReached: t.goal_reached, exchanges: exchangesRef.current };
    }
    setScore(result);
    setPhase('done');

    if (isAuthenticated && !savedRef.current) {
      savedRef.current = true;
      try {
        await apiClient.post('/experiential/sessions', {
          config_id: configId,
          template_id: templateId,
          title: `${config.meta?.title || 'Shock World'} — ${grounding?.country || country}`,
          status: 'completed',
          total_score: result?.total ?? null,
          breakdown: result?.breakdown || [],
          synthesis_text: result?.feedback || '',
          transcript: feedRef.current,
          effective_config: { ...config, _grounding: grounding, _country: grounding?.country || country },
        });
        onSessionSaved?.();
      } catch (_) { /* non-fatal */ }
    }
  };

  const left = Math.max(0, budget - exchanges);
  const headerExtra = (phase === 'gate' || phase === 'rounds')
    ? (
      <span className="text-[11px] font-semibold uppercase tracking-wide bg-[#F9D0C4]/40 text-[#b8452a] px-2 py-1 rounded-lg">
        {phase === 'gate' ? 'Warm-up' : `${left} of ${budget} replies left`}
      </span>
    ) : null;

  // ── Footer input ────────────────────────────────────────────────────────────
  // The multiple-choice step shows only the options (they ARE the input box);
  // picking one morphs it into a "Why?" field. The free-text follow-up nudge
  // shows a single compact input. Neither uses the tall chat composer.
  let footer = null;
  if (phase === 'gate' || phase === 'rounds') {
    const options = currentQuestion?.options || [];
    const isMc = mode === 'mc' && options.length > 0;
    footer = (
      <footer className="border-t border-gray-200 bg-white/95 backdrop-blur px-4 sm:px-6 lg:px-12 xl:px-24 py-3 shrink-0">
        <div className="w-full max-w-3xl mx-auto">
          {busy ? (
            // While the tutor is loading, show a single empty box — never flash the
            // choices back (pickRef is already cleared, which would un-morph the MCQ).
            <div className="sw-input-shell">
              <WhyInput why="" setWhy={() => {}} busy onSend={() => {}} placeholder="" />
            </div>
          ) : isMc ? (
            <AnswerMorph
              options={options}
              pick={pickRef.current}
              why={why}
              setWhy={setWhy}
              busy={busy}
              onPick={choose}
              onChangeAnswer={() => { pickRef.current = ''; setWhy(''); forcePick((n) => n + 1); }}
              onSend={submit}
            />
          ) : (
            <div className="sw-input-shell">
              <WhyInput why={why} setWhy={setWhy} busy={busy} onSend={submit} placeholder="Type your reasoning…" />
            </div>
          )}
          {error && <p className="text-xs text-red-500 mt-1.5 flex items-center gap-1"><FiAlertTriangle /> {error}</p>}
        </div>
      </footer>
    );
  }

  return (
    <Shell
      title={config.meta?.title || 'Shock World'}
      subtitle={grounding?.country ? `Grounded to ${grounding.country}` : config.scenario?.shockKind}
      onBack={onBack}
      headerExtra={headerExtra}
      footer={footer}
      isAuthenticated={isAuthenticated}
      onOpenMobileSidebar={onOpenMobileSidebar}
    >
      {phase === 'country-pick' && (
        <Card accent className="p-6">
          <div className="flex items-center gap-2 text-[#FA6C43] font-semibold mb-2"><FiZap /> {config.meta?.title || 'Shock World'}</div>
          <p className="text-sm text-gray-700 mb-4">{config.scenario?.brief}</p>
          <label className="block text-[13px] font-semibold text-gray-700 mb-1.5">Pick a country</label>
          <select
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            className="w-full mb-4 p-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F9D0C4] focus:border-[#FA6C43]"
          >
            {(config.countries || []).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <label className="block text-[13px] font-semibold text-gray-700 mb-1.5">Want an analogy to make it click? <span className="font-normal text-gray-400">(optional)</span></label>
          <input
            type="text"
            value={analogy}
            onChange={(e) => setAnalogy(e.target.value)}
            placeholder="e.g. rock climbing, swimming, cooking — leave blank for none"
            className="w-full mb-1.5 p-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F9D0C4] focus:border-[#FA6C43]"
          />
          <p className="text-xs text-gray-500 mb-4">Tell us something you're into and the tutor will explain each case through it — the economics stays exactly the same, just made intuitive. Leave it blank to keep the plain explanation.</p>
          <button type="button" onClick={startLab} className="inline-flex items-center gap-2 bg-[#FA6C43] hover:bg-[#e85a30] text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors">
            Enter the shock world
          </button>
          {error && <p className="text-xs text-red-500 mt-2 flex items-center gap-1"><FiAlertTriangle /> {error}</p>}
        </Card>
      )}

      {phase === 'grounding' && (
        <Card className="p-6 flex items-center gap-3 text-gray-600">
          <FaSpinner className="animate-spin text-[#FA6C43]" /> Building your scenario for {country}…
        </Card>
      )}

      {feed.map((b, i) => <FeedBlock key={i} block={b} />)}

      {phase === 'grading' && (
        <Card className="p-6 flex items-center gap-3 text-gray-600">
          <FaSpinner className="animate-spin text-[#FA6C43]" /> Scoring your reasoning…
        </Card>
      )}

      {phase === 'done' && score && (
        <Card accent className="p-6">
          <div className="flex items-center gap-2 text-[#FA6C43] font-bold mb-3"><FiAward /> Debrief</div>
          <p className="text-sm text-gray-700 mb-3 flex items-center gap-1.5">
            {score.goalReached
              ? <><FiCheckCircle className="text-green-600" /> You reached the goal in {score.exchanges} {score.exchanges === 1 ? 'reply' : 'replies'}.</>
              : <>You worked through {score.exchanges} {score.exchanges === 1 ? 'reply' : 'replies'} — not quite to the goal this time.</>}
          </p>
          {typeof score.total === 'number' && (
            <div className="text-3xl font-bold text-gray-800 mb-4">{score.total}<span className="text-lg text-gray-400"> / 100</span></div>
          )}
          <div className="space-y-2 mb-4">
            {(score.breakdown || []).map((d) => {
              // A null score means the dimension didn't apply this run (e.g. no
              // self-correction because the student was never wrong) — show it as
              // n/a rather than a misleading empty bar.
              const na = d.score === null || d.na;
              return (
                <div key={d.key}>
                  <div className="flex justify-between text-xs text-gray-600 mb-0.5">
                    <span>{d.label}</span>
                    <span className="font-semibold">{na ? 'not applicable' : `${d.score} · w${d.weight}`}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                    {!na && <div className="h-full bg-[#FA6C43]" style={{ width: `${Math.max(0, Math.min(100, d.score))}%` }} />}
                  </div>
                </div>
              );
            })}
          </div>
          {score.feedback && <p className="text-sm text-gray-700 leading-relaxed">{score.feedback}</p>}
          <button type="button" onClick={onReset} className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-[#FA6C43] hover:text-[#e85a30]">
            <FiRefreshCw /> Play again
          </button>
        </Card>
      )}

      <div ref={scrollRef} />
    </Shell>
  );
}
