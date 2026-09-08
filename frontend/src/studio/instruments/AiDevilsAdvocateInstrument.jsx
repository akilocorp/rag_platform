// @language JavaScript (React / JSX)
// @updated   2026-09-08
// @changed   New file: the AI Devil's-Advocate instrument. Badge + a live RespondExtra — once the
//            host block has an answer, offers to show a counterargument; on request, calls
//            /ai-instrument for a Claude-generated rebuttal, then captures a post-rebuttal
//            confidence rating (same 0-100 slider UI as Confidence Slider). Captures
//            {initial_stance, rebuttal, post_confidence} as instrument_values; no compute() (see
//            backend file for why a belief_shift metric isn't derived here).
import React, { useState } from 'react';
import { FaComments, FaTimes } from 'react-icons/fa';
import { registerInstrument } from './registryStore';
import { callLiveAiInstrument } from './liveAiCall';

const FONT_BODY = "'Plus Jakarta Sans', 'Inter', system-ui, sans-serif";

const Badge = ({ onRemove }) => (
  <span
    className="inline-flex items-center gap-1 pl-2 pr-1.5 py-1 rounded-full text-[11px] font-semibold"
    style={{ backgroundColor: '#FDEBE0', color: '#B85C1E', fontFamily: FONT_BODY }}
  >
    <FaComments size={10} />
    AI Devil&rsquo;s Advocate
    <button
      type="button"
      onClick={onRemove}
      className="ml-0.5 opacity-40 hover:opacity-100 transition-opacity"
      aria-label="Remove AI Devil's Advocate"
    >
      <FaTimes size={9} />
    </button>
  </span>
);

const RespondExtra = ({ value, onChange, answerValue, projectId, blockId }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  if (!answerValue) return null;

  const requestRebuttal = async () => {
    setLoading(true);
    setError(null);
    try {
      const stance = typeof answerValue === 'string' ? answerValue : JSON.stringify(answerValue);
      const result = await callLiveAiInstrument(projectId, blockId, 'ai_devils_advocate', { stance });
      if (!result) throw new Error('empty result');
      onChange({ initial_stance: stance, rebuttal: result.rebuttal });
    } catch {
      setError("Couldn't generate a counterargument just now.");
    } finally {
      setLoading(false);
    }
  };

  if (!value?.rebuttal) {
    return (
      <div className="px-4 pb-4 -mt-1">
        <button
          type="button"
          onClick={requestRebuttal}
          disabled={loading}
          className="text-xs font-semibold disabled:opacity-60"
          style={{ color: '#B85C1E', fontFamily: FONT_BODY }}
        >
          {loading ? 'Thinking…' : 'See a counterargument'}
        </button>
        {error && <p className="text-xs mt-1" style={{ color: '#E5484D', fontFamily: FONT_BODY }}>{error}</p>}
      </div>
    );
  }

  const postConfidence = value.post_confidence ?? 50;
  return (
    <div className="px-4 pb-4 -mt-1">
      <p className="text-xs italic mb-2" style={{ fontFamily: FONT_BODY, color: 'rgba(31,31,31,0.7)' }}>
        &ldquo;{value.rebuttal}&rdquo;
      </p>
      <label
        className="text-xs font-medium flex items-center justify-between mb-1.5"
        style={{ fontFamily: FONT_BODY, color: 'rgba(31,31,31,0.6)' }}
      >
        How confident are you now?
        <span style={{ color: '#B85C1E', fontWeight: 700 }}>{postConfidence}</span>
      </label>
      <input
        type="range"
        min={0}
        max={100}
        value={postConfidence}
        onChange={(e) => onChange({ ...value, post_confidence: Number(e.target.value) })}
        className="w-full"
      />
    </div>
  );
};

registerInstrument('ai_devils_advocate', { Badge, RespondExtra });

export default Badge;
