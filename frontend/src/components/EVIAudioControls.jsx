import React, { useEffect, useRef, useState } from 'react';
import { VoiceProvider, useVoice } from '@humeai/voice-react';
import MicButton from './MicButton';
import apiClient from '../api/apiClient';

/**
 * EVIAudioControls — self-contained Hume EVI integration.
 *
 * Renders a mic button that opens a Hume EVI WebSocket. As EVI emits
 * finalized user/assistant turns, fires `onTurn({role, transcript, prosody})`
 * once per turn so the parent can append a chat bubble + persist + postMessage.
 *
 * Props:
 *   humeConfigId   — Hume EVI config id from the bot's saved config
 *   sessionId      — `<config_id>:<chat_id>:<user_id>` (passed to CLM via session_settings)
 *   onTurn         — callback for finalized turns
 *   onError        — callback for connection errors
 *   disabled
 */

const InnerControls = ({ onTurn, onError }) => {
  const { status, messages, connect, disconnect, mute, unmute, isMuted } = useVoice();
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
      await connect();
    } catch (e) {
      onError?.(e?.message || 'Failed to start voice session');
    }
  };

  return (
    <MicButton
      isConnected={status?.value === 'connected'}
      status={status?.value || 'disconnected'}
      onConnect={handleConnect}
      onDisconnect={disconnect}
      muted={!!isMuted}
      onMute={mute}
      onUnmute={unmute}
    />
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
      auth={{ type: 'accessToken', value: accessToken }}
      configId={humeConfigId}
      sessionSettings={sessionId ? { customSessionId: sessionId } : undefined}
    >
      <InnerControls onTurn={onTurn} onError={onError} />
    </VoiceProvider>
  );
};

export default EVIAudioControls;
