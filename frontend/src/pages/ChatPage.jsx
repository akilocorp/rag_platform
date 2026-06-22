import React, { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { FaSpinner, FaPaperPlane, FaExclamationTriangle } from 'react-icons/fa';
import { RiUser3Line } from 'react-icons/ri';
import { FiFile, FiX, FiFolder, FiChevronRight, FiLink, FiMenu, FiSettings, FiUploadCloud } from 'react-icons/fi';
import { getBotAvatarIconComponent } from '../components/AvatarSelector';
import ChatSidebar from '../components/SideBar.jsx';
import AvatarView from '../components/AvatarView';
import ThinkingIndicator from '../components/ThinkingIndicator';
import ToolStatusPill from '../components/ToolStatusPill';
import ChatComposer from '../components/ChatComposer';
import DefinitionPopover from '../components/DefinitionPopover';
import EVIAudioControls from '../components/EVIAudioControls';
import { getModelDisplayName } from '../utils/modelNames';
import { loadDefineableSet, wrapDefineableWordsInDom } from '../utils/defineableWords';
import { lookupDefinition } from '../utils/dictionaryClient';
import apiClient from '../api/apiClient';
import axios from 'axios';
import { io } from 'socket.io-client';
import { renderMarkdown } from '../utils/markdown';

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
  const attachedImages = message.attachedImages || [];
  const isUser = sender === 'user';
  const hasToolCalls = toolCalls.length > 0;
  const hasAttachedFiles = isUser && attachedFiles.length > 0;
  const hasAttachedImages = isUser && attachedImages.length > 0;
  const showThinking = !isUser && isTyping && !text && !hasToolCalls;
  const BotIcon = !isUser ? getBotAvatarIconComponent(botAvatarId) : null;
  const mdRef = useRef(null);
  const sources = !isUser ? extractSources(toolCalls) : [];
  const [thinkingOpen, setThinkingOpen] = useState(false);
  const hasThinking = !isUser && (hasToolCalls || sources.length > 0);

  // Definition popover state — only ever populated for AI messages.
  const [popover, setPopover] = useState(null); // {word, anchorRect, loading, definition}
  const hoverInTimerRef = useRef(null);
  const hoverOutTimerRef = useRef(null);

  useLayoutEffect(() => {
    if (showThinking) return;
    const el = mdRef.current;
    if (!el) return;
    el.innerHTML = isUser ? (text || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>') : renderMarkdown(text);
    if (!isUser) {
      loadDefineableSet().then((set) => {
        // Bail if message text changed underneath us between yield points.
        if (mdRef.current === el) {
          wrapDefineableWordsInDom(el, set);
        }
      });
    }
  }, [text, showThinking, isUser]);

  // React synthetic mouseover/mouseout bubble up from the .defineable spans
  // through the markdown root. Using JSX handlers (not addEventListener)
  // avoids ref-timing issues where the effect ran before mdRef was set.
  const handleDefMouseOver = (e) => {
    if (isUser) return;
    const target = e.target.closest && e.target.closest('.defineable');
    if (!target) return;
    clearTimeout(hoverOutTimerRef.current);
    clearTimeout(hoverInTimerRef.current);
    hoverInTimerRef.current = setTimeout(() => {
      const word = target.dataset.word;
      if (!word) return;
      const rect = target.getBoundingClientRect();
      const anchorRect = {
        top: rect.top, left: rect.left, width: rect.width,
        height: rect.height, bottom: rect.bottom,
      };
      setPopover({ word, anchorRect, loading: true, definition: null });
      lookupDefinition(word).then((def) => {
        setPopover((p) => (p && p.word === word ? { ...p, loading: false, definition: def } : p));
      });
    }, 250);
  };

  const handleDefMouseOut = (e) => {
    if (isUser) return;
    const target = e.target.closest && e.target.closest('.defineable');
    if (!target) return;
    clearTimeout(hoverInTimerRef.current);
    clearTimeout(hoverOutTimerRef.current);
    hoverOutTimerRef.current = setTimeout(() => setPopover(null), 150);
  };

  // Dismiss on ESC while open. (Scroll-dismiss removed — chat auto-scroll
  // during streaming was tearing the popover down before it could open.)
  useEffect(() => {
    if (!popover) return;
    const onKey = (e) => { if (e.key === 'Escape') setPopover(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [popover]);

  const onPopoverEnter = () => clearTimeout(hoverOutTimerRef.current);
  const onPopoverLeave = () => {
    clearTimeout(hoverOutTimerRef.current);
    hoverOutTimerRef.current = setTimeout(() => setPopover(null), 150);
  };

  return (
    <div className={`flex gap-4 ${isUser ? 'justify-end animate-send-fly-in' : 'justify-start animate-in fade-in slide-in-from-bottom-2 duration-300'}`}>
      {!isUser && BotIcon && (
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center mt-1" style={{ color: '#1F1F1F' }}>
          <BotIcon className="text-sm" />
        </div>
      )}

      <div className={`min-w-0 max-w-[88%] text-[15px] leading-[1.65] break-words ${
        isUser
          ? 'bg-[#FA6C43] hover:bg-[#E55B34] text-white rounded-2xl rounded-br-none px-4 py-3 sm:px-5 shadow-sm'
          : 'text-[#222] mt-1'
      }`}>
          {hasAttachedImages && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {attachedImages.map((img) => (
                <img
                  key={img.id}
                  src={img.dataUrl}
                  alt="attached"
                  className="max-h-48 max-w-xs rounded-xl object-cover border border-white/20"
                />
              ))}
            </div>
          )}
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

          {hasThinking && (
            <div className="mb-3">
              <button
                onClick={() => setThinkingOpen(o => !o)}
                className="flex items-center gap-1.5 text-[11px] text-gray-400 hover:text-[#FA6C43] transition-colors select-none"
              >
                <svg
                  className={`w-3 h-3 transition-transform duration-200 ${thinkingOpen ? 'rotate-90' : ''}`}
                  fill="none" stroke="currentColor" viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
                <span>{thinkingOpen ? 'Hide thinking' : 'Show thinking'}</span>
              </button>

              {thinkingOpen && (
                <div className="mt-2 pl-2 border-l-2 border-gray-100">
                  {hasToolCalls && (
                    <div className="mb-1">
                      {toolCalls.map((tc) => (
                        <ToolStatusPill key={tc.id} toolCall={tc} />
                      ))}
                    </div>
                  )}
                  {sources.length > 0 && (
                    <div className={hasToolCalls ? 'mt-2' : ''}>
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
              )}
            </div>
          )}

          {showThinking ? (
            <ThinkingIndicator />
          ) : (
            <div
              ref={mdRef}
              onMouseOver={handleDefMouseOver}
              onMouseOut={handleDefMouseOut}
              className={`chat-message-md prose max-w-none ${
                isUser ? 'chat-message-md--invert prose-invert' : 'chat-message-md--light'
              }`}
            />
          )}
      </div>

      {isUser && (
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[#F9D0C4]/60 flex items-center justify-center mt-1">
          <RiUser3Line className="text-[#FA6C43] text-sm" />
        </div>
      )}

      {!isUser && popover && (
        <DefinitionPopover
          word={popover.word}
          anchorRect={popover.anchorRect}
          loading={popover.loading}
          definition={popover.definition}
          onPopoverEnter={onPopoverEnter}
          onPopoverLeave={onPopoverLeave}
        />
      )}
    </div>
  );
});

const ChatPage = () => {
  const { configId, chatId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  // Model picked in the v2 composer (carried via router state) or via the in-chat
  // picker on playground/personal bots. Sent as model_override (backend honors it
  // only on playground/personal bots).
  const [sessionModel, setSessionModel] = useState(location.state?.model || null);
  const pendingFirstMessageRef = useRef(location.state?.firstMessage || null);
  const _qp = new URLSearchParams(window.location.search);
  const qualtricsIdRef = useRef(_qp.get('qualtricsId') || null);
  const _urlStudentLabel = _qp.get('studentEmail') || _qp.get('studentName') || null;
  const _savedGuest = (() => { try { return JSON.parse(localStorage.getItem('guestInfo') || 'null'); } catch { return null; } })();
  const studentLabelRef = useRef(_urlStudentLabel || _savedGuest?.name || null);

  // --- STATE ---
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [config, setConfig] = useState(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [isSending, setIsSending] = useState(false);
  // Tailored follow-up prompts shown in the send-button hover fan.
  // Backend regenerates these from the latest AI reply; default until then.
  const [quickPrompts, setQuickPrompts] = useState(['Explain it simpler', 'Give an example', 'Go deeper']);

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
  // currentPath drives the unified sidebar file tree.
  //   ""                       → personal library root (also shows Bot Files virtual folder)
  //   "a/b"                    → personal library subfolder a/b
  //   "bots"                   → list of accessible bot subfolders
  //   "bots/<config_id>"       → that bot's root folder
  //   "bots/<config_id>/a/b"   → subfolder a/b inside that bot
  const [currentPath, setCurrentPath] = useState('');
  const [accessibleConfigs, setAccessibleConfigs] = useState([]);
  const [libraryFiles, setLibraryFiles] = useState([]);
  const [libraryFolders, setLibraryFolders] = useState([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [sessionUploads, setSessionUploads] = useState([]);
  // Files explicitly selected for chat context (from My Files or current bot's folder)
  const [selectedFileIds, setSelectedFileIds] = useState([]);
  const [isFetchingUrl, setIsFetchingUrl] = useState(false);
  const [pendingImages, setPendingImages] = useState([]);
  const libraryLoadedRef = useRef(false);

  // Usage limits: warn banner (approaching cap) + block modal (cap reached)
  const [usageWarn, setUsageWarn] = useState(null);   // { remaining } | null
  const [usageBlock, setUsageBlock] = useState(null); // { population, cta } | null

  // Parse currentPath into the effective fetch/write scope. See currentPath
  // shape comment above. canSelect: only files inside the *current* bot's
  // subtree or the personal library can be attached to this chat (spec).
  const fileScope = useMemo(() => {
    const parts = currentPath ? currentPath.split('/') : [];
    const head = parts[0];
    if (head === 'bots') {
      if (parts.length === 1) return { kind: 'bots-list', configId: null, folderPath: '', canSelect: false };
      const cid = parts[1];
      const folderPath = parts.slice(2).join('/');
      return {
        kind: 'bot',
        configId: cid,
        folderPath,
        canSelect: cid === configId,
      };
    }
    // Root or any non-bots path = personal library.
    return { kind: 'me', configId: null, folderPath: parts.join('/'), canSelect: true };
  }, [currentPath, configId]);

  // Personal config settings panel (students)
  const [showSettings, setShowSettings] = useState(false);
  const [settingsForm, setSettingsForm] = useState({ bot_name: '', model_name: '', instructions: '' });
  const [settingsSaving, setSettingsSaving] = useState(false);

  // --- REFS (The "Brain" of the component) ---
  const currentChatIdRef = useRef(chatId); // Tracks the session ID across renders
  const userFetchRef = useRef(false);
  const sessionFetchRef = useRef(null);
  const messagesEndRef = useRef(null);
  const isStreamingRef = useRef(false); // New: specifically tracks if we are in the middle of a fetch
  const inputRef = useRef(null);
  const attachInputRef = useRef(null);
  const imageInputRef = useRef(null);
  const optionsRef = useRef(null);
  const qualtricsSentCountRef = useRef(0); // Tracks how many messages have been sent to Qualtrics

  const isAuthenticated = !!getToken();

  const [guestInfo, setGuestInfo] = useState(() => {
    try { return JSON.parse(localStorage.getItem('guestInfo') || 'null') || null; } catch { return null; }
  });
  const [guestForm, setGuestForm] = useState({ name: '', email: '', marketingOptIn: true });
  const [guestFormError, setGuestFormError] = useState('');

  const submitGuestForm = () => {
    if (!guestForm.name.trim()) { setGuestFormError('Name is required.'); return; }
    if (!guestForm.email.trim() || !/\S+@\S+\.\S+/.test(guestForm.email)) { setGuestFormError('A valid email is required.'); return; }
    const info = { name: guestForm.name.trim(), email: guestForm.email.trim(), marketingOptIn: guestForm.marketingOptIn };
    localStorage.setItem('guestInfo', JSON.stringify(info));
    studentLabelRef.current = info.name;
    setGuestInfo(info);
  };

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

  useEffect(() => {
    if (config?.is_personal) {
      setSettingsForm({
        bot_name: config.bot_name || '',
        model_name: config.model_name || 'gpt-4o-mini',
        instructions: config.instructions || '',
      });
    }
  }, [config]);

  const savePersonalSettings = async () => {
    setSettingsSaving(true);
    try {
      await apiClient.patch('/student/personal-config', settingsForm);
      setConfig(prev => ({ ...prev, ...settingsForm }));
      setShowSettings(false);
    } catch (e) {
      console.error('Failed to save settings', e);
    } finally {
      setSettingsSaving(false);
    }
  };

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
  // Fetch the bots the caller has chatted with — drives the "Bot Files" tree.
  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiClient.get('/accessible_configs');
        if (!cancelled) setAccessibleConfigs(res.data.configs || []);
      } catch (e) {
        console.error('accessible_configs fetch failed', e);
      }
    })();
    return () => { cancelled = true; };
  }, [isAuthenticated]);

  const loadLibrary = useCallback(async () => {
    if (!isAuthenticated) return;
    // Virtual views (root / bots-list) have nothing to fetch.
    if (fileScope.kind !== 'bot' && fileScope.kind !== 'me') {
      setLibraryFiles([]);
      setLibraryFolders([]);
      return;
    }
    setFilesLoading(true);
    try {
      const params = fileScope.configId ? `?config_id=${fileScope.configId}` : '';
      const [filesRes, foldersRes] = await Promise.all([
        apiClient.get(`/files${params}`),
        apiClient.get(`/folders${params}`),
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
  }, [isAuthenticated, fileScope.kind, fileScope.configId]);

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

  const uploadFiles = useCallback(async (fileList) => {
    if (!fileList || fileList.length === 0) return;
    const folderPath = fileScope.folderPath || '';
    const scopeConfigId = fileScope.configId;
    setIsUploading(true);
    setUploadError(null);
    const uploaded = [];
    try {
      for (const file of fileList) {
        const form = new FormData();
        form.append('file', file);
        form.append('folder_path', folderPath);
        if (scopeConfigId) form.append('config_id', scopeConfigId);
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
        // Auto-select fresh uploads only when this scope is selectable for chat
        if (fileScope.canSelect) {
          setSelectedFileIds((prev) => [...prev, ...uploaded.map((f) => f._id)]);
        }
      }
    } finally {
      setIsUploading(false);
    }
  }, [fileScope]);

  useEffect(() => {
    const ALLOWED = ['pdf', 'txt', 'md', 'docx', 'pptx'];
    let depth = 0;
    const hasFiles = (e) => {
      const types = e.dataTransfer?.types;
      if (!types) return false;
      return Array.from(types).includes('Files');
    };
    const onEnter = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth += 1;
      if (depth === 1) setIsDragging(true);
    };
    const onOver = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const onLeave = (e) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setIsDragging(false);
    };
    const onDrop = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setIsDragging(false);
      const files = Array.from(e.dataTransfer?.files || []);
      if (!files.length) return;
      const accepted = [];
      const rejected = [];
      files.forEach((f) => {
        const ext = (f.name.split('.').pop() || '').toLowerCase();
        if (ALLOWED.includes(ext)) accepted.push(f);
        else rejected.push(f.name);
      });
      if (rejected.length) {
        setUploadError(`Unsupported file type: ${rejected.join(', ')}. Allowed: ${ALLOWED.join(', ')}.`);
      }
      if (accepted.length) uploadFiles(accepted);
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [uploadFiles]);

  const uploadUrl = useCallback(async (url) => {
    if (!url || !url.trim()) return;
    const folderPath = fileScope.folderPath || '';
    const scopeConfigId = fileScope.configId;
    setIsUploading(true);
    setUploadError(null);
    try {
      const res = await apiClient.post('/files/url', {
        url: url.trim(),
        folder_path: folderPath,
        ...(scopeConfigId ? { config_id: scopeConfigId } : {}),
      });
      const f = res.data?.file;
      if (f) {
        setLibraryFiles((prev) => [f, ...prev]);
        setSessionUploads((prev) => [...prev, f]);
        if (fileScope.canSelect) {
          setSelectedFileIds((prev) => [...prev, f._id]);
        }
      }
    } catch (err) {
      const msg = err.response?.data?.message || 'Failed to ingest URL';
      setUploadError(msg);
    } finally {
      setIsUploading(false);
    }
  }, [fileScope]);

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
    const scopeConfigId = fileScope.configId;
    try {
      const body = { path };
      if (scopeConfigId) body.config_id = scopeConfigId;
      await apiClient.post('/folders', body);
      setLibraryFolders((prev) => (prev.includes(path) ? prev : [...prev, path].sort()));
    } catch (e) {
      console.error('Create folder failed', e);
    }
  }, [fileScope]);

  const deleteFolder = useCallback(async (path) => {
    const scopeConfigId = fileScope.configId;
    let prevFolders;
    setLibraryFolders((prev) => { prevFolders = prev; return prev.filter((p) => p !== path && !p.startsWith(`${path}/`)); });
    try {
      const params = { path };
      if (scopeConfigId) params.config_id = scopeConfigId;
      await apiClient.delete('/folders', { params });
    } catch (e) {
      console.error('Delete folder failed, restoring', e);
      setLibraryFolders(prevFolders);
      throw e;
    }
  }, [fileScope]);

  const handleAttachPick = () => attachInputRef.current?.click();

  const handleAttachChange = (e) => {
    const picked = Array.from(e.target.files || []);
    if (picked.length) uploadFiles(picked);
    e.target.value = '';
  };

  const handleImageChange = (e) => {
    const files = Array.from(e.target.files || []);
    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        setPendingImages((prev) => [
          ...prev,
          { id: `img_${Date.now()}_${Math.random()}`, dataUrl: ev.target.result, mimeType: file.type },
        ]);
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  };

  const handlePaste = (e) => {
    const items = Array.from(e.clipboardData?.items || []);
    const imageItems = items.filter((item) => item.type.startsWith('image/'));
    if (imageItems.length === 0) return;
    imageItems.forEach((item) => {
      const file = item.getAsFile();
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        setPendingImages((prev) => [
          ...prev,
          { id: `img_${Date.now()}_${Math.random()}`, dataUrl: ev.target.result, mimeType: item.type },
        ]);
      };
      reader.readAsDataURL(file);
    });
  };

  const removeFromSession = (fileId) => {
    setSessionUploads((prev) => prev.filter((f) => f._id !== fileId));
    setSelectedFileIds((prev) => prev.filter((id) => id !== fileId));
  };

  const fetchUrl = useCallback(async (url) => {
    const folderPath = fileScope.folderPath || '';
    const scopeConfigId = fileScope.configId;
    setIsFetchingUrl(true);
    setUploadError(null);
    try {
      const body = { url, folder_path: folderPath };
      if (scopeConfigId) body.config_id = scopeConfigId;
      const res = await apiClient.post('/files/url', body);
      if (res.data?.file) {
        setLibraryFiles((prev) => [res.data.file, ...prev]);
        setSessionUploads((prev) => [...prev, res.data.file]);
        if (fileScope.canSelect) setSelectedFileIds((prev) => [...prev, res.data.file._id]);
      }
    } catch (err) {
      setUploadError(err.response?.data?.message || 'Failed to fetch URL');
    } finally {
      setIsFetchingUrl(false);
    }
  }, [fileScope]);

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
    const librarySelected = selectedFileIds
        .filter((id) => !sessionIds.has(id))
        .map((id) => libraryFiles.find((f) => f._id === id))
        .filter(Boolean);
    const attachedFiles = [...librarySelected, ...sessionUploads].map((f) => ({
        _id: f._id,
        filename: f.filename,
        folder_path: f.folder_path,
        is_url: f.is_url,
    }));
    const snapshotImages = [...pendingImages];

    // C. Optimistic UI Update
    setMessages(prev => [
        ...prev,
        { sender: 'user', text: textInput, attachedFiles, attachedImages: snapshotImages },
        { sender: 'ai', text: '', isTyping: true }
    ]);

    // Clear chips from the input box now that they've been pinned to the prompt
    if (attachedFiles.length > 0) {
        setSelectedFileIds([]);
        setSessionUploads([]);
    }
    if (snapshotImages.length > 0) {
        setPendingImages([]);
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
        credentials: 'include', // round-trip the anon device cookie
        headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          input: textInput,
          variant: 'A',
          selected_file_ids: selectedFileIds,
          attached_files: attachedFiles,
          images: snapshotImages.map(({ dataUrl, mimeType }) => ({ dataUrl, mimeType })),
          ...(sessionModel ? { model_override: sessionModel } : {}),
          ...(qualtricsIdRef.current ? { qualtrics_id: qualtricsIdRef.current } : {}),
          ...(studentLabelRef.current ? { student_label: studentLabelRef.current } : {}),
          ...(guestInfo?.email ? { student_email: guestInfo.email } : {}),
          ...(guestInfo && !isAuthenticated ? { marketing_opt_in: guestInfo.marketingOptIn } : {}),
        })
      });

      // Usage limit reached — no stream, show the block UI and drop the optimistic AI bubble.
      if (response.status === 429) {
        let usage = {};
        try { usage = (await response.json()).usage || {}; } catch (_) {}
        setUsageBlock({ population: usage.population, cta: usage.cta });
        setMessages(prev => prev.slice(0, -1));
        return;
      }

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
            } else if (data.type === 'done' && data.usage) {
              const u = data.usage;
              if (u.status === 'warn' && typeof u.remaining === 'number') {
                setUsageWarn({ remaining: u.remaining, cta: u.cta });
              } else if (u.status === 'blocked') {
                // Just consumed the last message — next send will hard-block.
                setUsageWarn({ remaining: 0, cta: u.cta });
              } else if (u.status === 'ok') {
                setUsageWarn(null);
              }
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

      // Fire-and-forget: ask the backend for 3 tailored follow-up prompts
      // based on this reply. Drives the send-button hover fan.
      if (accumulatedText.trim()) {
        fetch('/api/quick_prompts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_message: textInput, ai_reply: accumulatedText }),
        })
          .then((r) => (r.ok ? r.json() : null))
          .then((data) => {
            const prompts = data && Array.isArray(data.prompts) ? data.prompts.filter(Boolean) : null;
            if (prompts && prompts.length === 3) setQuickPrompts(prompts);
          })
          .catch(() => {});
      }

      if (isNewChat) fetchSessions(true);

    } catch (e) {
        console.error("Stream Error:", e);
        setError("Connection lost. Please try again.");
    } finally {
      setIsLoading(false);
      isStreamingRef.current = false; // "Unlock" the history loader
    }
  }, [configId, navigate, avatarSession, fetchSessions, isLoading, selectedFileIds, sessionUploads, libraryFiles, pendingImages, sessionModel]);

  // Auto-send the message typed in the v2 composer once the config is ready.
  useEffect(() => {
    if (!isInitializing && config && pendingFirstMessageRef.current) {
      const first = pendingFirstMessageRef.current;
      pendingFirstMessageRef.current = null;
      // Clear router state so a refresh doesn't replay the message.
      navigate(location.pathname, { replace: true, state: {} });
      handleMessageProcess(first);
    }
  }, [isInitializing, config, handleMessageProcess, navigate, location.pathname]);

  const handleTextSend = () => { handleMessageProcess(input); setInput(''); };

  const handleSendWithAnimation = (overrideText) => {
    if (isLoading) return;
    const text = typeof overrideText === 'string' ? overrideText : input;
    if (!text.trim()) return;
    setIsSending(true);
    if (typeof overrideText === 'string') {
      handleMessageProcess(text);
      setInput('');
    } else {
      handleTextSend();
    }
  };

  const handleVoiceTranscribed = useCallback((text) => {
    const trimmed = (text || '').trim();
    if (!trimmed || isLoading) return;
    setInput(trimmed);
    setIsSending(true);
    handleMessageProcess(trimmed);
    setInput('');
  }, [isLoading, handleMessageProcess]);

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

  if (!isAuthenticated && config?.is_public && !guestInfo) return (
    <div className="h-screen flex items-center justify-center bg-[#F0F6FB] px-4">
      <div className="bg-white rounded-2xl shadow-lg p-8 w-full max-w-md">
        <h2 className="text-xl font-bold text-[#222] mb-1">{config.bot_name || 'Chat'}</h2>
        <p className="text-sm text-gray-500 mb-6">Enter your info to get started.</p>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
            <input
              type="text"
              value={guestForm.name}
              onChange={e => setGuestForm(p => ({ ...p, name: e.target.value }))}
              onKeyDown={e => e.key === 'Enter' && submitGuestForm()}
              placeholder="Your name"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#FA6C43]"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              value={guestForm.email}
              onChange={e => setGuestForm(p => ({ ...p, email: e.target.value }))}
              onKeyDown={e => e.key === 'Enter' && submitGuestForm()}
              placeholder="you@example.com"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#FA6C43]"
            />
          </div>
          <label className="flex items-start gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={guestForm.marketingOptIn}
              onChange={e => setGuestForm(p => ({ ...p, marketingOptIn: e.target.checked }))}
              className="mt-0.5 accent-[#FA6C43]"
            />
            <span className="text-sm text-gray-600">I'd like to receive updates and research-related communications. <span className="text-gray-400">(Uncheck to opt out)</span></span>
          </label>
          {guestFormError && <p className="text-xs text-red-500">{guestFormError}</p>}
          <button
            onClick={submitGuestForm}
            className="w-full bg-[#FA6C43] hover:bg-[#e85a30] text-white font-semibold py-2.5 rounded-xl text-sm transition-colors"
          >
            Start Chat
          </button>
        </div>
      </div>
    </div>
  );

  const isAvatarMode = config?.bot_type === 'avatar';
  const showAvatar = isAvatarMode && !avatarError;
  const isCallMode = config?.bot_type === 'audio_call';

  const usageBlockCopy = (() => {
    const cta = usageBlock?.cta;
    if (cta === 'contact_professor') {
      return { title: "Your class is out of messages", body: "Your class's shared message pool has been used up. Please contact your professor to extend it.", action: null };
    }
    if (cta === 'create_account') {
      return { title: "You've reached the free limit", body: "Create a free account to keep chatting and unlock more messages.", action: { label: 'Create an account', to: '/register' } };
    }
    return { title: "You've reached your message limit", body: "You've used all your available messages.", action: null };
  })();

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-[#F0F6FB] font-sans text-[#222]" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
      {isDragging && (
        <div className="fixed inset-0 z-[60] pointer-events-none flex items-center justify-center px-4 animate-chip-in">
          <div className="absolute inset-3 sm:inset-5 rounded-3xl border-2 border-dashed border-[#FA6C43] bg-[#FA6C43]/8 backdrop-blur-[2px]" />
          <div className="relative bg-white shadow-xl rounded-2xl px-7 py-6 flex flex-col items-center gap-3 border border-[#F9D0C4]">
            <div className="p-3 rounded-full bg-[#F9D0C4]/50 text-[#FA6C43] animate-bounce">
              <FiUploadCloud className="w-7 h-7" />
            </div>
            <div className="text-center">
              <p className="font-semibold text-[#222] text-base">Drop to attach</p>
              <p className="text-xs text-gray-500 mt-0.5">PDF · TXT · MD · DOCX · PPTX</p>
            </div>
          </div>
        </div>
      )}
      {usageBlock && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md text-center">
            <h2 className="text-xl font-bold text-[#222] mb-2">{usageBlockCopy.title}</h2>
            <p className="text-sm text-gray-600 mb-6">{usageBlockCopy.body}</p>
            <div className="flex flex-col gap-2">
              {usageBlockCopy.action && (
                <button
                  onClick={() => navigate(usageBlockCopy.action.to)}
                  className="w-full bg-[#FA6C43] hover:bg-[#e85a30] text-white font-semibold py-2.5 rounded-xl text-sm transition-colors"
                >
                  {usageBlockCopy.action.label}
                </button>
              )}
              <button
                onClick={() => setUsageBlock(null)}
                className="w-full text-gray-500 hover:text-gray-700 font-medium py-2 text-sm"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}
      {usageWarn && (
        <div className="fixed top-3 left-1/2 -translate-x-1/2 z-40 bg-amber-50 border border-amber-200 text-amber-800 text-sm px-4 py-2 rounded-full shadow-sm flex items-center gap-3">
          <span>
            {usageWarn.remaining > 0
              ? `${usageWarn.remaining} message${usageWarn.remaining === 1 ? '' : 's'} left`
              : "This was your last message"}
            {usageWarn.cta === 'create_account' && ' — sign up to keep going'}
          </span>
          {usageWarn.cta === 'create_account' && (
            <button onClick={() => navigate('/register')} className="font-semibold underline">Sign up</button>
          )}
          <button onClick={() => setUsageWarn(null)} className="text-amber-500 hover:text-amber-700">✕</button>
        </div>
      )}
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
              currentPath={currentPath}
              onSetPath={setCurrentPath}
              accessibleConfigs={accessibleConfigs}
              libraryFiles={libraryFiles}
              libraryFolders={libraryFolders}
              filesLoading={filesLoading}
              isUploading={isUploading}
              uploadError={uploadError}
              onUpload={uploadFiles}
              onFetchUrl={fetchUrl}
              isFetchingUrl={isFetchingUrl}
              onDeleteFile={deleteLibraryFile}
              onCreateFolder={createFolder}
              onDeleteFolder={deleteFolder}
              canSelect={fileScope.canSelect}
              selectedFileIds={selectedFileIds}
              onToggleFile={toggleFileSelection}
              onDeleteSession={(id) => setSessions(prev => prev.filter(s => s.session_id !== id))}
          />
      )}

      <div className={`relative flex-1 flex flex-col w-full h-full transition-all duration-300 ${isAuthenticated && !isSidebarCollapsed ? 'md:ml-[30%]' : 'md:ml-20'}`}>
        
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
                <div className="p-2 rounded-lg bg-gray-100" style={{ color: '#1F1F1F' }}>
                    <HeaderIcon className="text-xl" />
                </div>
                  );
                })()}
                <div>
                    <h1 className="font-semibold text-[#222] text-base">{config?.bot_name || "AI Assistant"}</h1>
                    {config?.model_name && <p className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">{getModelDisplayName(config.model_name)}</p>}
                </div>
            </div>
            {config?.is_personal && (
              <button
                type="button"
                onClick={() => setShowSettings(s => !s)}
                className={`p-2 rounded-lg transition-colors ${showSettings ? 'bg-[#FA6C43] text-white' : 'text-gray-400 hover:bg-[#F0F6FB] hover:text-[#FA6C43]'}`}
                aria-label="Assistant settings"
                title="Customize your assistant"
              >
                <FiSettings className="w-5 h-5" />
              </button>
            )}
        </header>

        {config?.is_personal && showSettings && (
          <div className="border-b border-gray-200 bg-white px-4 sm:px-6 py-4 space-y-3 z-10 animate-in slide-in-from-top-2 duration-200">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">Assistant name</label>
                <input
                  type="text"
                  value={settingsForm.bot_name}
                  onChange={e => setSettingsForm(f => ({ ...f, bot_name: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#F9D0C4] focus:border-[#FA6C43] transition-all"
                  placeholder="My Assistant"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">Model</label>
                <select
                  value={settingsForm.model_name}
                  onChange={e => setSettingsForm(f => ({ ...f, model_name: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#F9D0C4] focus:border-[#FA6C43] transition-all bg-white"
                >
                  <option value="gpt-4o-mini">GPT-4o Mini</option>
                  <option value="gpt-4.1">GPT-4.1</option>
                  <option value="gpt-4-turbo">GPT-4 Turbo</option>
                  <option value="claude-haiku-4-5-20251001">Claude Haiku 4.5</option>
                  <option value="claude-sonnet-4-6">Claude Sonnet 4.6</option>
                  <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                  <option value="deepseek-chat">Deepseek Chat</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">System prompt</label>
              <textarea
                value={settingsForm.instructions}
                onChange={e => setSettingsForm(f => ({ ...f, instructions: e.target.value }))}
                rows={3}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#F9D0C4] focus:border-[#FA6C43] transition-all resize-none"
                placeholder="Describe how your assistant should behave…"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowSettings(false)}
                className="px-4 py-2 text-sm font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={savePersonalSettings}
                disabled={settingsSaving}
                className="px-4 py-2 text-sm font-bold text-white bg-[#FA6C43] hover:bg-[#E55B34] rounded-lg transition-colors disabled:opacity-60 flex items-center gap-2"
              >
                {settingsSaving && <FaSpinner className="animate-spin text-xs" />}
                Save
              </button>
            </div>
          </div>
        )}

        {avatarError && isAvatarMode && (
           <div className="bg-red-500/10 border-b border-red-500/20 px-4 py-2 flex items-center justify-center gap-2 text-red-400 text-sm">
               <FaExclamationTriangle />
               <span>Avatar connection failed. Switched to text mode.</span>
               <button onClick={() => setAvatarError(false)} className="underline hover:text-red-300 ml-2">Retry</button>
           </div>
        )}

        {isCallMode ? (
            <div className="flex-1 flex overflow-hidden bg-gradient-to-b from-[#0f1729] via-[#1a1230] to-[#0f1729]">
                <div className="flex-1 flex flex-col items-center justify-center text-center px-6 relative">
                    {(() => {
                      const HeroIcon = getBotAvatarIconComponent(config?.bot_avatar);
                      return (
                        <div className="w-24 h-24 rounded-full bg-white/10 flex items-center justify-center mb-6">
                          {HeroIcon ? <HeroIcon className="text-5xl text-white/90" /> : <FaPaperPlane className="text-4xl text-white/90" />}
                        </div>
                      );
                    })()}
                    <h2 className="text-2xl font-bold text-white mb-2">{config?.bot_name || 'AI Assistant'}</h2>
                    <p className="text-white/60 text-sm max-w-md mb-10">
                      {config?.introduction || 'Tap the mic to start a voice call. Your transcript appears on the right.'}
                    </p>
                    <EVIAudioControls
                      sessionId={`${configId}:${currentChatIdRef.current || 'new'}:${isAuthenticated ? 'user' : 'anonymous'}`}
                      onTurn={handleEVITurn}
                      onError={handleEVIError}
                    />
                </div>

                <aside className="hidden lg:flex w-96 border-l border-white/10 flex-col bg-black/20">
                    <div className="px-5 py-4 border-b border-white/10 text-white/80 text-xs uppercase tracking-[0.2em] font-semibold">Transcript</div>
                    <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3 scrollbar-thin">
                        {messages.length === 0 ? (
                            <p className="text-white/40 text-sm italic">No turns yet. Start the call to begin.</p>
                        ) : messages.map((m, i) => (
                            <div key={i} className={`text-sm leading-relaxed ${m.sender === 'user' ? 'text-white/70' : 'text-white'}`}>
                                <span className="font-bold mr-1 text-[#FA6C43]">{m.sender === 'user' ? 'You' : config?.bot_name || 'AI'}:</span>
                                {m.text}
                            </div>
                        ))}
                        <div ref={messagesEndRef} />
                    </div>
                </aside>
            </div>
        ) : showAvatar ? (
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
                                <div className="w-20 h-20 bg-gray-100 rounded-3xl flex items-center justify-center mb-6" style={{ color: '#1F1F1F' }}>
                                    <EmptyIcon className="text-5xl" />
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

                <footer className="p-4 sm:p-6 lg:px-12 xl:px-20">
                    <div className="w-full">
                        {pendingImages.length > 0 && (
                            <div className="flex flex-wrap gap-2 mb-3">
                                {pendingImages.map((img) => (
                                    <div key={img.id} className="relative group">
                                        <img
                                            src={img.dataUrl}
                                            alt="pending"
                                            className="h-16 w-16 object-cover rounded-xl border border-gray-200"
                                        />
                                        <button
                                            onClick={() => setPendingImages((prev) => prev.filter((i) => i.id !== img.id))}
                                            className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                        >
                                            <FiX className="w-2.5 h-2.5" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                        {(() => {
                            const chips = [];
                            const pillClass = 'group inline-flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-lg border text-xs max-w-xs animate-chip-in transition-all duration-200';
                            const pillStyle = { backgroundColor: 'rgba(250,108,67,0.10)', borderColor: 'rgba(250,108,67,0.35)', color: '#222' };

                            if (config?.web_access && (config?.model_name || '').toLowerCase().startsWith('claude')) {
                                const matches = (input.match(/(https?:\/\/[^\s]+)/g) || []).slice(0, 3);
                                matches.forEach((url) => {
                                    let host = url;
                                    try { host = new URL(url).hostname; } catch { /* ignore */ }
                                    chips.push(
                                        <div key={`url-${url}`} className={`${pillClass} px-2.5`} style={pillStyle} title={url}>
                                            <FiLink className="w-3 h-3 text-[#FA6C43] flex-shrink-0" />
                                            <span className="truncate max-w-[200px]">{host}</span>
                                            <span className="text-gray-500">— will be fetched</span>
                                        </div>,
                                    );
                                });
                            }

                            const sessionIds = new Set(sessionUploads.map((f) => f._id));
                            const librarySelected = selectedFileIds
                                .filter((id) => !sessionIds.has(id))
                                .map((id) => libraryFiles.find((f) => f._id === id))
                                .filter(Boolean)
                                .filter((f) => f.vector_ingested === true);
                            librarySelected.forEach((f) => {
                                chips.push(
                                    <div key={`lib-${f._id}`} className={pillClass} style={pillStyle}>
                                        {f.is_url ? (
                                            <FiLink className="w-3 h-3 text-[#FA6C43] flex-shrink-0" />
                                        ) : f.folder_path ? (
                                            <FiFolder className="w-3 h-3 text-[#FA6C43] flex-shrink-0" />
                                        ) : (
                                            <FiFile className="w-3 h-3 text-[#FA6C43] flex-shrink-0" />
                                        )}
                                        <span className="truncate">
                                            {f.folder_path ? (
                                                <>
                                                    {f.folder_path.split('/').map((seg, i) => (
                                                        <React.Fragment key={i}>
                                                            <span className="text-[#222]">{seg}</span>
                                                            <FiChevronRight className="inline w-3 h-3 text-gray-500 mx-0.5" />
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
                                    </div>,
                                );
                            });

                            // Honour deselection: chip only renders while the file is still in selectedFileIds.
                            // Session uploads land in both sessionUploads + selectedFileIds; the X on the chip
                            // (removeFromSession) tears down both, but FilesPanel deselect only mutates selectedFileIds.
                            const ingestedSessionUploads = sessionUploads.filter((f) => f.vector_ingested === true && selectedFileIds.includes(f._id));
                            ingestedSessionUploads.forEach((f) => {
                                chips.push(
                                    <div key={`ses-${f._id}`} className={pillClass} style={pillStyle}>
                                        {f.folder_path ? (
                                            <FiFolder className="w-3 h-3 text-[#FA6C43] flex-shrink-0" />
                                        ) : (
                                            <FiFile className="w-3 h-3 text-[#FA6C43] flex-shrink-0" />
                                        )}
                                        <span className="truncate">
                                            {f.folder_path ? (
                                                <>
                                                    {f.folder_path.split('/').map((seg, i) => (
                                                        <React.Fragment key={i}>
                                                            <span className="text-[#222]">{seg}</span>
                                                            <FiChevronRight className="inline w-3 h-3 text-gray-500 mx-0.5" />
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
                                    </div>,
                                );
                            });

                            const attachments = chips.length > 0 ? chips : null;
                            return (
                                <ChatComposer
                                    input={input}
                                    setInput={setInput}
                                    inputRef={inputRef}
                                    onSend={handleSendWithAnimation}
                                    onPaste={handlePaste}
                                    isLoading={isLoading}
                                    isSending={isSending}
                                    onSendAnimationEnd={() => setIsSending(false)}
                                    onAttachPick={handleAttachPick}
                                    attachInputRef={attachInputRef}
                                    onAttachChange={handleAttachChange}
                                    isUploading={isUploading}
                                    imageInputRef={imageInputRef}
                                    onImageChange={handleImageChange}
                                    showVoice={!config?.bot_type || config?.bot_type === 'chat'}
                                    onVoiceTranscribed={handleVoiceTranscribed}
                                    showOptions={showOptions}
                                    setShowOptions={setShowOptions}
                                    optionsRef={optionsRef}
                                    showModelPicker={!!(config?.is_playground || config?.is_personal)}
                                    model={sessionModel || config?.model_name || ''}
                                    onModelChange={setSessionModel}
                                    attachments={attachments}
                                    hasAiReplied={messages.some(m => m.sender === 'ai' && m.text && !m.isTyping)}
                                    quickPrompts={quickPrompts}
                                />
                            );
                        })()}
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