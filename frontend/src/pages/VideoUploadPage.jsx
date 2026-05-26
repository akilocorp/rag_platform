import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import { FaFilm, FaUpload, FaSpinner, FaEnvelope, FaExclamationTriangle, FaFileVideo, FaTimes } from 'react-icons/fa';
import apiClient from '../api/apiClient';

const STAGE_LABEL = {
  downloading: 'Preparing your video…',
  extracting_audio: 'Extracting audio…',
  analyzing: 'Analyzing voice & expression…',
  saving: 'Saving collected data…',
  scoring: 'Scoring your presentation…',
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const fmtSize = (bytes) => {
  if (!bytes) return '';
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`;
};

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
            <p className="text-xs text-gray-500">{subtitle || 'Upload your presentation for analysis'}</p>
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

  const socketRef = useRef(null);
  const pollRef = useRef(null);
  const fileInputRef = useRef(null);

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
          if (res.data?.email) setEmail(res.data.email);
        })
        .catch(() => {});
    }
  }, [configId]);

  useEffect(() => () => {
    if (socketRef.current) socketRef.current.disconnect();
    if (pollRef.current) clearInterval(pollRef.current);
  }, []);

  // subId is passed explicitly (not read from state) so navigation always has it.
  const finish = (subId, status, errMsg) => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (socketRef.current) socketRef.current.disconnect();
    if (status === 'done') {
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
  };

  const handleUpload = async () => {
    setError('');
    if (!name.trim() || !email.trim()) { setError('Please enter your name and email.'); return; }
    if (!EMAIL_RE.test(email.trim())) { setError('Please enter a valid email address.'); return; }
    if (!file) { setError('Please choose a video file.'); return; }

    setPhase('uploading');
    setProgress(0);
    const contentType = file.type || 'video/mp4';

    try {
      const res = await apiClient.post('/video/submissions', {
        config_id: configId,
        name: name.trim(),
        email: email.trim(),
        filename: file.name,
        content_type: contentType,
      });
      const { submission_id, upload_url, content_type: signedType } = res.data;

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
      setPhase('processing');
      setStage('downloading');
      watchProcessing(submission_id);
    } catch (e) {
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
        <div className="py-6">
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
              <FaSpinner className="animate-spin text-3xl text-[#FA6C43] mx-auto mb-4" />
              <p className="text-sm font-semibold text-gray-700">{STAGE_LABEL[stage] || 'Processing…'}</p>
              <p className="text-xs text-gray-400 mt-1">This can take a few minutes. Keep this tab open.</p>
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
            className="w-full p-3 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-[#FA6C43] disabled:bg-gray-50 disabled:text-gray-500"
            placeholder="jane@university.edu" />
          {loggedIn && <p className="text-xs text-gray-400 mt-1">Using your account details.</p>}
        </div>
        <div>
          <label className="block text-[13px] font-semibold text-gray-700 mb-1.5">Your Video</label>
          <label className="flex flex-col items-center justify-center px-6 py-8 border-2 border-dashed border-gray-300 rounded-xl cursor-pointer hover:border-[#FA6C43]/50 bg-gray-50">
            <FaUpload className="text-2xl text-gray-400 mb-2" />
            <span className="text-sm text-gray-600">{file ? 'Click to replace' : 'Click to choose a video'}</span>
            <span className="text-xs text-gray-400 mt-1">MP4, MOV, WEBM, M4V (up to 1GB)</span>
            <input ref={fileInputRef} type="file" accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm,.m4v" className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </label>

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
        <button onClick={handleUpload} disabled={!file}
          className="w-full py-3 rounded-xl font-bold text-white bg-[#FA6C43] hover:bg-[#E55B34] transition-all shadow-sm active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed">
          Upload & Analyze
        </button>
      </div>
    </Shell>
  );
}
