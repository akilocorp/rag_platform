/**
 * Step-by-step log of a voice call attempt, written to `audio_call_events`.
 *
 * When a participant's call never starts, the browser console is the only place
 * the reason used to appear — and nobody sees a participant's console. Every
 * step from page load to first message is posted to the server with the
 * client's timestamp, so a failed call reads back as a timeline: which step was
 * the last one reached, and what error came with it.
 *
 * Logging must never break a call: every send swallows its own failure.
 */
import { useCallback, useEffect, useRef } from 'react';
import apiClient from '../api/apiClient';

const ENDPOINT = '/audio/session/event';
const pageLoadedAt = Date.now();

const apiUrl = () => `${(apiClient.defaults.baseURL || '/api').replace(/\/$/, '')}${ENDPOINT}`;

// Errors and close events carry non-enumerable fields; pull out the useful ones.
export const describeError = (e) => {
  if (!e) return null;
  if (typeof e === 'string') return { message: e };
  return {
    name: e.name, message: e.message, type: e.type, reason: e.reason,
    code: e.code, slug: e.slug, status: e?.response?.status,
  };
};

/**
 * Returns `log(event, detail)` and `beacon(event, detail)`.
 *
 * Events logged before the call's session id exists are held and sent once it
 * does — research calls mint the id in an effect, after the controls first render.
 * `beacon` is for page teardown, where an ordinary request would be cancelled.
 */
export const useCallLog = ({ configId, callSessionId, variables }) => {
  const ctxRef = useRef({});
  ctxRef.current = { configId, callSessionId, qualtricsId: variables?.qualtricsId || null };
  const pendingRef = useRef([]);
  const seqRef = useRef(0);

  const build = (event, detail) => ({
    event,
    detail: detail ?? null,
    seq: ++seqRef.current,
    client_ts: new Date().toISOString(),
    ms_since_page_load: Date.now() - pageLoadedAt,
  });

  const send = (entry) => {
    const { configId: cid, callSessionId: sid, qualtricsId } = ctxRef.current;
    apiClient.post(ENDPOINT, { ...entry, session_id: sid, config_id: cid, qualtrics_id: qualtricsId })
      .catch(() => {});
  };

  const log = useCallback((event, detail) => {
    const entry = build(event, detail);
    if (!ctxRef.current.callSessionId || !ctxRef.current.configId) {
      pendingRef.current.push(entry);
      return;
    }
    send(entry);
  }, []);

  const beacon = useCallback((event, detail) => {
    const { configId: cid, callSessionId: sid, qualtricsId } = ctxRef.current;
    if (!sid || !cid || typeof navigator === 'undefined' || !navigator.sendBeacon) return;
    try {
      const body = JSON.stringify({ ...build(event, detail), session_id: sid, config_id: cid, qualtrics_id: qualtricsId });
      navigator.sendBeacon(apiUrl(), new Blob([body], { type: 'application/json' }));
    } catch { /* teardown: nothing left to do */ }
  }, []);

  useEffect(() => {
    if (!callSessionId || !configId || pendingRef.current.length === 0) return;
    const queued = pendingRef.current;
    pendingRef.current = [];
    queued.forEach(send);
  }, [callSessionId, configId]);

  return { log, beacon };
};

/** What the browser can tell us about the environment a call is attempted in. */
export const environmentSnapshot = async () => {
  const nav = typeof navigator !== 'undefined' ? navigator : {};
  let micPermission = 'unknown';
  try {
    micPermission = (await nav.permissions?.query({ name: 'microphone' }))?.state || 'unknown';
  } catch { /* Safari and Firefox may not support querying microphone */ }
  let inIframe = false;
  try { inIframe = window.self !== window.top; } catch { inIframe = true; }
  return {
    user_agent: nav.userAgent,
    language: nav.language,
    online: nav.onLine,
    secure_context: typeof window !== 'undefined' ? window.isSecureContext : null,
    media_devices: Boolean(nav.mediaDevices?.getUserMedia),
    mic_permission: micPermission,
    in_iframe: inIframe,
    referrer: typeof document !== 'undefined' ? document.referrer.split('?')[0] : null,
    viewport: typeof window !== 'undefined' ? `${window.innerWidth}x${window.innerHeight}` : null,
    connection: nav.connection?.effectiveType || null,
  };
};
