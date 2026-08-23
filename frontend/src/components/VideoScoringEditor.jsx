// @language  JavaScript (React / JSX)
// @updated   2026-08-24
// @changed   Dropped the scoring-box and content-check row editors; both now live on the visual
//            /video-boxes/:configId page, which shows them as the student's own report. What is
//            left here is the rubric-doc dropzone, the assignment-type picker and the grading prompt.
// @changed   Prior: Add drag-and-drop rubric-document import — AI builds the scoring spec from a prof's doc.
import React, { useEffect, useRef, useState } from 'react';
import { FaFileUpload, FaSpinner } from 'react-icons/fa';
import apiClient from '../api/apiClient';
import AdvancedReveal from './AdvancedReveal';

/**
 * Assignment-type picker + editable scoring spec for video-analysis configs.
 * Presets come from the code-defined registry (GET /api/video/assignment-types);
 * selecting one pre-fills an editable spec that is stored on the config doc.
 *
 * Scoring "boxes" (dimensions) are fully prof-defined: name + definition. The
 * scoring agent reads whichever signals (delivery report and/or transcript) are
 * relevant to each definition — there is no per-source picker by design. Each
 * box renders on the results page as a score /10 + a one-paragraph rationale.
 * They are EDITED on `pages/VideoBoxesPage.jsx` (/video-boxes/:configId), not
 * here: a preset picker that also let you rewrite the preset was the confusing
 * part, and the boxes only make sense next to the report they produce.
 *
 * Props:
 *   assignmentType : string
 *   scoringSpec    : object | null
 *   onChange({ assignment_type, scoring_spec })
 *   advanced       : boolean — when false (faculty Simple mode) only the
 *                    assignment-type picker shows; the grading prompt is hidden.
 *   onMeta({ bot_name, introduction }) : optional — fired after a rubric-doc
 *                    import so the wizard can prefill class name / intro.
 */
export default function VideoScoringEditor({ assignmentType, scoringSpec, onChange, advanced = true, onMeta }) {
  const [presets, setPresets] = useState([]);
  const [loading, setLoading] = useState(true);
  // Rubric-doc import state: idle → importing → imported {bot_name, counts} | error
  const [importing, setImporting] = useState(false);
  const [importNote, setImportNote] = useState(null);
  const [importError, setImportError] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    let alive = true;
    apiClient.get('/video/assignment-types')
      .then((res) => {
        if (!alive) return;
        const list = res.data?.presets || [];
        setPresets(list);
        // Auto-select the first preset if nothing is configured yet.
        if (!assignmentType && list.length) {
          onChange({ assignment_type: list[0].key, scoring_spec: list[0].scoring_spec });
        }
      })
      .catch((e) => console.error('Failed to load assignment types', e))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectPreset = (key) => {
    const p = presets.find((x) => x.key === key);
    if (p) onChange({ assignment_type: key, scoring_spec: JSON.parse(JSON.stringify(p.scoring_spec)) });
  };

  // Send a dropped rubric document to the AI class builder; the returned
  // assignment_type + scoring_spec replace the current spec, and bot_name /
  // introduction are offered to the wizard via onMeta.
  const importRubricDoc = async (file) => {
    if (!file || importing) return;
    setImporting(true); setImportError(null); setImportNote(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await apiClient.post('/video/rubric-from-doc', form);
      const { bot_name, introduction, assignment_type, scoring_spec } = res.data || {};
      if (!scoring_spec) throw new Error('empty response');
      onChange({ assignment_type, scoring_spec });
      if (onMeta) onMeta({ bot_name, introduction });
      setImportNote({
        name: bot_name || file.name,
        boxes: (scoring_spec.dimensions || []).length,
        checks: (scoring_spec.content_checks || []).length,
      });
    } catch (e) {
      setImportError(e?.response?.data?.error || 'Could not build a class from that document.');
    } finally {
      setImporting(false);
    }
  };

  const spec = scoringSpec || {};

  const patch = (next) => onChange({ assignment_type: assignmentType, scoring_spec: { ...spec, ...next } });

  if (loading) {
    return <p className="text-sm text-gray-500 text-center py-8">Loading assignment types…</p>;
  }

  return (
    <div className="space-y-6">
      {/* Rubric-doc dropzone — prof drops their metrics/rubric document and the
          AI builds the whole class (name, intro, boxes, checks, grading prompt). */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); importRubricDoc(e.dataTransfer.files?.[0]); }}
        onClick={() => !importing && fileInputRef.current?.click()}
        className={`rounded-2xl border-2 border-dashed p-5 text-center cursor-pointer transition-all ${
          dragOver ? 'border-[#FA6C43] bg-[#FFF3EF]' : 'border-gray-200 bg-gray-50 hover:border-[#F9D0C4]'
        }`}
      >
        <input
          ref={fileInputRef} type="file" className="hidden" accept=".docx,.pdf,.txt,.md"
          onChange={(e) => { importRubricDoc(e.target.files?.[0]); e.target.value = ''; }}
        />
        {importing ? (
          <p className="text-sm text-gray-600 flex items-center justify-center gap-2">
            <FaSpinner className="animate-spin text-[#FA6C43]" /> Reading your rubric and building the class…
          </p>
        ) : (
          <>
            <p className="text-sm font-semibold text-gray-700 flex items-center justify-center gap-2">
              <FaFileUpload className="text-[#FA6C43]" /> Drop your rubric or metrics document here
            </p>
            <p className="text-xs text-gray-400 mt-1">docx, pdf, txt or md — AI turns it into scoring boxes, content checks and a grading prompt. Review the boxes on the Edit boxes page.</p>
          </>
        )}
        {importNote && !importing && (
          <p className="text-xs text-green-600 mt-2">
            Imported “{importNote.name}” — {importNote.boxes} scoring boxes, {importNote.checks} content checks. Save, then review them under Edit boxes.
          </p>
        )}
        {importError && !importing && <p className="text-xs text-red-500 mt-2">{importError}</p>}
      </div>

      {/* Assignment type */}
      <div>
        <label className="block text-[13px] font-semibold text-gray-700 mb-1.5">Assignment Type</label>
        <select
          value={assignmentType || ''}
          onChange={(e) => selectPreset(e.target.value)}
          className="w-full p-3 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-[#FA6C43]"
        >
          {presets.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
        {(() => {
          const p = presets.find((x) => x.key === assignmentType);
          return p?.description ? <p className="text-xs text-gray-500 mt-1.5">{p.description}</p> : null;
        })()}
      </div>

      {/* Rubric detail is Advanced-only — Simple mode stops at the preset above.
          The boxes and content checks used to be edited here as grey form rows; they
          now live on /video-boxes/:configId, which shows them as the report the
          student actually receives. Editing them in two places would have meant two
          sets of add/delete handlers writing the same spec. */}
      <AdvancedReveal show={advanced}>
      <div className="space-y-6">

      {/* Grading prompt */}
      <div>
        <label className="block text-[13px] font-semibold text-gray-700 mb-1.5">Grading Prompt</label>
        <p className="text-xs text-gray-500 mb-2">Your grading philosophy — how strict to be and what matters most. Guides the final evaluator across all boxes and checks.</p>
        <textarea
          rows="5"
          value={spec.feedback_prompt_template || ''}
          onChange={(e) => patch({ feedback_prompt_template: e.target.value })}
          className="w-full p-3 border border-gray-200 rounded-xl text-sm focus:border-[#FA6C43] outline-none"
          placeholder="E.g. 'You are a strict pitch-competition judge. Reward explicit clarity; penalize vague or implied content. Poor delivery should drag the overall score down even if the content is solid.'"
        />
      </div>

      </div>
      </AdvancedReveal>
    </div>
  );
}
