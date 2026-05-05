/**
 * useHumeEVI — thin wrapper around @humeai/voice-react's useVoice hook.
 *
 * Surfaces a stable interface to the rest of the app:
 *   {
 *     status,           // 'disconnected' | 'connecting' | 'connected' | 'error'
 *     isConnected,
 *     connect(),        // open the EVI WebSocket
 *     disconnect(),
 *     muted, mute, unmute,
 *     lastTurn,         // { transcript, prosody, role: 'user'|'assistant' } — most recent finalized turn
 *     turns,            // running list of finalized turns this session
 *     error,
 *   }
 *
 * EVI emits a `user_message` (with prosody_score) when it finalizes a user
 * utterance, and an `assistant_message` for each assistant turn. We collect
 * those into `turns` so the page can persist them via /api/audio/session/turn
 * and render them as chat bubbles.
 */
import { useEffect, useMemo, useState } from 'react';
import { useVoice } from '@humeai/voice-react';

export const useHumeEVI = () => {
  const voice = useVoice();
  const { status, messages, connect, disconnect, mute, unmute, isMuted } = voice;

  const [turns, setTurns] = useState([]);
  const [lastTurn, setLastTurn] = useState(null);
  const [error, setError] = useState(null);

  // Mirror EVI's message stream into a turn list.
  useEffect(() => {
    if (!Array.isArray(messages) || messages.length === 0) return;
    const next = [];
    for (const m of messages) {
      const t = m?.type;
      if (t === 'user_message' || t === 'assistant_message') {
        const role = t === 'user_message' ? 'user' : 'assistant';
        const transcript = m?.message?.content || '';
        const prosody = m?.models?.prosody?.scores || null;
        if (transcript.trim()) {
          next.push({ role, transcript, prosody });
        }
      }
    }
    if (next.length > 0) {
      setTurns(next);
      setLastTurn(next[next.length - 1]);
    }
  }, [messages]);

  useEffect(() => {
    if (status?.value === 'error') {
      setError(status?.reason || 'EVI error');
    } else if (status?.value === 'connected' || status?.value === 'disconnected') {
      setError(null);
    }
  }, [status]);

  const isConnected = status?.value === 'connected';

  return useMemo(() => ({
    status: status?.value || 'disconnected',
    isConnected,
    connect,
    disconnect,
    muted: !!isMuted,
    mute,
    unmute,
    lastTurn,
    turns,
    error,
  }), [status, isConnected, connect, disconnect, isMuted, mute, unmute, lastTurn, turns, error]);
};

export default useHumeEVI;
