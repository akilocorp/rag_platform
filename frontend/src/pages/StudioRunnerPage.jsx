// @language JavaScript (React / JSX)
// @updated   2026-10-08
// @changed   Honours the builder's new block settings: display logic hides/shows blocks live as
//            answers change (a hidden block is never required, never gated, never submitted);
//            `{{answer:…}}` tokens in a question pipe in that block's answer; answers are checked
//            against each block's own rules (character limits, number/email format, "Other" text,
//            constant-sum totals); and "Request a response" blocks left blank get one soft
//            "submit anyway?" prompt. isAnswered moved to studio/blockRules.js, shared with the builder.
// Prior: Required check now uses isAnswered, matching the server: an empty list/object, or an
//            object whose entries are all blank (a card sort reset to "Choose…", a cleared constant
//            sum), is unanswered — previously the client let it through and the server bounced it.
// Prior: Micro-animation pass: block cards now stagger-fade in on load (animate-chip-in +
//            per-index delay) and pick up a soft orange border once answered; Submit gets a hover
//            shadow; the "Thanks for your response" screen fades its lines in instead of popping in
//            all at once.
//            Prior: RespondExtra now also receives answerValue/question/projectId/blockId (previously just
//            value/onChange) — needed by the Tier-3 live AI instruments (Comprehension Check, AI
//            Devil's-Advocate, Adaptive Follow-Up), which call a new public endpoint mid-session
//            and need to know the host block's own answer + question text + how to address the
//            call. Existing RespondExtra components (Confidence Slider etc.) just ignore the new props.
//            Prior: applyBehaviorInstruments now takes `answers` too, for Piped Text (prefixes a block's
//            question with a sibling block's live answer — a no-op until that sibling is actually
//            answered). Embedded Data: URL query params captured once on mount and sent as
//            `embedded_data` alongside the submission. Condition assignment needs no client change
//            — the backend assigns it at submit time from the project doc, not something this page
//            resolves or displays.
//            Prior: Generalized the old inline `hasRandomizer` one-off into applyBehaviorInstruments(),
//            which chains every behavior instrument that transforms a block's own rendered config
//            (Subset Randomizer's slice, Option Randomizer's shuffle, Instructed Response's
//            appended sentence) before handing config to the block's Component. Order matters when
//            Subset Randomizer and Option Randomizer are both attached to the same block: subset
//            first (decide which options exist at all), then randomize their order — reversed, a
//            stable subset could still leak "the answer is always first" to a repeat respondent.
//            Prior: Phase 3: wires in the three new instruments. Confidence Slider renders its
//            RespondExtra below the block and its value goes into a new `instrument_values` state
//            (separate from `answers` — it's a secondary value, not the block's own answer).
//            Read-Time Gate disables Submit until every gated block's `seconds` has elapsed since
//            it was shown (ticked via a 200ms interval only while a gate is actually active — no
//            polling cost otherwise), showing a countdown on the button. Option Randomizer shuffles
//            a single_choice block's options with a seed derived from respondent+block id, so the
//            order is stable across reloads for one respondent but differs across respondents.
//            Prior: Phase 2: records event timestamps (performance.now(), monotonic + high-
//            resolution — not wall-clock, which a respondent's system clock could skew) for any
//            block whose attached instrument needs them (server-enriched `needs_events` flag from
//            the public project payload, since an anonymous respondent has no access to the
//            faculty-scoped instrument registry). Only `shown` (page load, since all blocks render
//            at once — there's no progressive per-block reveal yet) and `submit` are captured,
//            because Reaction Timer is the only instrument that exists and that's all it reads;
//            richer event types (focus/blur/change) get added when an instrument consumes them.
//            Prior: New file: the public, unauthenticated respondent-facing Studio form. Fetches
//            the published project, resolves an anonymous localStorage respondent id (no JWT/
//            Qualtrics fallback chain yet — that generalization is Phase 5's embed work, not
//            needed here), renders every block in `mode="respond"`, validates required fields
//            client-side (with the server's 400 response as a defense-in-depth fallback), and
//            submits to POST /api/studio/public/projects/:id/responses.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { FaSpinner, FaCheckCircle } from 'react-icons/fa';
import apiClient from '../api/apiClient';
import { getBlockComponent } from '../studio/blocks/registry';
import { getInstrumentRespondExtra } from '../studio/instruments/registry';
import {
  isAnswered, visibleBlockIds, answerProblem, formatAnswerForPipe,
} from '../studio/blockRules';
import { resolvePipes } from '../studio/richTextFormat';

const FONT_BODY = "'Plus Jakarta Sans', 'Inter', system-ui, sans-serif";
const RESPONDENT_KEY = 'studio_respondent_id';

const blockNeedsEvents = (block) => (block.instruments || []).some((i) => i.needs_events);

// Same anonymous-identity idea GroupChatPage.jsx uses (persistent random id in
// localStorage) — simplified, since Studio has no JWT/Qualtrics path yet.
const getRespondentId = () => {
  let id = localStorage.getItem(RESPONDENT_KEY);
  if (!id) {
    id = `resp_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
    localStorage.setItem(RESPONDENT_KEY, id);
  }
  return id;
};

// Deterministic shuffle seeded from a string (mulberry32 PRNG — not
// cryptographic, just needs to be stable/repeatable per seed). Re-running
// this on every render is fine: same seed + same input array always
// produces the same output, so it's idempotent, not actually re-randomizing.
const seededShuffle = (array, seedStr) => {
  let h = 0;
  for (let i = 0; i < seedStr.length; i++) {
    h = (Math.imul(31, h) + seedStr.charCodeAt(i)) | 0;
  }
  let seed = h >>> 0;
  const next = () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...array];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

// Chains every attached behavior instrument that transforms a block's own
// rendered config, in a fixed order (see file header for why subset comes
// before reorder). Instruments with no rendering effect (Attention Check,
// Speeder Flag, ...) simply don't match any `find()` here and fall through.
const applyBehaviorInstruments = (block, respondentId, answers) => {
  let config = block.config;
  const instruments = block.instruments || [];

  // Inline piped text: each {{answer:<id>}} becomes that block's current
  // answer (a dash until it's answered). Done first, so the instruments
  // below see the question as the respondent will read it.
  const pipe = (id) => formatAnswerForPipe(answers[id]);
  if (typeof config?.question === 'string') config = { ...config, question: resolvePipes(config.question, pipe) };
  if (typeof config?.content === 'string') config = { ...config, content: resolvePipes(config.content, pipe) };

  const subset = instruments.find((i) => i.type === 'subset_randomizer');
  if (subset && Array.isArray(config?.options)) {
    const count = Math.min(subset.config?.count ?? 2, config.options.length);
    const shuffled = seededShuffle(config.options, `${respondentId}:${block.id}:subset`);
    config = { ...config, options: shuffled.slice(0, count) };
  }

  const randomizer = instruments.find((i) => i.type === 'option_randomizer');
  if (randomizer && Array.isArray(config?.options)) {
    config = { ...config, options: seededShuffle(config.options, `${respondentId}:${block.id}`) };
  }

  const instructedResponse = instruments.find((i) => i.type === 'instructed_response');
  if (instructedResponse && config?.question) {
    const instruction = instructedResponse.config?.instruction_text || 'For quality purposes, please select this option.';
    config = { ...config, question: `${config.question} (${instruction})` };
  }

  // A no-op until the source block actually has an answer — a respondent
  // who reaches the piped block before answering the source one just sees
  // the question as written, no placeholder text.
  const pipedText = instruments.find((i) => i.type === 'piped_text');
  const sourceAnswer = pipedText && answers[pipedText.config?.source_block_id];
  if (pipedText && sourceAnswer && config?.question) {
    config = { ...config, question: `"${sourceAnswer}" — ${config.question}` };
  }

  return config;
};

const StudioRunnerPage = () => {
  const { projectId } = useParams();
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [answers, setAnswers] = useState({});
  const [instrumentValues, setInstrumentValues] = useState({});
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState('');
  // "Request a response" blocks the respondent left blank on their last
  // Submit. Non-null = the soft prompt is showing; a second Submit goes through.
  const [nudgedIds, setNudgedIds] = useState(null);
  const [now, setNow] = useState(() => performance.now());
  // Lazy initializer — getRespondentId() runs once, not on every render.
  const [respondentId] = useState(getRespondentId);
  // Embedded Data — whatever URL query params this respondent arrived with
  // (Qualtrics-style), captured once and sent along with the submission for
  // later segmentation. Backend sanitizes/caps it; this is just capture.
  const [embeddedData] = useState(() => Object.fromEntries(new URLSearchParams(window.location.search)));

  useEffect(() => {
    let cancelled = false;
    apiClient.get(`/studio/public/projects/${projectId}`)
      .then(({ data }) => { if (!cancelled) setProject(data); })
      .catch(() => { if (!cancelled) setLoadError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId]);

  const blocks = useMemo(() => project?.pages?.[0]?.blocks || [], [project]);
  const shownAtRef = useRef({});

  // Display logic, re-evaluated on every answer change. A block whose
  // condition flips back off disappears again, and so does its answer from
  // the submission (see handleSubmit) — mirrors the server's visible_block_ids.
  const visibleIds = useMemo(() => visibleBlockIds(blocks, answers), [blocks, answers]);
  const visibleBlocks = useMemo(() => blocks.filter((b) => visibleIds.has(b.id)), [blocks, visibleIds]);

  // "Shown" is stamped once, the first time each event-needing block becomes
  // visible — page load for most, or the moment display logic reveals it.
  // Skips blocks already stamped so a re-render never resets the clock.
  useEffect(() => {
    const shownAt = performance.now();
    visibleBlocks.forEach((blk) => {
      if (blockNeedsEvents(blk) && !(blk.id in shownAtRef.current)) {
        shownAtRef.current[blk.id] = shownAt;
      }
    });
  }, [visibleBlocks]);

  const setAnswer = (blockId, value) => {
    setAnswers((prev) => ({ ...prev, [blockId]: value }));
    setErrors((prev) => (prev[blockId] ? { ...prev, [blockId]: undefined } : prev));
    setNudgedIds((prev) => (prev && prev.includes(blockId) ? prev.filter((id) => id !== blockId) : prev));
  };

  const setInstrumentValue = (blockId, instrumentType, value) => {
    setInstrumentValues((prev) => ({
      ...prev,
      [blockId]: { ...prev[blockId], [instrumentType]: value },
    }));
  };

  // Read-Time Gate: disable Submit until every gated block's `seconds` has
  // elapsed since it was shown. Only ticks (200ms) while a gate is actually
  // active on this project — zero polling cost for the common case of none.
  const gateInstruments = useMemo(() => (
    visibleBlocks.flatMap((blk) => (blk.instruments || [])
      .filter((i) => i.type === 'read_time_gate')
      .map((i) => ({ blockId: blk.id, seconds: i.config?.seconds ?? 5 })))
  ), [visibleBlocks]);

  useEffect(() => {
    if (gateInstruments.length === 0) return;
    const id = setInterval(() => setNow(performance.now()), 200);
    return () => clearInterval(id);
  }, [gateInstruments.length]);

  const gateRemainingMs = gateInstruments.reduce((max, g) => {
    const shownAt = shownAtRef.current[g.blockId];
    if (shownAt === undefined) return max;
    return Math.max(max, (shownAt + g.seconds * 1000) - now);
  }, 0);
  const gateActive = gateRemainingMs > 0;

  // Checks run in order of severity: hard errors (required, the block's own
  // answer rules) stop the submit outright; only once those are clear does
  // the soft "request a response" prompt get a turn, and only once — the
  // second Submit while it's showing goes through.
  const handleSubmit = async () => {
    const nextErrors = {};
    visibleBlocks.forEach((blk) => {
      const value = answers[blk.id];
      if (blk.config?.required && !isAnswered(value)) {
        nextErrors[blk.id] = 'This question is required.';
        return;
      }
      const problem = answerProblem(blk, value);
      if (problem) nextErrors[blk.id] = problem;
    });
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      setNudgedIds(null);
      return;
    }

    if (nudgedIds === null) {
      const skipped = visibleBlocks
        .filter((blk) => blk.config?.request_response && !isAnswered(answers[blk.id]))
        .map((blk) => blk.id);
      if (skipped.length > 0) {
        setNudgedIds(skipped);
        return;
      }
    }

    setSubmitting(true);
    setSubmitError('');
    const submitAt = performance.now();
    const blockIds = new Set(
      [...Object.keys(answers), ...Object.keys(instrumentValues)].filter((id) => visibleIds.has(id)),
    );
    try {
      await apiClient.post(`/studio/public/projects/${projectId}/responses`, {
        respondent_id: respondentId,
        embedded_data: embeddedData,
        answers: Array.from(blockIds).map((block_id) => {
          const entry = { block_id, value: answers[block_id] };
          const blk = blocks.find((b) => b.id === block_id);
          if (blk && blockNeedsEvents(blk)) {
            entry.events = [
              { type: 'shown', at: shownAtRef.current[block_id] ?? submitAt },
              { type: 'submit', at: submitAt },
            ];
          }
          if (instrumentValues[block_id] && Object.keys(instrumentValues[block_id]).length > 0) {
            entry.instrument_values = instrumentValues[block_id];
          }
          return entry;
        }),
      });
      setSubmitted(true);
    } catch (err) {
      if (err.response?.status === 429) {
        setSubmitError('Please wait a moment before submitting again.');
      } else if (err.response?.status === 400 && err.response.data?.block_ids) {
        const serverErrors = {};
        err.response.data.block_ids.forEach((id) => { serverErrors[id] = 'This question is required.'; });
        setErrors(serverErrors);
      } else {
        setSubmitError('Something went wrong submitting your response. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F7F8FA]">
        <FaSpinner className="animate-spin text-2xl text-gray-400" />
      </div>
    );
  }

  if (loadError || !project) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F7F8FA] px-6" style={{ fontFamily: FONT_BODY }}>
        <p className="text-gray-500 text-center">This form isn&rsquo;t available. It may be unpublished or no longer exist.</p>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#F7F8FA] px-6 text-center gap-3" style={{ fontFamily: FONT_BODY }}>
        <FaCheckCircle className="text-4xl animate-chip-in" style={{ color: '#1E7A3D' }} />
        <h1 className="text-lg font-bold animate-chip-in" style={{ color: '#1F1F1F', animationDelay: '120ms' }}>
          Thanks for your response!
        </h1>
        <p className="text-sm text-gray-500 animate-chip-in" style={{ animationDelay: '200ms' }}>
          You can close this window now.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F7F8FA] py-12 px-6" style={{ fontFamily: FONT_BODY }}>
      <div className="max-w-xl mx-auto">
        <div className="mb-6">
          <h1 className="text-xl font-bold mb-1.5" style={{ color: '#1F1F1F' }}>{project.title}</h1>
          {project.description && <p className="text-sm text-gray-500">{project.description}</p>}
        </div>

        <div className="flex flex-col gap-4">
          {visibleBlocks.map((block, idx) => {
            const Component = getBlockComponent(block.type);
            if (!Component) return null;

            const effectiveConfig = applyBehaviorInstruments(block, respondentId, answers);
            const answered = isAnswered(answers[block.id]);
            const nudged = nudgedIds?.includes(block.id);

            return (
              <div
                key={block.id}
                className={`bg-white rounded-2xl border shadow-sm animate-chip-in transition-colors duration-300 ${
                  nudged ? 'border-[#E0A100]/50' : answered ? 'border-[#FA6C43]/25' : 'border-gray-200'
                }`}
                style={{ animationDelay: `${Math.min(idx, 8) * 40}ms` }}
              >
                <Component
                  config={effectiveConfig}
                  mode="respond"
                  blockId={block.id}
                  value={answers[block.id]}
                  onAnswer={(v) => setAnswer(block.id, v)}
                  error={errors[block.id]}
                />
                {(block.instruments || []).map((inst) => {
                  const RespondExtra = getInstrumentRespondExtra(inst.type);
                  if (!RespondExtra) return null;
                  return (
                    <RespondExtra
                      key={inst.id}
                      value={instrumentValues[block.id]?.[inst.type]}
                      onChange={(v) => setInstrumentValue(block.id, inst.type, v)}
                      answerValue={answers[block.id]}
                      question={effectiveConfig?.question}
                      projectId={projectId}
                      blockId={block.id}
                    />
                  );
                })}
                {nudged && (
                  <p className="px-4 pb-3 -mt-1 text-xs" style={{ color: '#8A5A00' }}>
                    You haven&rsquo;t answered this one. Answering helps the research, but it&rsquo;s up to you.
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {nudgedIds?.length > 0 && (
          <p className="text-sm mt-4 px-4 py-3 rounded-xl" style={{ backgroundColor: '#FFF6E5', color: '#8A5A00' }}>
            {nudgedIds.length === 1 ? 'One question is' : `${nudgedIds.length} questions are`} still unanswered.
            Answer {nudgedIds.length === 1 ? 'it' : 'them'} above, or submit anyway.
          </p>
        )}

        {submitError && (
          <p className="text-sm mt-4" style={{ color: '#E5484D' }}>{submitError}</p>
        )}

        <button
          onClick={handleSubmit}
          disabled={submitting || gateActive}
          className="w-full mt-6 py-3 rounded-xl font-bold text-sm transition-all active:scale-[0.99] hover:shadow-lg disabled:opacity-60 disabled:hover:shadow-none"
          style={{ backgroundColor: '#FA6C43', color: '#FFFFFF' }}
        >
          {submitting
            ? <FaSpinner className="animate-spin inline" />
            : gateActive
              ? `Please wait ${Math.ceil(gateRemainingMs / 1000)}s…`
              : nudgedIds?.length > 0 ? 'Submit anyway' : 'Submit'}
        </button>
      </div>
    </div>
  );
};

export default StudioRunnerPage;
