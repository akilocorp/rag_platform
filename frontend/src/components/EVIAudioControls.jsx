/**
 * @language  JavaScript (React / JSX)
 * @updated   2026-09-24
 * @changed   Plain variant: hang-up now pauses instead of ending. The student chooses Continue (rejoins
 *            the same Hume chat group via `resumedChatGroupId`, so the partner keeps the conversation, and
 *            resumes the same recorder so the audio stays one file) or End. New `maxDurationMs` ends the
 *            call that long after the first Start click, counted through pauses and never shown. Turn
 *            indexes carry across reconnects; `started_at` is written once.
 *            Prior: New `variant="plain"` (research-mode calls): PlainCallPanel — status dot + "<name> is speaking /
 *            listening", a mic level bar, and text Mute / End conversation buttons. No waveform, fullscreen,
 *            or brand colour. New `onEnded` fires on hang-up so the page can swap to its end screen.
 *            Prior: VoiceOverlay + EmbeddedVoicePanel recolored again: #1F1F1F was a dark bg meant for white text —
 *            swapped for #F8FAFC (ChatPage's own off-white) to match the rest of the app's light surfaces,
 *            which meant flipping every white-on-dark element (dismiss/fullscreen buttons, status label,
 *            recording indicator, footer text, unmuted-mic button) to dark-on-light equivalents so contrast
 *            still holds.
 *            Prior: new `embedded` prop: renders a compact inline EmbeddedVoicePanel instead of the full-screen
 *            VoiceOverlay by default, with a fullscreen toggle button that swaps to VoiceOverlay without
 *            ending the call (its X now exits fullscreen back to embedded, not hang-up — the phone-slash
 *            End Call button is the only thing that disconnects). Recolored the overlay/panel from navy/
 *            purple to brand #1F1F1F + orange throughout. Non-embedded usage (the composer's inline
 *            trigger) is unchanged.
 *            Prior: a failed voice turn now prints its server-side cause to the browser console. Hume calls
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
import { FaExpand, FaMicrophone, FaMicrophoneSlash, FaPhoneSlash, FaSpinner, FaTimes } from 'react-icons/fa';
import apiClient from '../api/apiClient';

/**
 * EVIAudioControls — self-contained Hume EVI integration.
 *
 * Two contexts:
 *  - Inline trigger next to the chat input (`embedded` unset/false): clicking it connects
 *    and opens a full-screen voice overlay (wave animation + mute / end-call). Closing the
 *    overlay disconnects and returns the user to the text chat.
 *  - Dedicated audio_call page (`embedded`): clicking connects into a compact inline panel
 *    instead, so a transcript can render underneath it; a fullscreen button switches to the
 *    same full-screen overlay view without ending the call.
 * Voice turns are persisted as chat bubbles via the CLM bridge either way.
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

  // A paused call keeps one recorder, so the student's audio stays one file under
  // one key — a second recorder would upload over the first. Nothing is captured
  // while paused; the mic stream stays open only so resume needs no new prompt.
  const pause = useCallback(() => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.pause();
  }, []);
  const resume = useCallback(() => {
    if (recorderRef.current?.state === 'paused') {
      recorderRef.current.resume();
      return true;
    }
    return false;
  }, []);

  return { start, stop, pause, resume };
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

const VoiceWave = ({ fft, active, accent, compact }) => {
  const arr = Array.isArray(fft) ? fft : null;
  const max = arr && arr.length ? Math.max(1, ...arr) : 1;
  return (
    <div
      className={`flex items-end gap-1 sm:gap-1.5 w-full ${
        compact ? 'h-14 sm:h-16 max-w-xs px-2' : 'h-32 sm:h-40 max-w-md px-4 sm:px-6'
      }`}
      aria-hidden
    >
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

// Shared status label + wave accent so the embedded panel and the full-screen overlay
// never drift into describing the same call state differently.
const voiceStatusLabel = ({ isConnecting, speaking, isMuted }) =>
  isConnecting ? 'Connecting…' : speaking ? 'Speaking' : isMuted ? 'Muted' : 'Listening';

// Both brand-orange — "speaking" (bot's turn) is the brighter/warmer gradient, "listening"
// (mic's turn) is a deeper, muted orange. No blue/purple anywhere in the call UI.
const voiceAccent = (speaking) =>
  speaking
    ? 'bg-gradient-to-t from-[#FA6C43] to-[#FFB088]'
    : 'bg-gradient-to-t from-[#8A3F26] to-[#C9633E]';

const VoiceOverlay = ({
  status,
  fft,
  micFft,
  isPlayingAudio,
  isMuted,
  recording,
  onMute,
  onUnmute,
  onDismiss,
  onEndCall,
  dismissLabel = 'Close voice',
  footerText = 'Your conversation appears as messages in the chat. Close to switch back to typing.',
}) => {
  const isConnecting = status === 'connecting';
  const speaking = !!isPlayingAudio;
  const label = voiceStatusLabel({ isConnecting, speaking, isMuted });
  const activeFft = speaking ? fft : micFft;
  const accent = voiceAccent(speaking);

  return (
    <div className="fixed inset-0 z-50 voice-overlay-in flex flex-col items-center justify-center bg-[#F8FAFC]">
      <button
        type="button"
        onClick={onDismiss}
        title={dismissLabel}
        style={{
          top: 'max(1rem, env(safe-area-inset-top))',
          right: 'max(1rem, env(safe-area-inset-right))',
        }}
        className="absolute w-11 h-11 rounded-full bg-[#1F1F1F]/6 hover:bg-[#1F1F1F]/12 text-[#1F1F1F]/70 hover:text-[#1F1F1F] flex items-center justify-center transition active:scale-95"
      >
        <FaTimes className="text-lg" />
      </button>

      <div className="text-[#1F1F1F]/55 text-[11px] sm:text-xs tracking-[0.25em] uppercase mb-6 sm:mb-8 flex items-center gap-2">
        {isConnecting && <FaSpinner className="animate-spin text-sm" />}
        <span>{label}</span>
      </div>

      {/* Nobody is recorded without seeing that they are. */}
      {recording && (
        <div className="absolute top-5 left-1/2 -translate-x-1/2 flex items-center gap-2 text-[#1F1F1F]/60 text-[11px] tracking-[0.2em] uppercase">
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
              ? 'bg-[#1F1F1F]/8 text-[#1F1F1F]/60 hover:bg-[#1F1F1F]/14'
              : 'bg-[#1F1F1F] text-white hover:bg-[#1F1F1F]/85'
          }`}
        >
          {isMuted ? <FaMicrophoneSlash className="text-lg sm:text-xl" /> : <FaMicrophone className="text-lg sm:text-xl" />}
        </button>
        <button
          type="button"
          onClick={onEndCall}
          title="End call"
          className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-[#FA6C43] hover:bg-[#E55B34] text-white flex items-center justify-center transition active:scale-95"
        >
          <FaPhoneSlash className="text-lg sm:text-xl" />
        </button>
      </div>

      <div
        style={{ paddingBottom: 'max(0px, env(safe-area-inset-bottom))' }}
        className="mt-6 sm:mt-8 text-[#1F1F1F]/40 text-[11px] sm:text-xs px-6 text-center max-w-sm"
      >
        {footerText}
      </div>
    </div>
  );
};

// The default call surface when EVIAudioControls is used in `embedded` mode (the
// dedicated audio_call page layout): a compact inline panel instead of a full-screen
// takeover, so a transcript can stay visible underneath it. `onEnterFullscreen` swaps
// this out for VoiceOverlay — the call itself never disconnects on that switch, only
// `onEndCall` (the phone button) does.
const EmbeddedVoicePanel = ({
  status,
  fft,
  micFft,
  isPlayingAudio,
  isMuted,
  recording,
  onMute,
  onUnmute,
  onEndCall,
  onEnterFullscreen,
}) => {
  const isConnecting = status === 'connecting';
  const speaking = !!isPlayingAudio;
  const label = voiceStatusLabel({ isConnecting, speaking, isMuted });
  const activeFft = speaking ? fft : micFft;
  const accent = voiceAccent(speaking);

  return (
    <div className="relative w-full max-w-md mx-auto flex flex-col items-center px-4 py-6">
      <button
        type="button"
        onClick={onEnterFullscreen}
        title="Full screen"
        className="absolute top-0 right-4 w-9 h-9 rounded-full bg-[#1F1F1F]/6 hover:bg-[#1F1F1F]/12 text-[#1F1F1F]/60 hover:text-[#1F1F1F] flex items-center justify-center transition active:scale-95"
      >
        <FaExpand className="text-sm" />
      </button>

      <div className="text-[#1F1F1F]/55 text-[11px] tracking-[0.25em] uppercase mb-4 flex items-center gap-2">
        {isConnecting && <FaSpinner className="animate-spin text-sm" />}
        <span>{label}</span>
      </div>

      {recording && (
        <div className="mb-3 flex items-center gap-2 text-[#1F1F1F]/60 text-[10px] tracking-[0.2em] uppercase">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
          <span>Recording</span>
        </div>
      )}

      <VoiceWave fft={activeFft} active={!isConnecting} accent={accent} compact />

      <div className="mt-5 flex items-center gap-4">
        <button
          type="button"
          onClick={isMuted ? onUnmute : onMute}
          disabled={isConnecting}
          title={isMuted ? 'Unmute' : 'Mute'}
          className={`w-12 h-12 rounded-full flex items-center justify-center transition active:scale-95 disabled:opacity-50 ${
            isMuted
              ? 'bg-[#1F1F1F]/8 text-[#1F1F1F]/60 hover:bg-[#1F1F1F]/14'
              : 'bg-[#1F1F1F] text-white hover:bg-[#1F1F1F]/85'
          }`}
        >
          {isMuted ? <FaMicrophoneSlash className="text-base" /> : <FaMicrophone className="text-base" />}
        </button>
        <button
          type="button"
          onClick={onEndCall}
          title="End call"
          className="w-12 h-12 rounded-full bg-[#FA6C43] hover:bg-[#E55B34] text-white flex items-center justify-center transition active:scale-95"
        >
          <FaPhoneSlash className="text-base" />
        </button>
      </div>
    </div>
  );
};

// Hume's fft bands run 0–2 (byte frequency data rescaled per Bark band). A voice
// lights up a handful of bands, so the loudest few are a steadier level reading
// than a mean dragged down by the empty high bands.
const micLevel = (micFft) => {
  if (!Array.isArray(micFft) || micFft.length === 0) return 0;
  const top = [...micFft].sort((a, b) => b - a).slice(0, 5);
  const avg = top.reduce((s, v) => s + v, 0) / top.length;
  return Math.min(1, avg / 1.4);
};

/**
 * The research-mode call surface: as close to a phone call as a page gets.
 * One status line (dot + words), one mic level bar, Mute and End. No waveform,
 * no avatar, no transcript, no timer, no brand colour — a study compares
 * sessions against each other, so nothing here should vary but the voice.
 */
const PlainCallPanel = ({
  status, micFft, isPlayingAudio, isMuted, recording, partnerName,
  onMute, onUnmute, onEndCall,
}) => {
  const isConnecting = status === 'connecting';
  const speaking = !!isPlayingAudio;
  const level = isMuted || isConnecting ? 0 : micLevel(micFft);
  const label = isConnecting
    ? 'Connecting…'
    : speaking ? `${partnerName} is speaking` : `${partnerName} is listening`;

  return (
    <div className="w-full max-w-sm mx-auto flex flex-col items-center gap-8">
      <div className="flex items-center gap-3 text-base text-gray-800" aria-live="polite">
        <span
          className={`w-3 h-3 rounded-full ${
            isConnecting ? 'bg-gray-300' : speaking ? 'bg-gray-800 animate-pulse' : 'bg-gray-400'
          }`}
        />
        <span>{label}</span>
      </div>

      <div className="w-full">
        <div className="flex items-center justify-between text-xs text-gray-500 mb-2">
          <span>Your microphone</span>
          <span>{isMuted ? 'Muted' : ''}</span>
        </div>
        <div
          className="h-2 w-full rounded-full bg-gray-200 overflow-hidden"
          role="meter"
          aria-label="Microphone level"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(level * 100)}
        >
          <div
            className="h-full bg-gray-700 transition-[width] duration-100"
            style={{ width: `${Math.round(level * 100)}%` }}
          />
        </div>
      </div>

      <div className="flex items-start gap-8">
        <div className="flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={isMuted ? onUnmute : onMute}
            disabled={isConnecting}
            title={isMuted ? 'Unmute' : 'Mute'}
            className={`w-14 h-14 rounded-full flex items-center justify-center transition active:scale-95 disabled:opacity-50 ${
              isMuted
                ? 'bg-[#1F1F1F]/8 text-[#1F1F1F]/60 hover:bg-[#1F1F1F]/14'
                : 'bg-[#1F1F1F] text-white hover:bg-[#1F1F1F]/85'
            }`}
          >
            {isMuted ? <FaMicrophoneSlash className="text-lg" /> : <FaMicrophone className="text-lg" />}
          </button>
          <span className="text-xs text-gray-600">{isMuted ? 'Unmute' : 'Mute'}</span>
        </div>
        <div className="flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={onEndCall}
            title="End conversation"
            className="w-14 h-14 rounded-full bg-[#FA6C43] hover:bg-[#E55B34] text-white flex items-center justify-center transition active:scale-95"
          >
            <FaPhoneSlash className="text-lg" />
          </button>
          <span className="text-xs text-gray-600">End conversation</span>
        </div>
      </div>

      {recording && (
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
          <span>Recording</span>
        </div>
      )}
    </div>
  );
};

// Shown between hang-up and the student's choice. Continue rejoins the same Hume chat
// group, so the partner still has the whole conversation; End finishes the call.
const PausedCallPanel = ({ onContinue, onFinish, disabled }) => (
  <div className="w-full max-w-sm mx-auto flex flex-col items-center gap-8 text-center">
    <p className="text-base text-gray-800">
      You left the conversation. You can continue where you left off, or end it.
    </p>
    <div className="flex items-start gap-8">
      <div className="flex flex-col items-center gap-2">
        <button
          type="button"
          onClick={onContinue}
          disabled={disabled}
          title="Continue conversation"
          className="w-14 h-14 rounded-full bg-[#1F1F1F] text-white hover:bg-[#1F1F1F]/85 flex items-center justify-center transition active:scale-95 disabled:opacity-50"
        >
          <FaMicrophone className="text-lg" />
        </button>
        <span className="text-xs text-gray-600">Continue conversation</span>
      </div>
      <div className="flex flex-col items-center gap-2">
        <button
          type="button"
          onClick={onFinish}
          title="End conversation"
          className="w-14 h-14 rounded-full bg-[#FA6C43] hover:bg-[#E55B34] text-white flex items-center justify-center transition active:scale-95"
        >
          <FaPhoneSlash className="text-lg" />
        </button>
        <span className="text-xs text-gray-600">End conversation</span>
      </div>
    </div>
  </div>
);

const InnerControls = ({
  accessToken, humeConfigId, sessionId,
  configId, callSessionId, variables,
  onTurn, onError, disabled, embedded,
  variant, partnerName, onEnded, maxDurationMs,
}) => {
  const plain = variant === 'plain';
  // Plain (research) calls only. Hang-up pauses rather than ends, and the call is
  // over when the student says so or when `maxDurationMs` has passed since their
  // first click on Start — counted through pauses, and never shown.
  const [ended, setEnded] = useState(false);
  const endedRef = useRef(false);
  const deadlineTimerRef = useRef(null);
  const chatGroupIdRef = useRef(null);
  // Hume clears its message list on every disconnect, so a resumed call's turns
  // count from zero again; this carries the earlier connections' count forward.
  const turnBaseRef = useRef(0);
  // Set once the first connect succeeds. The clock starts at the click, but a
  // first attempt that fails has no recorder or call row yet to resume.
  const openedRef = useRef(false);
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
  // Embedded mode only: whether the compact panel has been swapped for the full-screen
  // overlay. Purely a view toggle — never touches the call connection.
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [recording, setRecording] = useState(false);
  const recorder = useCallRecorder();
  // Wall-clock start of the call. Every turn's offset_ms is measured from here,
  // which is what turns a pile of rows into a transcript with a timeline.
  const startedAtRef = useRef(null);

  useEffect(() => {
    if (status?.value === 'disconnected' || status?.value === 'error') {
      setDismissed(false);
      setIsFullscreen(false);
    }
  }, [status]);

  // Hume's own chat id arrives after the socket opens; file it against the call
  // so a record here can be matched to a record in Hume's dashboard.
  useEffect(() => {
    if (chatMetadata?.chatGroupId) chatGroupIdRef.current = chatMetadata.chatGroupId;
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
  const safeDisconnect = () => {
    try {
      const r = disconnect?.();
      if (r && typeof r.then === 'function') r.catch(err => console.error('disconnect error', err));
    } catch (err) {
      console.error('disconnect threw', err);
    }
  };

  const handleClose = () => {
    setDismissed(true);
    setRecording(false);
    safeDisconnect();
    finalizeCall();
  };

  // Plain mode's hang-up: drop the line but keep the call open for a resume.
  const handlePause = () => {
    setDismissed(true);
    setRecording(false);
    recorder.pause();
    safeDisconnect();
  };

  // Plain mode's real end — the student's choice or the deadline, whichever comes first.
  const handleFinish = () => {
    if (endedRef.current) return;
    endedRef.current = true;
    clearTimeout(deadlineTimerRef.current);
    setEnded(true);
    setDismissed(true);
    setRecording(false);
    safeDisconnect();
    onEnded?.();
    finalizeCall();
  };
  // The deadline timer was armed renders ago; it must call the current closure.
  const finishRef = useRef(handleFinish);
  finishRef.current = handleFinish;
  useEffect(() => () => clearTimeout(deadlineTimerRef.current), []);

  // A line that drops on its own (network, Hume) is treated like a hang-up: the
  // recorder stops capturing and the student gets the continue-or-end choice.
  useEffect(() => {
    if (!plain || endedRef.current || !startedAtRef.current) return;
    if (status?.value === 'disconnected' || status?.value === 'error') {
      recorder.pause();
      setRecording(false);
    }
  }, [plain, status, recorder]);

  const finalizeCall = () => {
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
        turnIndex: turnBaseRef.current + i,
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
    if (plain) return handlePlainConnect();
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

  /**
   * Plain mode's Start and Continue share this. The first click starts the clock
   * (before the socket even opens — the deadline is measured from the student's
   * click), the recorder and the call row. A later click rejoins the same Hume
   * chat group, so the partner hears the conversation so far, and picks the
   * existing recording back up rather than starting a second one.
   */
  const handlePlainConnect = async () => {
    if (endedRef.current) return;
    const resuming = openedRef.current;
    if (!startedAtRef.current) {
      startedAtRef.current = new Date();
      if (maxDurationMs) {
        deadlineTimerRef.current = setTimeout(() => finishRef.current(), maxDurationMs);
      }
    }
    turnBaseRef.current += seenTurnsRef.current;
    seenTurnsRef.current = 0;

    try {
      await connect({
        auth: { type: 'accessToken', value: accessToken },
        configId: humeConfigId,
        sessionSettings: sessionId ? { customSessionId: sessionId } : undefined,
        ...(resuming && chatGroupIdRef.current ? { resumedChatGroupId: chatGroupIdRef.current } : {}),
      });
    } catch (e) {
      console.error('EVI connect failed', e);
      onError?.(e?.message || 'Failed to start voice session');
      return;
    }
    // The deadline can pass while the socket is still opening.
    if (endedRef.current) {
      safeDisconnect();
      return;
    }

    if (resuming) {
      setRecording(recorder.resume());
      return;
    }

    openedRef.current = true;
    setRecording(await recorder.start());
    if (callSessionId && configId) {
      apiClient.post('/audio/session/call', {
        session_id: callSessionId,
        config_id: configId,
        started_at: startedAtRef.current.toISOString(),
        variables: variables || {},
      }).catch((e) => console.warn('Failed to open the call record', e));
    }
  };

  const isActive = !dismissed && (status?.value === 'connecting' || status?.value === 'connected');

  if (plain) {
    if (ended) return null;
    if (!isActive && openedRef.current) {
      return <PausedCallPanel onContinue={handleConnect} onFinish={handleFinish} disabled={disabled} />;
    }
    return isActive ? (
      <PlainCallPanel
        status={status?.value}
        micFft={micFft}
        isPlayingAudio={isPlayingAudio}
        isMuted={isMuted}
        recording={recording}
        partnerName={partnerName}
        onMute={mute}
        onUnmute={unmute}
        onEndCall={handlePause}
      />
    ) : (
      <div className="flex flex-col items-center gap-2">
        <button
          type="button"
          onClick={handleConnect}
          disabled={disabled}
          title="Start conversation"
          className="w-16 h-16 rounded-full bg-[#1F1F1F] text-white hover:bg-[#1F1F1F]/85 flex items-center justify-center transition active:scale-95 disabled:opacity-50"
        >
          <FaMicrophone className="text-xl" />
        </button>
        <span className="text-xs text-gray-600">Start conversation</span>
      </div>
    );
  }

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

      {isActive && embedded && !isFullscreen && (
        <EmbeddedVoicePanel
          status={status?.value}
          fft={fft}
          micFft={micFft}
          isPlayingAudio={isPlayingAudio}
          isMuted={isMuted}
          recording={recording}
          onMute={mute}
          onUnmute={unmute}
          onEndCall={handleClose}
          onEnterFullscreen={() => setIsFullscreen(true)}
        />
      )}

      {isActive && embedded && isFullscreen && (
        <VoiceOverlay
          status={status?.value}
          fft={fft}
          micFft={micFft}
          isPlayingAudio={isPlayingAudio}
          isMuted={isMuted}
          recording={recording}
          onMute={mute}
          onUnmute={unmute}
          onDismiss={() => setIsFullscreen(false)}
          onEndCall={handleClose}
          dismissLabel="Exit full screen"
          footerText="Tap × to return to the embedded view."
        />
      )}

      {isActive && !embedded && (
        <VoiceOverlay
          status={status?.value}
          fft={fft}
          micFft={micFft}
          isPlayingAudio={isPlayingAudio}
          isMuted={isMuted}
          recording={recording}
          onMute={mute}
          onUnmute={unmute}
          onDismiss={handleClose}
          onEndCall={handleClose}
        />
      )}
    </>
  );
};

const EVIAudioControls = ({
  humeConfigId, sessionId,
  configId, callSessionId, variables,
  onTurn, onError, disabled, embedded,
  variant, partnerName = 'Your partner', onEnded, maxDurationMs,
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
        embedded={embedded}
        variant={variant}
        partnerName={partnerName}
        onEnded={onEnded}
        maxDurationMs={maxDurationMs}
      />
    </VoiceProvider>
  );
};

export default EVIAudioControls;
