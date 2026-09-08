// @language JavaScript (React / JSX)
// @updated   2026-09-08
// @changed   New file: the Comprehension-Paraphrase Check instrument. Badge + a live RespondExtra —
//            once the host block has an answer, asks the respondent to restate the question, calls
//            the new /ai-instrument endpoint (via liveAiCall.js) for a fidelity score, and shows the
//            feedback. Captures {paraphrase, fidelity_score, feedback} as this block's
//            instrument_values; no compute() reads it back (see backend file for why).
import React, { useState } from 'react';
import { FaQuestionCircle, FaTimes } from 'react-icons/fa';
import { registerInstrument } from './registryStore';
import { callLiveAiInstrument } from './liveAiCall';

const FONT_BODY = "'Plus Jakarta Sans', 'Inter', system-ui, sans-serif";

const Badge = ({ onRemove }) => (
  <span
    className="inline-flex items-center gap-1 pl-2 pr-1.5 py-1 rounded-full text-[11px] font-semibold"
    style={{ backgroundColor: '#E8EEFB', color: '#3552A6', fontFamily: FONT_BODY }}
  >
    <FaQuestionCircle size={10} />
    Comprehension Check
    <button
      type="button"
      onClick={onRemove}
      className="ml-0.5 opacity-40 hover:opacity-100 transition-opacity"
      aria-label="Remove Comprehension Check"
    >
      <FaTimes size={9} />
    </button>
  </span>
);

const RespondExtra = ({ value, onChange, answerValue, question, projectId, blockId }) => {
  const [paraphrase, setParaphrase] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  if (!answerValue) return null; // nothing to paraphrase until the block itself is answered

  if (value?.fidelity_score !== undefined) {
    return (
      <div className="px-4 pb-4 -mt-1">
        <p className="text-xs" style={{ fontFamily: FONT_BODY, color: 'rgba(31,31,31,0.6)' }}>
          <span className="font-semibold" style={{ color: '#3552A6' }}>Comprehension check: </span>
          {value.feedback}
        </p>
      </div>
    );
  }

  const submitParaphrase = async () => {
    if (!paraphrase.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const result = await callLiveAiInstrument(projectId, blockId, 'comprehension_paraphrase_check', { paraphrase });
      if (!result) throw new Error('empty result');
      onChange({ paraphrase, fidelity_score: result.fidelity_score, feedback: result.feedback });
    } catch {
      setError("Couldn't check that just now — you can still submit normally.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="px-4 pb-4 -mt-1">
      <label className="text-xs font-medium block mb-1.5" style={{ fontFamily: FONT_BODY, color: 'rgba(31,31,31,0.6)' }}>
        In your own words, what was &ldquo;{question}&rdquo; asking?
      </label>
      <div className="flex gap-2">
        <input
          type="text"
          value={paraphrase}
          onChange={(e) => setParaphrase(e.target.value)}
          className="flex-1 px-2.5 py-1.5 rounded-md border text-sm"
          style={{ borderColor: 'rgba(31,31,31,0.15)', fontFamily: FONT_BODY, color: '#1F1F1F' }}
        />
        <button
          type="button"
          onClick={submitParaphrase}
          disabled={loading}
          className="px-3 py-1.5 rounded-md text-xs font-semibold disabled:opacity-60"
          style={{ backgroundColor: '#3552A6', color: '#FFFFFF' }}
        >
          {loading ? '…' : 'Check'}
        </button>
      </div>
      {error && <p className="text-xs mt-1" style={{ color: '#E5484D', fontFamily: FONT_BODY }}>{error}</p>}
    </div>
  );
};

registerInstrument('comprehension_paraphrase_check', { Badge, RespondExtra });

export default Badge;
