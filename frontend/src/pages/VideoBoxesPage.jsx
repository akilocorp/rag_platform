// @language  JavaScript (React / JSX)
// @updated   2026-08-24
// @changed   New page: edit a video config's scoring boxes and content checks inside a replica of the
//            student's results report, so a professor sees the thing they are editing.
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { FaTrash, FaPlus, FaArrowLeft, FaSpinner, FaCheck } from 'react-icons/fa';
import apiClient from '../api/apiClient';

/**
 * The visual rubric editor at /video-boxes/:configId.
 *
 * WHY IT LOOKS LIKE THE RESULTS PAGE
 *   The old editor was a stack of grey form rows in Advanced mode, and nothing about
 *   it told a professor what a "box" or a "content check" actually becomes. Here the
 *   card IS the card the student gets — same shell, same type scale, same score-out-of-ten
 *   on the right, same two-column grid for the checks — with the name and definition
 *   turned into fields. The markup is deliberately kept in step with
 *   `VideoResultsPage.jsx` (DimensionCard, ComponentCard); if that page's card changes,
 *   this one should change with it.
 *
 * THE SCORES ARE FAKE, AND SAY SO
 *   A real score only exists after a student submits, but a card with an empty right-hand
 *   side does not read as the student's card at all — the number is the loudest thing on
 *   it. So the preview carries fixed sample numbers in grey, under a "sample scores" chip.
 *
 * SAVING
 *   Through PUT /video/config/:id/scoring-spec, which writes `scoring_spec` and nothing
 *   else. The generic config PUT rebuilds the whole document from the edit form and would
 *   blank every field this page does not know about.
 */

// Sample numbers for the preview, cycled by position. Deliberately not random: a
// number that changes on every render looks like live data being recomputed.
const SAMPLE = [8.4, 7.1, 9.0, 6.5, 7.8, 8.9];
const sampleFor = (i) => SAMPLE[i % SAMPLE.length];

// Grey, not the results page's red/amber/green scale — a sample must never look
// like a verdict on anything.
const PREVIEW_GREY = '#cbd5e1';

export default function VideoBoxesPage() {
  const { configId } = useParams();
  const navigate = useNavigate();

  const [botName, setBotName] = useState('');
  const [dimensions, setDimensions] = useState([]);
  const [checks, setChecks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [savedAt, setSavedAt] = useState(null);
  const [dirty, setDirty] = useState(false);
  const addedRef = useRef(null);   // focuses the name field of a freshly added row

  useEffect(() => {
    let alive = true;
    apiClient.get(`/video/config/${configId}/scoring-spec`)
      .then((res) => {
        if (!alive) return;
        const spec = res.data?.scoring_spec || {};
        setBotName(res.data?.bot_name || '');
        setDimensions(spec.dimensions || []);
        setChecks(spec.content_checks || []);
      })
      .catch((e) => alive && setError(e?.response?.data?.error || 'Could not load this rubric.'))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [configId]);

  // Browser-level guard only. An in-app router prompt would need a blocker hook the
  // rest of this app does not use, and losing a rubric edit to a stray back button is
  // the one mistake worth interrupting.
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const touch = () => { setDirty(true); setSavedAt(null); };

  const setDim = (idx, field, value) => {
    setDimensions((prev) => prev.map((d, i) => (i === idx ? { ...d, [field]: value } : d)));
    touch();
  };
  const addDim = () => {
    setDimensions((prev) => [...prev, { id: '', name: '', definition: '' }]);
    addedRef.current = `dim-${dimensions.length}`;
    touch();
  };
  const removeDim = (idx) => { setDimensions((prev) => prev.filter((_, i) => i !== idx)); touch(); };

  const setCheck = (idx, field, value) => {
    setChecks((prev) => prev.map((c, i) => (i === idx ? { ...c, [field]: value } : c)));
    touch();
  };
  const addCheck = () => {
    setChecks((prev) => [...prev, { id: '', label: '', description: '' }]);
    addedRef.current = `check-${checks.length}`;
    touch();
  };
  const removeCheck = (idx) => { setChecks((prev) => prev.filter((_, i) => i !== idx)); touch(); };

  const save = async () => {
    setSaving(true); setError(null);
    try {
      const res = await apiClient.put(`/video/config/${configId}/scoring-spec`, {
        dimensions, content_checks: checks,
      });
      // Take the server's normalized rows back: it assigns ids to new boxes and drops
      // unnamed ones, so the page would otherwise be showing something that was not saved.
      const spec = res.data?.scoring_spec || {};
      setDimensions(spec.dimensions || []);
      setChecks(spec.content_checks || []);
      setDirty(false);
      setSavedAt(Date.now());
    } catch (e) {
      setError(e?.response?.data?.error || 'Could not save. Your edits are still here — try again.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F0F6FB] flex items-center justify-center">
        <p className="text-sm text-gray-500 flex items-center gap-2">
          <FaSpinner className="animate-spin text-[#FA6C43]" /> Loading the rubric…
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F0F6FB]" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
      {/* Sticky action bar — Save has to stay reachable however long the rubric gets. */}
      <div className="sticky top-0 z-20 bg-[#F0F6FB]/95 backdrop-blur border-b border-gray-200/70">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => navigate('/config_list')}
            className="text-gray-400 hover:text-gray-700 p-2 -ml-2 shrink-0"
            title="Back to your classes"
          >
            <FaArrowLeft />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="text-base font-bold text-[#222] truncate">Scoring boxes</h1>
            <p className="text-xs text-gray-500 truncate">{botName || 'Video assignment'}</p>
          </div>
          {savedAt && !dirty && (
            <span className="text-xs font-semibold text-green-600 flex items-center gap-1.5 shrink-0">
              <FaCheck className="text-[10px]" /> Saved
            </span>
          )}
          <button
            onClick={save}
            disabled={saving || !dirty}
            className={`px-5 py-2 rounded-xl text-sm font-bold shrink-0 transition-all ${
              dirty && !saving
                ? 'bg-[#FA6C43] text-white hover:bg-[#e85f38]'
                : 'bg-gray-200 text-gray-400 cursor-not-allowed'
            }`}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-6">
        <div className="mb-6">
          <p className="text-sm text-gray-600 leading-relaxed">
            This is your students' report. Every box below is scored out of 10 with a short written
            rationale — edit a name or a definition in place, and the AI evaluator grades against
            whatever you write here.
          </p>
          {error && (
            <p className="mt-3 text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-2.5">{error}</p>
          )}
        </div>

        {/* ── Overall banner — not editable, shown so the boxes sit in their real context ── */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-5 flex items-center justify-between opacity-90">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-wider text-gray-400">Overall Score</p>
            <p className="text-sm text-gray-500 mt-0.5 truncate">
              {dimensions.filter((d) => d.name).length
                ? `Delivery and content, weighed together (${dimensions.map((d) => d.name).filter(Boolean).join(', ')})`
                : 'Delivery and content, weighed together'}
            </p>
          </div>
          <div className="text-right shrink-0 ml-4">
            <span className="text-5xl font-extrabold" style={{ color: PREVIEW_GREY }}>7.9</span>
            <span className="text-lg text-gray-300 font-bold"> / 10</span>
          </div>
        </div>

        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-bold text-[#222]">Scoring boxes</h2>
          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 bg-gray-100 rounded-full px-2.5 py-1">
            sample scores
          </span>
        </div>

        {/* ── The student's DimensionCard, with name and definition made editable ── */}
        <div className="space-y-4 mb-4">
          {dimensions.map((d, idx) => (
            <div key={idx} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 group">
              <div className="flex items-start justify-between mb-3 gap-3">
                <div className="flex-1 min-w-0">
                  <input
                    autoFocus={addedRef.current === `dim-${idx}`}
                    value={d.name || ''}
                    onChange={(e) => setDim(idx, 'name', e.target.value)}
                    placeholder="Box name (e.g. Confidence)"
                    className="w-full text-base font-bold text-[#222] bg-transparent border border-transparent hover:border-gray-200 focus:border-[#FA6C43] focus:bg-white rounded-lg px-2 py-1 -ml-2 outline-none transition-all placeholder:text-gray-300"
                  />
                  <textarea
                    rows="2"
                    value={d.definition || ''}
                    onChange={(e) => setDim(idx, 'definition', e.target.value)}
                    placeholder="What does this box measure? e.g. 'How composed and assured the speaker appears — steady gaze, grounded posture, a steady voice.'"
                    className="w-full mt-1 text-xs text-gray-500 leading-relaxed bg-transparent border border-transparent hover:border-gray-200 focus:border-[#FA6C43] focus:bg-white rounded-lg px-2 py-1 -ml-2 outline-none resize-none transition-all placeholder:text-gray-300"
                  />
                </div>
                <div className="text-right shrink-0 flex items-start gap-2">
                  <div>
                    <span className="text-3xl font-extrabold" style={{ color: PREVIEW_GREY }}>
                      {sampleFor(idx).toFixed(1)}
                    </span>
                    <span className="text-sm text-gray-300 font-bold"> / 10</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeDim(idx)}
                    title="Delete this box"
                    className="text-gray-300 hover:text-red-500 p-1.5 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                  >
                    <FaTrash className="text-sm" />
                  </button>
                </div>
              </div>
              <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden mb-3">
                <div className="h-full rounded-full" style={{ width: `${sampleFor(idx) * 10}%`, background: PREVIEW_GREY }} />
              </div>
              <p className="text-sm text-gray-300 italic">
                The AI writes a short rationale here for each student.
              </p>
            </div>
          ))}
        </div>

        {/* Add sits at the BOTTOM of the stack, where the next card would appear. */}
        <button
          type="button"
          onClick={addDim}
          className="w-full mb-8 rounded-2xl border-2 border-dashed border-gray-200 hover:border-[#FA6C43] hover:bg-[#FFF3EF] text-sm font-bold text-gray-400 hover:text-[#FA6C43] py-5 transition-all flex items-center justify-center gap-2"
        >
          <FaPlus className="text-xs" /> Add a scoring box
        </button>

        {/* ── Content checks: the student's two-column grid, made editable ── */}
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-base font-bold text-[#222]">Content Checks</h2>
        </div>
        <p className="text-xs text-gray-500 mb-3">
          Graded against the transcript — did they actually say it. Students see the name and the
          score; the definition is yours, and only the AI reads it.
        </p>
        <div className="grid sm:grid-cols-2 gap-3 mb-8">
          {checks.map((c, idx) => (
            <div key={idx} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 group">
              <div className="flex items-start justify-between mb-2 gap-2">
                <input
                  autoFocus={addedRef.current === `check-${idx}`}
                  value={c.label || ''}
                  onChange={(e) => setCheck(idx, 'label', e.target.value)}
                  placeholder="Check name (e.g. Opening hook)"
                  className="flex-1 min-w-0 text-sm font-bold text-[#222] bg-transparent border border-transparent hover:border-gray-200 focus:border-[#FA6C43] rounded-lg px-2 py-1 -ml-2 outline-none transition-all placeholder:text-gray-300"
                />
                <div className="flex items-start gap-1 shrink-0">
                  <span className="text-2xl font-extrabold" style={{ color: PREVIEW_GREY }}>
                    {sampleFor(idx + 2).toFixed(1)}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeCheck(idx)}
                    title="Delete this check"
                    className="text-gray-300 hover:text-red-500 p-1 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                  >
                    <FaTrash className="text-xs" />
                  </button>
                </div>
              </div>
              <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden mb-2.5">
                <div className="h-full rounded-full" style={{ width: `${sampleFor(idx + 2) * 10}%`, background: PREVIEW_GREY }} />
              </div>
              <textarea
                rows="2"
                value={c.description || ''}
                onChange={(e) => setCheck(idx, 'description', e.target.value)}
                placeholder="What satisfies this check?"
                className="w-full text-xs text-gray-500 leading-relaxed bg-gray-50 border border-transparent hover:border-gray-200 focus:border-[#FA6C43] focus:bg-white rounded-lg px-2 py-1.5 outline-none resize-none transition-all placeholder:text-gray-300"
              />
            </div>
          ))}

          {/* Add sits IN the grid, so it lands beside the last check rather than under it. */}
          <button
            type="button"
            onClick={addCheck}
            className="rounded-2xl border-2 border-dashed border-gray-200 hover:border-[#FA6C43] hover:bg-[#FFF3EF] text-sm font-bold text-gray-400 hover:text-[#FA6C43] py-8 transition-all flex items-center justify-center gap-2"
          >
            <FaPlus className="text-xs" /> Add a content check
          </button>
        </div>

        <p className="text-xs text-gray-400 mb-10">
          Changes apply to new submissions. To re-grade videos already submitted, use Rescore on the dashboard.
        </p>
      </div>
    </div>
  );
}
