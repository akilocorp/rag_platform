// @language  JavaScript (React / JSX)
// @updated   2026-08-24
// @changed   Hide/Show per box: a hidden box collapses to a single grey row and drops out of
//            scoring (persisted as `hidden` and enforced server-side); active boxes now carry a
//            green left-accent so it reads at a glance which ones still count.
// @changed   Prior: Cards are read-only until you press Edit. The fields used to be transparent inputs sitting
//            in the card, which read as plain text — you could edit them without ever knowing you could.
//            Edit is now a visible button, and it swaps the card for a labelled form with Delete + Done.
// @changed   Prior: New page: edit a video config's scoring boxes and content checks inside a replica of
//            the student's results report, so a professor sees the thing they are editing.
import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { FaTrash, FaPlus, FaArrowLeft, FaSpinner, FaCheck, FaPen, FaEye, FaEyeSlash } from 'react-icons/fa';
import apiClient from '../api/apiClient';

/**
 * The visual rubric editor at /video-boxes/:configId.
 *
 * WHY IT LOOKS LIKE THE RESULTS PAGE
 *   The old editor was a stack of grey form rows in Advanced mode, and nothing about
 *   it told a professor what a "box" or a "content check" actually becomes. Here the
 *   card IS the card the student gets — same shell, same type scale, same score-out-of-ten
 *   on the right, same two-column grid for the checks. The markup is deliberately kept
 *   in step with `VideoResultsPage.jsx` (DimensionCard, ComponentCard); if that page's
 *   card changes, this one should change with it.
 *
 * VIEW FIRST, THEN EDIT
 *   Every card is read-only until its Edit button is pressed. The first version made the
 *   name and definition into borderless inputs living in the card, which looked exactly
 *   like text: you could edit them, but nothing said so, and the definition picked up a
 *   spellcheck underline that made the preview look broken. Read-only also means the
 *   preview is honest — what you see is what the student sees, with no input chrome in it.
 *
 * THE SCORES ARE FAKE, AND SAY SO
 *   A real score only exists after a student submits, but a card with an empty right-hand
 *   side does not read as the student's card — the number is the loudest thing on it. So
 *   the preview carries fixed sample numbers in grey, under a "sample scores" chip.
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

const FIELD =
  'w-full px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none ' +
  'focus:ring-2 focus:ring-[#F9D0C4] focus:border-[#FA6C43] transition-all';
const LABEL = 'block text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-1.5';

// The Edit affordance. Always visible — a control that appears on hover is the same
// problem as no control at all for anyone who does not happen to hover the right card.
function EditButton({ onClick, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 text-xs font-bold text-gray-500 hover:text-[#FA6C43] bg-gray-50 hover:bg-[#FFF3EF] border border-gray-200 hover:border-[#FA6C43] rounded-lg px-2.5 py-1.5 transition-all shrink-0"
    >
      <FaPen className="text-[10px]" /> {label}
    </button>
  );
}

// Hide/show affordance. Hiding doesn't delete a box — it stops counting toward
// grading (enforced server-side) and collapses the card so a professor isn't
// scrolling past boxes they've already decided not to use.
function HideButton({ hidden, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={hidden ? 'Show this box again — it will count toward scoring' : 'Hide — stops counting toward scoring'}
      className={`flex items-center gap-1.5 text-xs font-bold rounded-lg px-2.5 py-1.5 border transition-all shrink-0 ${
        hidden
          ? 'text-[#FA6C43] bg-[#FFF3EF] border-[#FA6C43]/30 hover:bg-[#FFE8E0]'
          : 'text-gray-500 bg-gray-50 hover:bg-gray-100 border-gray-200 hover:border-gray-300'
      }`}
    >
      {hidden ? <FaEye className="text-[10px]" /> : <FaEyeSlash className="text-[10px]" />}
      {hidden ? 'Show' : 'Hide'}
    </button>
  );
}

// Shared footer for a card in edit mode: destructive action far left, confirm right.
function EditActions({ onDelete, onDone, deleteLabel }) {
  return (
    <div className="flex items-center justify-between pt-1">
      <button
        type="button"
        onClick={onDelete}
        className="flex items-center gap-1.5 text-xs font-bold text-gray-400 hover:text-red-500 transition-colors"
      >
        <FaTrash className="text-[10px]" /> {deleteLabel}
      </button>
      <button
        type="button"
        onClick={onDone}
        className="text-xs font-bold text-white bg-[#FA6C43] hover:bg-[#e85f38] rounded-lg px-4 py-2 transition-all"
      >
        Done
      </button>
    </div>
  );
}

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
  // Index of the card currently open for editing, or null. One at a time: several
  // open forms turn the page back into the wall of grey rows this replaced.
  const [editingDim, setEditingDim] = useState(null);
  const [editingCheck, setEditingCheck] = useState(null);

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
  // A new box opens straight into edit mode — it has no name yet, so there is
  // nothing to look at and exactly one thing to do.
  const addDim = () => {
    setDimensions((prev) => [...prev, { id: '', name: '', definition: '' }]);
    setEditingDim(dimensions.length);
    touch();
  };
  const removeDim = (idx) => {
    setDimensions((prev) => prev.filter((_, i) => i !== idx));
    setEditingDim(null);
    touch();
  };
  const toggleDimHidden = (idx) => {
    setDimensions((prev) => prev.map((d, i) => (i === idx ? { ...d, hidden: !d.hidden } : d)));
    touch();
  };

  const setCheck = (idx, field, value) => {
    setChecks((prev) => prev.map((c, i) => (i === idx ? { ...c, [field]: value } : c)));
    touch();
  };
  const addCheck = () => {
    setChecks((prev) => [...prev, { id: '', label: '', description: '' }]);
    setEditingCheck(checks.length);
    touch();
  };
  const removeCheck = (idx) => {
    setChecks((prev) => prev.filter((_, i) => i !== idx));
    setEditingCheck(null);
    touch();
  };
  const toggleCheckHidden = (idx) => {
    setChecks((prev) => prev.map((c, i) => (i === idx ? { ...c, hidden: !c.hidden } : c)));
    touch();
  };

  const save = async () => {
    setSaving(true); setError(null);
    try {
      const res = await apiClient.put(`/video/config/${configId}/scoring-spec`, {
        dimensions, content_checks: checks,
      });
      // Take the server's normalized rows back: it assigns ids to new boxes and drops
      // unnamed ones, so the page would otherwise show something that was not saved.
      const spec = res.data?.scoring_spec || {};
      setDimensions(spec.dimensions || []);
      setChecks(spec.content_checks || []);
      setEditingDim(null); setEditingCheck(null);
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
            This is your students' report. Every box is scored out of 10 with a short written
            rationale — press <span className="font-semibold text-gray-700">Edit</span> on any card to
            change its name or what it measures, then Save.
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
              {(() => {
                const active = dimensions.filter((d) => d.name && !d.hidden).map((d) => d.name);
                return active.length
                  ? `Delivery and content, weighed together (${active.join(', ')})`
                  : 'Delivery and content, weighed together';
              })()}
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

        {/* ── The student's DimensionCard, read-only, with an Edit button ── */}
        <div className="space-y-4 mb-4">
          {dimensions.map((d, idx) => (
            <div
              key={idx}
              className={`bg-white rounded-2xl shadow-sm transition-all ${
                editingDim === idx
                  ? 'border-2 border-[#FA6C43] p-5'
                  : d.hidden
                    ? 'border border-gray-200 bg-gray-50 opacity-60 p-4'
                    : 'border border-gray-100 border-l-4 border-l-emerald-400 p-5'
              }`}
            >
              {editingDim === idx ? (
                <div className="space-y-4">
                  <div>
                    <label className={LABEL}>Box name</label>
                    <input
                      autoFocus
                      value={d.name || ''}
                      onChange={(e) => setDim(idx, 'name', e.target.value)}
                      placeholder="e.g. Confidence"
                      className={`${FIELD} font-semibold`}
                    />
                  </div>
                  <div>
                    <label className={LABEL}>What it measures</label>
                    <textarea
                      rows="3"
                      value={d.definition || ''}
                      onChange={(e) => setDim(idx, 'definition', e.target.value)}
                      placeholder="e.g. 'How composed and assured the speaker appears — steady gaze, grounded posture, a steady voice.'"
                      className={FIELD}
                    />
                    <p className="text-[11px] text-gray-400 mt-1.5">
                      The AI grades against exactly what you write here, and students read it under the box name.
                    </p>
                  </div>
                  <EditActions
                    deleteLabel="Delete this box"
                    onDelete={() => removeDim(idx)}
                    onDone={() => setEditingDim(null)}
                  />
                </div>
              ) : d.hidden ? (
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-semibold text-gray-400 truncate">{d.name || 'Untitled box'}</h3>
                    <p className="text-[11px] font-bold uppercase tracking-wider text-gray-300 mt-0.5">Hidden — not scored</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <EditButton label="Edit" onClick={() => { setEditingDim(idx); setEditingCheck(null); }} />
                    <HideButton hidden onClick={() => toggleDimHidden(idx)} />
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-start justify-between mb-3 gap-3">
                    <div className="min-w-0 flex-1">
                      <h3 className="text-base font-bold text-[#222]">{d.name || <span className="text-gray-300">Untitled box</span>}</h3>
                      {d.definition
                        ? <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{d.definition}</p>
                        : <p className="text-xs text-gray-300 italic mt-0.5">No definition yet — press Edit to describe what this measures.</p>}
                    </div>
                    <div className="flex items-start gap-3 shrink-0">
                      <div className="flex items-center gap-2">
                        <EditButton label="Edit" onClick={() => { setEditingDim(idx); setEditingCheck(null); }} />
                        <HideButton onClick={() => toggleDimHidden(idx)} />
                      </div>
                      <div className="text-right">
                        <span className="text-3xl font-extrabold" style={{ color: PREVIEW_GREY }}>
                          {sampleFor(idx).toFixed(1)}
                        </span>
                        <span className="text-sm text-gray-300 font-bold"> / 10</span>
                      </div>
                    </div>
                  </div>
                  <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden mb-3">
                    <div className="h-full rounded-full" style={{ width: `${sampleFor(idx) * 10}%`, background: PREVIEW_GREY }} />
                  </div>
                  <p className="text-sm text-gray-300 italic">
                    The AI writes a short rationale here for each student.
                  </p>
                </>
              )}
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

        {/* ── Content checks: the student's two-column grid ── */}
        <h2 className="text-base font-bold text-[#222] mb-1">Content Checks</h2>
        <p className="text-xs text-gray-500 mb-3">
          Graded against the transcript — did they actually say it. Students see the name and the
          score; the definition is yours, and only the AI reads it.
        </p>
        <div className="grid sm:grid-cols-2 gap-3 mb-8">
          {checks.map((c, idx) => (
            <div
              key={idx}
              className={`bg-white rounded-2xl shadow-sm transition-all ${
                editingCheck === idx
                  ? 'border-2 border-[#FA6C43] p-4'
                  : c.hidden
                    ? 'border border-gray-200 bg-gray-50 opacity-60 p-4'
                    : 'border border-gray-100 border-l-4 border-l-emerald-400 p-4'
              }`}
            >
              {editingCheck === idx ? (
                <div className="space-y-3">
                  <div>
                    <label className={LABEL}>Check name</label>
                    <input
                      autoFocus
                      value={c.label || ''}
                      onChange={(e) => setCheck(idx, 'label', e.target.value)}
                      placeholder="e.g. Opening hook"
                      className={`${FIELD} font-semibold`}
                    />
                  </div>
                  <div>
                    <label className={LABEL}>What satisfies it</label>
                    <textarea
                      rows="3"
                      value={c.description || ''}
                      onChange={(e) => setCheck(idx, 'description', e.target.value)}
                      placeholder="e.g. 'Opens with a question, statistic or story rather than a name and title.'"
                      className={FIELD}
                    />
                  </div>
                  <EditActions
                    deleteLabel="Delete"
                    onDelete={() => removeCheck(idx)}
                    onDone={() => setEditingCheck(null)}
                  />
                </div>
              ) : c.hidden ? (
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <span className="text-sm font-semibold text-gray-400 truncate block">{c.label || 'Untitled check'}</span>
                    <span className="text-[11px] font-bold uppercase tracking-wider text-gray-300">Hidden — not scored</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <EditButton label="Edit" onClick={() => { setEditingCheck(idx); setEditingDim(null); }} />
                    <HideButton hidden onClick={() => toggleCheckHidden(idx)} />
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-start justify-between mb-2 gap-2">
                    <span className="text-sm font-bold text-[#222] min-w-0 flex-1">
                      {c.label || <span className="text-gray-300">Untitled check</span>}
                    </span>
                    <span className="text-2xl font-extrabold shrink-0" style={{ color: PREVIEW_GREY }}>
                      {sampleFor(idx + 2).toFixed(1)}
                    </span>
                  </div>
                  <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden mb-2.5">
                    <div className="h-full rounded-full" style={{ width: `${sampleFor(idx + 2) * 10}%`, background: PREVIEW_GREY }} />
                  </div>
                  <div className="flex items-end justify-between gap-2">
                    <p className="text-xs text-gray-400 leading-relaxed min-w-0 flex-1">
                      {c.description || <span className="text-gray-300 italic">No definition yet.</span>}
                    </p>
                    <div className="flex items-center gap-2 shrink-0">
                      <EditButton label="Edit" onClick={() => { setEditingCheck(idx); setEditingDim(null); }} />
                      <HideButton onClick={() => toggleCheckHidden(idx)} />
                    </div>
                  </div>
                </>
              )}
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
