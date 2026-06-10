import React, { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { FaSpinner, FaPaperPlane, FaUsers, FaArrowLeft } from 'react-icons/fa';
import { RiUser3Line } from 'react-icons/ri';
import axios from 'axios';
import { renderMarkdown } from '../utils/markdown';
import { getBotAvatarIconComponent } from '../components/AvatarSelector';
import { io } from 'socket.io-client';
import ChatSidebar from '../components/SideBar.jsx';

const getToken = () => localStorage.getItem('jwtToken') || localStorage.getItem('access_token');

// AI/other-human messages render as markdown so headings, lists, **bold** etc.
// look the same as the 1:1 chat. The user's own bubble stays plain text.
const GroupMessageBody = React.memo(({ text, isMe }) => {
  const mdRef = useRef(null);
  useLayoutEffect(() => {
    if (isMe) return;
    const el = mdRef.current;
    if (!el) return;
    el.innerHTML = renderMarkdown(text);
  }, [text, isMe]);

  if (isMe) {
    return <p className="whitespace-pre-wrap">{text}</p>;
  }
  return (
    <div ref={mdRef} className="chat-message-md chat-message-md--light max-w-none" />
  );
});

const GroupChatPage = () => {
  const { configId } = useParams();
  const navigate = useNavigate();
  
  const [config, setConfig] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [phase, setPhase] = useState('loading'); // 'loading' | 'waiting' | 'chat'
  const [queuePosition, setQueuePosition] = useState(null);
  const [roomId, setRoomId] = useState(null);
  const [userInfo, setUserInfo] = useState(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  const socketRef = useRef(null);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  const userIdRef = useRef(null);
  const phaseRef = useRef('loading'); // mirrors phase state for use inside socket closures

  // Resolve a persistent user identity: JWT user_id → Qualtrics responseId → localStorage
  const resolveUid = async () => {
    const token = getToken();
    if (token) {
      try {
        const res = await axios.get('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
        setUserInfo(res.data);
        const id = res.data?.user_id || res.data?.id || res.data?.email;
        if (id) {
          localStorage.setItem('group_chat_uid', String(id));
          return String(id);
        }
      } catch {}
    }
    const qualtricsId = window.ragChatConfig?.responseId;
    if (qualtricsId && !qualtricsId.includes('${')) {
      const qid = `Q_${qualtricsId}`;
      localStorage.setItem('group_chat_uid', qid);
      return qid;
    }
    // Fall back to whatever is already stored, or generate a new random ID
    let stored = localStorage.getItem('group_chat_uid');
    if (!stored) {
      stored = `User_${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
      localStorage.setItem('group_chat_uid', stored);
    }
    return stored;
  };

  // 1. Fetch Config & Connect Socket
  useEffect(() => {
    let isMounted = true;

    const initSpace = async () => {
      try {
        const token = getToken();
        const headers = token ? { Authorization: `Bearer ${token}` } : {};

        const [configResponse, uid] = await Promise.all([
          axios.get(`/api/config/${configId}`, { headers }),
          resolveUid()
        ]);

        if (!isMounted) return;
        userIdRef.current = uid;
        setConfig(configResponse.data.config);

        // Connect Socket
        socketRef.current = io("/", { path: "/socket.io" });
        const socket = socketRef.current;

        // Wait for connection, then enter the matchmaking queue.
        // Guard against reconnects firing join_queue while already in chat.
        socket.on('connect', () => {
          console.log("🟢 Connected to Socket! Phase:", phaseRef.current);
          if (phaseRef.current === 'chat') return;
          socket.emit('join_queue', {
            uid: userIdRef.current,
            config_id: configId
          });
        });

        // Still waiting — update queue position and show waiting screen
        socket.on('queued', (data) => {
          console.log("⏳ Queued at position", data.position);
          setQueuePosition(data.position);
          setPhase('waiting');
        });

        // Match found — store room_id, load history, enter chat
        socket.on('match_found', (data) => {
          console.log("✅ Match found, room:", data.room_id);
          setRoomId(data.room_id);
          socket.emit('get_history', { room_id: data.room_id });
          setPhase('chat');
        });

        // Listen for history on room join
        socket.on('chat_history', (data) => {
          if (data.messages) {
            setMessages(data.messages.map(m => ({ sender: m.sender, text: m.text })));
          }
        });

        // Listen for new live messages
        socket.on('message', (data) => {
          setMessages(prev => [...prev, { sender: data.sender, text: data.text }]);
        });

      } catch (e) {
        console.error("Failed to load group space", e);
      }
    };
    
    initSpace();

    return () => {
      isMounted = false;
      if (socketRef.current) socketRef.current.disconnect();
    };
  }, [configId]);
  // Keep phaseRef in sync so socket closures always see the current phase
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Auto-expand textarea
  const adjustInputHeight = useCallback(() => {
    const ta = inputRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
  }, []);

  useEffect(() => { adjustInputHeight(); }, [input, adjustInputHeight]);

  const handleCancelQueue = () => {
    if (socketRef.current) {
      socketRef.current.emit('leave_queue', { uid: userIdRef.current });
      socketRef.current.disconnect();
    }
    navigate('/config_list');
  };

  const handleSend = () => {
    if (!input.trim() || !socketRef.current) return;

    socketRef.current.emit('send_message', {
      room_id: roomId,
      uid: userIdRef.current,
      text: input
    });

    setInput('');
  };

  if (phase === 'loading') {
    return (
      <div className="h-screen flex items-center justify-center bg-[#F0F6FB] text-[#222]">
        <FaSpinner className="animate-spin text-4xl text-[#FA6C43]" />
      </div>
    );
  }

  if (phase === 'waiting') {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-[#F0F6FB] text-[#222]" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
        <div className="flex flex-col items-center gap-6 bg-white rounded-3xl shadow-md border border-gray-100 px-12 py-14 max-w-sm w-full mx-4">
          {/* Pulsing icon */}
          <div className="relative flex items-center justify-center w-20 h-20 rounded-3xl bg-[#F9D0C4]/40">
            <FaUsers className="text-4xl text-[#FA6C43]" />
            <span className="absolute -top-1 -right-1 flex h-4 w-4">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#FA6C43] opacity-60" />
              <span className="relative inline-flex h-4 w-4 rounded-full bg-[#FA6C43]" />
            </span>
          </div>

          <div className="text-center">
            <h2 className="text-xl font-bold text-[#222] mb-2">Finding your group…</h2>
            <p className="text-gray-500 text-sm">Waiting for other participants to join.</p>
          </div>

          {queuePosition !== null && (
            <div className="inline-flex items-center gap-2 rounded-full border border-[#FA6C43]/35 bg-gradient-to-r from-[#F9D0C4]/50 to-[#FA6C43]/15 px-4 py-2 shadow-sm ring-1 ring-[#FA6C43]/10">
              <span className="text-xs font-bold uppercase tracking-widest text-[#C2410C]">
                Position in queue: {queuePosition}
              </span>
            </div>
          )}

          <FaSpinner className="animate-spin text-2xl text-[#FA6C43] opacity-60" />

          <button
            onClick={handleCancelQueue}
            className="mt-2 inline-flex items-center gap-2 text-sm font-semibold text-gray-500 hover:text-[#FA6C43] transition-colors"
          >
            <FaArrowLeft className="text-xs" />
            Leave queue
          </button>
        </div>
      </div>
    );
  }

  const LobbyIcon = getBotAvatarIconComponent(config?.bot_avatar);

  return (
    <div className="flex h-screen overflow-hidden bg-[#F0F6FB] font-sans text-[#222]" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>

      {/* Mobile overlay backdrop */}
      {userInfo && isMobileSidebarOpen && (
        <button className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={() => setIsMobileSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      {userInfo && (
        <ChatSidebar
          sessions={[]}
          sessionsLoading={false}
          userInfo={userInfo}
          userInfoLoaded={!!userInfo}
          configId={configId}
          isCollapsed={isSidebarCollapsed}
          isMobileOpen={isMobileSidebarOpen}
          onClose={() => setIsMobileSidebarOpen(false)}
          onToggle={() => setIsSidebarCollapsed(v => !v)}
          onNewChat={() => { navigate('/config_list'); setIsMobileSidebarOpen(false); }}
          onNavigateWithAutoSave={(cb) => cb()}
          isPublic={false}
          activeTab="chats"
          onSetTab={() => {}}
          currentFolder=""
          onSetFolder={() => {}}
          libraryFiles={[]}
          libraryFolders={[]}
          filesLoading={false}
          isUploading={false}
          uploadError={null}
          onUpload={() => {}}
          onUploadUrl={() => {}}
          onDeleteFile={() => {}}
          onCreateFolder={() => {}}
          onDeleteFolder={() => {}}
          selectable={false}
          selectedFileIds={[]}
          onToggleFile={() => {}}
        />
      )}

      <div className={`relative flex-1 flex flex-col w-full h-full transition-all duration-300 ${userInfo ? (isSidebarCollapsed ? 'md:ml-20' : 'md:ml-[30%]') : ''}`}>
        
        {/* Header */}
        <header className="flex items-center justify-between px-6 py-3 border-b border-gray-200 bg-white/95 backdrop-blur z-10 h-16 shadow-sm">
          <div className="flex items-center gap-4">
            <button onClick={() => navigate('/config_list')} className="text-gray-400 hover:text-gray-700 p-2 bg-gray-50 rounded-lg">
              <FaArrowLeft />
            </button>
            <div className="p-2 rounded-lg bg-[#F9D0C4]/40 text-[#FA6C43]">
              {LobbyIcon ? <LobbyIcon className="text-xl" /> : <FaUsers className="text-xl" />}
            </div>
            <div className="min-w-0 flex items-center gap-3">
              <h1 className="font-semibold text-[#222] text-base truncate">{config?.bot_name || "Drop-In Space"}</h1>
              <div className="inline-flex items-center gap-2 rounded-full border border-[#FA6C43]/35 bg-gradient-to-r from-[#F9D0C4]/50 to-[#FA6C43]/15 px-3 py-1 shadow-sm ring-1 ring-[#FA6C43]/10 shrink-0">
                <span className="relative flex h-2 w-2 shrink-0">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#FA6C43] opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-[#FA6C43]" />
                </span>
                <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#C2410C]">
                  Live session active
                </span>
              </div>
            </div>
          </div>
        </header>

        {/* Chat Area */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:px-12 xl:px-20 scrollbar-thin">
          <div className="w-full space-y-6 pb-4">
            
            {messages.length === 0 && (
                <div className="flex flex-col items-center justify-center py-20 opacity-80">
                    <div className="w-20 h-20 bg-[#F9D0C4]/40 rounded-3xl flex items-center justify-center mb-6">
                        {LobbyIcon ? (
                          <LobbyIcon className="text-4xl text-[#FA6C43]" />
                        ) : (
                          <FaUsers className="text-4xl text-[#FA6C43]" />
                        )}
                    </div>
                    <h2 className="text-2xl font-bold text-[#222] mb-2">Welcome to {config?.bot_name}</h2>
                    <p className="text-gray-500">Say hello to get the group talking!</p>
                </div>
            )}

            {messages.map((msg, i) => {
              const isMe = msg.sender === userIdRef.current;
              const isSystem = msg.sender === 'System';

              if (isSystem) {
                return (
                  <div key={i} className="flex justify-center my-4 animate-in fade-in">
                    <span className="bg-gray-100 text-gray-500 text-xs px-3 py-1 rounded-full font-medium">
                      {msg.text}
                    </span>
                  </div>
                );
              }

              return (
                <div key={i} className={`flex gap-4 ${isMe ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-2 duration-300`}>
                  
                  {!isMe && (
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[#F9D0C4]/60 flex items-center justify-center mt-1">
                      <span className="text-[#FA6C43] text-xs font-bold">{msg.sender.substring(0,2).toUpperCase()}</span>
                    </div>
                  )}

                  <div className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                    {!isMe && <span className="text-[10px] font-bold text-gray-500 ml-1 mb-1">{msg.sender}</span>}
                    
                    <div className={`min-w-0 max-w-[88%] rounded-2xl px-5 py-3 shadow-sm text-[15px] leading-[1.65] break-words overflow-hidden ${
                      isMe
                        ? 'bg-[#FA6C43] text-white rounded-br-none'
                        : 'bg-white border border-gray-200 text-[#222] rounded-bl-none'
                    }`}>
                      <GroupMessageBody text={msg.text} isMe={isMe} />
                    </div>
                  </div>

                  {isMe && (
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[#F9D0C4]/60 flex items-center justify-center mt-1">
                      <RiUser3Line className="text-[#FA6C43] text-sm" />
                    </div>
                  )}
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>
        </main>

        {/* Input Area */}
        <footer className="p-4 sm:p-6 lg:px-12 xl:px-20 bg-white border-t border-gray-200">
          <div className="w-full relative flex items-center gap-3">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Message the space..."
              rows={1}
              className="flex-1 min-h-[52px] max-h-[200px] resize-none overflow-y-auto scrollbar-hide bg-[#F0F6FB] text-[#222] placeholder-gray-500 border border-gray-200 rounded-2xl px-5 py-4 focus:outline-none focus:ring-2 focus:ring-[#FA6C43]/50 focus:border-[#FA6C43]/50 transition-all"
            />
            <button 
              onClick={handleSend}
              disabled={!input.trim()}
              className="p-4 bg-[#FA6C43] hover:bg-[#E55B34] text-white rounded-2xl disabled:opacity-50 transition-all active:scale-95"
            >
              <FaPaperPlane className="text-lg" />
            </button>
          </div>
        </footer>

      </div>
    </div>
  );
};

export default GroupChatPage;