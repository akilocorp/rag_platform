// @language JavaScript (React / JSX)
// @updated   2026-09-07
// @changed   Phase 2: records event timestamps (performance.now(), monotonic + high-resolution —
//            not wall-clock, which a respondent's system clock could skew) for any block whose
//            attached instrument needs them (server-enriched `needs_events` flag from the public
//            project payload, since an anonymous respondent has no access to the faculty-scoped
//            instrument registry). Only `shown` (page load, since all blocks render at once —
//            there's no progressive per-block reveal yet) and `submit` are captured, because
//            Reaction Timer is the only instrument that exists and that's all it reads; richer
//            event types (focus/blur/change) get added when an instrument actually consumes them.
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

const StudioRunnerPage = () => {
  const { projectId } = useParams();
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [answers, setAnswers] = useState({});
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState('');

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

  // "Shown" is stamped once, the first time each event-needing block is seen
  // — currently that's page load, since every block on the page renders at
  // once. Skips blocks already stamped so a re-render never resets the clock.
  useEffect(() => {
    const now = performance.now();
    blocks.forEach((blk) => {
      if (blockNeedsEvents(blk) && !(blk.id in shownAtRef.current)) {
        shownAtRef.current[blk.id] = now;
      }
    });
  }, [blocks]);

  const setAnswer = (blockId, value) => {
    setAnswers((prev) => ({ ...prev, [blockId]: value }));
    setErrors((prev) => (prev[blockId] ? { ...prev, [blockId]: undefined } : prev));
  };

  const handleSubmit = async () => {
    const nextErrors = {};
    blocks.forEach((blk) => {
      if (!blk.config?.required) return;
      const val = answers[blk.id];
      if (val === undefined || val === null || (typeof val === 'string' && !val.trim())) {
        nextErrors[blk.id] = 'This question is required.';
      }
    });
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    setSubmitting(true);
    setSubmitError('');
    const submitAt = performance.now();
    try {
      await apiClient.post(`/studio/public/projects/${projectId}/responses`, {
        respondent_id: getRespondentId(),
        answers: Object.entries(answers).map(([block_id, value]) => {
          const entry = { block_id, value };
          const blk = blocks.find((b) => b.id === block_id);
          if (blk && blockNeedsEvents(blk)) {
            entry.events = [
              { type: 'shown', at: shownAtRef.current[block_id] ?? submitAt },
              { type: 'submit', at: submitAt },
            ];
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
        <FaCheckCircle className="text-4xl" style={{ color: '#1E7A3D' }} />
        <h1 className="text-lg font-bold" style={{ color: '#1F1F1F' }}>Thanks for your response!</h1>
        <p className="text-sm text-gray-500">You can close this window now.</p>
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
          {blocks.map((block) => {
            const Component = getBlockComponent(block.type);
            if (!Component) return null;
            return (
              <div key={block.id} className="bg-white rounded-2xl border border-gray-200 shadow-sm">
                <Component
                  config={block.config}
                  mode="respond"
                  blockId={block.id}
                  value={answers[block.id]}
                  onAnswer={(v) => setAnswer(block.id, v)}
                  error={errors[block.id]}
                />
              </div>
            );
          })}
        </div>

        {submitError && (
          <p className="text-sm mt-4" style={{ color: '#E5484D' }}>{submitError}</p>
        )}

        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="w-full mt-6 py-3 rounded-xl font-bold text-sm transition-all active:scale-[0.99] disabled:opacity-60"
          style={{ backgroundColor: '#FA6C43', color: '#FFFFFF' }}
        >
          {submitting ? <FaSpinner className="animate-spin inline" /> : 'Submit'}
        </button>
      </div>
    </div>
  );
};

export default StudioRunnerPage;
