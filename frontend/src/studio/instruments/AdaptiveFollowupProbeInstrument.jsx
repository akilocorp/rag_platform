// @language JavaScript (React / JSX)
// @updated   2026-09-08
// @changed   New file: the Adaptive Follow-Up Probe instrument. Badge + a live RespondExtra — once
//            the host block has an answer, generates a bespoke follow-up question via
//            /ai-instrument and lets the respondent answer it inline. Captures
//            {followup_question, followup_answer} as instrument_values; the generated question
//            isn't a real Studio block (see backend file for why), it only ever exists here.
import React, { useState } from 'react';
import { FaSearchPlus, FaTimes } from 'react-icons/fa';
import { registerInstrument } from './registryStore';
import { callLiveAiInstrument } from './liveAiCall';

const FONT_BODY = "'Plus Jakarta Sans', 'Inter', system-ui, sans-serif";

const Badge = ({ onRemove }) => (
  <span
    className="inline-flex items-center gap-1 pl-2 pr-1.5 py-1 rounded-full text-[11px] font-semibold"
    style={{ backgroundColor: '#E7F3EE', color: '#1E6B4F', fontFamily: FONT_BODY }}
  >
    <FaSearchPlus size={10} />
    Adaptive Follow-Up
    <button
      type="button"
      onClick={onRemove}
      className="ml-0.5 opacity-40 hover:opacity-100 transition-opacity"
      aria-label="Remove Adaptive Follow-Up"
    >
      <FaTimes size={9} />
    </button>
  </span>
);

const RespondExtra = ({ value, onChange, answerValue, projectId, blockId }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  if (!answerValue) return null;

  const requestFollowup = async () => {
    setLoading(true);
    setError(null);
    try {
      const answerText = typeof answerValue === 'string' ? answerValue : JSON.stringify(answerValue);
      const result = await callLiveAiInstrument(projectId, blockId, 'adaptive_followup_probe', { answer: answerText });
      if (!result) throw new Error('empty result');
      onChange({ followup_question: result.followup_question, followup_answer: '' });
    } catch {
      setError("Couldn't generate a follow-up just now.");
    } finally {
      setLoading(false);
    }
  };

  if (!value?.followup_question) {
    return (
      <div className="px-4 pb-4 -mt-1">
        <button
          type="button"
          onClick={requestFollowup}
          disabled={loading}
          className="text-xs font-semibold disabled:opacity-60"
          style={{ color: '#1E6B4F', fontFamily: FONT_BODY }}
        >
          {loading ? 'Thinking…' : 'One more thing…'}
        </button>
        {error && <p className="text-xs mt-1" style={{ color: '#E5484D', fontFamily: FONT_BODY }}>{error}</p>}
      </div>
    );
  }

  return (
    <div className="px-4 pb-4 -mt-1">
      <label className="text-xs font-medium block mb-1.5" style={{ fontFamily: FONT_BODY, color: 'rgba(31,31,31,0.6)' }}>
        {value.followup_question}
      </label>
      <input
        type="text"
        value={value.followup_answer || ''}
        onChange={(e) => onChange({ ...value, followup_answer: e.target.value })}
        className="w-full px-2.5 py-1.5 rounded-md border text-sm"
        style={{ borderColor: 'rgba(31,31,31,0.15)', fontFamily: FONT_BODY, color: '#1F1F1F' }}
      />
    </div>
  );
};

registerInstrument('adaptive_followup_probe', { Badge, RespondExtra });

export default Badge;
