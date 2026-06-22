import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  FiArrowLeft, FiRefreshCw, FiCheck, FiLock, FiMenu,
  FiPlusCircle, FiHelpCircle, FiAward,
} from 'react-icons/fi';
import apiClient from '../api/apiClient';
import { getExperientialConfig } from '../configs/experiential';
import { validateExperientialConfig } from '../configs/experiential/schema';
import ChatSidebar from '../components/SideBar.jsx';
import ChatComposer from '../components/ChatComposer';
import StickyHeader from '../components/experiential/StickyHeader';
import IrfChart from '../components/experiential/IrfChart';
import ComparisonTable from '../components/experiential/ComparisonTable';

const getToken = () => localStorage.getItem('jwtToken') || localStorage.getItem('access_token');

// ─── Static display helpers ──────────────────────────────────────────────────

const ARROWS = { '-3': '↓↓↓', '-2': '↓↓', '-1': '↓', '0': '—', '1': '↑', '2': '↑↑', '3': '↑↑↑' };
const NOTCHES = [-3, -2, -1, 0, 1, 2, 3];
const arrow = (v) => ARROWS[String(v)] || '—';
const dirOf = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : 'flat');
const UNIT_BY_KEY = { gdp: '%', investment: '%', inflation: 'pp', rate: 'pp' };
const LABEL_BY_KEY = { gdp: 'Real GDP', investment: 'Investment', inflation: 'Inflation', rate: 'Policy Rate' };

// Rubric keyword heuristics — scripted mode can't LLM-grade, so we keyword-match.
const RUBRIC_KEYWORDS = {
  'identifies supply/cost-push shock typology': (t) => /supply|cost.?push/.test(t),
  'BGG → investment channel': (t) => /(bgg|accelerator|net worth|spread).*(invest)|invest.*(bgg|accelerator|net worth|spread)/.test(t) || (/bgg|accelerator/.test(t) && /invest/.test(t)),
  'HANK → consumption channel': (t) => (/hank|hand.?to.?mouth|mpc/.test(t) && /consum/.test(t)),
  'explains inflation near-invariance': (t) => /inflation/.test(t) && /(barely|invarian|unchanged|flat|little|hardly|near.?invar|doesn.?t move|does not move)/.test(t),
  'demonstrates provenance awareness': (t) => /calibrat|illustrative|not estimated|provenance|not.* solved/.test(t),
};

// ─── Card shell ──────────────────────────────────────────────────────────────

function Card({ children, accent = false, className = '' }) {
  return (
    <div className={`rounded-2xl border bg-white shadow-sm ${accent ? 'border-[#FA6C43]/40' : 'border-gray-200'} ${className}`}>
      {children}
    </div>
  );
}

function SpeakerLabel({ name }) {
  return <div className="text-[11px] font-semibold uppercase tracking-wide text-[#FA6C43] mb-1.5">{name}</div>;
}

// ─── Main player ─────────────────────────────────────────────────────────────

export default function ExperientialPage() {
  const { templateId } = useParams();
  const navigate = useNavigate();

  const config = useMemo(() => getExperientialConfig(templateId), [templateId]);
  const validation = useMemo(() => (config ? validateExperientialConfig(config) : { ok: false, errors: ['template not found'] }), [config]);

  // Bump this to remount the whole player on reset.
  const [runKey, setRunKey] = useState(0);

  // ── Chat-page parity: same sidebar (auth only) wrapping the lab column ──
  const isAuthenticated = !!getToken();
  const [userInfo, setUserInfo] = useState(null);
  const [accessibleConfigs, setAccessibleConfigs] = useState([]);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [sidebarTab, setSidebarTab] = useState('chats');
  const [sidebarPath, setSidebarPath] = useState('');

  useEffect(() => {
    if (!isAuthenticated) return;
    apiClient.get('/auth/me').then((r) => setUserInfo(r.data)).catch(() => {});
    apiClient.get('/accessible_configs').then((r) => setAccessibleConfigs(r.data.configs || [])).catch(() => {});
  }, [isAuthenticated]);

  const noop = () => {};
  let columnContent;
  if (!config) {
    columnContent = (
      <ColumnShell title="Experiential Lab" onBack={() => navigate('/experiential')} isAuthenticated={isAuthenticated} onOpenMobileSidebar={() => setIsMobileSidebarOpen(true)}>
        <Card className="p-6">
          <p className="text-gray-700">No experiential template found for id <code className="px-1 bg-gray-100 rounded">{templateId}</code>.</p>
          <button onClick={() => navigate('/experiential')} className="mt-4 text-[#FA6C43] font-semibold">← Back to lab list</button>
        </Card>
      </ColumnShell>
    );
  } else if (!validation.ok) {
    columnContent = (
      <ColumnShell title={config?.meta?.title || 'Experiential Lab'} onBack={() => navigate('/experiential')} isAuthenticated={isAuthenticated} onOpenMobileSidebar={() => setIsMobileSidebarOpen(true)}>
        <Card className="p-6 border-red-200">
          <h2 className="text-lg font-bold text-red-700 mb-2">This simulation config is invalid</h2>
          <ul className="list-disc pl-5 text-sm text-red-600 space-y-1">
            {validation.errors.map((e, i) => <li key={i}><code>{e}</code></li>)}
          </ul>
        </Card>
      </ColumnShell>
    );
  } else {
    columnContent = (
      <Player
        key={runKey}
        config={config}
        onReset={() => setRunKey((k) => k + 1)}
        onBack={() => navigate('/experiential')}
        isAuthenticated={isAuthenticated}
        onOpenMobileSidebar={() => setIsMobileSidebarOpen(true)}
      />
    );
  }

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-[#F0F6FB] text-[#222]" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
      {isAuthenticated && isMobileSidebarOpen && (
        <button type="button" aria-label="Close sidebar" className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={() => setIsMobileSidebarOpen(false)} />
      )}
      {isAuthenticated && (
        <ChatSidebar
          sessions={[]}
          sessionsLoading={false}
          userInfo={userInfo}
          userInfoLoaded={!!userInfo}
          configId={undefined}
          isCollapsed={isSidebarCollapsed}
          isMobileOpen={isMobileSidebarOpen}
          onClose={() => setIsMobileSidebarOpen(false)}
          onToggle={() => setIsSidebarCollapsed((v) => !v)}
          onNewChat={() => navigate('/experiential')}
          onNavigateWithAutoSave={(cb) => cb()}
          activeTab={sidebarTab}
          onSetTab={setSidebarTab}
          currentPath={sidebarPath}
          onSetPath={setSidebarPath}
          accessibleConfigs={accessibleConfigs}
          libraryFiles={[]}
          libraryFolders={[]}
          filesLoading={false}
          isUploading={false}
          onUpload={noop}
          onFetchUrl={noop}
          onDeleteFile={noop}
          onCreateFolder={noop}
          onDeleteFolder={noop}
          canSelect={false}
          selectedFileIds={[]}
          onToggleFile={noop}
          onDeleteSession={noop}
        />
      )}
      <div className={`relative flex-1 flex flex-col w-full h-full transition-all duration-300 ${isAuthenticated && !isSidebarCollapsed ? 'md:ml-[30%]' : isAuthenticated ? 'md:ml-20' : ''}`}>
        {columnContent}
      </div>
    </div>
  );
}

// Column content mirroring the chat column: header, sticky strip, scroll body,
// footer. Rendered INSIDE the flex column next to the shared sidebar.
function ColumnShell({ title, subtitle, onBack, headerExtra, footer, children, stickyHeader, isAuthenticated, onOpenMobileSidebar }) {
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
      {stickyHeader}
      <main className="flex-1 overflow-y-auto px-4 sm:px-6 lg:px-12 xl:px-24 py-5 scrollbar-thin">
        <div className="w-full max-w-3xl mx-auto space-y-4">{children}</div>
      </main>
      {footer}
    </>
  );
}

function Player({ config, onReset, onBack, isAuthenticated, onOpenMobileSidebar }) {
  const { meta, scenario, analyst, predictionVariables, layers, probes, provenanceGates, coach, synthesis } = config;

  const layerById = useMemo(() => Object.fromEntries(layers.map((l) => [l.id, l])), [layers]);
  const probeById = useMemo(() => Object.fromEntries(probes.map((p) => [p.id, p])), [probes]);
  const baseLayer = layers[0];

  // ── Core state ──
  const [dials, setDials] = useState(() => Object.fromEntries(predictionVariables.map((v) => [v.id, 0])));
  const [dialsCommitted, setDialsCommitted] = useState(false);
  const [revealedIds, setRevealedIds] = useState([]);              // layers whose reveal is shown (ordered)
  const [unlockedIds, setUnlockedIds] = useState([baseLayer.id]);  // layers available to add
  const [pendingLayerId, setPendingLayerId] = useState(null);      // layer awaiting its predict→reveal
  const [usedProbeIds, setUsedProbeIds] = useState([]);
  const [satisfiedGateIds, setSatisfiedGateIds] = useState([]);
  const [chartVar, setChartVar] = useState('gdp');
  const [feed, setFeed] = useState([]);                            // append-only narrative blocks
  const [synthesisOpen, setSynthesisOpen] = useState(false);
  const [synthesisText, setSynthesisText] = useState('');
  const [scores, setScores] = useState(null);

  // Coach state
  const [hintsUsed, setHintsUsed] = useState(0);
  const unproductiveRef = useRef(0);
  const lastActionRef = useRef(Date.now());
  const feedEndRef = useRef(null);

  // Composer state (reused chat input box).
  const [input, setInput] = useState('');
  const inputRef = useRef(null);
  const attachInputRef = useRef(null);
  const imageInputRef = useRef(null);

  const chartKeys = useMemo(() => Object.keys(baseLayer.reveal.chartSeries), [baseLayer]);

  // ── Derived ──
  const gatesForHeader = provenanceGates.map((g) => ({ ...g, satisfied: satisfiedGateIds.includes(g.id) }));
  const numbersBlurred = provenanceGates.length > 0 && !provenanceGates.every((g) => satisfiedGateIds.includes(g.id));
  const revealedLayers = revealedIds.map((id) => layerById[id]);

  const markAction = () => { lastActionRef.current = Date.now(); };
  const appendFeed = (block) => setFeed((f) => [...f, { ...block, _k: `${block.type}-${f.length}` }]);

  // Auto-scroll on feed growth.
  useEffect(() => { feedEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [feed.length, synthesisOpen, scores]);

  // ── Idle coach timer ──
  useEffect(() => {
    if (scores) return undefined;
    const interval = setInterval(() => {
      if (hintsUsed >= coach.maxHints) return;
      const idleSec = (Date.now() - lastActionRef.current) / 1000;
      if (dialsCommitted && idleSec >= coach.hintAfterIdleSec) {
        fireHint('idle');
        markAction();
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [scores, hintsUsed, dialsCommitted, coach.maxHints, coach.hintAfterIdleSec]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Coach: suggest the next productive probe given current state ──
  function suggestNextProbe() {
    const gateUnsatisfied = provenanceGates.find((g) => !satisfiedGateIds.includes(g.id));
    if (gateUnsatisfied && !usedProbeIds.includes(gateUnsatisfied.untrustedUntilProbeId)) {
      return { id: gateUnsatisfied.untrustedUntilProbeId, why: `Those numbers are still tagged illustrative. What would tell you whether to trust them?` };
    }
    // unlock probes for layers not yet unlocked
    for (const l of layers) {
      if (l.unlockedByProbeId && !unlockedIds.includes(l.id) && !usedProbeIds.includes(l.unlockedByProbeId)) {
        return { id: l.unlockedByProbeId, why: `There may be a channel this baseline is leaving out. What mechanism could deepen the response?` };
      }
    }
    // productiveAfter probes whose context is now satisfied
    for (const p of probes) {
      if (usedProbeIds.includes(p.id) || p.deadEnd) continue;
      if (p.productiveAfter && p.productiveAfter.some((lid) => revealedIds.includes(lid))) {
        return { id: p.id, why: `Now that a richer model is on the table, is the smoothing logic still intact?` };
      }
    }
    // any remaining informative probe
    const next = probes.find((p) => !usedProbeIds.includes(p.id) && !p.deadEnd);
    if (next) return { id: next.id, why: `Keep interrogating the model's assumptions before you commit.` };
    return null;
  }

  function fireHint(reason) {
    if (hintsUsed >= coach.maxHints) return;
    const s = suggestNextProbe();
    if (!s) return;
    const probe = probeById[s.id];
    appendFeed({ type: 'coach', text: s.why, suggestProbe: probe ? probe.text : null, reason });
    setHintsUsed((n) => n + 1);
    unproductiveRef.current = 0;
  }

  // ── Actions ──
  function commitDials() {
    markAction();
    setDialsCommitted(true);
    setRevealedIds([baseLayer.id]);
    appendFeed({ type: 'reveal', layerId: baseLayer.id, snapshot: [baseLayer.id], withGuess: true });
  }

  function handleProbe(probe) {
    markAction();
    if (usedProbeIds.includes(probe.id)) return;
    setUsedProbeIds((u) => [...u, probe.id]);

    // Productivity bookkeeping for the coach.
    const productiveNow =
      !probe.deadEnd &&
      (probe.establishesGateId ||
        probe.unlocksLayerId ||
        !probe.productiveAfter ||
        probe.productiveAfter.some((lid) => revealedIds.includes(lid)));
    if (productiveNow) unproductiveRef.current = 0;
    else {
      unproductiveRef.current += 1;
      if (unproductiveRef.current >= coach.hintAfterUnproductiveProbes) fireHint('unproductive');
    }

    // Satisfy a provenance gate (un-blurs the numbers).
    if (probe.establishesGateId) {
      setSatisfiedGateIds((g) => (g.includes(probe.establishesGateId) ? g : [...g, probe.establishesGateId]));
    }
    // Unlock a layer (the answer block will offer "Add layer").
    if (probe.unlocksLayerId) {
      setUnlockedIds((u) => (u.includes(probe.unlocksLayerId) ? u : [...u, probe.unlocksLayerId]));
    }
    appendFeed({ type: 'answer', probeId: probe.id });
  }

  function addLayer(layerId) {
    markAction();
    setPendingLayerId(layerId);
    appendFeed({ type: 'layer-predict', layerId });
  }

  function revealLayer(layerId) {
    markAction();
    setPendingLayerId(null);
    setRevealedIds((r) => (r.includes(layerId) ? r : [...r, layerId]));
    appendFeed({ type: 'comparison', layerId, snapshot: [...revealedIds, layerId] });
  }

  function openSynthesis() {
    markAction();
    setSynthesisOpen(true);
  }

  function submitSynthesis() {
    markAction();
    setScores(computeScores());
  }

  function handleFreeform(text) {
    markAction();
    appendFeed({ type: 'freeform', question: text });
  }

  // ── Scoring ──
  function computeScores() {
    // Prediction (direction match).
    let correct = 0;
    const predDetail = predictionVariables.map((v) => {
      const got = dirOf(dials[v.id]);
      const ok = got === String(v.expected);
      if (ok) correct += 1;
      return { label: v.label, expected: v.expected, got: arrow(dials[v.id]), ok };
    });
    const predictionScore = Math.round((correct / predictionVariables.length) * config.scoring.predictionWeight);

    // Probe efficiency.
    const used = usedProbeIds.map((id) => probeById[id]);
    const wasted = used.filter((p) => p.deadEnd).length +
      used.filter((p) => !p.deadEnd && p.productiveAfter && !p.productiveAfter.some((lid) => revealedIds.includes(lid))).length;
    const usefulUsed = used.filter((p) =>
      !p.deadEnd && (p.establishesGateId || p.unlocksLayerId || !p.productiveAfter || p.productiveAfter.some((lid) => revealedIds.includes(lid)))).length;
    const IDEAL_USEFUL = 4;
    const effRatio = Math.max(0, Math.min(1, (usefulUsed - 0.5 * wasted) / IDEAL_USEFUL));
    const probeScore = Math.round(effRatio * config.scoring.probeEfficiencyWeight);

    // Provenance.
    const provRatio = provenanceGates.length ? satisfiedGateIds.length / provenanceGates.length : 1;
    const provScore = Math.round(provRatio * config.scoring.provenanceWeight);

    // Synthesis (rubric keyword heuristic).
    const t = synthesisText.toLowerCase();
    const rubricHits = synthesis.rubric.map((r) => ({ r, hit: RUBRIC_KEYWORDS[r] ? RUBRIC_KEYWORDS[r](t) : t.includes(r.toLowerCase()) }));
    const hitCount = rubricHits.filter((x) => x.hit).length;
    const words = t.trim() ? t.trim().split(/\s+/).length : 0;
    const overLimit = words > synthesis.wordLimit;
    const synthScore = Math.round((hitCount / synthesis.rubric.length) * config.scoring.synthesisWeight);

    return {
      total: predictionScore + probeScore + provScore + synthScore,
      breakdown: [
        { key: 'Prediction', score: predictionScore, weight: config.scoring.predictionWeight, detail: `${correct}/${predictionVariables.length} directions correct`, rows: predDetail },
        { key: 'Probe efficiency', score: probeScore, weight: config.scoring.probeEfficiencyWeight, detail: `${usefulUsed} productive probe${usefulUsed === 1 ? '' : 's'}, ${wasted} wasted` },
        { key: 'Provenance', score: provScore, weight: config.scoring.provenanceWeight, detail: `${satisfiedGateIds.length}/${provenanceGates.length} gate${provenanceGates.length === 1 ? '' : 's'} verified` },
        { key: 'Synthesis', score: synthScore, weight: config.scoring.synthesisWeight, detail: `${hitCount}/${synthesis.rubric.length} rubric points${overLimit ? ` · over the ${synthesis.wordLimit}-word limit (${words})` : ''}`, rubric: rubricHits },
      ],
    };
  }

  // ── Chart data for a snapshot of revealed layer ids ──
  function chartFor(snapshotIds, withGuess) {
    const series = snapshotIds
      .filter((id) => layerById[id].reveal.chartSeries[chartVar])
      .map((id) => ({ key: id, label: layerById[id].name.match(/\(([^)]+)\)/)?.[1] || layerById[id].name, values: layerById[id].reveal.chartSeries[chartVar] }));
    let guess = null;
    if (withGuess) {
      const dv = dials[chartVar];
      if (dv !== undefined) {
        const ref = Math.max(...series.flatMap((s) => s.values.map(Math.abs)), 1);
        const end = (dv / 3) * ref; // magnitude 3 ≈ full scale
        guess = { label: `Your call (${arrow(dv)})`, values: Array.from({ length: 8 }, (_, i) => (end * (i + 1)) / 8) };
      }
    }
    return { series, guess, unit: UNIT_BY_KEY[chartVar] || '' };
  }

  // ── Probe chip availability ──
  function probeState(p) {
    if (usedProbeIds.includes(p.id)) return { state: 'used' };
    if (p.productiveAfter && !p.productiveAfter.some((lid) => revealedIds.includes(lid))) {
      const need = p.productiveAfter.map((lid) => layerById[lid]?.name.match(/\(([^)]+)\)/)?.[1] || lid).join(' / ');
      return { state: 'disabled', tip: `Useful after you add the ${need} layer` };
    }
    return { state: 'ready' };
  }

  // ── Render blocks ──
  const renderBlock = (b) => {
    switch (b.type) {
      case 'reveal':
      case 'comparison': {
        const lyr = layerById[b.layerId];
        const { series, guess, unit } = chartFor(b.snapshot, b.withGuess);
        const snapshotLayers = b.snapshot.map((id) => layerById[id]);
        return (
          <Card key={b._k} accent={b.type === 'reveal'} className="p-5">
            <SpeakerLabel name={analyst.persona ? meta.title : 'Analyst'} />
            <div className="flex items-center justify-between gap-2 mb-2">
              <h3 className="font-bold text-[#222]">{b.type === 'reveal' ? lyr.name : `Comparison · ${lyr.name}`}</h3>
              <ChartVarToggle chartKeys={chartKeys} chartVar={chartVar} setChartVar={setChartVar} />
            </div>
            <IrfChart series={series} guess={guess} unit={unit} blurNumbers={numbersBlurred} />
            <p className="text-sm text-gray-700 mt-3 leading-relaxed">{lyr.reveal.narrative}</p>
            <div className="mt-4 pt-3 border-t border-gray-100">
              <ComparisonTable layers={snapshotLayers} blurNumbers={numbersBlurred} />
            </div>
          </Card>
        );
      }
      case 'answer': {
        const p = probeById[b.probeId];
        const canAdd = p.unlocksLayerId && !revealedIds.includes(p.unlocksLayerId) && pendingLayerId !== p.unlocksLayerId;
        return (
          <Card key={b._k} className="p-5">
            <div className="text-sm font-semibold text-gray-500 mb-1.5 flex items-center gap-1.5">
              <FiHelpCircle className="text-gray-400" /> {p.text}
            </div>
            <SpeakerLabel name={meta.title} />
            <p className="text-sm text-gray-800 leading-relaxed">{p.answer}</p>
            {p.deadEnd && (
              <p className="text-[11px] text-amber-600 mt-2 italic">Trust unchanged — more decimals isn’t more provenance.</p>
            )}
            {canAdd && (
              <button
                onClick={() => addLayer(p.unlocksLayerId)}
                className="mt-3 inline-flex items-center gap-1.5 bg-[#FA6C43] hover:bg-[#e85a30] text-white text-sm font-semibold px-3.5 py-2 rounded-xl transition-colors"
              >
                <FiPlusCircle /> Add {layerById[p.unlocksLayerId].name}
              </button>
            )}
          </Card>
        );
      }
      case 'layer-predict': {
        const lyr = layerById[b.layerId];
        const done = revealedIds.includes(b.layerId);
        return (
          <Card key={b._k} accent={!done} className="p-5">
            <SpeakerLabel name={`Predict · ${lyr.name.match(/\(([^)]+)\)/)?.[1] || lyr.name}`} />
            <p className="text-sm text-gray-700 mb-1">{lyr.predictPrompt}</p>
            <p className="text-xs text-gray-500 mb-3">{lyr.changes}</p>
            {done ? (
              <div className="inline-flex items-center gap-1.5 text-sm text-gray-500"><FiCheck className="text-green-600" /> Revealed below</div>
            ) : (
              <button
                onClick={() => revealLayer(b.layerId)}
                className="inline-flex items-center gap-1.5 bg-[#222] hover:bg-black text-white text-sm font-semibold px-3.5 py-2 rounded-xl transition-colors"
              >
                Reveal {lyr.name.match(/\(([^)]+)\)/)?.[1] || lyr.name} path
              </button>
            )}
          </Card>
        );
      }
      case 'coach':
        return (
          <div key={b._k} className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-start gap-2.5">
            <FiAward className="text-amber-500 mt-0.5 shrink-0" />
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-600 mb-0.5">Coach · {coach.tone}</div>
              <p className="text-sm text-amber-900">{b.text}</p>
              {b.suggestProbe && <p className="text-xs text-amber-700 mt-1">Try asking: “{b.suggestProbe}”</p>}
            </div>
          </div>
        );
      case 'freeform':
        return (
          <Card key={b._k} className="p-5">
            <div className="text-sm font-semibold text-gray-500 mb-1.5">You: {b.question}</div>
            <SpeakerLabel name={meta.title} />
            <p className="text-sm text-gray-800 leading-relaxed">{analyst.scriptedFallback || 'Use the probe chips to interrogate the model.'}</p>
          </Card>
        );
      default:
        return null;
    }
  };

  // Free-form send via the reused chat composer. `arg` is a string for quick
  // prompts; the send button calls onSend() with no arg → fall back to `input`.
  const onComposerSend = (arg) => {
    const text = (typeof arg === 'string' ? arg : input).trim();
    if (!text || scores) return;
    handleFreeform(text);
    setInput('');
  };

  // ── Footer (probe tray + reused chat input box) ──
  const footer = (
    <footer className="border-t border-gray-200 bg-white/95 backdrop-blur px-4 sm:px-6 lg:px-12 xl:px-24 py-3 shrink-0">
      <div className="w-full max-w-3xl mx-auto space-y-2.5">
        {dialsCommitted && !scores && (
          <ProbeTray probes={probes} probeState={probeState} onPick={handleProbe} />
        )}
        {dialsCommitted && !scores && !synthesisOpen && (
          <button onClick={openSynthesis} className="text-xs font-semibold text-[#FA6C43] hover:underline">
            I’m ready to write my synthesis →
          </button>
        )}
        <ChatComposer
          input={input}
          setInput={setInput}
          inputRef={inputRef}
          onSend={onComposerSend}
          isLoading={false}
          attachInputRef={attachInputRef}
          imageInputRef={imageInputRef}
          showAttach={false}
          showVoice={false}
          showModelPicker={false}
          hasAiReplied={false}
          attachments={null}
        />
      </div>
    </footer>
  );

  return (
    <ColumnShell
      title={meta.title}
      subtitle={`${meta.discipline} · ${meta.level} · ~${meta.estMinutes} min`}
      onBack={onBack}
      isAuthenticated={isAuthenticated}
      onOpenMobileSidebar={onOpenMobileSidebar}
      headerExtra={
        <button onClick={onReset} className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-500 hover:text-[#FA6C43] transition-colors">
          <FiRefreshCw /> Replay
        </button>
      }
      stickyHeader={<StickyHeader layers={layers} unlockedLayerIds={revealedIds} gates={gatesForHeader} />}
      footer={footer}
    >
      {/* Brief */}
      <Card accent className="p-5">
        <SpeakerLabel name="Scenario" />
        <p className="text-[15px] text-gray-800 leading-relaxed">{scenario.brief}</p>
      </Card>

      {/* Prediction dials (collapses after commit) */}
      <DialsCard
        variables={predictionVariables}
        dials={dials}
        setDials={(id, v) => { markAction(); setDials((d) => ({ ...d, [id]: v })); }}
        committed={dialsCommitted}
        onCommit={commitDials}
      />

      {/* Narrative feed */}
      {feed.map(renderBlock)}

      {/* Synthesis */}
      {synthesisOpen && (
        <SynthesisCard
          synthesis={synthesis}
          text={synthesisText}
          setText={setSynthesisText}
          submitted={!!scores}
          onSubmit={submitSynthesis}
        />
      )}

      {/* Debrief */}
      {scores && <DebriefCard scores={scores} onReset={onReset} />}

      <div ref={feedEndRef} />
    </ColumnShell>
  );
}

// ─── Sub-widgets ─────────────────────────────────────────────────────────────

function ChartVarToggle({ chartKeys, chartVar, setChartVar }) {
  return (
    <div className="flex items-center gap-1 flex-wrap justify-end">
      {chartKeys.map((k) => (
        <button
          key={k}
          onClick={() => setChartVar(k)}
          className={`text-[11px] px-2 py-0.5 rounded-md font-medium transition-colors ${
            chartVar === k ? 'bg-[#222] text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
          }`}
        >
          {LABEL_BY_KEY[k] || k}
        </button>
      ))}
    </div>
  );
}

function DialsCard({ variables, dials, setDials, committed, onCommit }) {
  if (committed) {
    return (
      <Card className="px-4 py-2.5">
        <div className="flex items-center gap-2 flex-wrap text-sm">
          <FiCheck className="text-green-600 shrink-0" />
          <span className="font-semibold text-gray-500">Your call:</span>
          {variables.map((v, i) => (
            <span key={v.id} className="text-gray-700">
              {v.label} <span className="font-bold text-[#222]">{arrow(dials[v.id])}</span>
              {i < variables.length - 1 && <span className="text-gray-300 ml-2">·</span>}
            </span>
          ))}
        </div>
      </Card>
    );
  }
  return (
    <Card accent className="p-5">
      <SpeakerLabel name="Your prediction" />
      <p className="text-sm text-gray-600 mb-4">Set a direction and magnitude for each variable, then commit to reveal the baseline model.</p>
      <div className="grid sm:grid-cols-2 gap-x-6 gap-y-3">
        {variables.map((v) => (
          <div key={v.id}>
            <div className="flex items-baseline justify-between mb-1">
              <span className="text-sm font-medium text-gray-800">{v.label}</span>
              <span className="text-xs text-gray-400" title={v.intuition}>{v.intuition.length > 36 ? v.intuition.slice(0, 34) + '…' : v.intuition}</span>
            </div>
            <div className="flex items-center gap-0.5">
              {NOTCHES.map((n) => (
                <button
                  key={n}
                  onClick={() => setDials(v.id, n)}
                  className={`flex-1 py-1.5 text-xs rounded-md font-semibold transition-colors ${
                    dials[v.id] === n
                      ? n === 0 ? 'bg-gray-300 text-gray-700' : n > 0 ? 'bg-green-500 text-white' : 'bg-red-500 text-white'
                      : 'bg-gray-50 text-gray-400 hover:bg-gray-100'
                  }`}
                >
                  {arrow(n)}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <button onClick={onCommit} className="mt-5 inline-flex items-center gap-1.5 bg-[#FA6C43] hover:bg-[#e85a30] text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors">
        Commit prediction & reveal baseline
      </button>
    </Card>
  );
}

function ProbeTray({ probes, probeState, onPick }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Probes</span>
      {probes.map((p) => {
        const { state, tip } = probeState(p);
        const base = 'text-xs px-2.5 py-1.5 rounded-full border font-medium transition-colors';
        if (state === 'used') {
          return <span key={p.id} className={`${base} bg-gray-100 border-gray-200 text-gray-400 inline-flex items-center gap-1`}><FiCheck size={11} /> {p.text}</span>;
        }
        if (state === 'disabled') {
          return <span key={p.id} title={tip} className={`${base} bg-gray-50 border-dashed border-gray-200 text-gray-300 cursor-not-allowed inline-flex items-center gap-1`}><FiLock size={10} /> {p.text}</span>;
        }
        return (
          <button key={p.id} onClick={() => onPick(p)} className={`${base} bg-white border-[#FA6C43]/40 text-[#b8452a] hover:bg-[#F9D0C4]/30`}>
            {p.text}
          </button>
        );
      })}
    </div>
  );
}

function SynthesisCard({ synthesis, text, setText, submitted, onSubmit }) {
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const over = words > synthesis.wordLimit;
  if (submitted) {
    return (
      <Card className="px-4 py-3">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">Your synthesis · {words} words</div>
        <p className="text-sm text-gray-700 whitespace-pre-wrap">{text || <span className="italic text-gray-400">(blank)</span>}</p>
      </Card>
    );
  }
  return (
    <Card accent className="p-5">
      <SpeakerLabel name="Synthesis" />
      <p className="text-sm text-gray-700 mb-3">{synthesis.task}</p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        placeholder="Trace the causal chain…"
        className="w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm focus:outline-none focus:border-[#FA6C43] resize-y"
      />
      <div className="flex items-center justify-between mt-2">
        <span className={`text-xs ${over ? 'text-red-500' : 'text-gray-400'}`}>{words} / {synthesis.wordLimit} words{over ? ' — over limit' : ''}</span>
        <button onClick={onSubmit} disabled={!text.trim()} className="inline-flex items-center gap-1.5 bg-[#FA6C43] hover:bg-[#e85a30] disabled:opacity-40 text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors">
          Submit & see debrief
        </button>
      </div>
    </Card>
  );
}

function DebriefCard({ scores, onReset }) {
  return (
    <Card accent className="p-5">
      <div className="flex items-center justify-between mb-4">
        <SpeakerLabel name="Debrief" />
        <div className="text-right">
          <div className="text-2xl font-bold text-[#222]">{scores.total}<span className="text-base text-gray-400">/100</span></div>
        </div>
      </div>
      <div className="space-y-3">
        {scores.breakdown.map((b) => (
          <div key={b.key} className="border-t border-gray-100 pt-3 first:border-0 first:pt-0">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-gray-800 text-sm">{b.key}</span>
              <span className="text-sm font-bold text-[#FA6C43]">{b.score}<span className="text-gray-400 font-normal">/{b.weight}</span></span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-gray-100 mt-1.5 overflow-hidden">
              <div className="h-full rounded-full bg-[#FA6C43]" style={{ width: `${b.weight ? (b.score / b.weight) * 100 : 0}%` }} />
            </div>
            <p className="text-xs text-gray-500 mt-1">{b.detail}</p>
            {b.rows && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {b.rows.map((r) => (
                  <span key={r.label} className={`text-[11px] px-1.5 py-0.5 rounded ${r.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
                    {r.label} {r.got}
                  </span>
                ))}
              </div>
            )}
            {b.rubric && (
              <ul className="mt-2 space-y-0.5">
                {b.rubric.map((x) => (
                  <li key={x.r} className={`text-[11px] flex items-center gap-1.5 ${x.hit ? 'text-green-700' : 'text-gray-400'}`}>
                    {x.hit ? <FiCheck size={11} /> : <span className="w-[11px] inline-block">·</span>} {x.r}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
      <p className="text-[11px] text-gray-400 mt-4 italic">Scripted scoring — synthesis is graded by rubric-keyword heuristic, not an LLM.</p>
      <button onClick={onReset} className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-[#FA6C43] hover:underline">
        <FiRefreshCw /> Replay this lab
      </button>
    </Card>
  );
}
