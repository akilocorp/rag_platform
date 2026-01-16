import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { FaSpinner, FaPaperPlane, FaExclamationTriangle } from 'react-icons/fa';
import { RiRobot2Line, RiUser3Line } from 'react-icons/ri';
import ChatSidebar from '../components/SideBar.jsx'; 
import AvatarView from '../components/AvatarView'; 
import apiClient from '../api/apiClient'; 
import axios from 'axios';
import { marked } from 'marked';

// --- HELPER: Get Token Safely ---
const getToken = () => localStorage.getItem('jwtToken') || localStorage.getItem('access_token');

// --- MODERN CHAT MESSAGE COMPONENT ---
const ChatMessage = React.memo(({ message }) => {
  const { sender, text } = message;
  const isUser = sender === 'user';
  
  // Render Markdown safely
  const createMarkup = (txt) => ({ __html: marked.parse(txt || '') });

  return (
    <div className={`flex gap-4 ${isUser ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-2 duration-300`}>
      {!isUser && (
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-indigo-500/20 flex items-center justify-center mt-1">
          <RiRobot2Line className="text-indigo-400 text-sm" />
        </div>
      )}

      <div className={`max-w-[85%] rounded-2xl px-5 py-3 shadow-sm text-sm leading-relaxed ${
        isUser 
          ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-br-none' 
          : 'bg-gray-800/50 backdrop-blur-sm border border-gray-700/50 text-gray-100 rounded-bl-none'
      }`}>
          <div className="prose prose-invert max-w-none prose-p:my-0 prose-ul:my-2" dangerouslySetInnerHTML={createMarkup(text)} />
      </div>

      {isUser && (
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-purple-500/20 flex items-center justify-center mt-1">
          <RiUser3Line className="text-purple-400 text-sm" />
        </div>
      )}
    </div>
  );
});

const ChatPage = () => {
  const { configId, chatId } = useParams();
  const navigate = useNavigate();
  
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

  // --- REFS (The "Brain" of the component) ---
  const currentChatIdRef = useRef(chatId); // Tracks the session ID across renders
  const userFetchRef = useRef(false);
  const sessionFetchRef = useRef(null);
  const messagesEndRef = useRef(null);
  const isStreamingRef = useRef(false); // New: specifically tracks if we are in the middle of a fetch

  const isAuthenticated = !!getToken();

  // Sync Ref with URL param
  useEffect(() => {
    currentChatIdRef.current = chatId;
  }, [chatId]);

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
        body: JSON.stringify({ input: textInput })
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
    // Stop if there are no messages to send
    if (messages.length === 0) return;

    // Get the most recent message
    const lastMessage = messages[messages.length - 1];

    // 1. Send the Message content
    const payload = {
      type: "CHAT_MESSAGE",
      sender: lastMessage.sender, // 'user' or 'ai'
      content: lastMessage.text,
      timestamp: new Date().toISOString()
    };

    // Send to parent window (Qualtrics)
    // We use '*' to ensure it reaches Qualtrics regardless of the specific subdomain
    window.parent.postMessage(payload, "*");

    // 2. Initialize Config on First Message
    // This ensures Qualtrics knows which Config ID & Chat ID we are using
    if (messages.length === 1) {
       window.parent.postMessage({
         type: "INIT_RAG_CONFIG",
         payload: {
           configId: configId,
           chatId: currentChatIdRef.current
         }
       }, "*");
    }

  }, [messages, configId]); // <--- Runs every time 'messages' changes

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  if (isInitializing) return (
    <div className="h-screen flex items-center justify-center bg-gray-900 text-white flex-col gap-4">
        <FaSpinner className="animate-spin text-4xl text-indigo-500" />
    </div>
  );

  const isAvatarMode = config?.bot_type === 'avatar';
  const showAvatar = isAvatarMode && !avatarError;

  return (
    <div className="flex h-screen overflow-hidden bg-gray-900 font-sans text-gray-100">
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
          />
      )}

      <div className={`relative flex-1 flex flex-col w-full h-full transition-all duration-300 ${isAuthenticated && !isSidebarCollapsed ? 'md:ml-72' : 'md:ml-20'}`}>
        
        <header className="flex items-center justify-between px-6 py-3 border-b border-gray-800 bg-gray-900/95 backdrop-blur z-10 h-16">
            <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${isAvatarMode ? 'bg-purple-500/10 text-purple-400' : 'bg-indigo-500/10 text-indigo-400'}`}>
                    <RiRobot2Line className="text-xl" />
                </div>
                <div>
                    <h1 className="font-semibold text-white text-base">{config?.bot_name || "AI Assistant"}</h1>
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
                                <span className={`font-bold mr-1 ${m.sender === 'user' ? 'text-purple-400' : 'text-indigo-400'}`}>
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
                            <div className="flex flex-col items-center justify-center h-[60vh] text-center opacity-40">
                                <div className="w-20 h-20 bg-gray-800 rounded-3xl flex items-center justify-center mb-6">
                                    <RiRobot2Line className="text-5xl text-indigo-500" />
                                </div>
                                <h2 className="text-2xl font-bold text-gray-200 mb-2">{config?.bot_name || "AI Assistant"}</h2>
                                <p className="text-gray-400 max-w-md">{config?.introduction || "I'm ready to help."}</p>
                            </div>
                        )}
                        {messages.map((msg, i) => <ChatMessage key={i} message={msg} />)}
                        <div ref={messagesEndRef} />
                     </div>
                </main>

                <footer className="p-4 sm:p-6 bg-gray-900 border-t border-gray-800">
                    <div className="max-w-4xl mx-auto relative flex items-center gap-3">
                        <input 
                            type="text"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleTextSend()}
                            placeholder="Type a message..."
                            className="flex-1 bg-gray-800/50 text-white placeholder-gray-500 border border-gray-700 rounded-2xl px-5 py-4 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all"
                            disabled={isLoading}
                        />
                        <button 
                            onClick={handleTextSend}
                            disabled={isLoading || !input.trim()}
                            className="p-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl disabled:opacity-50 transition-all active:scale-95"
                        >
                            {isLoading ? <FaSpinner className="animate-spin text-lg" /> : <FaPaperPlane className="text-lg" />}
                        </button>
                    </div>
                </footer>
            </>
        )}
      </div>
    </div>
  );
};

export default ChatPage;