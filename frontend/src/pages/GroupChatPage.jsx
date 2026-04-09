import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { FaSpinner, FaPaperPlane, FaUsers, FaArrowLeft } from 'react-icons/fa';
import { RiUser3Line } from 'react-icons/ri';
import axios from 'axios';
import { getBotAvatarIconComponent } from '../components/AvatarSelector';
import { io } from 'socket.io-client';

const getToken = () => localStorage.getItem('jwtToken') || localStorage.getItem('access_token');

const GroupChatPage = () => {
  const { configId } = useParams();
  const navigate = useNavigate();
  
  const [config, setConfig] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isReady, setIsReady] = useState(false);
  
  const socketRef = useRef(null);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  
  // Create a persistent username (In a real app, pull from JWT user profile)
  const userIdRef = useRef(`User_${Math.random().toString(36).substring(2, 6).toUpperCase()}`); 

  // 1. Fetch Config & Connect Socket
  
  
  // 1. Fetch Config & Connect Socket
  useEffect(() => {
    let isMounted = true;
    
    const initSpace = async () => {
      try {
        const token = getToken();
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        const response = await axios.get(`/api/config/${configId}`, { headers });
        
        if (!isMounted) return;
        setConfig(response.data.config);

        // Connect Socket & Force WebSocket transport for better stability
        socketRef.current = io("http://localhost:5000");
        const socket = socketRef.current;

        // --- NEW FIX: Wait for connection BEFORE emitting ---
        socket.on('connect', () => {
          console.log("🟢 Connected to Socket! Joining room...");
          socket.emit('join_group_chat', {
            uid: userIdRef.current,
            config_id: configId
          });
        });

        // Listen for history when dropping in
        socket.on('chat_history', (data) => {
          if (data.messages) {
            setMessages(data.messages.map(m => ({ sender: m.sender, text: m.text })));
          }
        });

        // Listen for new live messages
        socket.on('message', (data) => {
          setMessages(prev => [...prev, { sender: data.sender, text: data.text }]);
        });

        setIsReady(true);

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

  const handleSend = () => {
    if (!input.trim() || !socketRef.current) return;

    socketRef.current.emit('send_message', {
      config_id: configId,
      uid: userIdRef.current,
      text: input
    });

    setInput('');
  };

  if (!isReady) {
    return (
      <div className="h-screen flex items-center justify-center bg-[#F0F6FB] text-[#222]">
        <FaSpinner className="animate-spin text-4xl text-[#FA6C43]" />
      </div>
    );
  }

  const LobbyIcon = getBotAvatarIconComponent(config?.bot_avatar);

  return (
    <div className="flex h-screen overflow-hidden bg-[#F0F6FB] font-sans text-[#222]" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
      <div className="relative flex-1 flex flex-col w-full h-full transition-all duration-300">
        
        {/* Header */}
        <header className="flex items-center justify-between px-6 py-3 border-b border-gray-200 bg-white/95 backdrop-blur z-10 h-16 shadow-sm">
          <div className="flex items-center gap-4">
            <button onClick={() => navigate('/config_list')} className="text-gray-400 hover:text-gray-700 p-2 bg-gray-50 rounded-lg">
              <FaArrowLeft />
            </button>
            <div className="p-2 rounded-lg bg-[#F9D0C4]/40 text-[#FA6C43]">
              {LobbyIcon ? <LobbyIcon className="text-xl" /> : <FaUsers className="text-xl" />}
            </div>
            <div className="min-w-0">
              <h1 className="font-semibold text-[#222] text-base truncate">{config?.bot_name || "Drop-In Space"}</h1>
              <div className="mt-1.5 inline-flex items-center gap-2 rounded-full border border-[#FA6C43]/35 bg-gradient-to-r from-[#F9D0C4]/50 to-[#FA6C43]/15 px-3 py-1 shadow-sm ring-1 ring-[#FA6C43]/10">
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
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 scrollbar-thin">
          <div className="w-full max-w-4xl mx-auto space-y-6 pb-4">
            
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
                    
                    <div className={`max-w-[85%] rounded-2xl px-5 py-3 shadow-sm text-sm leading-relaxed ${
                      isMe 
                        ? 'bg-[#FA6C43] text-white rounded-br-none' 
                        : 'bg-white border border-gray-200 text-[#222] rounded-bl-none'
                    }`}>
                      {msg.text}
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
        <footer className="p-4 sm:p-6 bg-white border-t border-gray-200">
          <div className="max-w-4xl mx-auto relative flex items-center gap-3">
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