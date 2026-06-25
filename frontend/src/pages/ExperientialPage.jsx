import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  FiArrowLeft, FiRefreshCw, FiCheck, FiMenu,
  FiHelpCircle, FiAward,
} from 'react-icons/fi';
import apiClient from '../api/apiClient';
import { renderMarkdown } from '../utils/markdown';
import { getExperientialConfig } from '../configs/experiential';
import { validateExperientialConfig } from '../configs/experiential/schema';
import ChatSidebar from '../components/SideBar.jsx';
import ChatComposer from '../components/ChatComposer';
import StickyHeader from '../components/experiential/StickyHeader';
import IrfChart from '../components/experiential/IrfChart';
import ComparisonTable from '../components/experiential/ComparisonTable';
import SessionReplay from '../components/experiential/SessionReplay';
import SessionReport from '../components/experiential/SessionReport';

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

// Anything the student typed or chose renders in this orange box so professors
// can distinguish the student's own words from the analyst's replies at a glance.
function StudentSays({ label = 'Student', children }) {
  return (
    <div className="rounded-xl border border-[#FA6C43]/40 bg-[#FA6C43]/[0.07] px-3.5 py-2.5 mb-3">
      <div className="text-[10px] font-bold uppercase tracking-wide text-[#FA6C43] mb-1">{label}</div>
      <div className="text-sm text-gray-800 leading-relaxed">{children}</div>
    </div>
  );
}

// ─── Main player ─────────────────────────────────────────────────────────────

export default function ExperientialPage() {
  const { templateId, configId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  // A `?session=<id>` opens that saved run inline (sidebar stays put) instead of
  // navigating away. The lab path stays the same, so this page is not remounted.
  const selectedSessionId = searchParams.get('session');
  const basePath = configId ? `/experiential/c/${configId}` : `/experiential/${templateId || ''}`;

  // Two sources: a built-in template (by id) or a DB config's AI-generated lab.
  const [dbLab, setDbLab] = useState({ loading: !!configId, config: null, error: null });
  useEffect(() => {
    if (!configId) return;
    let cancelled = false;
    apiClient.get(`/config/${configId}`)
      .then((res) => {
        if (cancelled) return;
        const ec = res.data?.config?.experiential_config;
        if (ec && ec.layers) setDbLab({ loading: false, config: ec, error: null });
        else setDbLab({ loading: false, config: null, error: 'This lab has no generated config yet — generate it from the config editor.' });
      })
      .catch(() => { if (!cancelled) setDbLab({ loading: false, config: null, error: 'Could not load this lab.' }); });
    return () => { cancelled = true; };
  }, [configId]);

  const config = configId ? dbLab.config : getExperientialConfig(templateId);
  const validation = useMemo(
    () => (config ? validateExperientialConfig(config) : { ok: false, errors: [configId ? (dbLab.error || 'loading…') : 'template not found'] }),
    [config, configId, dbLab.error],
  );

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

  // Saved lab sessions for the sidebar. When the viewer owns this config we load
  // every student's run (review); otherwise we load their own finished runs.
  const [sessions, setSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) return;
    apiClient.get('/auth/me').then((r) => setUserInfo(r.data)).catch(() => {});
    apiClient.get('/accessible_configs').then((r) => setAccessibleConfigs(r.data.configs || [])).catch(() => {});
  }, [isAuthenticated]);

  const loadSessions = useCallback(() => {
    if (!isAuthenticated) return;
    setSessionsLoading(true);
    const apply = (list, byConfig) => {
      const mapped = (list || []).map((s) => ({
        ...s,
        // Distinguish rows: professor sees "student — score", student sees "lab — score".
        title: `${byConfig ? (s.username || 'Student') : (s.title || 'Lab')}${
          s.total_score != null ? ` — ${s.total_score}/100` : ''
        }`,
      }));
      setSessions(mapped);
      setSessionsLoading(false);
    };
    const loadMine = () => apiClient.get('/experiential/sessions')
      .then((r) => apply(r.data.sessions, false))
      .catch(() => setSessionsLoading(false));
    if (configId) {
      apiClient.get(`/experiential/sessions/by-config/${configId}`)
        .then((r) => apply(r.data.sessions, true))
        .catch(loadMine); // not the owner → fall back to my own runs
    } else {
      loadMine();
    }
  }, [isAuthenticated, configId]);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  const noop = () => {};
  let columnContent;
  if (isAuthenticated && selectedSessionId) {
    // Inline replay of a saved run — stays inside this page next to the sidebar.
    columnContent = (
      <SessionColumn
        sessionId={selectedSessionId}
        isAuthenticated={isAuthenticated}
        onClose={() => { searchParams.delete('session'); setSearchParams(searchParams, { replace: true }); }}
        onOpenMobileSidebar={() => setIsMobileSidebarOpen(true)}
      />
    );
  } else if (configId && dbLab.loading) {
    columnContent = (
      <ColumnShell title="Experiential Lab" onBack={() => navigate('/config_list')} isAuthenticated={isAuthenticated} onOpenMobileSidebar={() => setIsMobileSidebarOpen(true)}>
        <Card className="p-6"><p className="text-gray-500">Loading lab…</p></Card>
      </ColumnShell>
    );
  } else if (!config) {
    columnContent = (
      <ColumnShell title="Experiential Lab" onBack={() => navigate('/config_list')} isAuthenticated={isAuthenticated} onOpenMobileSidebar={() => setIsMobileSidebarOpen(true)}>
        <Card className="p-6">
          <p className="text-gray-700">{configId ? (dbLab.error || 'This lab is not available.') : <>No experiential template found for id <code className="px-1 bg-gray-100 rounded">{templateId}</code>.</>}</p>
          <button onClick={() => navigate('/config_list')} className="mt-4 text-[#FA6C43] font-semibold">← Back to dashboard</button>
        </Card>
      </ColumnShell>
    );
  } else if (!validation.ok) {
    columnContent = (
      <ColumnShell title={config?.meta?.title || 'Experiential Lab'} onBack={() => navigate('/config_list')} isAuthenticated={isAuthenticated} onOpenMobileSidebar={() => setIsMobileSidebarOpen(true)}>
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
      <LabRunner
        key={runKey}
        config={config}
        configId={configId}
        templateId={templateId}
        onReset={() => setRunKey((k) => k + 1)}
        onBack={() => navigate('/config_list')}
        isAuthenticated={isAuthenticated}
        onSessionSaved={loadSessions}
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
          sessions={sessions}
          sessionsLoading={sessionsLoading}
          sessionTo={(s) => `${basePath}?session=${s.session_id}`}
          hideSessionMenu
          sessionsLabel="Lab sessions"
          userInfo={userInfo}
          userInfoLoaded={!!userInfo}
          configId={undefined}
          isCollapsed={isSidebarCollapsed}
          isMobileOpen={isMobileSidebarOpen}
          onClose={() => setIsMobileSidebarOpen(false)}
          onToggle={() => setIsSidebarCollapsed((v) => !v)}
          onNewChat={() => navigate('/config_list')}
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

// Inline session viewer rendered in the lab column (sidebar stays). Default shows
// the read-only replay (history); a "Report" toggle in the header shows the score.
function SessionColumn({ sessionId, isAuthenticated, onClose, onOpenMobileSidebar }) {
  const [data, setData] = useState({ loading: true, session: null, error: null });
  const [cfg, setCfg] = useState(null);
  const [tab, setTab] = useState('session');

  useEffect(() => {
    let cancelled = false;
    setData({ loading: true, session: null, error: null });
    setCfg(null);
    setTab('session');
    apiClient.get(`/experiential/sessions/${sessionId}`)
      .then((r) => { if (!cancelled) setData({ loading: false, session: r.data.session, error: null }); })
      .catch((e) => {
        if (cancelled) return;
        const c = e?.response?.status;
        setData({
          loading: false, session: null,
          error: c === 403 ? "You don't have access to this session."
            : c === 404 ? 'This session no longer exists.' : 'Could not load this session.',
        });
      });
    return () => { cancelled = true; };
  }, [sessionId]);

  const session = data.session;
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    // Prefer the snapshot saved with the run (reflects any student adaptation);
    // fall back to the live config / built-in template for older sessions.
    if (session.effective_config?.layers) {
      setCfg(session.effective_config);
      return () => { cancelled = true; };
    }
    if (session.config_id) {
      apiClient.get(`/config/${session.config_id}`)
        .then((r) => { if (!cancelled) setCfg(r.data?.config?.experiential_config || null); })
        .catch(() => { if (!cancelled) setCfg(null); });
    } else if (session.template_id) {
      setCfg(getExperientialConfig(session.template_id) || null);
    }
    return () => { cancelled = true; };
  }, [session]);

  const headerExtra = session ? (
    <div className="flex items-center gap-1.5">
      {session.total_score != null && tab === 'session' && (
        <span className="hidden sm:inline text-sm font-bold text-[#FA6C43] tabular-nums mr-1">{session.total_score}/100</span>
      )}
      {[['session', 'History'], ['report', 'Report']].map(([k, label]) => (
        <button
          key={k}
          onClick={() => setTab(k)}
          className={`text-sm px-3 py-1.5 rounded-xl font-semibold transition-colors ${
            tab === k ? 'bg-[#222] text-white' : 'bg-white border border-gray-200 text-gray-500 hover:text-[#FA6C43]'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  ) : null;

  const subtitle = session
    ? [session.username, session.created_at ? new Date(session.created_at).toLocaleString() : null].filter(Boolean).join(' · ')
    : '';

  return (
    <ColumnShell
      title={session?.title || 'Session'}
      subtitle={subtitle}
      onBack={onClose}
      isAuthenticated={isAuthenticated}
      onOpenMobileSidebar={onOpenMobileSidebar}
      headerExtra={headerExtra}
    >
      {data.loading && <Card className="p-6"><p className="text-gray-500">Loading…</p></Card>}
      {data.error && <Card className="p-6"><p className="text-gray-600">{data.error}</p></Card>}
      {session && tab === 'session' && (
        cfg ? <SessionReplay config={cfg} transcript={session.transcript} />
          : <Card className="p-6"><p className="text-gray-500">Loading the lab…</p></Card>
      )}
      {session && tab === 'report' && <SessionReport session={session} />}
    </ColumnShell>
  );
}

// Light fallback when a lab isn't web-grounded: fold the student's picks into
// the scenario text so the analyst and reveals see them, without a model call.
function injectChoices(config, chosen) {
  const filled = chosen.filter((c) => c.value);
  if (!filled.length) return config;
  const suffix = ` (${filled.map((c) => `${c.label}: ${c.value}`).join(', ')})`;
  return { ...config, scenario: { ...config.scenario, brief: (config.scenario?.brief || '') + suffix } };
}

// Gate in front of the Player: when a lab defines `studentChoices`, the student
// picks values first. Grounded choices route through /experiential/adapt (web +
// Claude rewrite, cached); everything else folds in locally. Then the Player
// runs against the resulting config.
function LabRunner(props) {
  const { config, configId, templateId, onBack, isAuthenticated, onOpenMobileSidebar } = props;
  const choices = config.studentChoices || [];
  const [phase, setPhase] = useState(choices.length ? 'choose' : 'run');
  const [values, setValues] = useState(() =>
    Object.fromEntries(choices.map((c) => [c.id, c.type === 'select' ? (c.options?.[0] || '') : ''])),
  );
  const [adapting, setAdapting] = useState(false);
  const [effectiveConfig, setEffectiveConfig] = useState(config);
  const [choiceValues, setChoiceValues] = useState([]);

  async function start() {
    const chosen = choices.map((c) => ({
      id: c.id, label: c.label, value: (values[c.id] || '').trim(), grounded: !!c.grounded,
    }));
    setChoiceValues(chosen.filter((c) => c.value));
    const hasGrounded = chosen.some((c) => c.grounded && c.value);
    if (!hasGrounded) {
      setEffectiveConfig(injectChoices(config, chosen));
      setPhase('run');
      return;
    }
    setAdapting(true);
    try {
      const { data } = await apiClient.post(
        '/experiential/adapt',
        { config, choices: chosen, base_id: configId || templateId || config.meta?.id || '' },
        { timeout: 180000 }, // web search + a Claude rewrite — give it room
      );
      const { ok } = validateExperientialConfig(data.config);
      setEffectiveConfig(ok ? data.config : injectChoices(config, chosen));
    } catch {
      // Grounding failed → still let the student play with their picks folded in.
      setEffectiveConfig(injectChoices(config, chosen));
    } finally {
      setAdapting(false);
      setPhase('run');
    }
  }

  if (phase === 'choose') {
    return (
      <ChooserScreen
        config={config}
        choices={choices}
        values={values}
        setValues={setValues}
        adapting={adapting}
        onStart={start}
        onBack={onBack}
        isAuthenticated={isAuthenticated}
        onOpenMobileSidebar={onOpenMobileSidebar}
      />
    );
  }
  return <Player {...props} config={effectiveConfig} choiceValues={choiceValues} />;
}

function ChooserScreen({ config, choices, values, setValues, adapting, onStart, onBack, isAuthenticated, onOpenMobileSidebar }) {
  const field = 'w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm focus:outline-none focus:border-[#FA6C43]';
  return (
    <ColumnShell
      title={config.meta?.title || 'Experiential Lab'}
      subtitle={`${config.meta?.discipline || ''}${config.meta?.level ? ` · ${config.meta.level}` : ''}`}
      onBack={onBack}
      isAuthenticated={isAuthenticated}
      onOpenMobileSidebar={onOpenMobileSidebar}
    >
      <Card accent className="p-5">
        <SpeakerLabel name="Before you start" />
        <p className="text-sm text-gray-600 mb-4">Make this lab yours — set the options below and we’ll build your scenario.</p>
        <div className="space-y-4">
          {choices.map((c) => (
            <div key={c.id}>
              <label className="block text-sm font-medium text-gray-800 mb-1">{c.label}</label>
              {c.prompt && <p className="text-xs text-gray-400 mb-1.5">{c.prompt}</p>}
              {c.type === 'select' ? (
                <select value={values[c.id] || ''} onChange={(e) => setValues((v) => ({ ...v, [c.id]: e.target.value }))} className={field}>
                  {(c.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <input
                  value={values[c.id] || ''}
                  onChange={(e) => setValues((v) => ({ ...v, [c.id]: e.target.value }))}
                  placeholder={c.prompt || 'Type your choice…'}
                  className={field}
                />
              )}
              {c.grounded && (
                <p className="text-[11px] text-[#FA6C43] mt-1">Your scenario will reflect current, real-world conditions for this.</p>
              )}
            </div>
          ))}
        </div>
        <button
          onClick={onStart}
          disabled={adapting}
          className="mt-5 inline-flex items-center gap-1.5 bg-[#FA6C43] hover:bg-[#e85a30] disabled:opacity-50 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors"
        >
          {adapting ? <><FiRefreshCw className="animate-spin" /> Building your scenario…</> : 'Start the lab'}
        </button>
      </Card>
    </ColumnShell>
  );
}

function Player({ config, configId, templateId, onReset, onBack, isAuthenticated, onSessionSaved, onOpenMobileSidebar, choiceValues = [] }) {
  const { meta, scenario, analyst, predictionVariables, layers, probes, provenanceGates, coach, synthesis } = config;

  const layerById = useMemo(() => Object.fromEntries(layers.map((l) => [l.id, l])), [layers]);
  const probeById = useMemo(() => Object.fromEntries(probes.map((p) => [p.id, p])), [probes]);
  const baseLayer = layers[0];

  // ── Core state ──
  const [dials, setDials] = useState(() => Object.fromEntries(predictionVariables.map((v) => [v.id, 0])));
  const [dialsCommitted, setDialsCommitted] = useState(false);
  const [revealedIds, setRevealedIds] = useState([]);              // layers whose reveal is shown (ordered)
  const [unlockedIds, setUnlockedIds] = useState([baseLayer.id]);  // layers available to add
  const [layerPredictions, setLayerPredictions] = useState({});    // layerId -> 'more'|'same'|'less'
  const [layerReasons, setLayerReasons] = useState({});            // layerId -> the student's one-line "why"
  const [usedProbeIds, setUsedProbeIds] = useState([]);
  const [satisfiedGateIds, setSatisfiedGateIds] = useState([]);
  // Default to the baseline's first chart variable. Generated labs use their own
  // variable keys (e.g. price_level, real_gdp), so a hardcoded 'gdp' would match
  // nothing and render an empty chart until the user clicked a variable chip.
  const [chartVar, setChartVar] = useState(() => Object.keys(baseLayer.reveal.chartSeries)[0]);
  const [feed, setFeed] = useState([]);                            // append-only narrative blocks
  const [synthesisOpen, setSynthesisOpen] = useState(false);
  const [synthesisText, setSynthesisText] = useState('');
  const [scores, setScores] = useState(null);
  const [grading, setGrading] = useState(false);

  const isGenerative = analyst.mode === 'generative';

  // Coach state
  const [hintsUsed, setHintsUsed] = useState(0);
  const unproductiveRef = useRef(0);
  const lastActionRef = useRef(Date.now());
  const feedEndRef = useRef(null);

  // Saved-session lifecycle: created on the first answer, updated as the run
  // progresses, finalized on synthesis. sessionIdRef holds the row id once made.
  const sessionIdRef = useRef(null);
  const persistingRef = useRef(false);

  // Probes are no longer student-picked: after the baseline commit they are
  // posed automatically, one at a time, in config order. This cursor walks them.
  const probeCursorRef = useRef(0);

  // Composer state (reused chat input box).
  const [input, setInput] = useState('');
  const inputRef = useRef(null);
  const attachInputRef = useRef(null);
  const imageInputRef = useRef(null);

  const chartKeys = useMemo(() => Object.keys(baseLayer.reveal.chartSeries), [baseLayer]);
  // Friendly chart-variable labels come from the lab's own predictionVariables
  // (e.g. real_gdp -> "Real GDP"), so the toggle never shows raw snake_case keys.
  const varLabelByKey = useMemo(
    () => Object.fromEntries(predictionVariables.map((v) => [v.id, v.label])),
    [predictionVariables]
  );

  // ── Derived ──
  const gatesForHeader = provenanceGates.map((g) => ({ ...g, satisfied: satisfiedGateIds.includes(g.id) }));
  const numbersBlurred = provenanceGates.length > 0 && !provenanceGates.every((g) => satisfiedGateIds.includes(g.id));
  const revealedLayers = revealedIds.map((id) => layerById[id]);

  const markAction = () => { lastActionRef.current = Date.now(); };
  const blockSeqRef = useRef(0);
  // Returns the block's stable key so async handlers can patch it later.
  const appendFeed = (block) => {
    const _k = `${block.type}-${blockSeqRef.current++}`;
    setFeed((f) => [...f, { ...block, _k }]);
    return _k;
  };
  const updateFeed = (k, patch) => setFeed((f) => f.map((b) => (b._k === k ? { ...b, ...patch } : b)));

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
    // Probes pose themselves now, so the coach only nudges the student's thinking
    // — it never tells them which probe to "ask".
    appendFeed({ type: 'coach', text: s.why, reason });
    setHintsUsed((n) => n + 1);
    unproductiveRef.current = 0;
  }

  // ── Actions ──
  function commitDials() {
    markAction();
    setDialsCommitted(true);
    setRevealedIds([baseLayer.id]);
    appendFeed({ type: 'reveal', layerId: baseLayer.id, snapshot: [baseLayer.id], withGuess: true });
    // Kick off the auto-sequence: pose the first probe right after the baseline.
    probeCursorRef.current = 0;
    presentProbeAt(0);
  }

  // Pose the probe at `idx` automatically: the analyst raises a "what if…",
  // answers it, and (when it introduces a complication) immediately opens that
  // layer's prediction — the student never chooses which probe to ask. When the
  // probes run out, the synthesis step opens on its own.
  function presentProbeAt(idx) {
    const probe = probes[idx];
    if (!probe) { openSynthesis(); return; }
    markAction();
    setUsedProbeIds((u) => (u.includes(probe.id) ? u : [...u, probe.id]));
    if (probe.establishesGateId) {
      setSatisfiedGateIds((g) => (g.includes(probe.establishesGateId) ? g : [...g, probe.establishesGateId]));
    }
    appendFeed({ type: 'answer', probeId: probe.id });
    if (probe.unlocksLayerId) {
      setUnlockedIds((u) => (u.includes(probe.unlocksLayerId) ? u : [...u, probe.unlocksLayerId]));
      appendFeed({ type: 'layer-predict', layerId: probe.unlocksLayerId });
      // Wait here — advanceProbe() fires once the student reveals this layer.
    } else {
      advanceProbe(); // informational probe → move straight to the next
    }
  }

  function advanceProbe() {
    probeCursorRef.current += 1;
    presentProbeAt(probeCursorRef.current);
  }

  function revealLayer(layerId) {
    markAction();
    const snapshot = [...revealedIds, layerId];
    setRevealedIds((r) => (r.includes(layerId) ? r : [...r, layerId]));
    appendFeed({ type: 'comparison', layerId, snapshot });
    // Route the mechanism through the helper, addressed to the student's own
    // prediction + reason, instead of just dumping the static narrative.
    explainLayer(layerId, snapshot);
  }

  // The helper explains WHY — confirming or correcting the student's reasoning.
  async function explainLayer(layerId, snapshot) {
    const lyr = layerById[layerId];
    const ep = lyr.extensionPredict;
    const focus = ep?.focus || 'the outcome';
    const choiceWord = { more: 'more', same: 'about the same', less: 'less' }[layerPredictions[layerId]] || 'a certain amount';
    const reason = (layerReasons[layerId] || '').trim();
    const actualCell = lyr.reveal.tableRow[focus];
    const baseCell = baseLayer.reveal.tableRow[focus];
    const fallback = lyr.reveal.narrative;

    const k = appendFeed({ type: 'explain', layerId, pending: isGenerative });
    if (!isGenerative) { updateFeed(k, { reply: fallback, pending: false }); advanceProbe(); return; }
    try {
      const question =
        `I predicted ${focus} would fall ${choiceWord} than the baseline` +
        (reason ? `, because: "${reason}"` : '') +
        `. The model now shows ${focus} at ${actualCell} versus the baseline's ${baseCell}. ` +
        `Was my reasoning right? In 2–3 sentences, tell me whether my "why" holds up and walk me through the actual mechanism, correcting me if I'm off. Don't just restate the result — explain the channel.`;
      const { data } = await apiClient.post('/experiential/analyst', {
        persona: analyst.persona,
        stayInCharacter: analyst.stayInCharacter,
        scenario: scenario.brief,
        labTitle: meta.title,
        question,
        state: buildLabState(snapshot),
      });
      updateFeed(k, { reply: data.reply, pending: false });
    } catch (e) {
      updateFeed(k, { reply: fallback, pending: false });
    } finally {
      // Once the "why" lands, the next probe poses itself.
      advanceProbe();
    }
  }

  function openSynthesis() {
    markAction();
    setSynthesisOpen(true);
  }

  // Compact lab state shared with the backend so Claude stays consistent with
  // the scripted reveals / probe answers the student has already seen.
  function buildLabState(revealedOverride) {
    const ids = revealedOverride || revealedIds;
    return {
      revealedLayers: ids.map((id) => ({
        name: layerById[id].name,
        narrative: layerById[id].reveal.narrative,
        changes: layerById[id].changes,
      })),
      numbersVerified: provenanceGates.length > 0 && provenanceGates.every((g) => satisfiedGateIds.includes(g.id)),
      probeQA: usedProbeIds.map((id) => ({ q: probeById[id].text, a: probeById[id].answer })),
      prediction: dialsCommitted
        ? predictionVariables.map((v) => ({ label: v.label, call: arrow(dials[v.id]) }))
        : [],
    };
  }

  // Full transcript + state for replay, plus summary fields for the dashboard.
  function buildSessionPayload(finalScores) {
    return {
      config_id: configId || null,
      template_id: templateId || null,
      title: meta.title,
      discipline: meta.discipline,
      level: meta.level,
      status: finalScores ? 'completed' : 'in_progress',
      total_score: finalScores ? finalScores.total : null,
      breakdown: finalScores ? finalScores.breakdown : null,
      graded_by: finalScores ? finalScores.synthGradedBy : null,
      synthesis_text: synthesisText,
      predictions: predictionVariables.map((v) => ({ label: v.label, call: arrow(dials[v.id]) })),
      layers_revealed: revealedIds.map((id) => layerById[id].name),
      probes_used: usedProbeIds.map((id) => probeById[id]?.text).filter(Boolean),
      // The effective (possibly student-adapted) config drives faithful replay —
      // a built-in template id won't reconstruct an adapted "Nigeria" scenario.
      effective_config: config,
      transcript: {
        feed, dials, dialsCommitted, revealedIds, unlockedIds,
        layerPredictions, layerReasons, usedProbeIds, satisfiedGateIds, chartVar,
        synthesisText, choiceValues,
      },
    };
  }

  // Create on first save, update thereafter. Best-effort: a failed save never
  // blocks the run. A creation guard avoids racing two POSTs into two rows.
  async function persistSession(finalScores) {
    if (!isAuthenticated) return;
    if (persistingRef.current && !sessionIdRef.current) return;
    persistingRef.current = true;
    try {
      const payload = buildSessionPayload(finalScores);
      if (!sessionIdRef.current) {
        const { data } = await apiClient.post('/experiential/sessions', payload);
        sessionIdRef.current = data.session_id;
      } else {
        await apiClient.put(`/experiential/sessions/${sessionIdRef.current}`, payload);
      }
      onSessionSaved && onSessionSaved();
    } catch (e) {
      // Non-fatal.
    } finally {
      persistingRef.current = false;
    }
  }

  // Keep the saved session in sync as the run unfolds (debounced). Starts only
  // after the first answer (dialsCommitted) and stops once finished — finish()
  // writes the authoritative completed state.
  useEffect(() => {
    if (!isAuthenticated || !dialsCommitted || scores) return;
    const t = setTimeout(() => persistSession(), 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feed, dialsCommitted, revealedIds, layerPredictions, layerReasons, usedProbeIds, synthesisText, scores]);

  function finish(finalScores) {
    setScores(finalScores);
    persistSession(finalScores);
  }

  async function submitSynthesis() {
    markAction();
    if (!isGenerative) { finish(computeScores()); return; }
    setGrading(true);
    try {
      const { data } = await apiClient.post('/experiential/grade', {
        task: synthesis.task,
        rubric: synthesis.rubric,
        wordLimit: synthesis.wordLimit,
        synthesis: synthesisText,
        context: {
          scenario: scenario.brief,
          layers: revealedIds.map((id) => ({ name: layerById[id].name, narrative: layerById[id].reveal.narrative })),
        },
      });
      const hits = synthesis.rubric.map((r, i) => {
        const item = data.rubric?.[i] || {};
        return { r, hit: !!item.met, note: item.note || '' };
      });
      finish(computeScores({ rubricHits: hits, feedback: data.feedback || '', graded: true }));
    } catch (e) {
      // Backend unavailable → fall back to the local keyword heuristic.
      finish(computeScores());
    } finally {
      setGrading(false);
    }
  }

  async function handleFreeform(text) {
    markAction();
    const k = appendFeed({ type: 'freeform', question: text, reply: null, pending: isGenerative });
    if (!isGenerative) {
      updateFeed(k, { reply: analyst.scriptedFallback || 'Use the probe chips to interrogate the model.', pending: false });
      return;
    }
    try {
      const { data } = await apiClient.post('/experiential/analyst', {
        persona: analyst.persona,
        stayInCharacter: analyst.stayInCharacter,
        scenario: scenario.brief,
        labTitle: meta.title,
        question: text,
        state: buildLabState(),
      });
      updateFeed(k, { reply: data.reply, pending: false });
    } catch (e) {
      updateFeed(k, { reply: analyst.scriptedFallback || 'I can’t reach my models right now — try a probe chip above.', pending: false, error: true });
    }
  }

  // ── Scoring ──
  // `synthJudgment` (optional): { rubricHits:[{r,hit,note}], feedback, graded }
  // from the live Claude grader. When absent, fall back to the keyword heuristic.
  function computeScores(synthJudgment) {
    const EP_LABEL = { more: 'Falls more', same: 'About the same', less: 'Falls less' };

    // Prediction = baseline directions + each extension prediction.
    let correct = 0;
    const baseRows = predictionVariables.map((v) => {
      const ok = dirOf(dials[v.id]) === String(v.expected);
      if (ok) correct += 1;
      return { label: v.label, got: arrow(dials[v.id]), ok };
    });
    const extLayers = layers.filter((l) => l.extensionPredict);
    const extRows = extLayers.map((l) => {
      const pick = layerPredictions[l.id];
      const ok = pick === l.extensionPredict.expected;
      if (ok) correct += 1;
      return { label: `${l.short}: ${l.extensionPredict.focus}`, got: pick ? EP_LABEL[pick] : '—', ok };
    });
    const predTotal = predictionVariables.length + extLayers.length;
    const predictionScore = Math.round((correct / predTotal) * config.scoring.predictionWeight);

    // Probe efficiency (only when the config weights it).
    const used = usedProbeIds.map((id) => probeById[id]);
    const wasted = used.filter((p) => p.deadEnd).length;
    const usefulUsed = used.filter((p) => !p.deadEnd && (p.establishesGateId || p.unlocksLayerId)).length;
    const effRatio = Math.max(0, Math.min(1, (usefulUsed - 0.5 * wasted) / 4));
    const probeScore = Math.round(effRatio * config.scoring.probeEfficiencyWeight);

    // Provenance (only when the config defines gates).
    const provRatio = provenanceGates.length ? satisfiedGateIds.length / provenanceGates.length : 0;
    const provScore = Math.round(provRatio * config.scoring.provenanceWeight);

    // Synthesis: live Claude grade when provided, else keyword heuristic.
    const t = synthesisText.toLowerCase();
    const rubricHits = synthJudgment?.rubricHits
      || synthesis.rubric.map((r) => ({ r, hit: RUBRIC_KEYWORDS[r] ? RUBRIC_KEYWORDS[r](t) : t.includes(r.toLowerCase()) }));
    const hitCount = rubricHits.filter((x) => x.hit).length;
    const words = t.trim() ? t.trim().split(/\s+/).length : 0;
    const overLimit = words > synthesis.wordLimit;
    const synthScore = Math.round((hitCount / synthesis.rubric.length) * config.scoring.synthesisWeight);
    const synthGradedBy = synthJudgment?.graded ? 'Claude Sonnet' : 'keyword heuristic';
    const synthFeedback = synthJudgment?.feedback || '';

    // Only surface dimensions the config actually weights.
    const breakdown = [
      { key: 'Prediction', score: predictionScore, weight: config.scoring.predictionWeight, detail: `${correct}/${predTotal} predictions correct`, rows: [...baseRows, ...extRows] },
    ];
    if (config.scoring.probeEfficiencyWeight > 0) {
      breakdown.push({ key: 'Probe efficiency', score: probeScore, weight: config.scoring.probeEfficiencyWeight, detail: `${usefulUsed} productive, ${wasted} wasted` });
    }
    if (provenanceGates.length > 0 && config.scoring.provenanceWeight > 0) {
      breakdown.push({ key: 'Provenance', score: provScore, weight: config.scoring.provenanceWeight, detail: `${satisfiedGateIds.length}/${provenanceGates.length} verified` });
    }
    breakdown.push({ key: 'Synthesis', score: synthScore, weight: config.scoring.synthesisWeight, detail: `${hitCount}/${synthesis.rubric.length} rubric points${overLimit ? ` · over the ${synthesis.wordLimit}-word limit (${words})` : ''}`, rubric: rubricHits, feedback: synthFeedback });

    return {
      total: breakdown.reduce((sum, b) => sum + b.score, 0),
      breakdown,
      synthGradedBy,
    };
  }

  // ── Chart data for a snapshot of revealed layer ids ──
  function chartFor(snapshotIds, withGuess) {
    const series = snapshotIds
      .filter((id) => layerById[id].reveal.chartSeries[chartVar])
      .map((id) => ({ key: id, label: layerById[id].short || layerById[id].name.match(/\(([^)]+)\)/)?.[1] || layerById[id].name, values: layerById[id].reveal.chartSeries[chartVar] }));
    let guess = null;
    if (withGuess) {
      const dv = dials[chartVar];
      if (dv !== undefined) {
        const ref = Math.max(...series.flatMap((s) => s.values.map(Math.abs)), 1);
        const end = (dv / 3) * ref; // magnitude 3 ≈ full scale
        // Match the real series length (labs aren't always 8 points).
        const n = series[0]?.values.length || 8;
        guess = { label: `Your call (${arrow(dv)})`, values: Array.from({ length: n }, (_, i) => (end * (i + 1)) / n) };
      }
    }
    return { series, guess, unit: UNIT_BY_KEY[chartVar] || '' };
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
              <ChartVarToggle chartKeys={chartKeys} chartVar={chartVar} setChartVar={setChartVar} labels={varLabelByKey} />
            </div>
            <p className="text-xs text-gray-500 mb-1.5">
              {varLabelByKey[chartVar] || LABEL_BY_KEY[chartVar] || chartVar} — {config.chartCaption || 'trajectory across the series. Each line is a model.'}
            </p>
            <IrfChart series={series} guess={guess} unit={unit} blurNumbers={numbersBlurred} />
            {/* Baseline shows its narrative; extension layers route the "why"
                through the helper (the 'explain' block) instead. */}
            {b.type === 'reveal' && (
              <p className="text-sm text-gray-700 mt-3 leading-relaxed">{lyr.reveal.narrative}</p>
            )}
            <div className="mt-4 pt-3 border-t border-gray-100">
              <ComparisonTable layers={snapshotLayers} blurNumbers={numbersBlurred} />
            </div>
          </Card>
        );
      }
      case 'answer': {
        const p = probeById[b.probeId];
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
          </Card>
        );
      }
      case 'layer-predict': {
        const lyr = layerById[b.layerId];
        const done = revealedIds.includes(b.layerId);
        const ep = lyr.extensionPredict;
        const choice = layerPredictions[b.layerId];
        const OPTS = [
          { v: 'more', label: 'Falls more' },
          { v: 'same', label: 'About the same' },
          { v: 'less', label: 'Falls less' },
        ];
        return (
          <Card key={b._k} accent={!done} className="p-5">
            <SpeakerLabel name={`Predict · ${lyr.short || lyr.name}`} />
            <p className="text-sm text-gray-700 mb-3">{ep ? ep.prompt : lyr.predictPrompt}</p>
            {ep && !done && (
              <>
                <div className="flex flex-wrap gap-2 mb-3">
                  {OPTS.map((o) => (
                    <button
                      key={o.v}
                      onClick={() => { markAction(); setLayerPredictions((p) => ({ ...p, [b.layerId]: o.v })); }}
                      className={`text-sm px-3.5 py-2 rounded-xl font-semibold border transition-colors ${
                        choice === o.v ? 'bg-[#FA6C43] border-[#FA6C43] text-white' : 'bg-white border-gray-200 text-gray-600 hover:border-[#FA6C43]/50'
                      }`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
                {choice && (
                  <div className="mb-4 animate-in fade-in slide-in-from-top-1">
                    <label className="block text-xs font-semibold text-gray-600 mb-1">In one sentence — why?</label>
                    <input
                      value={layerReasons[b.layerId] || ''}
                      onChange={(e) => setLayerReasons((p) => ({ ...p, [b.layerId]: e.target.value }))}
                      placeholder="e.g. weaker balance sheets make borrowing dearer, so capex is cut harder…"
                      className="w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm focus:outline-none focus:border-[#FA6C43]"
                    />
                  </div>
                )}
              </>
            )}
            {done ? (
              <div className="inline-flex items-center gap-1.5 text-sm text-gray-500"><FiCheck className="text-green-600" /> Revealed below</div>
            ) : (
              <button
                onClick={() => revealLayer(b.layerId)}
                disabled={!!ep && (!choice || !(layerReasons[b.layerId] || '').trim())}
                className="inline-flex items-center gap-1.5 bg-[#222] hover:bg-black disabled:opacity-40 text-white text-sm font-semibold px-3.5 py-2 rounded-xl transition-colors"
              >
                Commit reasoning & reveal {lyr.short || lyr.name}
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
            </div>
          </div>
        );
      case 'explain': {
        const lyr = layerById[b.layerId];
        const pick = layerPredictions[b.layerId];
        const reason = layerReasons[b.layerId];
        const focus = lyr.extensionPredict?.focus;
        const EP_LABEL = { more: 'falls more', same: 'about the same', less: 'falls less' };
        return (
          <Card key={b._k} className="p-5">
            {pick && (
              <StudentSays label="Student · prediction">
                <span className="font-semibold">{focus} {EP_LABEL[pick] || pick}</span>
                {reason ? <> — “{reason}”</> : null}
              </StudentSays>
            )}
            <SpeakerLabel name={`${meta.title} · why`} />
            {b.pending ? (
              <div className="flex items-center gap-2 text-sm text-gray-400">
                <span className="inline-flex gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-300 animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-300 animate-bounce" style={{ animationDelay: '120ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-300 animate-bounce" style={{ animationDelay: '240ms' }} />
                </span>
                Checking your reasoning…
              </div>
            ) : (
              <div
                className="text-sm leading-relaxed prose-experiential text-gray-800"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(b.reply || '') }}
              />
            )}
          </Card>
        );
      }
      case 'freeform':
        return (
          <Card key={b._k} className="p-5">
            <StudentSays label="Student · asked">{b.question}</StudentSays>
            <SpeakerLabel name={meta.title} />
            {b.pending ? (
              <div className="flex items-center gap-2 text-sm text-gray-400">
                <span className="inline-flex gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-300 animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-300 animate-bounce" style={{ animationDelay: '120ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-300 animate-bounce" style={{ animationDelay: '240ms' }} />
                </span>
                Analyst is thinking…
              </div>
            ) : (
              <div
                className={`text-sm leading-relaxed prose-experiential ${b.error ? 'text-amber-700' : 'text-gray-800'}`}
                dangerouslySetInnerHTML={{ __html: renderMarkdown(b.reply || '') }}
              />
            )}
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
        {dialsCommitted && !scores && !synthesisOpen && (
          <button onClick={openSynthesis} className="text-xs font-semibold text-[#FA6C43] hover:underline">
            Skip ahead to my synthesis →
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
          grading={grading}
          gradedLive={isGenerative}
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

function ChartVarToggle({ chartKeys, chartVar, setChartVar, labels = {} }) {
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
          {labels[k] || LABEL_BY_KEY[k] || k}
        </button>
      ))}
    </div>
  );
}

function DialsCard({ variables, dials, setDials, committed, onCommit }) {
  if (committed) {
    return (
      <Card className="px-4 py-2.5 border-[#FA6C43]/40 bg-[#FA6C43]/[0.07]">
        <div className="flex items-center gap-2 flex-wrap text-sm">
          <span className="text-[10px] font-bold uppercase tracking-wide text-[#FA6C43]">Student · prediction</span>
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

function SynthesisCard({ synthesis, text, setText, submitted, grading, gradedLive, onSubmit }) {
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
        <button onClick={onSubmit} disabled={!text.trim() || grading} className="inline-flex items-center gap-1.5 bg-[#FA6C43] hover:bg-[#e85a30] disabled:opacity-40 text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors">
          {grading ? (
            <>
              <FiRefreshCw className="animate-spin" /> {gradedLive ? 'Claude is grading…' : 'Scoring…'}
            </>
          ) : (
            'Submit & see debrief'
          )}
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
              <ul className="mt-2 space-y-1">
                {b.rubric.map((x) => (
                  <li key={x.r} className={`text-[11px] ${x.hit ? 'text-green-700' : 'text-gray-400'}`}>
                    <span className="flex items-start gap-1.5">
                      {x.hit ? <FiCheck size={11} className="mt-0.5 shrink-0" /> : <span className="w-[11px] inline-block shrink-0">·</span>}
                      <span>{x.r}{x.note ? <span className="text-gray-400 font-normal"> — {x.note}</span> : null}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {b.feedback && (
              <p className="text-xs text-gray-600 mt-2 bg-gray-50 rounded-lg px-3 py-2 italic">{b.feedback}</p>
            )}
          </div>
        ))}
      </div>
      <p className="text-[11px] text-gray-400 mt-4 italic">
        Predictions scored from your calls; synthesis graded by {scores.synthGradedBy || 'keyword heuristic'}.
      </p>
      <button onClick={onReset} className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-[#FA6C43] hover:underline">
        <FiRefreshCw /> Replay this lab
      </button>
    </Card>
  );
}
