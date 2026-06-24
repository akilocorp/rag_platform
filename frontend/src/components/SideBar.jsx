import React, { useState, useEffect } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import apiClient from '../api/apiClient';
import {
  FiPlus,
  FiClock,
  FiChevronLeft,
  FiChevronDown,
  FiUser,
  FiLogOut,
  FiMoreHorizontal,
  FiDownload,
  FiTrash2,
  FiFolder,
  FiBarChart2,
} from 'react-icons/fi';
import { RiRobot2Line } from 'react-icons/ri';
import { FaSpinner } from 'react-icons/fa';
import logo from '../assets/logo.png';
import FilesPanel from './FilesPanel.jsx';

const TypewriterText = ({ text, speed = 22, delay = 0 }) => {
  const [displayed, setDisplayed] = useState('');
  useEffect(() => {
    setDisplayed('');
    if (!text) return;
    let cancelled = false;
    const startTimer = setTimeout(() => {
      let i = 0;
      const tick = setInterval(() => {
        if (cancelled) { clearInterval(tick); return; }
        i++;
        setDisplayed(text.slice(0, i));
        if (i >= text.length) clearInterval(tick);
      }, speed);
      return () => clearInterval(tick);
    }, delay);
    return () => { cancelled = true; clearTimeout(startTimer); };
  }, [text, speed, delay]);
  return <>{displayed}</>;
};

export const ChatSidebar = ({
  sessions = [],
  newlyCreatedSessionId = null,
  sessionsLoading = false,
  userInfo = null,
  userInfoLoaded = false,
  configId,
  isCollapsed,
  isMobileOpen = false,
  onClose,
  onToggle,
  onNewChat,
  onNavigateWithAutoSave,
  isPublic,
  // Files tab props
  activeTab = 'chats',
  onSetTab,
  currentPath = '',
  onSetPath,
  accessibleConfigs = [],
  libraryFiles = [],
  libraryFolders = [],
  filesLoading = false,
  isUploading = false,
  uploadError = null,
  onUpload,
  onDeleteFile,
  onCreateFolder,
  onDeleteFolder,
  // Selection (for attaching files as chat context)
  canSelect = false,
  selectedFileIds = [],
  onToggleFile,
  // URL ingestion
  onFetchUrl,
  isFetchingUrl = false,
  onDeleteSession = () => {},
  // Session list customization (experiential labs reuse this list)
  sessionTo = null,            // (session) => path; defaults to the chat route
  hideSessionMenu = false,     // hide the download/delete dropdown
  sessionsLabel = 'Recent Chats',
  // Credits (UI placeholder for now)
  credits = { used: 240, total: 500 },
}) => {
  const linkForSession = sessionTo || ((session) => `/chat/${configId}/${session.session_id}`);
  const { chatId: activeChatId } = useParams();
  const navigate = useNavigate();
  const [openDropdown, setOpenDropdown] = useState(null);
  const [removingChatIds, setRemovingChatIds] = useState(() => new Set());

  useEffect(() => {
    const handleClickOutside = () => setOpenDropdown(null);
    if (openDropdown) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [openDropdown]);

  const handleNewChatClick = (e) => {
    if (onNewChat) {
      e.preventDefault();
      onNewChat();
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
      let textContent = `Chat History: ${title || 'New Chat'}\n`;
      textContent += `Downloaded on: ${new Date().toLocaleString()}\n`;
      textContent += '='.repeat(50) + '\n\n';

      chatHistory.forEach((message) => {
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

  const handleDeleteChat = (sessionId) => {
    if (removingChatIds.has(sessionId)) return;
    setOpenDropdown(null);
    setRemovingChatIds((prev) => {
      const next = new Set(prev);
      next.add(sessionId);
      return next;
    });
    setTimeout(async () => {
      try {
        await apiClient.delete(`/chat/${configId}/${sessionId}`);
        onDeleteSession(sessionId);
        if (activeChatId === sessionId) navigate(`/chat/${configId}`);
      } catch (error) {
        console.error('Error deleting chat:', error);
        setRemovingChatIds((prev) => {
          const next = new Set(prev);
          next.delete(sessionId);
          return next;
        });
      }
    }, 220);
  };

  const goConfigList = () => navigate('/config_list');

  const handleLogoClick = (e) => {
    if (onNavigateWithAutoSave) {
      e.preventDefault();
      onNavigateWithAutoSave(goConfigList);
    }
  };

  const switchTab = (tab) => {
    if (!onSetTab) return;
    onSetTab(activeTab === tab ? null : tab);
  };

  const creditsPct = Math.max(
    0,
    Math.min(100, Math.round(((credits?.used ?? 0) / Math.max(1, credits?.total ?? 1)) * 100)),
  );

  return (
    <aside
      className={`bg-white backdrop-blur-lg border-r border-gray-200 text-[#222] h-full fixed z-[50] transition-all duration-300 overflow-y-auto shadow-sm w-72 ${
        isCollapsed ? 'md:w-20' : 'md:w-[30%]'
      } ${isMobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'} left-0 top-0 pt-6 pr-2 pl-2`}
    >
      {/* Mobile close button */}
      <button
        className="absolute right-2 top-0 mt-4 p-2 rounded-full bg-[#F0F6FB] text-gray-500 hover:text-[#FA6C43] transition-colors md:hidden"
        onClick={onClose}
      >
        <FiChevronLeft className="w-5 h-5" />
      </button>

      <div className="flex flex-col h-full">
        {/* Header: logo + collapse toggle */}
        <div
          className={`relative mb-5 px-1 flex ${
            isCollapsed ? 'flex-col items-center gap-3' : 'items-center justify-between min-h-[2.75rem]'
          }`}
        >
          <Link
            to="/config_list"
            onClick={handleLogoClick}
            className={`flex items-center justify-center hover:opacity-90 transition-opacity shrink-0 ${
              isCollapsed ? 'w-full' : ''
            }`}
            title="ACTR Labs — Agent list"
          >
            <img
              src={logo}
              alt="ACTR Labs"
              className={`w-auto object-contain ${isCollapsed ? 'h-8 max-w-[2.5rem]' : 'h-10'}`}
            />
          </Link>
          <button
            type="button"
            className="p-3 rounded-full border border-gray-200 hover:bg-[#F9D0C4]/30 hover:border-[#FA6C43]/30 text-gray-700 hover:text-[#FA6C43] transition-all duration-150 hidden md:block shrink-0"
            onClick={onToggle}
            aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <FiChevronLeft className={`w-5 h-5 transition-transform duration-200 ${isCollapsed ? 'rotate-180' : ''}`} />
          </button>
        </div>

        {/* New Chat pill */}
        {!isCollapsed ? (
          <div className="mb-4 px-1">
            <button
              onClick={handleNewChatClick}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-2xl bg-[#2D6CDF] hover:bg-[#2257B8] active:scale-[0.985] text-white text-sm font-semibold transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] shadow-sm"
            >
              <FiPlus className="w-4 h-4" />
              New Chat
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-5 mb-5">
            <button
              onClick={handleNewChatClick}
              title="New Chat"
              className="p-2.5 rounded-xl bg-[#2D6CDF] hover:bg-[#2257B8] active:scale-95 text-white transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)]"
            >
              <FiPlus className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Credits remaining card */}
        {!isCollapsed && (
          <div className="mb-4 mx-1 px-3 py-3 rounded-2xl bg-[#F0F6FB] border border-[#E4ECF6]">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <FiBarChart2 className="w-3.5 h-3.5 text-[#2D6CDF]" />
                <span className="text-[13px] font-semibold text-[#222]">Credits remaining</span>
              </div>
            </div>
            <div className="h-1.5 w-full bg-white rounded-full overflow-hidden">
              <div
                className="h-full bg-[#2D6CDF] rounded-full transition-[width] duration-700 ease-[cubic-bezier(0.32,0.72,0,1)]"
                style={{ width: `${creditsPct}%` }}
              />
            </div>
            <div className="flex items-center justify-between mt-2">
              <span className="text-[11px] text-gray-500">This month</span>
              <span className="text-[11px] text-gray-700">
                <span className="font-semibold text-[#222]">{credits?.used ?? 0}</span>
                <span className="text-gray-400"> / {credits?.total ?? 0}</span>
              </span>
            </div>
          </div>
        )}

        {/* Body: stacked accordions — Recent Chats / Files */}
        {!isCollapsed && (
          <div className="flex-1 overflow-y-auto pr-1">
            {/* === Recent Chats accordion === */}
            <div className="mb-2">
              <button
                onClick={() => switchTab('chats')}
                className="w-full flex items-center justify-between px-2 py-2 rounded-lg hover:bg-[#F0F6FB] transition-colors duration-200 group"
              >
                <span className="flex items-center text-[13px] font-semibold text-[#222]">
                  <FiChevronDown
                    className={`mr-1.5 w-3.5 h-3.5 text-gray-500 transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] ${
                      activeTab === 'chats' ? 'rotate-0' : '-rotate-90'
                    }`}
                  />
                  <FiClock className="mr-1.5 w-3.5 h-3.5 text-gray-500" />
                  {sessionsLabel}
                </span>
                <span className="text-[11px] text-gray-400 tabular-nums">
                  {sessions.length}
                </span>
              </button>

              <div
                className={`grid transition-[grid-template-rows] duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ${
                  activeTab === 'chats' ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
                }`}
              >
                <div className="overflow-hidden">
                  <div
                    className={`pt-1 transition-opacity duration-300 ${
                      activeTab === 'chats' ? 'opacity-100' : 'opacity-0'
                    }`}
                  >
                    <div className="space-y-1 isolate">
                  {sessionsLoading ? (
                    <div className="space-y-1">
                      {[72, 58, 65].map((w, i) => (
                        <div key={i} className="px-4 py-3 rounded-xl">
                          <div className="h-3.5 bg-gray-200 rounded-md animate-pulse mb-2" style={{ width: `${w}%` }} />
                          <div className="h-2.5 bg-gray-100 rounded-md animate-pulse" style={{ width: '35%' }} />
                        </div>
                      ))}
                    </div>
                  ) : sessions.length > 0 ? (
                    sessions.map((session, index) => {
                      const isRemoving = removingChatIds.has(session.session_id);
                      return (
                      <div
                        key={session.session_id}
                        className={`transition-all duration-200 ease-out ${
                          isRemoving ? 'opacity-0 max-h-0 -translate-x-2 overflow-hidden' : 'opacity-100 max-h-32'
                        }`}
                      >
                      <div className={`relative ${openDropdown === session.session_id ? 'z-[100]' : ''}`}>
                        {session.pending ? (
                          <div className="px-4 py-3 rounded-xl bg-[#F9D0C4]/20">
                            <div className="h-3.5 bg-gray-200 rounded-md animate-pulse mb-2" style={{ width: '68%' }} />
                            <div className="h-2.5 bg-gray-100 rounded-md animate-pulse" style={{ width: '38%' }} />
                          </div>
                        ) : (
                          <>
                            <Link
                              to={linkForSession(session)}
                              onClick={() => onClose && onClose()}
                              className={`flex items-center px-4 pr-9 py-3 rounded-xl transition-all ${
                                activeChatId === session.session_id
                                  ? 'bg-[#F9D0C4]/40 border border-[#FA6C43]/30'
                                  : 'hover:bg-[#F0F6FB]'
                              }`}
                            >
                              <div className="flex-1 min-w-0">
                                <p
                                  className={`text-sm truncate ${
                                    activeChatId === session.session_id
                                      ? 'text-[#222] font-medium'
                                      : 'text-gray-600'
                                  }`}
                                >
                                  {session.session_id === newlyCreatedSessionId
                                    ? <TypewriterText text={session.title || 'New Chat'} />
                                    : (session.title || 'New Chat')}
                                </p>
                                <p className="text-xs text-gray-500 mt-1">
                                  {new Date(session.timestamp).toLocaleString('default', {
                                    month: 'short',
                                    day: 'numeric',
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })}
                                </p>
                              </div>
                            </Link>

                            {/* Three-dot menu */}
                            {!hideSessionMenu && (
                            <div className="absolute right-2 top-1/2 transform -translate-y-1/2">
                              <button
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setOpenDropdown(
                                    openDropdown === session.session_id ? null : session.session_id,
                                  );
                                }}
                                className="p-1 rounded-full hover:bg-[#F0F6FB] text-gray-500 hover:text-[#FA6C43] transition-colors"
                              >
                                <FiMoreHorizontal className="w-4 h-4" />
                              </button>

                              {openDropdown === session.session_id && (
                                <div className="absolute right-0 top-full mt-1 w-44 bg-white border border-gray-200 rounded-lg shadow-xl py-1 z-[60]">
                                  <button
                                    onClick={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      handleDownloadChat(session.session_id, session.title);
                                    }}
                                    className="w-full px-3 py-2 text-left text-sm text-gray-600 hover:text-[#FA6C43] hover:bg-[#F0F6FB] transition-colors flex items-center space-x-3 rounded-md"
                                  >
                                    <FiDownload className="w-4 h-4 flex-shrink-0" />
                                    <span>Download Chat</span>
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      handleDeleteChat(session.session_id);
                                    }}
                                    className="w-full px-3 py-2 text-left text-sm text-red-500 hover:text-red-600 hover:bg-red-50 transition-colors flex items-center space-x-3 rounded-md"
                                  >
                                    <FiTrash2 className="w-4 h-4 flex-shrink-0" />
                                    <span>Delete Chat</span>
                                  </button>
                                </div>
                              )}
                            </div>
                            )}
                          </>
                        )}
                      </div>
                      </div>
                      );
                    })
                  ) : (
                    <div className="text-center p-4">
                      <p className="text-gray-500 text-sm">
                        {sessionTo ? 'No finished sessions yet' : 'No recent conversations'}
                      </p>
                      {!sessionTo && (
                        <Link
                          to={`/chat/${configId}`}
                          className="text-[#2D6CDF] text-xs hover:underline mt-1 inline-block"
                        >
                          Start a new chat
                        </Link>
                      )}
                    </div>
                  )}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* === Files accordion === */}
            <div className="mb-2">
              <button
                onClick={() => switchTab('files')}
                className="w-full flex items-center justify-between px-2 py-2 rounded-lg hover:bg-[#F0F6FB] transition-colors duration-200"
              >
                <span className="flex items-center text-[13px] font-semibold text-[#222]">
                  <FiChevronDown
                    className={`mr-1.5 w-3.5 h-3.5 text-gray-500 transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] ${
                      activeTab === 'files' ? 'rotate-0' : '-rotate-90'
                    }`}
                  />
                  <FiFolder className="mr-1.5 w-3.5 h-3.5 text-gray-500" />
                  Files
                </span>
              </button>

              <div
                className={`grid transition-[grid-template-rows] duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ${
                  activeTab === 'files' ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
                }`}
              >
                <div className="overflow-hidden">
                  <div
                    className={`pt-1 transition-opacity duration-300 ${
                      activeTab === 'files' ? 'opacity-100' : 'opacity-0'
                    }`}
                  >
                    <FilesPanel
                      currentPath={currentPath}
                      onSetPath={onSetPath}
                      accessibleConfigs={accessibleConfigs}
                      files={libraryFiles}
                      folders={libraryFolders}
                      isLoading={filesLoading}
                      isUploading={isUploading}
                      uploadError={uploadError}
                      onUpload={onUpload}
                      onDeleteFile={onDeleteFile}
                      onCreateFolder={onCreateFolder}
                      onDeleteFolder={onDeleteFolder}
                      canSelect={canSelect}
                      selectedFileIds={selectedFileIds}
                      onToggleFile={onToggleFile}
                      onFetchUrl={onFetchUrl}
                      isFetchingUrl={isFetchingUrl}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {isCollapsed && <div className="flex-1" />}

        {/* User Profile (Fixed) */}
        <div className="p-4">
          {userInfoLoaded &&
            (userInfo ? (
              <div className="flex flex-col gap-2">
                <div
                  className={`flex items-center ${
                    isCollapsed ? 'justify-center' : 'space-x-3 px-2'
                  } py-3 rounded-lg cursor-pointer transition-colors`}
                >
                  <div className="w-8 h-8 rounded-full bg-[#F9D0C4]/40 flex items-center justify-center">
                    <FiUser className="text-[#FA6C43]" />
                  </div>
                  {!isCollapsed && (
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[#222] truncate">{userInfo.username}</p>
                      <p className="text-xs text-gray-500 truncate">{userInfo.email || 'User Account'}</p>
                    </div>
                  )}
                </div>
                {!isCollapsed && (
                  <button
                    onClick={handleLogout}
                    className="w-full flex items-center justify-center gap-2 px-2 py-2 rounded-lg bg-white text-gray-600 hover:bg-red-50 hover:text-red-500 transition-colors border-0"
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
              <div
                className={`flex items-center ${
                  isCollapsed ? 'justify-center' : 'space-x-3 px-2'
                } py-3 rounded-lg`}
              >
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
            ))}
        </div>
      </div>
    </aside>
  );
};

export default ChatSidebar;
