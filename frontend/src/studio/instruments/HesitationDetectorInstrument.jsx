// @language JavaScript (React / JSX)
// @updated   2026-09-08
// @changed   New file: the Hesitation Detector instrument's badge. No RespondExtra/ConfigEditor —
//            purely passive; its filler_count/filler_rate_per_100_words metric is a plain regex
//            over the Voice Conversation block's own transcript text, computed server-side. See
//            backend src/studio/instruments/hesitation_detector.py.
import React from 'react';
import { FaCommentDots, FaTimes } from 'react-icons/fa';
import { registerInstrument } from './registryStore';

const FONT_BODY = "'Plus Jakarta Sans', 'Inter', system-ui, sans-serif";

const HesitationDetectorInstrument = ({ onRemove }) => (
  <span
    className="inline-flex items-center gap-1 pl-2 pr-1.5 py-1 rounded-full text-[11px] font-semibold"
    style={{ backgroundColor: '#F1EBFA', color: '#6B3FA0', fontFamily: FONT_BODY }}
  >
    <FaCommentDots size={10} />
    Hesitation Detector
    <button
      type="button"
      onClick={onRemove}
      className="ml-0.5 opacity-40 hover:opacity-100 transition-opacity"
      aria-label="Remove Hesitation Detector"
    >
      <FaTimes size={9} />
    </button>
  </span>
);

registerInstrument('hesitation_detector', { Badge: HesitationDetectorInstrument });

export default HesitationDetectorInstrument;
