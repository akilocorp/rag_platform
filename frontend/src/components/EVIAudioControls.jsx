import React, { useEffect, useRef, useState } from 'react';
import { VoiceProvider, useVoice } from '@humeai/voice-react';
import { FaMicrophone, FaMicrophoneSlash, FaPhoneSlash, FaSpinner, FaTimes } from 'react-icons/fa';
import apiClient from '../api/apiClient';

/**
 * EVIAudioControls — self-contained Hume EVI integration.
 *
 * Inline trigger sits next to the chat input. Clicking it connects and
 * opens a full-screen voice overlay (wave animation + mute / end-call).
 * Closing the overlay disconnects and returns the user to the text chat;
 * voice turns are already persisted as chat bubbles via the CLM bridge.
 */

const BAR_COUNT = 28;

const VoiceWave = ({ fft, active, accent }) => {
  const arr = Array.isArray(fft) ? fft : null;
  const max = arr && arr.length ? Math.max(1, ...arr) : 1;
  return (
    <div className="flex items-end gap-1 sm:gap-1.5 h-32 sm:h-40 w-full max-w-md px-4 sm:px-6" aria-hidden>
      {Array.from({ length: BAR_COUNT }, (_, i) => {
        const v = arr && arr.length ? arr[i % arr.length] / max : 0;
        const driven = active && v > 0;
        const height = driven ? Math.max(8, v * 100) : 22;
        return (
          <div
            key={i}
            className={`flex-1 rounded-full transition-[height] duration-75 ${accent} ${driven ? '' : 'voice-bar-idle'}`}
            style={{
              height: `${height}%`,
              animationDelay: driven ? '0ms' : `${(i % 7) * 80}ms`,
            }}
          />
        );
      })}
    </div>
  );
};

const VoiceOverlay = ({
  status,
  fft,
  micFft,
  isPlayingAudio,
  isMuted,
  onMute,
  onUnmute,
  onClose,
}) => {
  const isConnecting = status === 'connecting';
  const speaking = !!isPlayingAudio;
  const label = isConnecting
    ? 'Connecting…'
    : speaking
      ? 'Speaking'
      : isMuted
        ? 'Muted'
        : 'Listening';

  const activeFft = speaking ? fft : micFft;
  const accent = speaking
    ? 'bg-gradient-to-t from-[#FA6C43] to-[#FFB088]'
    : 'bg-gradient-to-t from-[#7C5CFF] to-[#B79CFF]';

  return (
    <div className="fixed inset-0 z-50 voice-overlay-in flex flex-col items-center justify-center bg-gradient-to-b from-[#0f1729] via-[#1a1230] to-[#0f1729]">
      <button
        type="button"
        onClick={onClose}
        title="Close voice"
        style={{
          top: 'max(1rem, env(safe-area-inset-top))',
          right: 'max(1rem, env(safe-area-inset-right))',
        }}
        className="absolute w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition active:scale-95"
      >
        <FaTimes className="text-lg" />
      </button>

      <div className="text-white/60 text-[11px] sm:text-xs tracking-[0.25em] uppercase mb-6 sm:mb-8 flex items-center gap-2">
        {isConnecting && <FaSpinner className="animate-spin text-sm" />}
        <span>{label}</span>
      </div>

      <VoiceWave fft={activeFft} active={!isConnecting} accent={accent} />

      <div className="mt-10 sm:mt-14 flex items-center gap-4 sm:gap-5">
        <button
          type="button"
          onClick={isMuted ? onUnmute : onMute}
          disabled={isConnecting}
          title={isMuted ? 'Unmute' : 'Mute'}
          className={`w-14 h-14 sm:w-16 sm:h-16 rounded-full flex items-center justify-center transition active:scale-95 disabled:opacity-50 ${
            isMuted
              ? 'bg-white/10 text-white/70 hover:bg-white/20'
              : 'bg-white text-[#1a1230] hover:bg-white/90'
          }`}
        >
          {isMuted ? <FaMicrophoneSlash className="text-lg sm:text-xl" /> : <FaMicrophone className="text-lg sm:text-xl" />}
        </button>
        <button
          type="button"
          onClick={onClose}
          title="End call"
          className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-[#FA6C43] hover:bg-[#E55B34] text-white flex items-center justify-center transition active:scale-95"
        >
          <FaPhoneSlash className="text-lg sm:text-xl" />
        </button>
      </div>

      <div
        style={{ paddingBottom: 'max(0px, env(safe-area-inset-bottom))' }}
        className="mt-6 sm:mt-8 text-white/40 text-[11px] sm:text-xs px-6 text-center max-w-sm"
      >
        Your conversation appears as messages in the chat. Close to switch back to typing.
      </div>
    </div>
  );
};

const InnerControls = ({ accessToken, humeConfigId, sessionId, onTurn, onError, disabled }) => {
  const voice = useVoice();
  const {
    status,
    messages,
    connect,
    disconnect,
    mute,
    unmute,
    isMuted,
    fft,
    micFft,
    isPlayingAudio,
  } = voice;
  const seenTurnsRef = useRef(0);

  useEffect(() => {
    if (!Array.isArray(messages)) return;
    const turnMessages = messages.filter(
      m => m?.type === 'user_message' || m?.type === 'assistant_message'
    );
    if (turnMessages.length <= seenTurnsRef.current) return;

    for (let i = seenTurnsRef.current; i < turnMessages.length; i++) {
      const m = turnMessages[i];
      const role = m.type === 'user_message' ? 'user' : 'assistant';
      const transcript = (m?.message?.content || '').trim();
      if (!transcript) continue;
      const prosody = m?.models?.prosody?.scores || null;
      onTurn?.({ role, transcript, prosody });
    }
    seenTurnsRef.current = turnMessages.length;
  }, [messages, onTurn]);

  useEffect(() => {
    if (status?.value === 'error') {
      onError?.(status?.reason || 'Voice session error');
    }
  }, [status, onError]);

  const handleConnect = async () => {
    try {
      await connect({
        auth: { type: 'accessToken', value: accessToken },
        configId: humeConfigId,
        sessionSettings: sessionId ? { customSessionId: sessionId } : undefined,
      });
    } catch (e) {
      console.error('EVI connect failed', e);
      onError?.(e?.message || 'Failed to start voice session');
    }
  };

  const isActive = status?.value === 'connecting' || status?.value === 'connected';

  return (
    <>
      {!isActive && (
        <button
          type="button"
          onClick={handleConnect}
          disabled={disabled}
          title="Start voice"
          className="min-h-[52px] px-3 sm:px-4 rounded-2xl bg-white border border-gray-200 hover:bg-[#FFF5F2] text-gray-600 hover:text-[#FA6C43] transition-all active:scale-95 flex items-center justify-center shrink-0 disabled:opacity-50"
        >
          <FaMicrophone className="text-base sm:text-lg" />
        </button>
      )}

      {isActive && (
        <VoiceOverlay
          status={status?.value}
          fft={fft}
          micFft={micFft}
          isPlayingAudio={isPlayingAudio}
          isMuted={isMuted}
          onMute={mute}
          onUnmute={unmute}
          onClose={disconnect}
        />
      )}
    </>
  );
};

const EVIAudioControls = ({ humeConfigId, sessionId, onTurn, onError, disabled }) => {
  const [accessToken, setAccessToken] = useState(null);
  const [tokenError, setTokenError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const fetchToken = async () => {
      try {
        const res = await apiClient.get('/audio/hume/access_token');
        if (cancelled) return;
        setAccessToken(res.data?.access_token || null);
      } catch (e) {
        if (cancelled) return;
        setTokenError(e?.response?.data?.error || 'Voice unavailable');
      }
    };
    fetchToken();
    return () => { cancelled = true; };
  }, []);

  if (tokenError) {
    return (
      <button
        type="button"
        disabled
        title={tokenError}
        className="min-h-[52px] px-4 rounded-2xl bg-gray-100 text-gray-400 text-xs shrink-0"
      >
        Voice off
      </button>
    );
  }

  if (!accessToken || !humeConfigId) {
    return null;
  }

  return (
    <VoiceProvider
      onError={(err) => {
        console.error('EVI VoiceProvider error', err);
        onError?.(err?.message || err?.reason || 'Voice session error');
      }}
    >
      <InnerControls
        accessToken={accessToken}
        humeConfigId={humeConfigId}
        sessionId={sessionId}
        onTurn={onTurn}
        onError={onError}
        disabled={disabled}
      />
    </VoiceProvider>
  );
};

export default EVIAudioControls;
