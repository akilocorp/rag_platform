import React, { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { FaSpinner, FaPaperPlane, FaExclamationTriangle } from 'react-icons/fa';
import { RiUser3Line } from 'react-icons/ri';
import { FiPaperclip, FiFile, FiX, FiFolder, FiChevronRight } from 'react-icons/fi';
import { getBotAvatarIconComponent } from '../components/AvatarSelector';
import ChatSidebar from '../components/SideBar.jsx';
import AvatarView from '../components/AvatarView';
import apiClient from '../api/apiClient';
import axios from 'axios';
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

// --- MODERN CHAT MESSAGE COMPONENT ---
const ChatMessage = React.memo(({ message, botAvatarId }) => {
  const { sender, text } = message;
  const isUser = sender === 'user';
  const BotIcon = !isUser ? getBotAvatarIconComponent(botAvatarId) : null;
  const mdRef = useRef(null);

  useLayoutEffect(() => {
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
  }, [text]);

  return (
    <div className={`flex gap-4 ${isUser ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-2 duration-300`}>
      {!isUser && BotIcon && (
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[#F9D0C4]/60 flex items-center justify-center mt-1">
          <BotIcon className="text-[#FA6C43] text-sm" />
        </div>
      )}

      <div className={`max-w-[85%] rounded-2xl px-5 py-3 shadow-sm text-sm leading-relaxed ${
        isUser 
          ? 'bg-[#FA6C43] hover:bg-[#E55B34] text-white rounded-br-none' 
          : 'bg-white border border-gray-200 text-[#222] rounded-bl-none shadow-sm'
      }`}>
          <div
            ref={mdRef}
            className={`chat-message-md prose max-w-none ${
              isUser ? 'chat-message-md--invert prose-invert' : 'chat-message-md--light'
            }`}
          />
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
  
  // Sidebar/User State
  const [sessions, setSessions] = useState([]);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
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
  const libraryLoadedRef = useRef(false);

  // --- REFS (The "Brain" of the component) ---
  const currentChatIdRef = useRef(chatId); // Tracks the session ID across renders
  const userFetchRef = useRef(false);
  const sessionFetchRef = useRef(null);
  const messagesEndRef = useRef(null);
  const isStreamingRef = useRef(false); // New: specifically tracks if we are in the middle of a fetch
  const inputRef = useRef(null);
  const attachInputRef = useRef(null);
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
      setLibraryFiles(filesRes.data.files || []);
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

  const deleteLibraryFile = useCallback(async (fileId) => {
    try {
      await apiClient.delete(`/files/${fileId}`);
      setLibraryFiles((prev) => prev.filter((f) => f._id !== fileId));
      setSessionUploads((prev) => prev.filter((f) => f._id !== fileId));
    } catch (e) {
      console.error('Delete file failed', e);
    }
  }, []);

  const createFolder = useCallback(async (path) => {
    try {
      await apiClient.post('/folders', { path });
      setLibraryFolders((prev) => (prev.includes(path) ? prev : [...prev, path].sort()));
    } catch (e) {
      console.error('Create folder failed', e);
    }
  }, []);

  const deleteFolder = useCallback(async (folderId) => {
    try {
      await apiClient.delete(`/folders/${folderId}`);
      await loadLibrary();
    } catch (e) {
      console.error('Delete folder failed', e);
    }
  }, [loadLibrary]);

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
        setMessages(historyData.map(msg => ({
          sender: msg.type === 'human' ? 'user' : 'ai',
          text: msg.data.content
        })));
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

    // C. Optimistic UI Update
    setMessages(prev => [
        ...prev, 
        { sender: 'user', text: textInput }, 
        { sender: 'ai', text: '', isTyping: true }
    ]);

    // D. Navigation (Non-blocking)
    if (isNewChat) {
        currentChatIdRef.current = workingChatId; // Set immediately so next send uses it
        navigate(`/chat/${configId}/${workingChatId}`, { replace: true });
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
  }, [configId, navigate, avatarSession, fetchSessions, isLoading]);

  const handleTextSend = () => { handleMessageProcess(input); setInput(''); };
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
    <div className="flex h-screen overflow-hidden bg-[#F0F6FB] font-sans text-[#222]" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
      {isAuthenticated && (
          <ChatSidebar
              sessions={sessions}
              userInfo={userInfo}
              userInfoLoaded={!!userInfo}
              configId={configId}
              isCollapsed={isSidebarCollapsed}
              onToggle={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
              onNewChat={() => { setMessages([]); navigate(`/chat/${configId}`); }}
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
              onDeleteFile={deleteLibraryFile}
              onCreateFolder={createFolder}
              onDeleteFolder={deleteFolder}
              selectable={variant === 'A'}
              selectedFileIds={selectedFileIds}
              onToggleFile={toggleFileSelection}
              libraryLabel={variant === 'B' ? `${config?.bot_name || 'Bot'} Files` : 'My Library'}
          />
      )}

      <div className={`relative flex-1 flex flex-col w-full h-full transition-all duration-300 ${isAuthenticated && !isSidebarCollapsed ? 'md:ml-72' : 'md:ml-20'}`}>
        
        <header className="flex items-center justify-between px-6 py-3 border-b border-gray-200 bg-white/95 backdrop-blur z-10 h-16">
            <div className="flex items-center gap-3">
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
                    {config?.model_name && <p className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">{config.model_name}</p>}
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
                <main className="flex-1 overflow-y-auto p-4 sm:p-6 scrollbar-thin">
                     <div className="w-full max-w-4xl mx-auto space-y-6 pb-4">
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

                <footer className="p-4 sm:p-6 bg-white border-t border-gray-200">
                    <div className="max-w-4xl mx-auto">
                        {sessionUploads.length > 0 && (
                            <div className="flex flex-wrap items-center gap-2 mb-3">
                                {sessionUploads.map((f) => (
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
                        )}
                        <div className="relative flex items-end gap-2">
                            <button
                                onClick={handleAttachPick}
                                disabled={isUploading}
                                title="Attach files"
                                className="p-3.5 rounded-2xl border border-gray-200 bg-white hover:bg-[#F0F6FB] text-gray-500 hover:text-[#FA6C43] transition-colors disabled:opacity-50"
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
                                accept=".pdf,.txt,.md,.docx"
                            />
                            <textarea
                                ref={inputRef}
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    handleTextSend();
                                  }
                                }}
                                placeholder="Type a message..."
                                rows={1}
                                className="flex-1 min-h-[52px] max-h-[200px] resize-none overflow-y-auto scrollbar-hide bg-[#F0F6FB] text-[#222] placeholder-gray-500 border border-gray-200 rounded-2xl px-5 py-4 focus:outline-none focus:ring-2 focus:ring-[#FA6C43]/50 focus:border-[#FA6C43]/50 transition-all"
                                disabled={isLoading}
                            />
                            <button
                                onClick={handleTextSend}
                                disabled={isLoading || !input.trim()}
                                className="p-4 bg-[#FA6C43] hover:bg-[#E55B34] text-white rounded-2xl disabled:opacity-50 transition-all active:scale-95"
                            >
                                {isLoading ? <FaSpinner className="animate-spin text-lg" /> : <FaPaperPlane className="text-lg" />}
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