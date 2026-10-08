// @language JavaScript (React / JSX)
// @updated   2026-10-08
// @changed   New `preview` prop: the builder's canvas renders every block in respond mode as a
//            live preview, and this one must not mount EVIAudioControls there (it would open a
//            voice session for the professor) — it shows a static mic card instead. Edit mode is now
//            just the explainer note; the prompt and Required moved to the builder's settings panel.
// Prior: New file: the Voice Conversation block — the first is_ai Studio block. Reuses the
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
import { FONT_BODY, QuestionHeader } from './blockParts';

const VoiceConversationBlock = ({ config, mode = 'edit', blockId, value, onAnswer, error, preview = false }) => {
  const [voiceError, setVoiceError] = useState(null);
  const turns = value || [];

  if (mode === 'respond') {
    return (
      <div className="p-4">
        <QuestionHeader config={config} />

        {preview ? (
          <div
            className="flex items-center gap-2 px-3 py-3 rounded-xl border border-dashed text-xs"
            style={{ borderColor: 'rgba(31,31,31,0.15)', color: 'rgba(31,31,31,0.5)', fontFamily: FONT_BODY }}
          >
            <FaMicrophone size={12} style={{ color: '#FA6C43' }} />
            Respondents start a live voice conversation here.
          </div>
        ) : (
          <EVIAudioControls
            embedded
            sessionId={blockId}
            onTurn={(turn) => onAnswer([...turns, turn])}
            onError={(msg) => setVoiceError(msg)}
          />
        )}

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
    <p className="flex items-start gap-1.5 text-[11px] leading-snug" style={{ fontFamily: FONT_BODY, color: 'rgba(31,31,31,0.5)' }}>
      <FaMicrophone size={10} className="mt-0.5 shrink-0" />
      Respondents talk to an AI voice assistant live; the transcript is captured as their answer. The question
      above is the prompt they see before starting.
    </p>
  );
};

registerBlock('voice_conversation', VoiceConversationBlock);

export default VoiceConversationBlock;
