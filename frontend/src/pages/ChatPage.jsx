import { FiAlertTriangle, FiChevronRight, FiLoader, FiSend } from 'react-icons/fi';
import React, { useEffect, useRef, useState } from 'react';
import { RiRobot2Line, RiUser3Line } from 'react-icons/ri';
import { useNavigate, useParams } from 'react-router-dom';

import ChatSidebar  from '../components/SideBar.jsx';
import { FaSpinner } from 'react-icons/fa';
import apiClient from '../api/apiClient';
import axios from 'axios';
import { marked } from 'marked';
// Import Qualtrics integration utility
import '../utils/qualtricsIntegration.js';

const ChatMessage = ({ message }) => {

  const { sender, text, isTyping } = message;
  const isUser = sender === 'user';

  const createMarkup = (markdownText) => {
    //check_n
    const rawMarkup = marked.parse(markdownText || '');
    return { __html: rawMarkup };
  };

  return (
    <div className={`flex gap-4 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && (
        <div className="flex-shrink-0 w-10 h-10 rounded-full bg-indigo-500/20 flex items-center justify-center">
          <RiRobot2Line className="text-indigo-400 text-xl" />
        </div>
      )}
      <div className={`max-w-[80%] rounded-2xl p-4 ${
        isUser
          ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white'
          : 'bg-gray-800/50 backdrop-blur-sm border border-gray-700/50'
      }`}>
        {isTyping ? (
          <div className="flex space-x-2">
            <div className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '0ms' }} />
            <div className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '150ms' }} />
            <div className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
        ) : (
          <div
            className="prose prose-invert max-w-none text-gray-100"
            dangerouslySetInnerHTML={createMarkup(text)}
          />
        )}

      </div>
      {isUser && (
        <div className="flex-shrink-0 w-10 h-10 rounded-full bg-indigo-500/20 flex items-center justify-center">
          <RiUser3Line className="text-indigo-400 text-xl" />
        </div>
      )}
    </div>
  );
};

// Enhanced Qualtrics integration with error handling
const addMessageToQualtrics = (sender, content) => {
  console.log('🔍 DEBUG: addMessageToQualtrics called with:', { sender, content: content?.substring(0, 100) + '...' });
  
  try {
    if (typeof window !== 'undefined') {
      console.log('🔍 DEBUG: Window is defined');
      
      if (window.addMessageToQualtrics && typeof window.addMessageToQualtrics === 'function') {
        console.log('🔍 DEBUG: Using window.addMessageToQualtrics function');
        return window.addMessageToQualtrics(sender, content);
      }
      
      if (typeof Qualtrics !== 'undefined' && Qualtrics.SurveyEngine) {
        console.log('🔍 DEBUG: Qualtrics SurveyEngine available, adding to ragChatHistory');
        if (!window.ragChatHistory) {
          window.ragChatHistory = [];
          console.log('🔍 DEBUG: Initialized new ragChatHistory array');
        }
        const message = {
          sender: sender,
          content: content,
          timestamp: new Date().toISOString(),
          messageIndex: window.ragChatHistory.length + 1
        };
        window.ragChatHistory.push(message);
        console.log('🔍 DEBUG: Message added to ragChatHistory. Total messages:', window.ragChatHistory.length);
        console.log('🔍 DEBUG: Current ragChatHistory:', window.ragChatHistory);
        return true;
      }
      
      if (window.parent && window.parent !== window) {
        console.log('🔍 DEBUG: Posting message to parent window');
        window.parent.postMessage({
          type: 'CHAT_MESSAGE',
          sender: sender,
          content: content,
          timestamp: new Date().toISOString()
        }, '*');
        return true;
      }
      
      console.log('🔍 DEBUG: No Qualtrics integration method available');
    }
    return false;
  } catch (error) {
    console.warn('Qualtrics integration error:', error);
    return false;
  }
};

const ChatPage = () => {
  const { configId, chatId, qualtricsId } = useParams();
  const navigate = useNavigate();
  
  // Initialize Qualtrics integration when component mounts
  useEffect(() => {
    if (qualtricsId && configId) {
      // Initialize RAG Qualtrics integration
      if (window.RAGQualtrics && window.RAGQualtrics.initialize) {
        const initSuccess = window.RAGQualtrics.initialize({
          configId: configId,
          responseId: qualtricsId,
          chatId: chatId || `chat_${Date.now()}`,
          hiddenQuestionId: 'QID1_ChatHistory'
        });
        
        if (initSuccess) {
          console.log('🚀 Qualtrics integration initialized for chat');
        }
      } else {
        // Fallback initialization
        window.ragChatHistory = window.ragChatHistory || [];
        window.ragChatConfig = {
          configId: configId,
          responseId: qualtricsId,
          chatId: chatId || `chat_${Date.now()}`,
          initialized: true
        };
        console.log('📝 Basic Qualtrics integration initialized');
      }
    }
  }, [configId, chatId, qualtricsId]);
  
  // Debug: Log Qualtrics integration status
  useEffect(() => {
    if (qualtricsId) {
      const logStatus = () => {
        const stats = window.RAGQualtrics?.getStats?.() || {
          messageCount: window.ragChatHistory?.length || 0,
          isInitialized: !!(window.ragChatConfig?.initialized),
          configId: window.ragChatConfig?.configId || null
        };
        console.log('📊 Qualtrics Integration Status:', stats);
      };
      
      // Log initial status
      logStatus();
      
      // Log status every 30 seconds for debugging
      const interval = setInterval(logStatus, 30000);
      return () => clearInterval(interval);
    }
  }, [qualtricsId]);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [config, setConfig] = useState(null);
  const [error, setError] = useState(null);
  const [showSidebar, setShowSidebar] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [sessions, setSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [userInfo, setUserInfo] = useState(null);
  const [userInfoLoaded, setUserInfoLoaded] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const [saveAlert, setSaveAlert] = useState(null); // { type: 'success' | 'error', message: string }
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const isAuthenticated = !!localStorage.getItem('jwtToken');

  // Simple navigation handler (Qualtrics client-side JS handles saving)
  const handleNavigationWithAutoSave = (navigationFn) => {
    if (navigationFn) navigationFn();
  };


  const handleNewChat = async () => {
    await handleNavigationWithAutoSave(() => {
      setIsInitializing(true);
      setMessages([]);
      setInput('');
      setError(null);
      setTimeout(() => setIsInitializing(false), 300);
    });
  };


  useEffect(() => {
    const fetchConfigDetails = async () => {
      if (!configId) {
        setError("Invalid configuration selected");
        setIsInitializing(false);
        return;
      }

      try {
        let response;
        
        // If user is authenticated, try with authentication first (for private chats)
        if (isAuthenticated) {
          try {
            response = await apiClient.get(`/config/${configId}`);
          } catch (authError) {
            // If authenticated request fails, try without auth (might be a public chat)
            if (authError.response?.status === 401 || authError.response?.status === 403) {
              response = await axios.get(`/api/config/${configId}`);
            } else {
              throw authError;
            }
          }
        } else {
          // If user is not authenticated, use direct axios call
          response = await axios.get(`/api/config/${configId}`);
        }
        
        setConfig(response.data.config);
      } catch (error) {
        console.error("Failed to fetch config:", error);
        setError("Failed to load chatbot configuration");
      } finally {
        setIsInitializing(false);
      }
    };
    fetchConfigDetails();
  }, [configId]);

  useEffect(() => {
    const fetchChatHistory = async () => {
      if (!chatId) return;
      
      setIsInitializing(true);
      try {
        const response = await apiClient.get(`/history/${chatId}`);
        const formattedMessages = response.data.history.map(item => ({
          sender: item.type === 'human' ? 'user' : 'ai',
          text: item.data?.content || '',
          sources: item.data?.sources || []
        }));
        setMessages(formattedMessages);
      } catch (error) {
        console.error("Failed to fetch history:", error);
        setError("Failed to load chat history");
      } finally {
        setIsInitializing(false);
      }
    };
    fetchChatHistory();
  }, [chatId]);

  useEffect(() => {
    // Only fetch sessions if user is authenticated
    if (!isAuthenticated) {
      setSessionsLoading(false);
      return;
    }

    const fetchSessions = async () => {
      if (!configId) return;
      setSessionsLoading(true);
      try {
        const response = await apiClient.get(`/chat/list/${configId}`);
        setSessions(response.data.sessions);
      } catch (error) {
        console.error("Failed to fetch sessions:", error);
      } finally {
        setSessionsLoading(false);
      }
    };
    fetchSessions();
  }, [configId, messages, isAuthenticated]);

  useEffect(() => {
    // Only fetch user info if user is authenticated
    if (!isAuthenticated) {
      setUserInfoLoaded(true);
      return;
    }

    const fetchUserInfo = async () => {
      try {
        const response = await apiClient.get('/auth/me');
        setUserInfo(response.data);
      } catch (error) {
        console.error('Failed to fetch user info:', error);
      } finally {
        setUserInfoLoaded(true);
      }
    };
    fetchUserInfo();
  }, [isAuthenticated]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);


  const handleSend = async () => {
    if (!input.trim() || isLoading || !configId) return;


    const userMessage = { sender: 'user', text: input };

    // Add user message to Qualtrics history
    try {
      console.log('🔄 Adding user message to Qualtrics history');
      const userResult = addMessageToQualtrics('user', input);
      console.log('🔄 User message tracking result:', userResult);
    } catch (error) {
      console.warn('Failed to add user message to Qualtrics:', error);
    }

    setMessages(prev => [...prev, userMessage, { sender: 'ai', isTyping: true }]);
    setInput('');
    setIsLoading(true);

    try {
      const targetChatId = chatId || crypto.randomUUID();


      const response = await apiClient.post(`/chat/${configId}/${targetChatId}`, {
        input: userMessage.text,
      });

      if (!chatId) {
        navigate(`/chat/${configId}/${targetChatId}`, { replace: true });
      }

      const aiResponse = {
            sender: 'ai',
            text: response.data.response,
            sources: response.data.sources || []
        };

      // Add AI response to Qualtrics history
      try {
        addMessageToQualtrics('ai', response.data.response);
        
        // Trigger explicit save after both messages are added
        setTimeout(() => {
          try {
            console.log('🔄 Triggering explicit Qualtrics save after message exchange');
            // Check parent window first (for iframe context)
            if (window.parent && window.parent.saveRAGChatToQualtrics) {
              window.parent.saveRAGChatToQualtrics();
            } else if (window.saveRAGChatToQualtrics) {
              window.saveRAGChatToQualtrics();
            } else {
              // Try to access parent Qualtrics directly
              if (window.parent && typeof window.parent.Qualtrics !== 'undefined') {
                console.log('Saving via parent Qualtrics');
              } else {
                console.warn('⚠️ No saveRAGChatToQualtrics function found');
              }
            }
          } catch (saveError) {
            console.error('Failed to trigger explicit save:', saveError);
          }
        }, 100); // Small delay to ensure messages are processed
        
      } catch (error) {
        console.warn('Failed to add AI response to Qualtrics:', error);
      }

     setMessages(prev => {
            // Remove the last item (the typing indicator)
            const updatedMessages = prev.slice(0, -1); 
            // Add the final AI response
            return [...updatedMessages, aiResponse];
        });

    } catch (error) {
        console.error("Chat error:", error);
        // On error, revert the optimistic updates (remove user message and typing indicator)
        setMessages(prev => prev.slice(0, -2)); 
        setInput(userMessage.text); // Put the user's text back in the input
        setError("Failed to send message. Please try again.");
    } finally {
        setIsLoading(false);
    }
  };

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 p-6 text-center">
        <div className="p-4 bg-red-900/50 rounded-xl border border-red-700/50 max-w-md">
          <FiAlertTriangle className="mx-auto text-red-400 text-3xl mb-3" />
          <h2 className="text-xl font-medium text-white mb-2">Error</h2>
          <p className="text-gray-300 mb-4">{error}</p>
          <button
            onClick={() => navigate('/config_list')}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 rounded-lg text-white"
          >
            Back to Configurations
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-gray-900">
      {/* Sidebar */}
     {isAuthenticated && (
      <div className="hidden md:block">
        
        <ChatSidebar 
          sessions={sessions} 
          sessionsLoading={sessionsLoading}
          userInfo={userInfo}
          userInfoLoaded={userInfoLoaded}
          configId={configId} 
          isCollapsed={isSidebarCollapsed}
          onToggle={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
          onClose={() => setShowSidebar(false)}
          onNewChat={handleNewChat}
          onNavigateWithAutoSave={handleNavigationWithAutoSave}
          isPublic={config?.is_public}
        />
	
      </div>
     )}

      {/* Mobile sidebar overlay */}
      {showSidebar && isAuthenticated && (
        <div className="fixed inset-0 z-40 bg-black/40 md:hidden">
          <div className="absolute left-0 top-0 h-full">
            <ChatSidebar 
              sessions={sessions} 
              sessionsLoading={sessionsLoading}
              userInfo={userInfo}
              userInfoLoaded={userInfoLoaded}
              configId={configId} 
              isCollapsed={false}
              onClose={() => setShowSidebar(false)}
              onNewChat={handleNewChat}
              onNavigateWithAutoSave={handleNavigationWithAutoSave}
            />
          </div>
        </div>
      )}

      {/* Main content with loading overlay */}
      <div className={`relative flex-1 flex flex-col w-full transition-all duration-300 ${
        isAuthenticated && !isSidebarCollapsed ? 'md:ml-72' : 'md:ml-0'
      }`}>
        {/* Loading overlay - positioned within chat area */}
        {isInitializing && (
          <div className="absolute inset-0 z-10 bg-gray-900/80 backdrop-blur-sm flex items-center justify-center">
            <div className="flex flex-col items-center">
              <FaSpinner className="animate-spin text-3xl text-indigo-400 mb-4" />
              <p className="text-gray-400">Loading chat...</p>
            </div>
          </div>
        )}

        {/* Legacy auto-save overlay - no longer needed with client-side approach */}

        {/* Save Alert Notification */}
        {saveAlert && (
          <div className={`fixed top-4 right-4 z-30 p-4 rounded-lg shadow-lg border max-w-md ${
            saveAlert.type === 'success' 
              ? 'bg-green-900/90 border-green-500/50 text-green-100' 
              : 'bg-red-900/90 border-red-500/50 text-red-100'
          }`}>
            <div className="flex items-start space-x-3">
              <div className="flex-1">
                <p className="text-sm font-medium">{saveAlert.message}</p>
              </div>
              <button
                onClick={() => setSaveAlert(null)}
                className="text-gray-400 hover:text-white"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        <header className="p-4 bg-gray-900 ">
          <div className="container mx-auto flex items-center justify-between">
            <button 
              className="md:hidden p-2 rounded-full bg-gray-800 hover:bg-gray-700 text-gray-400"
              onClick={() => setShowSidebar(true)}
            >
              <FiChevronRight className="text-xl" />
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 sm:p-6 z-0">
          <div className="container mx-auto max-w-4xl space-y-6">
            {messages.length === 0 && !isLoading && !isInitializing && (
              <div className="flex flex-col items-center justify-center h-full text-center px-4 py-16 sm:py-20">
                <div className="mb-6 flex flex-col items-center">
                  <h2 className='text-3xl font-bold bg-gradient-to-r from-indigo-400 to-purple-500 bg-clip-text text-transparent'>
                    Hey! I'm {config?.bot_name || ''}
                  </h2>
		{isAuthenticated && (
                  <p className="text-xs text-gray-400 mt-1 bg-gray-800 px-2 py-1 rounded-full">
                    {config?.model_name || 'AI Model'}
                  </p>
		)}
                </div>
                <h2 className="text-2xl font-bold bg-gray-500 bg-clip-text text-transparent">
                  How can I help you today ?
                </h2>
              </div>
            )}

            {messages.map((msg, index) => (
              <ChatMessage key={index} message={msg} />
            ))}

            {isLoading && messages[messages.length - 1]?.sender !== 'ai' && (
              <ChatMessage message={{ sender: 'ai', isTyping: true }} />
            )}

            <div ref={messagesEndRef} />
          </div>
        </main>

        <footer className="p-4 bg-gray-900 border-t border-gray-800 z-0">
          <div className="container mx-auto max-w-4xl">

            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
                className="flex-1 px-5 py-3 bg-gray-800 border border-gray-700 rounded-full focus:outline-none focus:ring-2 focus:ring-indigo-500 text-white placeholder-gray-500"
                placeholder="Type your message..."
                disabled={isLoading || isInitializing}
              />
              <button
                onClick={handleSend}
                disabled={isLoading || !input.trim() || isInitializing}
                className={`p-3 rounded-full ${
                  isLoading || !input.trim() || isInitializing
                    ? 'bg-gray-700 text-gray-500'
                    : 'bg-indigo-600 text-white hover:bg-indigo-700'
                } transition-all`}
              >
                {isLoading ? <FiLoader className="animate-spin" /> : <FiSend />}
              </button>
            </div>
	{isAuthenticated && (
            <p className="text-xs text-gray-500 mt-2 text-center">
              {config?.is_public ? 'Public chat' : 'Private chat'} • Powered by {config?.model_name || 'AI'}
            </p>
)}
          </div>
        </footer>
      </div>
    </div>
  );
};

export default ChatPage;
