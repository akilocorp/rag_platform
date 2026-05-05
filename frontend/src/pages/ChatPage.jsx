import React, { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { FaSpinner, FaPaperPlane, FaExclamationTriangle } from 'react-icons/fa';
import { RiUser3Line } from 'react-icons/ri';
import { FiPaperclip, FiFile, FiX, FiFolder, FiChevronRight, FiLink, FiMenu, FiMoreVertical } from 'react-icons/fi';
import { getBotAvatarIconComponent } from '../components/AvatarSelector';
import ChatSidebar from '../components/SideBar.jsx';
import AvatarView from '../components/AvatarView';
import ThinkingIndicator from '../components/ThinkingIndicator';
import ToolStatusPill from '../components/ToolStatusPill';
import EVIAudioControls from '../components/EVIAudioControls';
import { getModelDisplayName } from '../utils/modelNames';
import apiClient from '../api/apiClient';
import axios from 'axios';
import { io } from 'socket.io-client';
import { useVariant } from '../context/VariantContext';
import { marked } from 'marked';
import renderMathInElement from 'katex/dist/contrib/auto-render.mjs';

marked.use({ gfm: true, breaks: true });

const KATEX_DELIMITERS = [
  { left: '$$', right: '$$', display: true },
  { left: '$', right: '$', display: false },
  { left: '\\(', right: '\\)', display: false },
  { left: '\\[', right: '\\]', display: true },
];

// --- HELPER: Get Token Safely ---
const getToken = () => localStorage.getItem('jwtToken') || localStorage.getItem('access_token');

// Reconstruct paired tool calls from a persisted Anthropic block trace.
// trace: [{type: 'text'|'tool_use'|'tool_result', ...}]
// returns: [{id, name, input, result?, is_error?}, ...]
const extractToolCallsFromTrace = (trace) => {
  if (!Array.isArray(trace)) return [];
  const calls = [];
  const byId = {};
  for (const block of trace) {
    if (block?.type === 'tool_use') {
      const call = { id: block.id, name: block.name, input: block.input || {} };
      calls.push(call);
      byId[block.id] = call;
    } else if (block?.type === 'tool_result') {
      const call = byId[block.tool_use_id];
      if (call) {
        call.result = typeof block.content === 'string'
          ? block.content
          : JSON.stringify(block.content);
        call.is_error = !!block.is_error;
      }
    }
  }
  return calls;
};

const safeHostname = (url) => {
  try { return new URL(url).hostname; } catch { return url; }
};

// Build a deduped list of cited URLs from completed tool calls.
// - web_fetch: the input URL
// - web_search: parses "[N] title — url" lines from the result
const extractSources = (toolCalls) => {
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) return [];
  const seen = new Set();
  const sources = [];
  const push = (url, title) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    sources.push({ url, title: title || safeHostname(url) });
  };
  for (const tc of toolCalls) {
    if (!tc || tc.is_error) continue;
    if (tc.name === 'web_fetch') {
      push(tc.input?.url, null);
    } else if (tc.name === 'web_search' && typeof tc.result === 'string') {
      const re = /\[(\d+)\]\s+(.+?)\s+—\s+(https?:\/\/\S+)/g;
      let m;
      while ((m = re.exec(tc.result)) !== null) {
        push(m[3], m[2]);
      }
    }
  }
  return sources;
};

// --- MODERN CHAT MESSAGE COMPONENT ---
const ChatMessage = React.memo(({ message, botAvatarId }) => {
  const { sender, text, isTyping } = message;
  const toolCalls = message.tool_calls || [];
  const attachedFiles = message.attachedFiles || [];
  const isUser = sender === 'user';
  const hasToolCalls = toolCalls.length > 0;
  const hasAttachedFiles = isUser && attachedFiles.length > 0;
  const showThinking = !isUser && isTyping && !text && !hasToolCalls;
  const BotIcon = !isUser ? getBotAvatarIconComponent(botAvatarId) : null;
  const mdRef = useRef(null);
  const sources = !isUser ? extractSources(toolCalls) : [];

  useLayoutEffect(() => {
    if (showThinking) return;
    const el = mdRef.current;
    if (!el) return;
    el.innerHTML = marked.parse(text || '');
    try {
      renderMathInElement(el, {
        delimiters: KATEX_DELIMITERS,
        throwOnError: false,
        strict: false,
        trust: false,
      });
    } catch (e) {
      console.warn('KaTeX render:', e);
    }
  }, [text, showThinking]);

  return (
    <div className={`flex gap-4 ${isUser ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-2 duration-300`}>
      {!isUser && BotIcon && (
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[#F9D0C4]/60 flex items-center justify-center mt-1">
          <BotIcon className="text-[#FA6C43] text-sm" />
        </div>
      )}

      <div className={`min-w-0 max-w-[88%] text-sm leading-relaxed break-words ${
        isUser
          ? 'bg-[#FA6C43] hover:bg-[#E55B34] text-white rounded-2xl rounded-br-none px-4 py-3 sm:px-5 shadow-sm'
          : 'text-[#222] mt-1'
      }`}>
          {hasAttachedFiles && (
            <div className="flex flex-wrap gap-1.5 mb-2 -mx-1">
              {attachedFiles.map((f) => (
                <div
                  key={f._id}
                  className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-white/20 border border-white/30 text-[11px] text-white max-w-[240px]"
                  title={f.folder_path ? `${f.folder_path}/${f.filename}` : f.filename}
                >
                  {f.is_url ? (
                    <FiLink className="w-3 h-3 flex-shrink-0" />
                  ) : f.folder_path ? (
                    <FiFolder className="w-3 h-3 flex-shrink-0" />
                  ) : (
                    <FiFile className="w-3 h-3 flex-shrink-0" />
                  )}
                  <span className="truncate">{f.filename}</span>
                </div>
              ))}
            </div>
          )}

          {!isUser && hasToolCalls && (
            <div className="mb-1">
              {toolCalls.map((tc) => (
                <ToolStatusPill key={tc.id} toolCall={tc} />
              ))}
            </div>
          )}

          {showThinking ? (
            <ThinkingIndicator />
          ) : (
            <div
              ref={mdRef}
              className={`chat-message-md prose max-w-none ${
                isUser ? 'chat-message-md--invert prose-invert' : 'chat-message-md--light'
              }`}
            />
          )}

          {!isUser && sources.length > 0 && (
            <div className="mt-3 pt-3 border-t border-gray-100">
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">Sources</p>
              <div className="flex flex-wrap gap-1.5">
                {sources.map((s, i) => (
                  <a
                    key={s.url}
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-[#F0F6FB] hover:bg-[#F9D0C4]/40 text-[11px] text-[#222] hover:text-[#FA6C43] transition-colors max-w-[300px]"
                    title={s.title ? `${s.title} — ${s.url}` : s.url}
                  >
                    <span className="text-[#FA6C43] font-semibold">[{i + 1}]</span>
                    <span className="truncate">{s.title}</span>
                  </a>
                ))}
              </div>
            </div>
          )}
      </div>

      {isUser && (
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[#F9D0C4]/60 flex items-center justify-center mt-1">
          <RiUser3Line className="text-[#FA6C43] text-sm" />
        </div>
      )}
    </div>
  );
});

const ChatPage = () => {
  const { configId, chatId } = useParams();
  const navigate = useNavigate();
  const { variant } = useVariant();
  
  // --- STATE ---
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [config, setConfig] = useState(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [isSending, setIsSending] = useState(false);

  // Sidebar/User State
  const [sessions, setSessions] = useState([]);
  const [newlyCreatedSessionId, setNewlyCreatedSessionId] = useState(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [userInfo, setUserInfo] = useState(null);

  // Avatar State
  const [avatarSession, setAvatarSession] = useState(null);
  const [avatarError, setAvatarError] = useState(false);

  // File Library State
  const [sidebarTab, setSidebarTab] = useState('chats');
  const [currentFolder, setCurrentFolder] = useState('');
  const [libraryFiles, setLibraryFiles] = useState([]);
  const [libraryFolders, setLibraryFolders] = useState([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [sessionUploads, setSessionUploads] = useState([]);
  // Variant A: tracks which library files are selected for this chat session
  const [selectedFileIds, setSelectedFileIds] = useState([]);
  const [isFetchingUrl, setIsFetchingUrl] = useState(false);
  const libraryLoadedRef = useRef(false);

  // --- REFS (The "Brain" of the component) ---
  const currentChatIdRef = useRef(chatId); // Tracks the session ID across renders
  const userFetchRef = useRef(false);
  const sessionFetchRef = useRef(null);
  const messagesEndRef = useRef(null);
  const isStreamingRef = useRef(false); // New: specifically tracks if we are in the middle of a fetch
  const inputRef = useRef(null);
  const attachInputRef = useRef(null);
  const optionsRef = useRef(null);
  const qualtricsSentCountRef = useRef(0); // Tracks how many messages have been sent to Qualtrics

  const isAuthenticated = !!getToken();

  // Sync Ref with URL param
  useEffect(() => {
    currentChatIdRef.current = chatId;
  }, [chatId]);

  // Auto-expand textarea as user types
  const adjustInputHeight = useCallback(() => {
    const ta = inputRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
  }, []);

  useEffect(() => {
    adjustInputHeight();
  }, [input, adjustInputHeight]);

  // --- 1. INITIALIZATION: FETCH USER ---
  useEffect(() => {
    const token = getToken();
    if (token && !userFetchRef.current) {
        userFetchRef.current = true;
        apiClient.get('/auth/me').then(res => setUserInfo(res.data)).catch(() => {});
    }
  }, []);

  // --- 1b. SOCKET: listen for async upload completion ---
  // Async PDF uploads return 202 with a job_id; the backend pushes
  // 'upload_job_done' once Claude OCR + indexing finishes. We update the
  // matching file row in libraryFiles in place.
  useEffect(() => {
    const uid = userInfo?.user_id || userInfo?.id;
    if (!uid) return;

    const socket = io("/", { path: "/socket.io" });
    socket.on('connect', () => socket.emit('subscribe_uploads', { user_id: uid }));
    socket.on('upload_job_progress', (data) => {
      if (!data || !data.file_id) return;
      const patch = { progress: { stage: data.stage, batch: !!data.batch, pages: data.pages || 0 } };
      setLibraryFiles((prev) => prev.map((f) => f._id === data.file_id ? { ...f, ...patch } : f));
      setSessionUploads((prev) => prev.map((f) => f._id === data.file_id ? { ...f, ...patch } : f));
    });
    socket.on('upload_job_done', (data) => {
      if (!data || !data.file_id) return;
      if (data.status === 'done') {
        const patch = { vector_ingested: true, ingest_status: 'done', progress: undefined };
        setLibraryFiles((prev) => prev.map((f) => f._id === data.file_id ? { ...f, ...patch } : f));
        setSessionUploads((prev) => prev.map((f) => f._id === data.file_id ? { ...f, ...patch } : f));
      } else if (data.status === 'failed') {
        setLibraryFiles((prev) => prev.filter((f) => f._id !== data.file_id));
        setSessionUploads((prev) => prev.filter((f) => f._id !== data.file_id));
        setSelectedFileIds((prev) => prev.filter((id) => id !== data.file_id));
        setUploadError(`Failed to process ${data.filename}${data.error ? `: ${data.error}` : ''}`);
      }
    });

    return () => { socket.disconnect(); };
  }, [userInfo]);

  // --- 2. FETCH CONFIG ---
  useEffect(() => {
    let isMounted = true;
    const fetchConfig = async () => {
      try {
        const token = getToken();
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        const response = await axios.get(`/api/config/${configId}`, { headers });
        if (isMounted) {
          setConfig(response.data.config);
          setIsInitializing(false);
        }
      } catch (e) { 
        if (isMounted) {
            setError("Could not load bot.");
            setIsInitializing(false);
        }
      } 
    };
    fetchConfig();
    return () => { isMounted = false; };
  }, [configId]);

  // --- 3. SESSION LIST MANAGEMENT ---
  const fetchSessions = useCallback(async (force = false) => {
    if (!isAuthenticated) return;
    if (!force && sessionFetchRef.current === configId) return;
    sessionFetchRef.current = configId;
    try {
      const res = await apiClient.get(`/chat/list/${configId}`);
      setSessions(res.data.sessions || []);
    } catch (e) { console.error("Session fetch failed", e); }
  }, [configId, isAuthenticated]);

  useEffect(() => { fetchSessions(); }, [fetchSessions]);

  // --- 3b. FILE LIBRARY ---
  const loadLibrary = useCallback(async () => {
    if (!isAuthenticated) return;
    setFilesLoading(true);
    try {
      const scope = variant === 'B' ? `?config_id=${configId}` : '';
      const [filesRes, foldersRes] = await Promise.all([
        apiClient.get(`/files${scope}`),
        apiClient.get(`/folders${scope}`),
      ]);
      const visible = (filesRes.data.files || []).filter((f) => f.ingest_status !== 'failed');
      setLibraryFiles(visible);
      // Sync sessionUploads against the fresh server state. Without this, a
      // poll-discovered completion would leave sessionUploads stale at
      // vector_ingested:false — and the chip blocks (sessionUploads requires
      // ingested, librarySelected skips anything in sessionUploads) would
      // hide the file until the user reloads.
      const visibleById = new Map(visible.map((f) => [f._id, f]));
      setSessionUploads((prev) => prev
        .filter((su) => visibleById.has(su._id))
        .map((su) => ({ ...su, ...visibleById.get(su._id) }))
      );
      setLibraryFolders((foldersRes.data.folders || []).map((f) => f.path));
    } catch (e) {
      console.error('Library fetch failed', e);
    } finally {
      setFilesLoading(false);
    }
  }, [isAuthenticated, variant, configId]);

  useEffect(() => {
    if (!isAuthenticated) return;
    libraryLoadedRef.current = true;
    loadLibrary();
  }, [isAuthenticated, loadLibrary]);

  // POLL fallback for stuck pending files — if the upload_job_done socket
  // event is missed (backend restart, network hiccup), the row would sit on
  // "Indexing…" forever. Resync every 30s while anything is pending; loadLibrary
  // also drops files the backend has marked failed.
  const hasPendingFiles = libraryFiles.some((f) => f.vector_ingested === false);
  useEffect(() => {
    if (!hasPendingFiles) return;
    const id = setInterval(() => loadLibrary(), 30000);
    return () => clearInterval(id);
  }, [hasPendingFiles, loadLibrary]);

  const uploadFiles = useCallback(async (fileList, folderPath = currentFolder) => {
    if (!fileList || fileList.length === 0) return;
    setIsUploading(true);
    setUploadError(null);
    const uploaded = [];
    try {
      for (const file of fileList) {
        const form = new FormData();
        form.append('file', file);
        form.append('folder_path', folderPath || '');
        if (variant === 'B') form.append('config_id', configId);
        try {
          const res = await apiClient.post('/files', form, {
            headers: { 'Content-Type': 'multipart/form-data' },
          });
          if (res.data?.file) {
            uploaded.push(res.data.file);
            setLibraryFiles((prev) => [res.data.file, ...prev]);
          }
        } catch (err) {
          const msg = err.response?.data?.message || `Failed to upload ${file.name}`;
          setUploadError(msg);
        }
      }
      if (uploaded.length) {
        setSessionUploads((prev) => [...prev, ...uploaded]);
        // Variant A: auto-select newly uploaded files
        if (variant === 'A') {
          setSelectedFileIds((prev) => [...prev, ...uploaded.map((f) => f._id)]);
        }
      }
    } finally {
      setIsUploading(false);
    }
  }, [currentFolder, variant, configId]);

  const uploadUrl = useCallback(async (url, folderPath = currentFolder) => {
    if (!url || !url.trim()) return;
    setIsUploading(true);
    setUploadError(null);
    try {
      const res = await apiClient.post('/files/url', {
        url: url.trim(),
        folder_path: folderPath || '',
        ...(variant === 'B' ? { config_id: configId } : {}),
      });
      const f = res.data?.file;
      if (f) {
        setLibraryFiles((prev) => [f, ...prev]);
        setSessionUploads((prev) => [...prev, f]);
        if (variant === 'A') {
          setSelectedFileIds((prev) => [...prev, f._id]);
        }
      }
    } catch (err) {
      const msg = err.response?.data?.message || 'Failed to ingest URL';
      setUploadError(msg);
    } finally {
      setIsUploading(false);
    }
  }, [currentFolder, variant, configId]);

  const deleteLibraryFile = useCallback(async (fileId) => {
    let prevLibrary, prevSession, prevSelected;
    setLibraryFiles((prev) => { prevLibrary = prev; return prev.filter((f) => f._id !== fileId); });
    setSessionUploads((prev) => { prevSession = prev; return prev.filter((f) => f._id !== fileId); });
    setSelectedFileIds((prev) => { prevSelected = prev; return prev.filter((id) => id !== fileId); });
    try {
      await apiClient.delete(`/files/${fileId}`);
    } catch (e) {
      console.error('Delete file failed, restoring row', e);
      setLibraryFiles(prevLibrary);
      setSessionUploads(prevSession);
      setSelectedFileIds(prevSelected);
      throw e;
    }
  }, []);

  const createFolder = useCallback(async (path) => {
    try {
      const body = { path };
      if (variant === 'B') body.config_id = configId;
      await apiClient.post('/folders', body);
      setLibraryFolders((prev) => (prev.includes(path) ? prev : [...prev, path].sort()));
    } catch (e) {
      console.error('Create folder failed', e);
    }
  }, [variant, configId]);

  const deleteFolder = useCallback(async (path) => {
    let prevFolders;
    setLibraryFolders((prev) => { prevFolders = prev; return prev.filter((p) => p !== path && !p.startsWith(`${path}/`)); });
    try {
      const params = { path };
      if (variant === 'B') params.config_id = configId;
      await apiClient.delete('/folders', { params });
    } catch (e) {
      console.error('Delete folder failed, restoring', e);
      setLibraryFolders(prevFolders);
      throw e;
    }
  }, [variant, configId]);

  const handleAttachPick = () => attachInputRef.current?.click();

  const handleAttachChange = (e) => {
    const picked = Array.from(e.target.files || []);
    if (picked.length) uploadFiles(picked, currentFolder);
    e.target.value = '';
  };

  const removeFromSession = (fileId) => {
    setSessionUploads((prev) => prev.filter((f) => f._id !== fileId));
    setSelectedFileIds((prev) => prev.filter((id) => id !== fileId));
  };

  const fetchUrl = useCallback(async (url, folderPath = currentFolder) => {
    setIsFetchingUrl(true);
    setUploadError(null);
    try {
      const body = { url, folder_path: folderPath || '' };
      if (variant === 'B') body.config_id = configId;
      const res = await apiClient.post('/files/url', body);
      if (res.data?.file) {
        setLibraryFiles((prev) => [res.data.file, ...prev]);
        setSessionUploads((prev) => [...prev, res.data.file]);
        if (variant === 'A') setSelectedFileIds((prev) => [...prev, res.data.file._id]);
      }
    } catch (err) {
      setUploadError(err.response?.data?.message || 'Failed to fetch URL');
    } finally {
      setIsFetchingUrl(false);
    }
  }, [currentFolder, variant, configId]);

  const toggleFileSelection = (fileId) => {
    setSelectedFileIds((prev) =>
      prev.includes(fileId) ? prev.filter((id) => id !== fileId) : [...prev, fileId]
    );
  };

  // --- 4. HISTORY LOADER (Guarded) ---
  useEffect(() => {
    const loadHistory = async () => {
      // Logic: Only load history if we have a chatId and we AREN'T currently streaming/transitioning
      if (!chatId || isStreamingRef.current) return;

      try {
        const res = await apiClient.get(`/history/${chatId}`);
        const historyData = res.data.history || [];
        setMessages(historyData.map(msg => {
          const trace = msg.data?.additional_kwargs?.tool_trace;
          const attached = msg.data?.additional_kwargs?.attached_files;
          return {
            sender: msg.type === 'human' ? 'user' : 'ai',
            text: msg.data.content,
            tool_calls: trace ? extractToolCallsFromTrace(trace) : [],
            attachedFiles: Array.isArray(attached) ? attached : [],
          };
        }));
      } catch (e) { console.error("History load failed", e); }
    };
    loadHistory();
  }, [chatId]); // Fires when user clicks a session in sidebar

  // --- 5. THE UNIFIED MESSAGE PROCESSOR ---
  const handleMessageProcess = useCallback(async (textInput) => {
    if (!textInput || !textInput.trim() || isLoading) return;

    // A. Determine the working ID
    const isNewChat = !currentChatIdRef.current;
    const workingChatId = currentChatIdRef.current || `chat_${Date.now()}`;
    
    // B. Guard the state: Block the history Effect from firing
    isStreamingRef.current = true; 
    setIsLoading(true);

    // Snapshot every chip currently shown above the input — both library
    // selections and session uploads — so they ride along with this prompt
    // and disappear from the input box once it's sent.
    const sessionIds = new Set(sessionUploads.map((f) => f._id));
    const librarySelected = variant === 'A'
        ? selectedFileIds
            .filter((id) => !sessionIds.has(id))
            .map((id) => libraryFiles.find((f) => f._id === id))
            .filter(Boolean)
        : [];
    const attachedFiles = [...librarySelected, ...sessionUploads].map((f) => ({
        _id: f._id,
        filename: f.filename,
        folder_path: f.folder_path,
        is_url: f.is_url,
    }));

    // C. Optimistic UI Update
    setMessages(prev => [
        ...prev,
        { sender: 'user', text: textInput, attachedFiles },
        { sender: 'ai', text: '', isTyping: true }
    ]);

    // Clear chips from the input box now that they've been pinned to the prompt
    if (attachedFiles.length > 0) {
        setSelectedFileIds([]);
        setSessionUploads([]);
    }

    // D. Navigation (Non-blocking)
    if (isNewChat) {
        currentChatIdRef.current = workingChatId; // Set immediately so next send uses it
        navigate(`/chat/${configId}/${workingChatId}`, { replace: true });
        setSessions(prev => [{ session_id: workingChatId, pending: true, title: null, timestamp: new Date().toISOString() }, ...prev]);
        setNewlyCreatedSessionId(workingChatId);
    }

    try {
      const token = getToken();
      const response = await fetch(`/api/chat/${configId}/${workingChatId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          input: textInput,
          variant,
          selected_file_ids: variant === 'A' ? selectedFileIds : [],
          attached_files: attachedFiles,
        })
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let accumulatedText = '';
      let currentSentence = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunkStr = decoder.decode(value, { stream: true });
        const lines = chunkStr.split('\n').filter(Boolean);

        for (const line of lines) {
          try {
            const data = JSON.parse(line);
            const content = data.data || data.chunk;
            if (content && (data.type === 'token' || !data.type)) {
              accumulatedText += content;
              currentSentence += content;

              setMessages(prev => {
                const newMsgs = [...prev];
                const lastIdx = newMsgs.length - 1;
                newMsgs[lastIdx] = { ...newMsgs[lastIdx], text: accumulatedText, isTyping: false };
                return newMsgs;
              });

              // Avatar Integration
              if (avatarSession && /[.!?]/.test(content) && currentSentence.trim().length > 10) {
                apiClient.post('/heygen/task', {
                  session_id: avatarSession.session_id,
                  heygen_token: avatarSession.heygen_token,
                  text: currentSentence
                }).catch(() => {});
                currentSentence = '';
              }
            } else if (data.type === 'tool_use') {
              setMessages(prev => {
                const newMsgs = [...prev];
                const lastIdx = newMsgs.length - 1;
                const existing = newMsgs[lastIdx].tool_calls || [];
                newMsgs[lastIdx] = {
                  ...newMsgs[lastIdx],
                  isTyping: false,
                  tool_calls: [
                    ...existing,
                    { id: data.id, name: data.name, input: data.input || {} },
                  ],
                };
                return newMsgs;
              });
            } else if (data.type === 'tool_result') {
              setMessages(prev => {
                const newMsgs = [...prev];
                const lastIdx = newMsgs.length - 1;
                const existing = newMsgs[lastIdx].tool_calls || [];
                newMsgs[lastIdx] = {
                  ...newMsgs[lastIdx],
                  tool_calls: existing.map((tc) =>
                    tc.id === data.id
                      ? { ...tc, result: data.content, is_error: !!data.is_error }
                      : tc
                  ),
                };
                return newMsgs;
              });
            }
          } catch (e) { /* partial JSON chunk */ }
        }
      }

      // Final avatar task
      if (avatarSession && currentSentence.trim().length > 0) {
        apiClient.post('/heygen/task', { 
           session_id: avatarSession.session_id, 
           heygen_token: avatarSession.heygen_token, 
           text: currentSentence 
        }).catch(() => {});
      }

      if (isNewChat) fetchSessions(true);

    } catch (e) {
        console.error("Stream Error:", e);
        setError("Connection lost. Please try again.");
    } finally {
      setIsLoading(false);
      isStreamingRef.current = false; // "Unlock" the history loader
    }
  }, [configId, navigate, avatarSession, fetchSessions, isLoading, variant, selectedFileIds, sessionUploads, libraryFiles]);

  const handleTextSend = () => { handleMessageProcess(input); setInput(''); };

  const handleSendWithAnimation = () => {
    if (!input.trim() || isLoading) return;
    setIsSending(true);
    handleTextSend();
  };

  // --- EVI (Hume) audio turn handler ---
  // Each finalized user/assistant turn from EVI: render a bubble, persist to
  // audio_sessions, and notify the Qualtrics parent.
  const handleEVITurn = useCallback(async ({ role, transcript, prosody }) => {
    if (!transcript) return;

    let workingChatId = currentChatIdRef.current;
    if (!workingChatId) {
      workingChatId = `chat_${Date.now()}`;
      currentChatIdRef.current = workingChatId;
      navigate(`/chat/${configId}/${workingChatId}`, { replace: true });
    }

    setMessages(prev => [
      ...prev,
      {
        sender: role === 'assistant' ? 'ai' : 'user',
        text: transcript,
        audio: { prosody: prosody || null },
      },
    ]);

    try {
      window.parent.postMessage({
        type: 'AUDIO_MESSAGE',
        sender: role === 'assistant' ? 'ai' : 'user',
        content: transcript,
        prosody: prosody || null,
        timestamp: new Date().toISOString(),
      }, '*');
    } catch (_) { /* iframe-less context */ }

    try {
      await apiClient.post('/audio/session/turn', {
        session_id: workingChatId,
        config_id: configId,
        chat_type: '1on1',
        role,
        transcript,
        prosody_scores: prosody || null,
      });
    } catch (e) {
      console.warn('Failed to persist audio turn', e);
    }
  }, [configId, navigate]);

  const handleEVIError = useCallback((msg) => {
    console.warn('EVI error:', msg);
  }, []);

  useEffect(() => {
    const handler = (e) => {
      if (optionsRef.current && !optionsRef.current.contains(e.target)) {
        setShowOptions(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // --- 6. QUALTRICS INTEGRATION: Send messages to Parent Window ---
  useEffect(() => {
    if (messages.length === 0) return;

    // Send all messages that haven't been sent yet (handles user+AI added in same render)
    const unsent = messages.slice(qualtricsSentCountRef.current);
    unsent.forEach((msg, i) => {
      const absoluteIndex = qualtricsSentCountRef.current + i;

      // Skip streaming AI placeholders (empty text, isTyping) — wait for the final update
      if (msg.sender === 'ai' && (!msg.text || msg.isTyping)) return;

      window.parent.postMessage({
        type: "CHAT_MESSAGE",
        sender: msg.sender,
        content: msg.text,
        timestamp: new Date().toISOString()
      }, "*");

      // Initialize config on the very first message
      if (absoluteIndex === 0) {
        window.parent.postMessage({
          type: "INIT_RAG_CONFIG",
          payload: { configId, chatId: currentChatIdRef.current }
        }, "*");
      }

      qualtricsSentCountRef.current = absoluteIndex + 1;
    });

  }, [messages, configId]); // <--- Runs every time 'messages' changes

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  if (isInitializing) return (
    <div className="h-screen flex items-center justify-center bg-[#F0F6FB] text-[#222] flex-col gap-4">
        <FaSpinner className="animate-spin text-4xl text-[#FA6C43]" />
    </div>
  );

  const isAvatarMode = config?.bot_type === 'avatar';
  const showAvatar = isAvatarMode && !avatarError;

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-[#F0F6FB] font-sans text-[#222]" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
      {isAuthenticated && isMobileSidebarOpen && (
          <button
              type="button"
              aria-label="Close sidebar"
              className="fixed inset-0 z-40 bg-black/40 md:hidden"
              onClick={() => setIsMobileSidebarOpen(false)}
          />
      )}

      {isAuthenticated && (
          <ChatSidebar
              sessions={sessions}
              newlyCreatedSessionId={newlyCreatedSessionId}
              userInfo={userInfo}
              userInfoLoaded={!!userInfo}
              configId={configId}
              isCollapsed={isSidebarCollapsed}
              isMobileOpen={isMobileSidebarOpen}
              onClose={() => setIsMobileSidebarOpen(false)}
              onToggle={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
              onNewChat={() => { setMessages([]); navigate(`/chat/${configId}`); setIsMobileSidebarOpen(false); }}
              onNavigateWithAutoSave={(cb) => cb()}
              activeTab={sidebarTab}
              onSetTab={setSidebarTab}
              currentFolder={currentFolder}
              onSetFolder={setCurrentFolder}
              libraryFiles={libraryFiles}
              libraryFolders={libraryFolders}
              filesLoading={filesLoading}
              isUploading={isUploading}
              uploadError={uploadError}
              onUpload={uploadFiles}
              onUploadUrl={uploadUrl}
              onFetchUrl={uploadUrl}
              isFetchingUrl={isFetchingUrl}
              onDeleteFile={deleteLibraryFile}
              onCreateFolder={createFolder}
              onDeleteFolder={deleteFolder}
              selectable={variant === 'A'}
              selectedFileIds={selectedFileIds}
              onToggleFile={toggleFileSelection}
              libraryLabel={variant === 'B' ? `${config?.bot_name || 'Bot'} Files` : 'My Library'}
              onDeleteSession={(id) => setSessions(prev => prev.filter(s => s.session_id !== id))}
          />
      )}

      <div className={`relative flex-1 flex flex-col w-full h-full transition-all duration-300 ${isAuthenticated && !isSidebarCollapsed ? 'md:ml-72' : 'md:ml-20'}`}>
        
        <header className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-gray-200 bg-white/95 backdrop-blur z-10 h-16">
            <div className="flex items-center gap-3">
                {isAuthenticated && (
                  <button
                    type="button"
                    onClick={() => setIsMobileSidebarOpen(true)}
                    className="p-2 -ml-1 rounded-lg text-gray-500 hover:bg-[#F0F6FB] hover:text-[#FA6C43] transition-colors md:hidden"
                    aria-label="Open sidebar"
                  >
                    <FiMenu className="w-5 h-5" />
                  </button>
                )}
                {(() => {
                  const HeaderIcon = getBotAvatarIconComponent(config?.bot_avatar);
                  if (!HeaderIcon) return null;
                  return (
                <div className="p-2 rounded-lg bg-[#F9D0C4]/40 text-[#FA6C43]">
                    <HeaderIcon className="text-xl" />
                </div>
                  );
                })()}
                <div>
                    <h1 className="font-semibold text-[#222] text-base">{config?.bot_name || "AI Assistant"}</h1>
                    {config?.model_name && <p className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">{getModelDisplayName(config.model_name)}</p>}
                </div>
            </div>
        </header>

        {avatarError && isAvatarMode && (
           <div className="bg-red-500/10 border-b border-red-500/20 px-4 py-2 flex items-center justify-center gap-2 text-red-400 text-sm">
               <FaExclamationTriangle />
               <span>Avatar connection failed. Switched to text mode.</span>
               <button onClick={() => setAvatarError(false)} className="underline hover:text-red-300 ml-2">Retry</button>
           </div>
        )}

        {showAvatar ? (
            <div className="flex-1 relative flex flex-col overflow-hidden">
                <AvatarView 
                    config={config}
                    onAvatarReady={(data) => setAvatarSession(data)}
                    onUserVoiceInput={handleMessageProcess} 
                    isProcessing={isLoading}
                    onEndSession={() => setAvatarSession(null)}
                />
                
                {messages.length > 0 && (
                    <div className="absolute bottom-6 right-6 w-80 max-h-60 overflow-y-auto bg-black/40 backdrop-blur-xl border border-white/10 rounded-2xl p-4 space-y-3 z-10 scrollbar-hide">
                        {messages.slice(-3).map((m, i) => (
                             <div key={i} className={`text-xs leading-relaxed ${m.sender === 'user' ? 'text-gray-300' : 'text-white'}`}>
                                <span className={`font-bold mr-1 ${m.sender === 'user' ? 'text-[#FA6C43]' : 'text-[#FA6C43]'}`}>
                                    {m.sender === 'user' ? 'You:' : 'AI:'}
                                </span>
                                {m.text}
                             </div>
                        ))}
                    </div>
                )}
            </div>
        ) : (
            <>
                <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:px-12 xl:px-20 scrollbar-thin">
                     <div className="w-full space-y-6 pb-4">
                        {messages.length === 0 && (
                            <div className="flex flex-col items-center justify-center h-[60vh] text-center opacity-80">
                                {(() => {
                                  const EmptyIcon = getBotAvatarIconComponent(config?.bot_avatar);
                                  if (!EmptyIcon) return null;
                                  return (
                                <div className="w-20 h-20 bg-[#F9D0C4]/40 rounded-3xl flex items-center justify-center mb-6">
                                    <EmptyIcon className="text-5xl text-[#FA6C43]" />
                                </div>
                                  );
                                })()}
                                <h2 className="text-2xl font-bold text-[#222] mb-2">{config?.bot_name || "AI Assistant"}</h2>
                                <p className="text-gray-600 max-w-md">{config?.introduction || "I'm ready to help."}</p>
                            </div>
                        )}
                        {messages.map((msg, i) => (
                          <ChatMessage key={i} message={msg} botAvatarId={config?.bot_avatar} />
                        ))}
                        <div ref={messagesEndRef} />
                     </div>
                </main>

                <footer className="p-4 sm:p-6 lg:px-12 xl:px-20 bg-white border-t border-gray-200">
                    <div className="w-full">
                        {(() => {
                            if (!config?.web_access || !(config?.model_name || '').toLowerCase().startsWith('claude')) return null;
                            const matches = (input.match(/(https?:\/\/[^\s]+)/g) || []).slice(0, 3);
                            if (matches.length === 0) return null;
                            return (
                                <div className="flex flex-wrap items-center gap-2 mb-4">
                                    {matches.map((url) => {
                                        let host = url;
                                        try { host = new URL(url).hostname; } catch { /* ignore */ }
                                        return (
                                            <div
                                                key={url}
                                                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#F0F6FB] border border-gray-200 text-xs text-[#222]"
                                                title={url}
                                            >
                                                <FiLink className="w-3 h-3 text-[#FA6C43] flex-shrink-0" />
                                                <span className="truncate max-w-[200px]">{host}</span>
                                                <span className="text-gray-500">— will be fetched</span>
                                            </div>
                                        );
                                    })}
                                </div>
                            );
                        })()}
                        {variant === 'A' && (() => {
                            const sessionIds = new Set(sessionUploads.map((f) => f._id));
                            const librarySelected = selectedFileIds
                                .filter((id) => !sessionIds.has(id))
                                .map((id) => libraryFiles.find((f) => f._id === id))
                                .filter(Boolean)
                                .filter((f) => f.vector_ingested === true);
                            if (librarySelected.length === 0) return null;
                            return (
                                <div className="flex flex-wrap items-center gap-2 mb-4">
                                    {librarySelected.map((f) => (
                                        <div
                                            key={f._id}
                                            className="group flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-lg bg-[#F0F6FB] border border-gray-200 text-xs text-[#222] max-w-xs"
                                        >
                                            {f.is_url ? (
                                                <FiLink className="w-3 h-3 text-[#FA6C43] flex-shrink-0" />
                                            ) : f.folder_path ? (
                                                <FiFolder className="w-3 h-3 text-[#FA6C43] flex-shrink-0" />
                                            ) : (
                                                <FiFile className="w-3 h-3 text-gray-500 flex-shrink-0" />
                                            )}
                                            <span className="truncate">
                                                {f.folder_path ? (
                                                    <>
                                                        {f.folder_path.split('/').map((seg, i) => (
                                                            <React.Fragment key={i}>
                                                                <span className="text-gray-500">{seg}</span>
                                                                <FiChevronRight className="inline w-3 h-3 text-gray-400 mx-0.5" />
                                                            </React.Fragment>
                                                        ))}
                                                        {f.filename}
                                                    </>
                                                ) : (
                                                    f.filename
                                                )}
                                            </span>
                                            <button
                                                onClick={() => toggleFileSelection(f._id)}
                                                title="Deselect file"
                                                className="p-0.5 rounded hover:bg-white text-gray-400 hover:text-red-500 transition-colors"
                                            >
                                                <FiX className="w-3 h-3" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            );
                        })()}
                        {(() => {
                            const ingestedSessionUploads = sessionUploads.filter((f) => f.vector_ingested === true);
                            if (ingestedSessionUploads.length === 0) return null;
                            return (
                            <div className="flex flex-wrap items-center gap-2 mb-4">
                                {ingestedSessionUploads.map((f) => (
                                    <div
                                        key={f._id}
                                        className="group flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-lg bg-[#F0F6FB] border border-gray-200 text-xs text-[#222] max-w-xs"
                                    >
                                        {f.folder_path ? (
                                            <FiFolder className="w-3 h-3 text-[#FA6C43] flex-shrink-0" />
                                        ) : (
                                            <FiFile className="w-3 h-3 text-gray-500 flex-shrink-0" />
                                        )}
                                        <span className="truncate">
                                            {f.folder_path ? (
                                                <>
                                                    {f.folder_path.split('/').map((seg, i, arr) => (
                                                        <React.Fragment key={i}>
                                                            <span className="text-gray-500">{seg}</span>
                                                            <FiChevronRight className="inline w-3 h-3 text-gray-400 mx-0.5" />
                                                        </React.Fragment>
                                                    ))}
                                                    {f.filename}
                                                </>
                                            ) : (
                                                f.filename
                                            )}
                                        </span>
                                        <button
                                            onClick={() => removeFromSession(f._id)}
                                            title="Remove from this chat"
                                            className="p-0.5 rounded hover:bg-white text-gray-400 hover:text-red-500 transition-colors"
                                        >
                                            <FiX className="w-3 h-3" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                            );
                        })()}
                        <div className="relative flex items-center gap-1.5 sm:gap-2">
                            <button
                                onClick={handleAttachPick}
                                disabled={isUploading}
                                title="Attach files"
                                className="min-h-[52px] px-3 sm:px-3.5 rounded-2xl border border-gray-200 bg-white hover:bg-[#F0F6FB] text-gray-500 hover:text-[#FA6C43] transition-colors disabled:opacity-50 flex items-center justify-center shrink-0"
                            >
                                {isUploading ? (
                                    <FaSpinner className="animate-spin text-base" />
                                ) : (
                                    <FiPaperclip className="text-base" />
                                )}
                            </button>
                            <input
                                ref={attachInputRef}
                                type="file"
                                multiple
                                className="hidden"
                                onChange={handleAttachChange}
                                accept=".pdf,.txt,.md,.docx,.pptx"
                            />
                            <div className="relative shrink-0" ref={optionsRef}>
                                <button
                                    onClick={() => setShowOptions(v => !v)}
                                    title="More options"
                                    className="min-h-[52px] px-3 sm:px-3.5 rounded-2xl border border-gray-200 bg-white hover:bg-[#F0F6FB] text-gray-500 hover:text-[#FA6C43] transition-colors flex items-center justify-center"
                                >
                                    <FiMoreVertical className="text-base" />
                                </button>
                                {showOptions && (
                                    <div className="absolute bottom-full left-0 mb-2 w-44 bg-white rounded-xl shadow-lg border border-gray-100 p-1 z-50">
                                        <button
                                            className="group w-full flex items-center gap-3 px-3 py-2.5 text-sm text-gray-700 hover:bg-[#FFF5F2] rounded-lg transition-colors"
                                            onClick={() => setShowOptions(false)}
                                        >
                                            <span className="inline-flex transition-transform duration-200 ease-out group-hover:rotate-[-15deg]">
                                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FA6C43" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                                                    <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                                                    <line x1="12" y1="19" x2="12" y2="23"/>
                                                    <line x1="8" y1="23" x2="16" y2="23"/>
                                                </svg>
                                            </span>
                                            Live Drills
                                        </button>
                                    </div>
                                )}
                            </div>
                            <textarea
                                ref={inputRef}
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    handleSendWithAnimation();
                                  }
                                }}
                                placeholder="Type a message..."
                                rows={1}
                                className="flex-1 min-w-0 min-h-[52px] max-h-[200px] resize-none overflow-y-auto scrollbar-hide bg-[#F0F6FB] text-[#222] placeholder-gray-500 border border-gray-200 rounded-2xl px-4 sm:px-5 py-3.5 sm:py-4 focus:outline-none focus:ring-2 focus:ring-[#FA6C43]/50 focus:border-[#FA6C43]/50 transition-all"
                                disabled={isLoading}
                            />
                            {config?.audio_enabled && (config?.model_name || '').toLowerCase().startsWith('claude') && config?.hume_config_id && (
                                <EVIAudioControls
                                    humeConfigId={config.hume_config_id}
                                    sessionId={`${configId}:${currentChatIdRef.current || 'new'}:${isAuthenticated ? 'user' : 'anonymous'}`}
                                    onTurn={handleEVITurn}
                                    onError={handleEVIError}
                                />
                            )}
                            <button
                                onClick={handleSendWithAnimation}
                                disabled={isLoading || !input.trim()}
                                className="min-h-[52px] px-3 sm:px-4 bg-[#FA6C43] hover:bg-[#E55B34] text-white rounded-2xl disabled:opacity-50 transition-all active:scale-95 flex items-center justify-center shrink-0"
                            >
                                {isSending ? (
                                    <FaPaperPlane
                                        className="animate-send-launch text-lg"
                                        onAnimationEnd={() => setIsSending(false)}
                                    />
                                ) : isLoading ? (
                                    <FaSpinner className="animate-spin text-lg" />
                                ) : (
                                    <FaPaperPlane className="text-lg" />
                                )}
                            </button>
                        </div>
                        {uploadError && (
                            <p className="text-xs text-red-500 mt-2 px-1">{uploadError}</p>
                        )}
                    </div>
                </footer>
            </>
        )}
      </div>
    </div>
  );
};

export default ChatPage;