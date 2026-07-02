import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FiArrowLeft, FiRefreshCw, FiMenu, FiZap, FiAward, FiAlertTriangle, FiCheckCircle } from 'react-icons/fi';
import { FaSpinner } from 'react-icons/fa';
import apiClient from '../../api/apiClient';
import ChatComposer from '../../components/ChatComposer';
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

// Empty tally, accumulated across adaptive exchanges (the warm-up gate is excluded).
const EMPTY_TALLY = { exchanges: 0, goal_reached: false, demonstrated_count: 0, key_ideas_total: 0, explained_why: 0, revised_after_nudge: 0, worked_through_contradiction: 0, low_effort: 0 };

export default function Runner({ config, configId, templateId, onReset, onBack, isAuthenticated, onSessionSaved, onOpenMobileSidebar }) {
  const keyIdeas = useMemo(() => (Array.isArray(config.keyIdeas) ? config.keyIdeas : []), [config]);
  const budget = Math.max(1, config.maxRounds || 6);

  const [phase, setPhase] = useState('country-pick'); // country-pick | grounding | gate | rounds | grading | done
  const [country, setCountry] = useState(config.countries?.[0] || '');
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
    ? { country: grounding.country, conditions: grounding.conditions, shock: grounding.shock }
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
      keyIdeas: keyIdeas.map((k) => ({ id: k.id, label: k.label })),
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
    if (!isGate) {
      const t = tallyRef.current;
      const s = control?.effort_signals || {};
      t.exchanges += 1;
      exchangesRef.current += 1;
      setExchanges(exchangesRef.current);
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
    // Goal is reached if the control said so, or every key idea was demonstrated.
    if (keyIdeas.length > 0 && demonstratedRef.current.size >= keyIdeas.length) t.goal_reached = true;
    t.demonstrated_count = demonstratedRef.current.size;
    t.key_ideas_total = keyIdeas.length;

    let result = null;
    try {
      const { data } = await apiClient.post(
        '/experiential/method/shock-world/grade',
        {
          labTitle: config.meta?.title || 'Shock World',
          scenario: scenarioForTurn,
          endGoal: config.endGoal || '',
          weights: config.scoring || {},
          rubric: config.gradeRubric || [],
          tally: t,
          transcript: feedRef.current.filter((b) => b.type === 'student' || b.type === 'tutor').slice(-40),
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

  // ── Footer input (MC pills when applicable + the shared composer) ───────────
  let footer = null;
  if (phase === 'gate' || phase === 'rounds') {
    footer = (
      <footer className="border-t border-gray-200 bg-white/95 backdrop-blur px-4 sm:px-6 lg:px-12 xl:px-24 py-3 shrink-0">
        <div className="w-full max-w-3xl mx-auto">
          {mode === 'mc' && currentQuestion?.options?.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {currentQuestion.options.map((opt, i) => (
                <button
                  key={i}
                  type="button"
                  disabled={busy}
                  onClick={() => choose(opt)}
                  className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${pickRef.current === opt ? 'bg-[#FA6C43] text-white border-[#FA6C43]' : 'bg-white text-gray-700 border-gray-200 hover:border-[#FA6C43]'}`}
                >
                  {opt}
                </button>
              ))}
            </div>
          )}
          <ChatComposer
            input={why}
            setInput={setWhy}
            onSend={() => submit()}
            isLoading={busy}
            showAttach={false}
          />
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
            className="w-full mb-3 p-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F9D0C4] focus:border-[#FA6C43]"
          >
            {(config.countries || []).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
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
            {(score.breakdown || []).map((d) => (
              <div key={d.key}>
                <div className="flex justify-between text-xs text-gray-600 mb-0.5">
                  <span>{d.label}</span><span className="font-semibold">{d.score} · w{d.weight}</span>
                </div>
                <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                  <div className="h-full bg-[#FA6C43]" style={{ width: `${Math.max(0, Math.min(100, d.score))}%` }} />
                </div>
              </div>
            ))}
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
