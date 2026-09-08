// @language JavaScript (React / JSX)
// @updated   2026-09-08
// @changed   New file: the Sentiment-Drift Tracker instrument's badge. No RespondExtra/ConfigEditor
//            — purely passive; its tracked_emotion/drift metric is computed server-side from the
//            same Voice Conversation turn data Vocal Emotion Trace reads, just compared first-turn
//            vs. last-turn instead of averaged. See backend src/studio/instruments/sentiment_drift.py.
import React from 'react';
import { FaChartLine, FaTimes } from 'react-icons/fa';
import { registerInstrument } from './registryStore';

const FONT_BODY = "'Plus Jakarta Sans', 'Inter', system-ui, sans-serif";

const SentimentDriftInstrument = ({ onRemove }) => (
  <span
    className="inline-flex items-center gap-1 pl-2 pr-1.5 py-1 rounded-full text-[11px] font-semibold"
    style={{ backgroundColor: '#E9F5F0', color: '#1E7A5F', fontFamily: FONT_BODY }}
  >
    <FaChartLine size={10} />
    Sentiment-Drift Tracker
    <button
      type="button"
      onClick={onRemove}
      className="ml-0.5 opacity-40 hover:opacity-100 transition-opacity"
      aria-label="Remove Sentiment-Drift Tracker"
    >
      <FaTimes size={9} />
    </button>
  </span>
);

registerInstrument('sentiment_drift', { Badge: SentimentDriftInstrument });

export default SentimentDriftInstrument;
