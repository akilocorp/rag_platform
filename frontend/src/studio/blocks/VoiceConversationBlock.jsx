// @language JavaScript (React / JSX)
// @updated   2026-09-08
// @changed   New file: the Voice Conversation block — the first is_ai Studio block. Reuses the
//            platform's existing EVIAudioControls (Hume EVI) wholesale for the mic/voice UI.
//            Deliberately does NOT pass configId/callSessionId: those gate EVIAudioControls' own
//            persistence side-effects (session/call rows, recording upload, CLM error lookup), all
//            scoped to a 1:1 chat config, which a Studio project isn't. v1 just needs the live
//            conversation plus a client-captured transcript, so onTurn's payload is accumulated and
//            stored directly as the block's answer — no new backend route. Per-project Hume
//            personas (vs. the one global HUME_CONFIG_ID today) are deferred; see
//            backend/src/studio/blocks/voice_conversation.py.
import React, { useState } from 'react';
import { FaMicrophone } from 'react-icons/fa';
import EVIAudioControls from '../../components/EVIAudioControls';
import { registerBlock } from './registryStore';

const FONT_BODY = "'Plus Jakarta Sans', 'Inter', system-ui, sans-serif";

const VoiceConversationBlock = ({ config, mode = 'edit', onChange, blockId, value, onAnswer, error }) => {
  const { question = '', required = false } = config || {};
  const [voiceError, setVoiceError] = useState(null);
  const turns = value || [];

  if (mode === 'respond') {
    return (
      <div className="p-4">
        <label
          className="block text-sm font-semibold mb-3"
          style={{ fontFamily: FONT_BODY, color: '#1F1F1F' }}
        >
          {question} {required && <span style={{ color: '#FA6C43' }}>*</span>}
        </label>

        <EVIAudioControls
          embedded
          sessionId={blockId}
          onTurn={(turn) => onAnswer([...turns, turn])}
          onError={(msg) => setVoiceError(msg)}
        />

        {voiceError && (
          <p className="text-xs mt-2" style={{ color: '#E5484D', fontFamily: FONT_BODY }}>{voiceError}</p>
        )}

        {turns.length > 0 && (
          <div className="mt-4 space-y-2 max-h-56 overflow-y-auto pr-1">
            {turns.map((t, i) => (
              <p
                key={i}
                className="text-xs"
                style={{ fontFamily: FONT_BODY, color: t.role === 'user' ? '#1F1F1F' : 'rgba(31,31,31,0.6)' }}
              >
                <span className="font-semibold capitalize">{t.role}: </span>{t.transcript}
              </p>
            ))}
          </div>
        )}

        {error && <p className="text-xs mt-2" style={{ color: '#E5484D', fontFamily: FONT_BODY }}>{error}</p>}
      </div>
    );
  }

  return (
    <div className="p-4 flex flex-col gap-2">
      <input
        type="text"
        value={question}
        onChange={(e) => onChange({ ...config, question: e.target.value })}
        placeholder="Prompt shown before the conversation starts"
        className="w-full px-3 py-2 rounded-lg border text-sm font-semibold"
        style={{ borderColor: 'rgba(31,31,31,0.15)', fontFamily: FONT_BODY, color: '#1F1F1F' }}
      />
      <label
        className="flex items-center gap-2 text-xs"
        style={{ fontFamily: FONT_BODY, color: 'rgba(31,31,31,0.6)' }}
      >
        <input
          type="checkbox"
          checked={required}
          onChange={(e) => onChange({ ...config, required: e.target.checked })}
        />
        Required
      </label>
      <p className="flex items-center gap-1.5 text-[11px]" style={{ fontFamily: FONT_BODY, color: 'rgba(31,31,31,0.45)' }}>
        <FaMicrophone size={10} /> Respondents talk to an AI voice assistant live; the transcript is captured as their answer.
      </p>
    </div>
  );
};

registerBlock('voice_conversation', VoiceConversationBlock);

export default VoiceConversationBlock;
