/**
 * @language  JavaScript (React / JSX)
 * @updated   2026-08-15
 * @changed   Added a "Back to dashboard" link in the header so the page isn't a dead end.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  FiUploadCloud, FiFileText, FiCheckCircle, FiHelpCircle, FiLock, FiSend,
  FiChevronDown, FiChevronRight, FiExternalLink, FiAlertCircle, FiArrowLeft,
} from 'react-icons/fi';
import apiClient from '../api/apiClient';

const ACCEPT = '.pdf,.docx,.txt,.md,.pptx';
const STORAGE_KEY = 'actr.coursePlan.v1';

// The analysis is two Opus calls and runs 30-60s. A spinner alone reads as a hang
// at that length, so the label walks the stages the backend is actually working
// through. Timings are approximate by design — this narrates the wait, it does not
// claim to measure it.
const STAGES = [
  'Reading your syllabus…',
  'Finding each class session…',
  'Matching sessions to what students actually do…',
  'Checking every recommendation against your own words…',
];

// Visual weight per verdict. "possible" is deliberately quieter than "strong":
// the whole point of the plan is that the strong fits stand out from the maybes.
const FIT_STYLE = {
  strong: { label: 'Strong fit', chip: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  possible: { label: 'Worth a look', chip: 'bg-amber-100 text-amber-800 border-amber-200' },
};

export default function CoursePlanPage() {
  const [plan, setPlan] = useState(null);
  const [features, setFeatures] = useState({});
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState(0);
  const [error, setError] = useState('');
  const [pasteMode, setPasteMode] = useState(false);
  const [pasted, setPasted] = useState('');
  const fileRef = useRef(null);

  const isAuthed = plan?.authenticated;

  // The feature catalog drives card titles and guide links, so the page never
  // holds a second copy of what each feature is called.
  useEffect(() => {
    apiClient.get('/advisor/catalog')
      .then(({ data }) => {
        const map = {};
        (data.features || []).forEach((f) => { map[f.key] = f; });
        setFeatures(map);
      })
      .catch(() => {});
  }, []);

  // A plan survives a refresh mid-demo. sessionStorage rather than a server-side
  // record: phase 1 stores no plans, so the tab's copy IS the plan.
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) setPlan(JSON.parse(saved));
    } catch { /* a corrupt cache is not worth surfacing */ }
  }, []);

  useEffect(() => {
    try {
      if (plan) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(plan));
    } catch { /* quota or private mode — the plan still works in memory */ }
  }, [plan]);

  // Walks the stage label while a request is in flight, and resets on completion
  // so the next run starts from the first stage rather than mid-sequence.
  useEffect(() => {
    if (!busy) { setStage(0); return undefined; }
    const timer = setInterval(() => setStage((s) => Math.min(s + 1, STAGES.length - 1)), 9000);
    return () => clearInterval(timer);
  }, [busy]);

  /** Send the syllabus (file or pasted text) and hold the returned plan. */
  const analyze = useCallback(async (payload, isFile) => {
    setBusy(true);
    setError('');
    try {
      const { data } = isFile
        ? await apiClient.post('/advisor/syllabus', payload)
        : await apiClient.post('/advisor/syllabus', { text: payload });
      setPlan(data);
    } catch (err) {
      setError(err?.response?.data?.message || 'Something went wrong reading that syllabus.');
    } finally {
      setBusy(false);
    }
  }, []);

  const handleFile = useCallback((file) => {
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    analyze(form, true);
  }, [analyze]);

  // Drag-and-drop is the demo path — a professor drops the PDF they already have
  // open rather than hunting through a file dialog on a projector.
  const onDrop = useCallback((e) => {
    e.preventDefault();
    handleFile(e.dataTransfer?.files?.[0]);
  }, [handleFile]);

  const reset = () => {
    setPlan(null);
    setError('');
    sessionStorage.removeItem(STORAGE_KEY);
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-6 py-8">
          {/* The page is otherwise a dead end — give the professor a way back to the dashboard. */}
          <Link
            to="/config_list"
            className="inline-flex items-center gap-2 mb-4 text-sm text-slate-500 hover:text-slate-900 transition-colors"
          >
            <FiArrowLeft /> Back to dashboard
          </Link>
          <h1 className="text-3xl font-bold text-slate-900">Where does ACTR fit in your course?</h1>
          <p className="mt-2 text-slate-600 max-w-2xl">
            Upload the syllabus you already teach from. We'll read it session by session and tell you
            which classes are a fit, which aren't, and what you'd need to set each one up.
          </p>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        {!plan && (
          <UploadCard
            busy={busy}
            stageLabel={STAGES[stage]}
            error={error}
            pasteMode={pasteMode}
            setPasteMode={setPasteMode}
            pasted={pasted}
            setPasted={setPasted}
            onDrop={onDrop}
            onPick={() => fileRef.current?.click()}
            onPasteSubmit={() => analyze(pasted, false)}
          />
        )}
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />

        {plan && (
          <PlanView
            plan={plan}
            features={features}
            isAuthed={isAuthed}
            onReset={reset}
            onPlanChange={setPlan}
          />
        )}
      </main>
    </div>
  );
}

/** The empty state: dropzone, file picker, and a paste-instead escape hatch. */
function UploadCard({
  busy, stageLabel, error, pasteMode, setPasteMode, pasted, setPasted, onDrop, onPick, onPasteSubmit,
}) {
  if (busy) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl p-16 text-center">
        <div className="w-10 h-10 mx-auto border-2 border-slate-200 border-t-slate-700 rounded-full animate-spin" />
        <p className="mt-6 text-slate-700 font-medium">{stageLabel}</p>
        <p className="mt-2 text-sm text-slate-500">This takes about a minute.</p>
      </div>
    );
  }

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-8">
      {error && (
        <div className="mb-6 flex items-start gap-2 p-3 rounded-lg bg-red-50 text-red-700 text-sm">
          <FiAlertCircle className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {!pasteMode ? (
        <>
          <div
            onDrop={onDrop}
            onDragOver={(e) => e.preventDefault()}
            onClick={onPick}
            className="border-2 border-dashed border-slate-300 rounded-xl p-14 text-center cursor-pointer hover:border-slate-400 hover:bg-slate-50 transition"
          >
            <FiUploadCloud className="w-10 h-10 mx-auto text-slate-400" />
            <p className="mt-4 font-medium text-slate-800">Drop your syllabus here</p>
            <p className="mt-1 text-sm text-slate-500">PDF, Word, PowerPoint, or plain text — up to 10 MB</p>
          </div>
          <button
            onClick={() => setPasteMode(true)}
            className="mt-4 text-sm text-slate-600 hover:text-slate-900 underline underline-offset-2"
          >
            Or paste your weekly schedule instead
          </button>
        </>
      ) : (
        <>
          <textarea
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            rows={12}
            placeholder={'Week 1 — Introduction. Read ch. 1.\nWeek 2 — Negotiation. In-class role play in pairs.\n…'}
            className="w-full p-4 border border-slate-300 rounded-xl font-mono text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
          />
          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={onPasteSubmit}
              disabled={pasted.trim().length < 80}
              className="px-5 py-2.5 rounded-lg bg-slate-900 text-white font-medium disabled:opacity-40"
            >
              Read my schedule
            </button>
            <button onClick={() => setPasteMode(false)} className="text-sm text-slate-600 hover:text-slate-900">
              Upload a file instead
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** The result: recommendation cards, the not-a-fit weeks, and the follow-up panel. */
function PlanView({ plan, features, isAuthed, onReset, onPlanChange }) {
  const recs = plan.recommendations || [];
  const fits = recs.filter((r) => r.fit === 'strong' || r.fit === 'possible');
  const misses = recs.filter((r) => r.fit === 'none');
  const sessionsByIndex = useMemo(() => {
    const map = {};
    (plan.sessions || []).forEach((s) => { map[s.index] = s; });
    return map;
  }, [plan.sessions]);

  return (
    <div className="grid lg:grid-cols-3 gap-8 items-start">
      <div className="lg:col-span-2 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">
              {plan.course?.title || 'Your course'}
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              {(plan.sessions || []).length} sessions read · {fits.length} where we'd help
            </p>
          </div>
          <button onClick={onReset} className="text-sm text-slate-600 hover:text-slate-900 shrink-0">
            Try another syllabus
          </button>
        </div>

        {fits.map((rec) => (
          <RecommendationCard
            key={rec.session_index}
            rec={rec}
            session={sessionsByIndex[rec.session_index]}
            feature={features[rec.feature]}
            isAuthed={isAuthed}
          />
        ))}

        {plan.locked_count > 0 && <LockedBanner count={plan.locked_count} />}

        {misses.length > 0 && <NotAFitList misses={misses} sessionsByIndex={sessionsByIndex} />}
      </div>

      <RefinePanel plan={plan} onPlanChange={onPlanChange} />
    </div>
  );
}

/**
 * One session's recommendation. The evidence quote is not decoration — it is the
 * whole claim to credibility, so it renders above the sales copy rather than
 * buried under it: a professor should see their own sentence before ours.
 */
function RecommendationCard({ rec, session, feature, isAuthed }) {
  const [open, setOpen] = useState(false);
  const style = FIT_STYLE[rec.fit] || FIT_STYLE.possible;

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
            {session?.label || `Session ${rec.session_index}`}
          </p>
          <h3 className="mt-1 text-lg font-semibold text-slate-900">
            {session?.topic || 'This session'}
          </h3>
        </div>
        <span className={`shrink-0 text-xs font-medium px-2.5 py-1 rounded-full border ${style.chip}`}>
          {style.label}
        </span>
      </div>

      {rec.evidence && (
        <blockquote className="mt-4 pl-4 border-l-2 border-slate-300 text-sm text-slate-600 italic">
          “{rec.evidence}”
        </blockquote>
      )}

      <div className="mt-4 flex items-center gap-2 text-slate-900 font-medium">
        <FiCheckCircle className="text-emerald-600" />
        {feature?.label || rec.feature}
      </div>
      <p className="mt-2 text-slate-700">{rec.reason}</p>

      {(rec.caveats || []).map((c) => (
        <p key={c} className="mt-2 text-sm text-amber-700 flex items-start gap-2">
          <FiAlertCircle className="mt-0.5 shrink-0" />{c}
        </p>
      ))}

      {(rec.professor_must_supply || []).length > 0 && (
        <div className="mt-4 p-4 rounded-xl bg-slate-50 border border-slate-200">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            What you'd need to bring
          </p>
          <ul className="mt-2 space-y-1 text-sm text-slate-700 list-disc list-inside">
            {rec.professor_must_supply.map((s) => <li key={s}>{s}</li>)}
          </ul>
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        {/* Phase 1 has no one-click create: this opens the steps rather than the
            wizard, so the button never promises something that doesn't happen. */}
        {isAuthed && (
          <button
            onClick={() => setOpen((v) => !v)}
            className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium flex items-center gap-2"
          >
            {open ? <FiChevronDown /> : <FiChevronRight />}
            How to set this up
          </button>
        )}
        {feature?.guide_page && (
          <Link
            to={`/userguide/${feature.guide_page}`}
            className="text-sm text-slate-600 hover:text-slate-900 flex items-center gap-1.5"
          >
            Read the guide <FiExternalLink className="w-3.5 h-3.5" />
          </Link>
        )}
      </div>

      {open && (rec.setup_steps || []).length > 0 && (
        <ol className="mt-4 space-y-2 text-sm text-slate-700 list-decimal list-inside border-t border-slate-200 pt-4">
          {rec.setup_steps.map((s) => <li key={s}>{s}</li>)}
        </ol>
      )}
    </div>
  );
}

/**
 * The sign-up prompt for a logged-out visitor. It states the real withheld count
 * from the server, so it is a fact rather than a growth-hack number.
 */
function LockedBanner({ count }) {
  return (
    <div className="bg-slate-900 text-white rounded-2xl p-6 flex items-start gap-4">
      <FiLock className="w-5 h-5 mt-0.5 shrink-0" />
      <div>
        <p className="font-semibold">
          {count} more {count === 1 ? 'session' : 'sessions'} in your course matched.
        </p>
        <p className="mt-1 text-slate-300 text-sm">
          Create a free account to see the rest of the plan and set any of them up.
        </p>
        <Link
          to="/register"
          className="inline-block mt-4 px-4 py-2 rounded-lg bg-white text-slate-900 text-sm font-medium"
        >
          Create a free account
        </Link>
      </div>
    </div>
  );
}

/**
 * The weeks we are NOT for, collapsed. Showing these is what makes the fits
 * believable — a tool that finds a use for itself in all thirteen weeks is
 * obviously not reading the syllabus.
 */
function NotAFitList({ misses, sessionsByIndex }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-6">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between text-left"
      >
        <span className="font-medium text-slate-800">
          {misses.length} {misses.length === 1 ? 'session' : 'sessions'} where we wouldn't add anything
        </span>
        {open ? <FiChevronDown className="text-slate-400" /> : <FiChevronRight className="text-slate-400" />}
      </button>
      {open && (
        <ul className="mt-4 space-y-3 border-t border-slate-200 pt-4">
          {misses.map((m) => (
            <li key={m.session_index} className="text-sm">
              <span className="font-medium text-slate-700">
                {sessionsByIndex[m.session_index]?.label || `Session ${m.session_index}`}
              </span>
              <span className="text-slate-500"> — {m.reason}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Follow-up questions against the plan already on screen.
 *
 * The plan is posted back with every question because nothing is stored server
 * side; revisions come back as a partial list and are merged by session index,
 * so a question that changes nothing leaves the page exactly as it was.
 */
function RefinePanel({ plan, onPlanChange }) {
  const [question, setQuestion] = useState('');
  const [thread, setThread] = useState([]);
  const [busy, setBusy] = useState(false);

  const ask = async () => {
    const q = question.trim();
    if (!q || busy) return;
    setQuestion('');
    setThread((t) => [...t, { role: 'user', text: q }]);
    setBusy(true);
    try {
      const { data } = await apiClient.post('/advisor/refine', {
        question: q,
        course: plan.course,
        sessions: plan.sessions,
        recommendations: plan.recommendations,
      });
      setThread((t) => [...t, { role: 'actr', text: data.answer }]);
      if ((data.revised || []).length) {
        const byIndex = {};
        data.revised.forEach((r) => { byIndex[r.session_index] = r; });
        onPlanChange({
          ...plan,
          recommendations: plan.recommendations.map((r) => byIndex[r.session_index] || r),
        });
      }
    } catch (err) {
      setThread((t) => [...t, {
        role: 'actr',
        text: err?.response?.data?.message || "Couldn't answer that just now.",
      }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="bg-white border border-slate-200 rounded-2xl p-5 lg:sticky lg:top-8">
      <div className="flex items-center gap-2 text-slate-900 font-medium">
        <FiHelpCircle /> Ask about this plan
      </div>
      <p className="mt-1 text-sm text-slate-500">
        “Why not week 6?” · “We only have 50 minutes.” · “I don't have a case for that.”
      </p>

      <div className="mt-4 space-y-3 max-h-96 overflow-y-auto">
        {thread.map((m, i) => (
          <div
            key={i}
            className={m.role === 'user'
              ? 'text-sm text-slate-900 bg-slate-100 rounded-lg p-3'
              : 'text-sm text-slate-700'}
          >
            {m.text}
          </div>
        ))}
        {busy && <div className="text-sm text-slate-400">Thinking…</div>}
      </div>

      <div className="mt-4 flex gap-2">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && ask()}
          placeholder="Ask a question…"
          className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
        />
        <button
          onClick={ask}
          disabled={busy || !question.trim()}
          className="px-3 rounded-lg bg-slate-900 text-white disabled:opacity-40"
        >
          <FiSend />
        </button>
      </div>

      <div className="mt-5 pt-4 border-t border-slate-200 flex items-center gap-2 text-xs text-slate-500">
        <FiFileText className="shrink-0" />
        Your syllabus is read once to build this plan. It isn't stored.
      </div>
    </aside>
  );
}
