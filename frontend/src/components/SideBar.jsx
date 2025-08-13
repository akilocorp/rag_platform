import React, { useState, useEffect } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import apiClient from '../api/apiClient';
import { 
  FiMessageSquare, 
  FiPlus, 
  FiSettings, 
  FiClock,
  FiChevronRight,
  FiChevronLeft,
  FiLoader,
  FiUser,
  FiLogOut,
  FiMoreHorizontal,
  FiDownload
} from 'react-icons/fi';
import { RiRobot2Line } from 'react-icons/ri';
import { FaSpinner } from 'react-icons/fa';

export const ChatSidebar = ({ 
  sessions = [], 
  sessionsLoading = false,
  userInfo = null,
  userInfoLoaded = false,
  configId, 
  isCollapsed, 
  onClose, 
  onToggle,
  onNewChat,
  onNavigateWithAutoSave,
  isPublic
}) => {
  const { chatId: activeChatId } = useParams();
  const navigate = useNavigate();
  const [openDropdown, setOpenDropdown] = useState(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = () => {
      setOpenDropdown(null);
    };
    
    if (openDropdown) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [openDropdown]);

  const handleNewChatClick = (e) => {
    if (onNewChat) {
      e.preventDefault();
      onNewChat();
      setTimeout(() => {
        window.location.href = `/chat/${configId}`;
      }, 0);
    }
  };

  const handleLogout = async () => {
    try {
      await apiClient.post('/auth/logout');
      localStorage.removeItem('jwtToken');
      localStorage.removeItem('refreshToken');
      navigate('/login');
    } catch (error) {
      console.error('Error during logout:', error);
    }
  };

  const handleDownloadChat = async (sessionId, title) => {
    try {
      const response = await apiClient.get(`/history/${sessionId}`);
      const chatHistory = response.data.history;
      //change
      let textContent = `Chat History: ${title || 'New Chat'}\n`;
      textContent += `Downloaded on: ${new Date().toLocaleString()}\n`;
      textContent += '='.repeat(50) + '\n\n';
      
      chatHistory.forEach((message, index) => {
        const sender = message.type === 'human' ? 'User' : 'AI';
        const content = message.data?.content || '';
        textContent += `${sender}: ${content}\n\n`;
      });
      
      const blob = new Blob([textContent], { type: 'text/plain' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `chat-${title || 'conversation'}-${new Date().toISOString().split('T')[0]}.txt`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      
      setOpenDropdown(null);
    } catch (error) {
      console.error('Error downloading chat:', error);
    }
  };

  const handleConfigsClick = (e) => {
    if (onNavigateWithAutoSave) {
      e.preventDefault();
      onNavigateWithAutoSave(() => {
        navigate('/config_list');
      });
    }
  };

  const menuItems = [
    {
      icon: <FiPlus className="w-5 h-5" />,
      text: 'New Chat',
      link: `/chat/${configId}`,
      active: activeChatId === undefined,
      onClick: handleNewChatClick
    },
    {
      icon: <FiChevronLeft className="w-5 h-5" />,
      text: 'Configs',
      link: `/config_list`,
      active: false,
      onClick: handleConfigsClick
    },
  ];

  return (
    <aside className={`bg-gray-800/50 backdrop-blur-lg border-r border-gray-700/30 text-white h-full fixed z-[50] transition-all duration-300 overflow-y-auto ${
      isCollapsed ? 'w-20' : 'w-72'
    } left-0 top-0 pt-6 pr-2 pl-2`}>
      {/* Mobile close button */}
      <button 
        className="absolute right-10 top-0 -mr-10 mt-4 p-2 rounded-full bg-gray-800/50 text-gray-400 hover:text-gray-300 transition-colors md:hidden"
        onClick={onClose}
      >
        <FiChevronLeft className="w-5 h-5" />
      </button>
      
      {/* Desktop toggle button */}
      <button 
        className="absolute right-10 top-0 -mr-10 mt-4 p-2 rounded-full bg-gray-800/50 hover:bg-gray-700/50 text-gray-400 hover:text-gray-300 transition-colors hidden md:block"
        onClick={onToggle}
      >
        {isCollapsed ? (
          <FiChevronRight className="w-5 h-5" />
        ) : (
          <FiChevronLeft className="w-5 h-5" />
        )}
      </button>

      <div className="flex flex-col h-full">
        {/* Header (Fixed) */}
        <div className={`flex items-center ${isCollapsed ? 'justify-center' : 'justify-between'} mb-8`}>
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-indigo-500/10 rounded-lg">
              <RiRobot2Line className="text-indigo-400 text-xl" />
            </div>
            {!isCollapsed && (
              <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 to-purple-500">
                ChatBot AI
              </h1>
            )}
          </div>
        </div>

        {/* Main Navigation (Fixed) */}
        <nav className="space-y-2 mb-8">
          {menuItems.map((item, index) => (
            <Link
              key={index}
              to={item.link}
              onClick={item.onClick}
              className={`flex items-center ${isCollapsed ? 'justify-center' : 'space-x-3 px-4'} py-3 rounded-xl transition-all ${
                item.active
                  ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-lg'
                  : 'hover:bg-gray-700/50 text-gray-300'
              }`}
              title={isCollapsed ? item.text : ''}
            >
              <div className={`p-1 rounded-lg ${
                item.active ? 'bg-white/20' : 'bg-gray-700/50'
              }`}>
                {React.cloneElement(item.icon, {
                  className: `${item.icon.props.className} ${
                    item.active ? 'text-white' : 'text-gray-400'
                  }`
                })}
              </div>
              {!isCollapsed && (
                <span className="text-sm font-medium">{item.text}</span>
              )}
            </Link>
          ))}
        </nav>

        {/* Scrollable Chat History Section (Hidden when collapsed) */}
        {!isCollapsed && (
          <div className="flex-1 overflow-y-auto pr-2">
            <div className="mb-6">
              <div className="flex items-center justify-between px-2 mb-4">
                <h2 className="flex items-center text-xs font-semibold uppercase tracking-wider text-gray-400">
                  <FiClock className="mr-2" />
                  Recent Chats
                </h2>
                <span className="text-xs text-gray-500">
                  {sessions.length} {sessions.length === 1 ? 'chat' : 'chats'}
                </span>
              </div>

              <div className="space-y-1">
                {sessionsLoading ? (
                  <div className="flex items-center justify-center p-6">
                    <div className="flex flex-col items-center">
                      <FaSpinner className="animate-spin text-2xl text-indigo-400 mb-4" />
                      <p className="text-gray-400 text-sm">Loading recent chats...</p>
                    </div>
                  </div>
                ) : sessions.length > 0 ? (
                  sessions.map((session) => (
                    <div key={session.session_id} className="relative">
                      <Link
                        to={`/chat/${configId}/${session.session_id}`}
                        className={`flex items-center justify-between px-4 py-3 rounded-xl transition-all ${
                          activeChatId === session.session_id 
                            ? 'bg-gray-700/70 border border-gray-600/50'
                            : 'hover:bg-gray-700/30'
                        }`}
                      >
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm truncate ${
                            activeChatId === session.session_id ? 'text-white' : 'text-gray-300'
                          }`}>

                            {session.session_id ? `${session.session_id} - ${session.title}` : "New Chat"}
                          </p>
                          <p className="text-xs text-gray-500 mt-1">
                            {new Date(session.timestamp).toLocaleString('default', {
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </p>
                        </div>
                        <div className="flex items-center space-x-2 pr-8">
                          <FiChevronRight className="text-gray-500" />
                        </div>
                      </Link>
                      
                      {/* Three-dot menu */}
                      <div className="absolute right-2 top-1/2 transform -translate-y-1/2">
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setOpenDropdown(openDropdown === session.session_id ? null : session.session_id);
                          }}
                          className="p-1 rounded-full hover:bg-gray-600/50 text-gray-400 hover:text-gray-300 transition-colors"
                        >
                          <FiMoreHorizontal className="w-4 h-4" />
                        </button>
                        
                        {/* Dropdown menu */}
                        {openDropdown === session.session_id && (
                          <div className="absolute right-0 top-full mt-1 w-44 bg-gray-800/95 backdrop-blur-sm border border-gray-700/50 rounded-lg shadow-xl py-1 z-50">
                            <button
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                handleDownloadChat(session.session_id, session.title);
                              }}
                              className="w-full px-3 py-2 text-left text-sm text-gray-300 hover:text-green-600 transition-colors flex items-center space-x-3 rounded-md"
                            >
                              <FiDownload className="w-4 h-4 flex-shrink-0" />
                              <span>Download Chat</span>
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-center p-4">
                    <p className="text-gray-500 text-sm">No recent conversations</p>
                    <Link 
                      to={`/chat/${configId}`} 
                      className="text-indigo-400 text-xs hover:underline mt-1 inline-block"
                    >
                      Start a new chat
                    </Link>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
        
        {/* User Profile (Fixed) */}
        <div className="p-4 ">
          {userInfoLoaded && (
            userInfo ? (
              <div className="space-x-4">
                <div className={`flex items-center ${isCollapsed ? 'justify-center' : 'space-x-3 px-2'} py-3 rounded-lg cursor-pointer transition-colors`}>
                  <div className="w-8 h-8 rounded-full bg-indigo-500/10 flex items-center justify-center">
                    <FiUser className="text-indigo-400" />
                  </div>
                  {!isCollapsed && (
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white truncate">{userInfo.username}</p>
                      <p className="text-xs text-gray-500 truncate">{userInfo.email || 'User Account'}</p>
                    </div>
                  )}
                </div>
                {!isCollapsed && (
                  <button
                    onClick={handleLogout}
                    className="w-full flex items-center space-x-3 px-2 py-2 rounded-lg hover:bg-red-900/30 text-gray-400 hover:text-red-400 transition-colors"
                  >
                    <FiLogOut className="text-sm" />
                    <span className="text-sm">Logout</span>
                  </button>
                )}
              </div>
            ) : isPublic ? (
              <div className={`flex flex-col items-center ${isCollapsed ? 'justify-center' : ''} py-3`}>
                <div className="w-8 h-8 rounded-full bg-gray-500/10 flex items-center justify-center">
                  <RiRobot2Line className="text-gray-400" />
                </div>
                {!isCollapsed && (
                  <div className="text-center mt-2">
                    <p className="text-sm font-medium text-gray-300">Public Chat</p>
                    <p className="text-xs text-gray-500">Viewing as a guest</p>
                   
                  </div>
                )}
              </div>
            ) : (
              <div className={`flex items-center ${isCollapsed ? 'justify-center' : 'space-x-3 px-2'} py-3 rounded-lg`}>
                <div className="w-8 h-8 rounded-full bg-gray-500/10 flex items-center justify-center">
                  <FiUser className="text-gray-400" />
                </div>
                {!isCollapsed && (
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-400 truncate">User</p>
                    <p className="text-xs text-gray-500 truncate">Not logged in</p>
                  </div>
                )}
              </div>
            )
          )}
        </div>
      </div>
    </aside>
  );
};

export default ChatSidebar;

