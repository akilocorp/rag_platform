import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FiArrowLeft, FiRefreshCw, FiMenu, FiZap, FiAward, FiAlertTriangle } from 'react-icons/fi';
import { FaSpinner } from 'react-icons/fa';
import apiClient from '../../api/apiClient';
import ChatComposer from '../../components/ChatComposer';
import { Card, FeedBlock } from './blocks.jsx';

const getToken = () => localStorage.getItem('jwtToken') || localStorage.getItem('access_token');
const API_BASE = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_URL) ? import.meta.env.VITE_API_URL : '/api';

// Stream one Socratic turn. Yields text chunks to onToken as they arrive and
// resolves to the hidden control verdict ({verdict, advance, aha_reached,
// effort_signals}) emitted at the end of the NDJSON stream.
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
// but self-contained here (this method owns its UI; no reach into that file).
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

// Empty tally, accumulated across scored rounds (the warm-up gate is excluded).
const EMPTY_TALLY = { rounds_played: 0, ahas: 0, turns: 0, explained_why: 0, revised_after_nudge: 0, worked_through_contradiction: 0, low_effort: 0 };

export default function Runner({ config, configId, templateId, onReset, onBack, isAuthenticated, onSessionSaved, onOpenMobileSidebar }) {
  const intuitions = useMemo(() => (Array.isArray(config.targetIntuitions) ? config.targetIntuitions : []), [config]);
  const totalRounds = Math.min(config.maxRounds || intuitions.length, intuitions.length);

  const [phase, setPhase] = useState('country-pick'); // country-pick | grounding | gate | rounds | grading | done
  const [country, setCountry] = useState(config.countries?.[0] || '');
  const [grounding, setGrounding] = useState(null);
  const [feed, setFeed] = useState([]);
  const [roundIndex, setRoundIndex] = useState(0);
  const [mode, setMode] = useState('mc'); // mc | followup — within gate/round
  const [pick, setPick] = useState('');
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [score, setScore] = useState(null);

  const tallyRef = useRef({ ...EMPTY_TALLY });
  const roundHistoryRef = useRef([]); // resets each round; [{role, pick, why} | {role, text}]
  const savedRef = useRef(false);
  const scrollRef = useRef(null);
  // Mirror `feed` so finish/grade read the latest transcript, not a stale closure.
  const feedRef = useRef([]);
  useEffect(() => { feedRef.current = feed; }, [feed]);

  useEffect(() => { scrollRef.current?.scrollIntoView({ behavior: 'smooth' }); });

  const appendFeed = (block) => setFeed((f) => [...f, block]);

  const currentQuestion = phase === 'gate'
    ? { text: config.gate?.prompt, options: config.gate?.options || [], intuition: 'shock' }
    : (intuitions[roundIndex]?.seedQuestion
      ? { ...intuitions[roundIndex].seedQuestion, intuition: intuitions[roundIndex].id || intuitions[roundIndex].label }
      : null);

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
      setPhase('gate');
      setMode('mc');
    } catch (e) {
      setError(e.response?.data?.error || 'Could not build the scenario. Try again.');
      setPhase('country-pick');
    }
  };

  // ── Submit an answer (gate or round; MC or free-text follow-up) ─────────────
  const submit = async () => {
    if (busy) return;
    const isMc = mode === 'mc';
    if (isMc && !pick) { setError('Pick an option first.'); return; }
    if (!why.trim()) { setError(isMc ? 'Add a short “why”.' : 'Type your reasoning.'); return; }
    setError(null);
    setBusy(true);

    const answerPick = isMc ? pick : (roundHistoryRef.current.findLast?.((h) => h.role === 'student' && h.pick)?.pick || '');
    const studentBlock = { type: 'student', pick: isMc ? pick : '', why: why.trim() };
    appendFeed(studentBlock);
    roundHistoryRef.current.push({ role: 'student', pick: isMc ? pick : '', why: why.trim() });

    // Placeholder tutor block we stream into.
    const tutorIdx = feed.length + 1; // after the student block we just queued
    appendFeed({ type: 'tutor', text: '' });
    setPick(''); setWhy('');

    const payload = {
      labTitle: config.meta?.title || 'Shock World',
      scenario: scenarioForTurn,
      persona: config.analyst?.persona || '',
      courseOnly: !!config.courseOnly,
      phase: phase === 'gate' ? 'gate' : 'round',
      roundIndex,
      maxRounds: totalRounds,
      targetIntuitions: intuitions.map((t) => ({ id: t.id, label: t.label })),
      coveredIntuitions: intuitions.slice(0, roundIndex).map((t) => t.id || t.label),
      currentQuestion,
      answer: { pick: answerPick, why: why.trim() },
      history: roundHistoryRef.current,
    };

    let replyText = '';
    let control = null;
    try {
      control = await streamTurn(payload, (chunk) => {
        replyText += chunk;
        setFeed((f) => { const c = [...f]; if (c[tutorIdx]) c[tutorIdx] = { ...c[tutorIdx], text: replyText }; return c; });
      });
    } catch (e) {
      // Graceful degradation: show the scripted fallback, let them retry.
      const fallback = config.analyst?.scriptedFallback || 'The tutor is unavailable right now — try again in a moment.';
      setFeed((f) => { const c = [...f]; if (c[tutorIdx]) c[tutorIdx] = { ...c[tutorIdx], text: fallback }; return c; });
      setError(e.message || 'The tutor is unavailable right now.');
      setBusy(false);
      return;
    }
    roundHistoryRef.current.push({ role: 'tutor', text: replyText });

    const advance = !!control?.advance;
    const signals = control?.effort_signals || {};

    // Accumulate effort signals for scoring — but NOT the warm-up gate.
    if (phase === 'rounds') {
      const t = tallyRef.current;
      t.turns += 1;
      if (signals.explained_why) t.explained_why += 1;
      if (signals.revised_after_nudge) t.revised_after_nudge += 1;
      if (signals.worked_through_contradiction) t.worked_through_contradiction += 1;
      if (signals.low_effort) t.low_effort += 1;
    }

    setBusy(false);

    if (!advance) {
      // Stay in this question; the tutor's reply is the Socratic follow-up.
      setMode('followup');
      return;
    }

    // Round/gate closed on the aha.
    if (phase === 'gate') {
      roundHistoryRef.current = [];
      setRoundIndex(0);
      setMode('mc');
      setPhase('rounds');
      appendFeed({ type: 'question', round: 1, text: intuitions[0]?.seedQuestion?.text });
      return;
    }

    // A scored round completed.
    tallyRef.current.rounds_played += 1;
    tallyRef.current.ahas += 1;
    const next = roundIndex + 1;
    if (next >= totalRounds) {
      finishLab();
      return;
    }
    roundHistoryRef.current = [];
    setRoundIndex(next);
    setMode('mc');
    appendFeed({ type: 'question', round: next + 1, text: intuitions[next]?.seedQuestion?.text });
  };

  // ── Wrap-up: effort-to-learn grade + (auth) session persistence ─────────────
  const finishLab = async () => {
    setPhase('grading');
    let result = null;
    try {
      const { data } = await apiClient.post(
        '/experiential/method/shock-world/grade',
        {
          labTitle: config.meta?.title || 'Shock World',
          scenario: scenarioForTurn,
          weights: config.scoring || {},
          rubric: config.gradeRubric || [],
          tally: tallyRef.current,
          transcript: feedRef.current.filter((b) => b.type === 'student' || b.type === 'tutor').slice(-40),
        },
        { timeout: 120000 },
      );
      result = data;
    } catch (e) {
      result = { total: null, breakdown: [], feedback: 'Could not compute a score, but your run was saved.' };
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

  const roundLabel = phase === 'gate' ? 'Warm-up' : (phase === 'rounds' ? `Round ${Math.min(roundIndex + 1, totalRounds)} / ${totalRounds}` : '');
  const headerExtra = roundLabel
    ? <span className="text-[11px] font-semibold uppercase tracking-wide bg-[#F9D0C4]/40 text-[#b8452a] px-2 py-1 rounded-lg">{roundLabel}</span>
    : null;

  // ── Footer input (country pick, MC + why, or free-text follow-up) ───────────
  let footer = null;
  if (phase === 'gate' || phase === 'rounds') {
    footer = (
      <footer className="border-t border-gray-200 bg-white/95 backdrop-blur px-4 sm:px-6 lg:px-12 xl:px-24 py-3 shrink-0">
        <div className="w-full max-w-3xl mx-auto">
          {mode === 'mc' && currentQuestion && (
            <div className="flex flex-wrap gap-2 mb-2">
              {(currentQuestion.options || []).map((opt, i) => (
                <button
                  key={i}
                  type="button"
                  disabled={busy}
                  onClick={() => setPick(opt)}
                  className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${pick === opt ? 'bg-[#FA6C43] text-white border-[#FA6C43]' : 'bg-white text-gray-700 border-gray-200 hover:border-[#FA6C43]'}`}
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
