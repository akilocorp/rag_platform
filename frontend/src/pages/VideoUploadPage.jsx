import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import { FaFilm, FaUpload, FaEnvelope, FaExclamationTriangle, FaFileVideo, FaTimes, FaBell } from 'react-icons/fa';
import apiClient from '../api/apiClient';

const STAGE_LABEL = {
  downloading: 'Preparing your video…',
  extracting_audio: 'Optimizing your video…',
  analyzing: 'Analyzing your delivery & speech…',
  saving: 'Almost there…',
  scoring: 'Grading your pitch…',
};

// Rotating pitch tips shown on the waiting screen so the multi-minute analysis
// (external behaviour API + a multi-step AI grading chain) doesn't feel dead.
const TIPS = [
  'Open with a hook in the first 8 seconds — a question, a surprising fact, or a bold claim.',
  'Name the pain before the solution. People buy relief, not features.',
  'Specifics beat adjectives: “cuts onboarding from 3 days to 2 hours” lands harder than “much faster.”',
  'Confident pace is ~110–160 words per minute. When in doubt, slow down.',
  'Quantify the market and your ask — numbers signal you’ve done the work.',
  'Steady posture and eye contact read as confidence before you even speak.',
  'Tell them why *this* team can pull it off.',
  'End on one memorable line — not “any questions?”',
];

const fmtElapsed = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const fmtSize = (bytes) => {
  if (!bytes) return '';
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`;
};

const C = (v) => v == null ? '#9ca3af' : v >= 80 ? '#22c55e' : v >= 65 ? '#3b82f6' : v >= 50 ? '#f59e0b' : '#ef4444';

function SubmissionHistoryRow({ sub, onClick }) {
  const statusMap = { scored: ['Scored', '#22c55e'], failed: ['Failed', '#ef4444'] };
  const [label, color] = statusMap[sub.status] || ['Processing', '#f59e0b'];
  const date = sub.created_at ? new Date(sub.created_at * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—';
  return (
    <div onClick={onClick} className="flex items-center gap-3 px-3 py-2.5 bg-[#F0F6FB] rounded-xl cursor-pointer hover:bg-[#E8F0F8] transition-colors">
      <span className="text-[11px] font-bold text-gray-400 w-16 shrink-0">Attempt {sub.attempt_number}</span>
      <span className="text-xs text-gray-500 flex-1">{date}</span>
      {sub.overall != null && <span className="text-sm font-extrabold" style={{ color: C(sub.overall) }}>{(sub.overall / 10).toFixed(1)}</span>}
      <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full text-white shrink-0" style={{ background: color }}>{label}</span>
    </div>
  );
}

// Defined at module scope so it keeps a stable component identity across
// renders. (Defining it inside the page component remounts the subtree on every
// keystroke and drops input focus.)
function Shell({ title, subtitle, children }) {
  return (
    <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }} className="min-h-screen bg-[#F0F6FB] flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-xl w-full max-w-lg p-8 sm:p-10">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-3 bg-[#F9D0C4]/30 rounded-2xl text-[#FA6C43]"><FaFilm className="text-xl" /></div>
          <div>
            <h1 className="text-xl font-bold text-[#222]">{title || 'Video Assignment'}</h1>
            <p className="text-xs text-gray-500">{subtitle || 'Fill in your details and upload your video below'}</p>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function VideoUploadPage() {
  const { configId } = useParams();
  const navigate = useNavigate();

  const [config, setConfig] = useState(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [loggedIn, setLoggedIn] = useState(false);
  const [file, setFile] = useState(null);

  const [phase, setPhase] = useState('form'); // form | uploading | processing | done | error
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState('');
  const [error, setError] = useState('');
  const [history, setHistory] = useState(null); // null=not loaded
  const [limitReached, setLimitReached] = useState(false);
  const [dragging, setDragging] = useState(false);

  // Waiting-screen state: rotating tip, elapsed timer, browser-notification opt-in.
  const [tipIndex, setTipIndex] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [notifyState, setNotifyState] = useState(
    () => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission)
  );

  const socketRef = useRef(null);
  const pollRef = useRef(null);
  const fileInputRef = useRef(null);

  const fetchHistory = async (emailValue) => {
    const e = (emailValue || '').trim().toLowerCase();
    if (!e || !EMAIL_RE.test(e)) return;
    try {
      const res = await apiClient.get(`/video/config/${configId}/student-history?email=${encodeURIComponent(e)}`);
      setHistory(res.data.submissions || []);
      setLimitReached(!res.data.can_submit);
    } catch (_) { setHistory([]); }
  };

  useEffect(() => {
    const token = localStorage.getItem('jwtToken');
    apiClient.get(`/config/${configId}`)
      .then((res) => setConfig(res.data.config))
      .catch(() => setError('This assignment could not be found.'));
    if (token) {
      apiClient.get('/auth/me')
        .then((res) => {
          setLoggedIn(true);
          if (res.data?.username) setName(res.data.username);
          if (res.data?.email) {
            setEmail(res.data.email);
            fetchHistory(res.data.email);
          }
        })
        .catch(() => {});
    }
  }, [configId]);

  useEffect(() => () => {
    if (socketRef.current) socketRef.current.disconnect();
    if (pollRef.current) clearInterval(pollRef.current);
  }, []);

  // Rotate the pitch tip + tick the elapsed timer while we wait.
  useEffect(() => {
    if (phase !== 'uploading' && phase !== 'processing') return undefined;
    const tip = setInterval(() => setTipIndex((i) => (i + 1) % TIPS.length), 5000);
    const clock = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => { clearInterval(tip); clearInterval(clock); };
  }, [phase]);

  const enableNotify = async () => {
    if (typeof Notification === 'undefined') return;
    try { setNotifyState(await Notification.requestPermission()); } catch (_) { /* ignore */ }
  };

  // Fire a browser notification when results land — lets students tab away and
  // get pulled back. Click focuses this tab (logged-in users have already been
  // navigated to their results by finish()).
  const notifyReady = () => {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    try {
      const n = new Notification('Your pitch results are ready 🎉', {
        body: 'Tap to see your feedback and scores.',
        tag: 'video-results',
      });
      n.onclick = () => { window.focus(); n.close(); };
    } catch (_) { /* ignore */ }
  };

  // subId is passed explicitly (not read from state) so navigation always has it.
  const finish = (subId, status, errMsg) => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (socketRef.current) socketRef.current.disconnect();
    if (status === 'done') {
      notifyReady();
      if (loggedIn) navigate(`/video-results/${subId}`);
      else setPhase('done');
    } else {
      setError(errMsg || 'Processing failed. Please try again.');
      setPhase('error');
    }
  };

  const watchProcessing = (subId) => {
    const socket = io('/', { path: '/socket.io' });
    socketRef.current = socket;
    socket.on('connect', () => socket.emit('subscribe_video', { submission_id: subId }));
    socket.on('video_job_progress', (d) => { if (d.submission_id === subId) setStage(d.stage); });
    socket.on('video_job_done', (d) => { if (d.submission_id === subId) finish(subId, d.status, d.error); });

    pollRef.current = setInterval(async () => {
      try {
        const res = await apiClient.get(`/video/submissions/${subId}/status`);
        if (res.data.status === 'scored') finish(subId, 'done');
        else if (res.data.status === 'failed') finish(subId, 'failed', res.data.error);
      } catch (_) { /* ignore */ }
    }, 5000);

    // After 10 minutes still processing → show an error so the student isn't stuck forever
    setTimeout(() => {
      if (pollRef.current) {
        finish(subId, 'failed', 'Processing is taking too long. Please try uploading again or contact support.');
      }
    }, 10 * 60 * 1000);
  };

  const handleUpload = async () => {
    setError('');
    if (!name.trim() || !email.trim()) { setError('Please enter your name and email.'); return; }
    if (!EMAIL_RE.test(email.trim())) { setError('Please enter a valid email address.'); return; }
    if (!file) { setError('Please choose a video file.'); return; }

    setPhase('uploading');
    setProgress(0);
    setElapsed(0);
    // Ask for notification permission here — this click is the user gesture
    // browsers require. Best-effort; we still poll/navigate regardless.
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().then(setNotifyState).catch(() => {});
    }
    const contentType = file.type || 'video/mp4';

    let createdSubmissionId = null;
    let uploadConfirmed = false;
    try {
      const res = await apiClient.post('/video/submissions', {
        config_id: configId,
        name: name.trim(),
        email: email.trim(),
        filename: file.name,
        content_type: contentType,
      });
      const { submission_id, upload_url, content_type: signedType } = res.data;
      createdSubmissionId = submission_id;

      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', upload_url);
        xhr.setRequestHeader('Content-Type', signedType || contentType);
        xhr.upload.onprogress = (e) => { if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100)); };
        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300) ? resolve() : reject(new Error(`Upload failed (${xhr.status})`));
        xhr.onerror = () => reject(new Error('Upload failed — check your connection.'));
        xhr.send(file);
      });

      await apiClient.post(`/video/submissions/${submission_id}/uploaded`, {});
      uploadConfirmed = true;
      setPhase('processing');
      setStage('downloading');
      watchProcessing(submission_id);
    } catch (e) {
      // Clean up any orphaned submission doc so it doesn't count toward the limit
      // or show as stuck "Processing" in history.
      // Calling /uploaded lets the backend check S3 and mark it as upload_failed if
      // the file never landed; if it did land, the pipeline starts (happy-path recovery).
      if (createdSubmissionId && !uploadConfirmed) {
        apiClient.post(`/video/submissions/${createdSubmissionId}/uploaded`, {}).catch(() => {});
      }
      if (e.response?.status === 409 && e.response?.data?.limit_reached) {
        setLimitReached(true);
        await fetchHistory(email.trim());
        setError('You have reached the maximum of 15 submissions for this assignment.');
        setPhase('form');
        return;
      }
      setError(e.response?.data?.error || e.message || 'Something went wrong.');
      setPhase('error');
    }
  };

  if (phase === 'done') {
    return (
      <Shell title={config?.bot_name}>
        <div className="text-center py-6">
          <FaEnvelope className="text-4xl text-[#FA6C43] mx-auto mb-4" />
          <h2 className="text-lg font-bold text-[#222] mb-2">You're all set!</h2>
          <p className="text-sm text-gray-600">We've emailed a private link to <span className="font-semibold">{email}</span> where you can view your results once they're ready.</p>
        </div>
      </Shell>
    );
  }

  if (phase === 'error') {
    return (
      <Shell title={config?.bot_name}>
        <div className="text-center py-6">
          <FaExclamationTriangle className="text-4xl text-red-500 mx-auto mb-4" />
          <h2 className="text-lg font-bold text-[#222] mb-2">Something went wrong</h2>
          <p className="text-sm text-gray-600 mb-5">{error}</p>
          <button onClick={() => { setPhase('form'); setError(''); }} className="px-6 py-2.5 rounded-xl font-bold text-white bg-[#FA6C43] hover:bg-[#E55B34]">Try again</button>
        </div>
      </Shell>
    );
  }

  if (phase === 'uploading' || phase === 'processing') {
    return (
      <Shell title={config?.bot_name}>
        <div className="py-4">
          {phase === 'uploading' ? (
            <>
              <p className="text-sm font-semibold text-gray-700 mb-2">Uploading… {progress}%</p>
              <div className="w-full h-2.5 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-[#FA6C43] transition-all" style={{ width: `${progress}%` }} />
              </div>
              <p className="text-xs text-gray-400 mt-3 truncate">{file?.name}</p>
            </>
          ) : (
            <div className="text-center">
              {/* Pulsing badge */}
              <div className="relative w-16 h-16 mx-auto mb-5">
                <span className="absolute inset-0 rounded-full bg-[#FA6C43]/20 animate-ping" />
                <span className="relative flex items-center justify-center w-16 h-16 rounded-full bg-[#F9D0C4]/40 text-[#FA6C43]">
                  <FaFilm className="text-2xl" />
                </span>
              </div>

              <h2 className="text-lg font-bold text-[#222]">Analyzing your pitch…</h2>
              <p className="text-sm font-semibold text-[#FA6C43] mt-1">{STAGE_LABEL[stage] || 'Working on it…'}</p>
              <p className="text-xs text-gray-400 mt-1">
                This usually takes 2–4 minutes{elapsed ? ` · ${fmtElapsed(elapsed)} elapsed` : ''}. You can switch tabs — we’ll keep working.
              </p>

              {/* Indeterminate progress shimmer */}
              <div className="mt-4 w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full w-full bg-[#FA6C43]/70 rounded-full animate-pulse" />
              </div>

              {/* Rotating pitch tip */}
              <div className="mt-6 bg-[#F0F6FB] rounded-2xl p-4 text-left min-h-[88px]">
                <p className="text-[11px] font-bold uppercase tracking-wider text-[#FA6C43] mb-1">💡 Pitch tip</p>
                <p key={tipIndex} className="text-sm text-gray-700 leading-relaxed">{TIPS[tipIndex]}</p>
              </div>

              {/* Notify-me opt-in */}
              <div className="mt-5">
                {notifyState === 'granted' ? (
                  <p className="text-xs text-gray-500 flex items-center justify-center gap-1.5">
                    <FaBell className="text-[#FA6C43]" /> We’ll notify you the moment your results are ready.
                  </p>
                ) : (notifyState === 'unsupported' || notifyState === 'denied') ? null : (
                  <button onClick={enableNotify}
                    className="text-xs font-semibold text-[#FA6C43] hover:underline flex items-center justify-center gap-1.5 mx-auto">
                    <FaBell /> Notify me when it’s ready
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </Shell>
    );
  }

  return (
    <Shell title={config?.bot_name}>
      {config?.introduction && (
        <p className="text-sm text-gray-600 mb-5 bg-[#F0F6FB] rounded-xl p-4">{config.introduction}</p>
      )}
      {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-sm">{error}</div>}

      <div className="space-y-4">
        <div>
          <label className="block text-[13px] font-semibold text-gray-700 mb-1.5">Your Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} disabled={loggedIn}
            className="w-full p-3 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-[#FA6C43] disabled:bg-gray-50 disabled:text-gray-500"
            placeholder="Jane Doe" />
        </div>
        <div>
          <label className="block text-[13px] font-semibold text-gray-700 mb-1.5">Email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={loggedIn}
            onBlur={(e) => !loggedIn && fetchHistory(e.target.value)}
            className="w-full p-3 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-[#FA6C43] disabled:bg-gray-50 disabled:text-gray-500"
            placeholder="jane@university.edu" />
          {loggedIn && <p className="text-xs text-gray-400 mt-1">Using your account details.</p>}
        </div>
        <div>
          <label className="block text-[13px] font-semibold text-gray-700 mb-1.5">Your Video</label>
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setDragging(true); }}
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragging(true); }}
            onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setDragging(false); }}
            onDrop={(e) => {
              e.preventDefault(); e.stopPropagation(); setDragging(false);
              const dropped = e.dataTransfer.files?.[0];
              if (dropped) setFile(dropped);
            }}
            className={`flex flex-col items-center justify-center px-6 py-8 border-2 border-dashed rounded-xl cursor-pointer transition-colors ${
              dragging ? 'border-[#FA6C43] bg-[#FFF4F0]' : 'border-gray-300 bg-gray-50 hover:border-[#FA6C43]/50'
            }`}
          >
            <FaUpload className={`text-2xl mb-3 transition-colors ${dragging ? 'text-[#FA6C43]' : 'text-gray-300'}`} />
            <span className="text-sm font-semibold text-gray-700">
              {dragging ? 'Drop your video here' : 'Drag & drop your video here'}
            </span>
            <span className="text-xs text-gray-400 mt-1">{file ? 'or click to replace' : 'or click to browse'}</span>
            <span className="text-[11px] text-gray-300 mt-2">MP4, MOV, WEBM, M4V · up to 1 GB</span>
            <input ref={fileInputRef} type="file" accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm,.m4v" className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </div>

          {/* Attached-file confirmation so it's obvious a video is selected. */}
          {file && (
            <div className="mt-3 flex items-center gap-3 bg-[#F9D0C4]/20 border border-[#FA6C43]/30 rounded-xl p-3">
              <div className="p-2 bg-white rounded-lg text-[#FA6C43]"><FaFileVideo /></div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-800 truncate">{file.name}</p>
                <p className="text-xs text-gray-500">{fmtSize(file.size)} · ready to upload</p>
              </div>
              <button type="button" onClick={() => { setFile(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}
                className="text-gray-400 hover:text-red-500 p-2" title="Remove">
                <FaTimes />
              </button>
            </div>
          )}
        </div>
        {history !== null && history.length > 0 && (
          <div className="border-t border-gray-100 pt-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[13px] font-bold text-gray-700">Your submissions ({history.length}/15)</span>
              {history.length > 1 && (
                <button type="button"
                  onClick={() => navigate(`/video/compare/${configId}?email=${encodeURIComponent(email.trim())}`)}
                  className="text-xs font-semibold text-[#FA6C43] hover:underline">
                  Compare all →
                </button>
              )}
            </div>
            <div className="space-y-2">
              {history.map((sub) => (
                <SubmissionHistoryRow key={sub.submission_id} sub={sub}
                  onClick={() => navigate(`/video-results/${sub.submission_id}`)} />
              ))}
            </div>
          </div>
        )}
        {limitReached && (
          <div className="p-3 bg-amber-50 border border-amber-200 text-amber-700 rounded-xl text-sm">
            You've used all 15 submissions for this assignment.
          </div>
        )}
        <button onClick={handleUpload} disabled={!file || limitReached}
          className="w-full py-3 rounded-xl font-bold text-white bg-[#FA6C43] hover:bg-[#E55B34] transition-all shadow-sm active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed">
          Upload & Analyze
        </button>
      </div>
    </Shell>
  );
}
