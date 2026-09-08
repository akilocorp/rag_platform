// @language JavaScript (React / JSX)
// @updated   2026-09-08
// @changed   New file: the Vocal Emotion Trace instrument's badge. No RespondExtra/ConfigEditor —
//            purely passive (backend config is always {}); its dominant_emotion/dominant_emotion_avg
//            metric is computed entirely server-side from data the Voice Conversation block already
//            captures. See backend src/studio/instruments/vocal_emotion_trace.py.
import React from 'react';
import { FaSmile, FaTimes } from 'react-icons/fa';
import { registerInstrument } from './registryStore';

const FONT_BODY = "'Plus Jakarta Sans', 'Inter', system-ui, sans-serif";

const VocalEmotionTraceInstrument = ({ onRemove }) => (
  <span
    className="inline-flex items-center gap-1 pl-2 pr-1.5 py-1 rounded-full text-[11px] font-semibold"
    style={{ backgroundColor: '#FDF3E3', color: '#B8860B', fontFamily: FONT_BODY }}
  >
    <FaSmile size={10} />
    Vocal Emotion Trace
    <button
      type="button"
      onClick={onRemove}
      className="ml-0.5 opacity-40 hover:opacity-100 transition-opacity"
      aria-label="Remove Vocal Emotion Trace"
    >
      <FaTimes size={9} />
    </button>
  </span>
);

registerInstrument('vocal_emotion_trace', { Badge: VocalEmotionTraceInstrument });

export default VocalEmotionTraceInstrument;
