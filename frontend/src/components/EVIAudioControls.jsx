/**
 * @language  JavaScript (React / JSX)
 * @updated   2026-09-02
 * @changed   A failed voice turn now prints its server-side cause to the browser console. Hume calls
 *            our CLM endpoint from its own servers, so a broken turn shows up in the page only as the
 *            bot's apology and never as a request in the network tab — when that apology arrives, the
 *            overlay fetches the reason from /audio/clm/last-error and console.errors it.
 *            Prior: calls are now recorded and filed. The student's microphone is captured for the length of
 *            the call and uploaded straight to S3 on hang-up; a call-metadata row is written at connect
 *            (so a closed tab still leaves a record) and completed at hang-up; and each turn now reports
 *            its index and offset from the start of the call. Overlay carries a live recording dot.
 *            Prior: dismiss voice overlay locally so X / End-call close instantly.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
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

// The one line the CLM bridge speaks when a turn threw. Matched on its opening
// clause so rewording the tail of the sentence doesn't silently stop the lookup.
const SPOKEN_FAILURE_PREFIX = 'Sorry, I lost my train of thought';

/**
 * Captures the student's microphone for the length of a call.
 *
 * A second `getUserMedia` alongside the one the Hume SDK holds — browsers allow
 * concurrent captures of the same device, and tapping the SDK's own stream would
 * mean reaching into its internals. Only the student is recorded: the assistant's
 * audio arrives as separate WebSocket clips that would need decoding, mixing and
 * re-syncing around every interruption, and its words are already in the
 * transcript. So this is a clean single-speaker track, not the mixed call.
 */
const useCallRecorder = () => {
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);

  const start = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
        .find((t) => MediaRecorder.isTypeSupported(t)) || '';
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data?.size > 0) chunksRef.current.push(e.data); };
      // Timeslice so a crashed tab still leaves whole chunks behind rather than
      // one buffer that was never flushed.
      recorder.start(5000);
      recorderRef.current = recorder;
      return true;
    } catch (e) {
      console.warn('Call recording unavailable', e);
      return false;
    }
  }, []);

  // Resolves once the recorder has flushed its final chunk — `stop()` is async
  // in effect, and reading chunksRef before `onstop` loses the tail of the call.
  const stop = useCallback(() => new Promise((resolve) => {
    const recorder = recorderRef.current;
    const releaseMic = () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
    if (!recorder || recorder.state === 'inactive') {
      releaseMic();
      resolve(null);
      return;
    }
    recorder.onstop = () => {
      releaseMic();
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
      chunksRef.current = [];
      recorderRef.current = null;
      resolve(blob.size > 0 ? blob : null);
    };
    recorder.stop();
  }), []);

  return { start, stop };
};

/** Presign, then PUT the recording straight to S3. Returns the stored key. */
const uploadRecording = async (blob, { configId, sessionId }) => {
  const { data } = await apiClient.post('/audio/session/recording/url', {
    session_id: sessionId,
    config_id: configId,
    content_type: blob.type || 'audio/webm',
  });
  // Plain fetch, not apiClient: our auth interceptor would add headers that are
  // not part of the presigned signature, and S3 rejects the PUT with a 403.
  const res = await fetch(data.upload_url, {
    method: 'PUT',
    body: blob,
    headers: { 'Content-Type': data.content_type },
  });
  if (!res.ok) throw new Error(`S3 upload failed (${res.status})`);
  return data.storage_key;
};

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
  recording,
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

      {/* Nobody is recorded without seeing that they are. */}
      {recording && (
        <div className="absolute top-5 left-1/2 -translate-x-1/2 flex items-center gap-2 text-white/70 text-[11px] tracking-[0.2em] uppercase">
          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          <span>Recording</span>
        </div>
      )}

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

const InnerControls = ({
  accessToken, humeConfigId, sessionId,
  configId, callSessionId, variables,
  onTurn, onError, disabled,
}) => {
  const voice = useVoice();
  const {
    status,
    messages,
    chatMetadata,
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
  const [dismissed, setDismissed] = useState(false);
  const [recording, setRecording] = useState(false);
  const recorder = useCallRecorder();
  // Wall-clock start of the call. Every turn's offset_ms is measured from here,
  // which is what turns a pile of rows into a transcript with a timeline.
  const startedAtRef = useRef(null);

  useEffect(() => {
    if (status?.value === 'disconnected' || status?.value === 'error') {
      setDismissed(false);
    }
  }, [status]);

  // Hume's own chat id arrives after the socket opens; file it against the call
  // so a record here can be matched to a record in Hume's dashboard.
  useEffect(() => {
    const humeChatId = chatMetadata?.chatId;
    if (!humeChatId || !callSessionId || !configId) return;
    apiClient.post('/audio/session/call', {
      session_id: callSessionId,
      config_id: configId,
      hume_chat_id: humeChatId,
    }).catch((e) => console.warn('Failed to file Hume chat id', e));
  }, [chatMetadata, callSessionId, configId]);

  /**
   * Hang up: stop the recorder, upload what it captured, and close out the call
   * row. The overlay is dismissed first and the upload runs behind it — a
   * student should never be held on a "please wait" screen by our bookkeeping.
   */
  const handleClose = () => {
    setDismissed(true);
    setRecording(false);
    try {
      const r = disconnect?.();
      if (r && typeof r.then === 'function') r.catch(err => console.error('disconnect error', err));
    } catch (err) {
      console.error('disconnect threw', err);
    }

    (async () => {
      const startedAt = startedAtRef.current;
      startedAtRef.current = null;
      let blob = null;
      try {
        blob = await recorder.stop();
      } catch (e) {
        console.warn('Could not finalize the recording', e);
      }
      if (!callSessionId || !configId) return;

      const payload = {
        session_id: callSessionId,
        config_id: configId,
        ended_at: new Date().toISOString(),
      };
      if (startedAt) payload.duration_ms = Date.now() - startedAt.getTime();

      try {
        if (blob) payload.storage_key = await uploadRecording(blob, { configId, sessionId: callSessionId });
        if (blob) payload.content_type = blob.type || 'audio/webm';
      } catch (e) {
        // The transcript is already saved turn by turn, so a failed upload costs
        // the audio and nothing else. Close the call row out regardless.
        console.error('Recording upload failed', e);
      }
      apiClient.post('/audio/session/call', payload)
        .catch((e) => console.warn('Failed to close out the call record', e));
    })();
  };

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
      // The bridge speaks this line when the turn raised. The exception itself never
      // reaches the browser, so go and ask for it — otherwise the only evidence a
      // student's call is broken is a polite sentence that looks deliberate.
      if (role === 'assistant' && transcript.startsWith(SPOKEN_FAILURE_PREFIX) && configId) {
        apiClient.get(`/audio/clm/last-error/${configId}`)
          .then(({ data }) => console.error('[voice] the server failed this turn:', data))
          .catch((e) => console.error('[voice] turn failed; could not read the reason', e));
      }
      const prosody = m?.models?.prosody?.scores || null;
      // The SDK stamps every message with `receivedAt`, so the turn's place in
      // the call is real rather than reconstructed from when our POST landed.
      const receivedAt = m?.receivedAt instanceof Date ? m.receivedAt : new Date();
      const startedAt = startedAtRef.current;
      onTurn?.({
        role,
        transcript,
        prosody,
        turnIndex: i,
        receivedAt: receivedAt.toISOString(),
        offsetMs: startedAt ? Math.max(0, receivedAt.getTime() - startedAt.getTime()) : null,
      });
    }
    seenTurnsRef.current = turnMessages.length;
  }, [messages, onTurn, configId]);

  useEffect(() => {
    if (status?.value === 'error') {
      onError?.(status?.reason || 'Voice session error');
    }
  }, [status, onError]);

  /**
   * Open the call: connect, start recording, and write the call row immediately.
   *
   * The row is written now rather than at hang-up so that a student who closes
   * the tab halfway through still leaves a record carrying the variables they
   * were assigned — a partial call is data, an orphaned set of turns is not.
   */
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
      return;
    }

    const startedAt = new Date();
    startedAtRef.current = startedAt;
    seenTurnsRef.current = 0;

    setRecording(await recorder.start());

    if (callSessionId && configId) {
      apiClient.post('/audio/session/call', {
        session_id: callSessionId,
        config_id: configId,
        started_at: startedAt.toISOString(),
        variables: variables || {},
      }).catch((e) => console.warn('Failed to open the call record', e));
    }
  };

  const isActive = !dismissed && (status?.value === 'connecting' || status?.value === 'connected');

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
          recording={recording}
          onMute={mute}
          onUnmute={unmute}
          onClose={handleClose}
        />
      )}
    </>
  );
};

const EVIAudioControls = ({
  humeConfigId, sessionId,
  configId, callSessionId, variables,
  onTurn, onError, disabled,
}) => {
  const [accessToken, setAccessToken] = useState(null);
  const [serverConfigId, setServerConfigId] = useState(null);
  const [tokenError, setTokenError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const fetchToken = async () => {
      try {
        const res = await apiClient.get('/audio/hume/access_token');
        if (cancelled) return;
        setAccessToken(res.data?.access_token || null);
        setServerConfigId(res.data?.config_id || null);
      } catch (e) {
        if (cancelled) return;
        setTokenError(e?.response?.data?.error || 'Voice unavailable');
      }
    };
    fetchToken();
    return () => { cancelled = true; };
  }, []);

  const effectiveConfigId = humeConfigId || serverConfigId;

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

  if (!accessToken || !effectiveConfigId) {
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
        humeConfigId={effectiveConfigId}
        sessionId={sessionId}
        configId={configId}
        callSessionId={callSessionId}
        variables={variables}
        onTurn={onTurn}
        onError={onError}
        disabled={disabled}
      />
    </VoiceProvider>
  );
};

export default EVIAudioControls;
