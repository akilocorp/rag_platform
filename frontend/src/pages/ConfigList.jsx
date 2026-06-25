import { FaCog, FaPlus, FaRobot, FaSpinner, FaBug, FaListAlt, FaTrash, FaThLarge, FaList, FaExternalLinkAlt } from 'react-icons/fa';
import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import UserInfo from '../components/UserInfo';
import { getBotAvatarIconComponent } from '../components/AvatarSelector';
import { getModelDisplayName } from '../utils/modelNames';
import apiClient from '../api/apiClient';
import logo from '../assets/logo.png';
// Import your modal components here (adjust paths as needed)
import ConfigModal from './ConfigPage';
import ReportBugModal from './ReportBugModal';

// Primary action label + the route a card opens, derived from bot_type.
// Keeps the existing routing behavior (chat / group / dashboards / sessions).
const primaryActionLabel = (botType) => {
  switch (botType) {
    case 'video_analysis': return 'Open Dashboard';
    case 'experiential':   return 'Open Sessions';
    case 'group_chat':     return 'Open Chat';
    default:               return 'Chat Now';
  }
};

const ConfigItem = ({ config, index, view, onOpen, onResponses, onEdit, onDelete }) => {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const ListIcon = getBotAvatarIconComponent(config.bot_avatar);
  const isList = view === 'list';

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await onDelete(config.config_id);
    } finally {
      setDeleting(false);
      setConfirming(false);
    }
  };

  // Icon actions (Responses + Delete). In grid view these sit top-right next
  // to the title; in list view they're relocated into the footer cluster so
  // they line up with Customize / Chat Now on one vertically-centered row.
  const actionButtons = (
    <>
      <button
        onClick={(e) => { e.stopPropagation(); onResponses(config); }}
        title={config.bot_type === 'video_analysis' ? 'Dashboard' : config.bot_type === 'experiential' ? 'Sessions' : 'Responses'}
        className="p-1.5 text-gray-400 rounded-lg hover:text-[#FA6C43] hover:bg-[#F9D0C4]/30 transition-colors"
      >
        <FaListAlt className="text-sm" />
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); setConfirming(true); }}
        title="Delete"
        className="p-1.5 text-gray-400 rounded-lg hover:text-red-600 hover:bg-red-50 transition-colors"
      >
        <FaTrash className="text-sm" />
      </button>
    </>
  );

  return (
    <div
      className={`group relative bg-white rounded-2xl border border-gray-200 shadow-sm transition-all duration-300 cursor-pointer hover:border-[#FA6C43]/40 hover:shadow-md hover:-translate-y-1 animate-send-fly-in ${
        isList ? 'p-5 flex items-center gap-5' : 'p-5 flex flex-col'
      }`}
      style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
      onClick={() => onOpen(config)}
    >
      {/* Top: icon + title + actions */}
      <div className={isList ? 'flex items-center gap-4 flex-1 min-w-0' : 'flex items-start gap-4'}>
        <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-gray-100 flex items-center justify-center text-[#1F1F1F]">
          {ListIcon ? <ListIcon className="text-xl" /> : <FaRobot className="text-xl" />}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-2">
            <h3 className="text-[15px] font-bold text-[#222] truncate flex-1">{config.bot_name}</h3>
            {!isList && (
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {actionButtons}
              </div>
            )}
          </div>

          <p className="text-sm text-gray-500 mt-1.5 line-clamp-2">
            {config.introduction?.trim() || `${getModelDisplayName(config.model_name)} assistant.`}
          </p>

          {/* Info chips */}
          <div className="mt-3 flex flex-wrap gap-1.5">
            <span className="px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-[#F0F6FB] text-gray-600 border border-gray-100 animate-chip-in">
              {getModelDisplayName(config.model_name)}
            </span>
            {config.class_code && (
              <span className="px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-[#F9D0C4]/30 text-[#FA6C43] border border-[#FA6C43]/20 uppercase tracking-wide animate-chip-in">
                {config.class_code}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Footer: customize + primary action, or delete confirmation */}
      <div className={`relative z-10 ${isList ? 'flex-shrink-0' : 'mt-4 pt-4 border-t border-gray-100'}`}>
        {confirming ? (
          <div className={`flex items-center gap-2 ${isList ? '' : 'justify-end'}`} onClick={(e) => e.stopPropagation()}>
            <span className="text-xs font-medium text-gray-500 mr-auto">Delete this assistant?</span>
            <button
              onClick={() => setConfirming(false)}
              className="px-3 py-1.5 text-xs font-bold text-gray-600 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="px-3 py-1.5 text-xs font-bold text-white bg-red-500 rounded-lg hover:bg-red-600 transition-colors flex items-center gap-1.5 disabled:opacity-60"
            >
              {deleting && <FaSpinner className="animate-spin text-[10px]" />}
              Delete
            </button>
          </div>
        ) : (
          <div className={`flex items-center gap-3 ${isList ? '' : 'justify-between'}`}>
            {isList && (
              <div className="flex items-center gap-1.5 mr-1">
                {actionButtons}
              </div>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); onEdit(config); }}
              className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-[#FA6C43] transition-colors"
            >
              <FaCog className="text-sm" />
              Customize
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onOpen(config); }}
              className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-[#FA6C43] hover:text-white hover:border-[#FA6C43] transition-colors active:scale-[0.98]"
            >
              <FaExternalLinkAlt className="text-[10px]" />
              {primaryActionLabel(config.bot_type)}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

const ConfigListPage = () => {
  const [configs, setConfigs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Dashboard view state
  const [visibility, setVisibility] = useState('private'); // 'private' | 'shared'
  const [category, setCategory] = useState('all');          // 'all' | 'text' | 'video'
  const [view, setView] = useState('grid');                 // 'grid' | 'list'

  // State to manage modal visibilities
  const [isConfigModalOpen, setIsConfigModalOpen] = useState(false);
  const [isBugModalOpen, setIsBugModalOpen] = useState(false);

  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const loadPageData = async () => {
      setLoading(true);
      try {
        const response = await apiClient.get('/config_list');
        setConfigs(response.data.configs);
      } catch (err) {
        console.error('Failed to load configurations:', err);
        setError('Failed to load configurations');
        if (err.response?.status === 401) {
          navigate('/login');
        }
      } finally {
        setLoading(false);
      }
    };

    loadPageData();
  }, [location.key, navigate]);

  // Open a config = the existing select/routing behavior, used by the card body
  // and the primary action button.
  const handleOpen = (config) => {
    if (!config.config_id) {
      console.error('Invalid config:', config);
      setError('Failed to select configuration');
      return;
    }
    if (config.bot_type === 'video_analysis') {
      navigate(`/video-dashboard/${config.config_id}`);
    } else if (config.bot_type === 'experiential') {
      navigate(`/experiential-dashboard/${config.config_id}`);
    } else if (config.bot_type === 'group_chat') {
      navigate(`/group-chat/${config.config_id}`);
    } else {
      navigate(`/chat/${config.config_id}`);
    }
  };

  const handleResponses = (config) => {
    navigate(
      config.bot_type === 'video_analysis' ? `/video-dashboard/${config.config_id}`
        : config.bot_type === 'experiential' ? `/experiential-dashboard/${config.config_id}`
        : `/responses/${config.config_id}`,
    );
  };

  const onEdit = (config) => {
    const configForEdit = {
      ...config,
      config_id: config.config_id,
      _id: config.config_id,
      documents: config.documents || [],
    };
    navigate(`/edit-config`, { state: { config: configForEdit } });
  };

  const handleDelete = async (configId) => {
    try {
      await apiClient.delete(`/config/${configId}`);
      setConfigs(prev => prev.filter(c => (c.config_id || c._id) !== configId));
    } catch (err) {
      console.error('Failed to delete configuration:', err);
      setError('Failed to delete assistant');
    }
  };

  const handleCreateNew = () => {
    setIsConfigModalOpen(true);
  };

  // Apply the Private/Shared filter once; categories slice the result.
  const byVisibility = useMemo(
    () => configs.filter(c => (visibility === 'shared' ? !!c.is_public : !c.is_public)),
    [configs, visibility],
  );

  const isVideo = (c) => c.bot_type === 'video_analysis';
  const counts = {
    all: byVisibility.length,
    text: byVisibility.filter(c => !isVideo(c)).length,
    video: byVisibility.filter(isVideo).length,
  };

  const visible = useMemo(() => byVisibility.filter(c => {
    if (category === 'text') return !isVideo(c);
    if (category === 'video') return isVideo(c);
    return true;
  }), [byVisibility, category]);

  const sections = [
    { key: 'text', label: 'Text-based', items: visible.filter(c => !isVideo(c)) },
    { key: 'video', label: 'Video-based', items: visible.filter(isVideo) },
  ].filter(s => s.items.length > 0);

  const CATEGORIES = [
    { key: 'all', label: 'All Assistants' },
    { key: 'text', label: 'Text-based' },
    { key: 'video', label: 'Video-based' },
  ];

  return (
    <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }} className="min-h-screen bg-[#F0F6FB] text-gray-900 flex flex-col relative">

      {/* Navbar */}
      <nav className="w-full flex justify-between items-center px-6 lg:px-8 py-6 max-w-[1440px] mx-auto z-10">
        <div
          className="flex items-center hover:opacity-90 transition-opacity cursor-pointer"
          onClick={() => navigate('/config_list')}
        >
          <img
            src={logo}
            alt="actrLabs Logo"
            className="h-10 lg:h-12 w-auto object-contain"
          />
        </div>
        <div className="flex items-center space-x-6 lg:space-x-8">

          {/* Report Bug Button added to Navbar */}
          <button
            onClick={() => setIsBugModalOpen(true)}
            className="hidden sm:flex items-center justify-center px-5 py-2.5 bg-[#FA6C43] hover:bg-[#E55B34] text-white rounded-xl transition-all duration-200 shadow-sm active:scale-[0.98]"
          >
            <FaBug className="mr-2 text-sm" />
            <span className="font-bold text-[14px]">Report a Bug</span>
          </button>

          <UserInfo />
        </div>
      </nav>

      {/* Main Content Area: sidebar + content */}
      <div className="container mx-auto px-6 lg:px-8 py-4 lg:py-8 max-w-[1440px] flex-1 w-full">
        <div className="flex flex-col lg:flex-row gap-8 lg:gap-10">

          {/* ── Sidebar ─────────────────────────────────── */}
          <aside className="w-full lg:w-60 flex-shrink-0">
            <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-3 px-1">Categories</p>

            {/* Private / Shared toggle */}
            <div className="flex p-1 bg-white border border-gray-200 rounded-xl mb-5 shadow-sm">
              {['private', 'shared'].map((v) => (
                <button
                  key={v}
                  onClick={() => setVisibility(v)}
                  className={`flex-1 py-2 text-sm font-semibold rounded-lg capitalize transition-all ${
                    visibility === v ? 'bg-[#FA6C43] text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>

            {/* Category list */}
            <nav className="space-y-1">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat.key}
                  onClick={() => setCategory(cat.key)}
                  className={`w-full flex items-center justify-between px-3 py-2.5 text-sm rounded-xl transition-colors ${
                    category === cat.key
                      ? 'bg-white text-[#FA6C43] font-bold shadow-sm border border-[#FA6C43]/20'
                      : 'text-gray-500 hover:bg-white/60 hover:text-gray-700 font-medium'
                  }`}
                >
                  <span>{cat.label}</span>
                  <span className={`text-xs font-semibold ${category === cat.key ? 'text-[#FA6C43]' : 'text-gray-400'}`}>
                    {counts[cat.key]}
                  </span>
                </button>
              ))}
            </nav>
          </aside>

          {/* ── Content ─────────────────────────────────── */}
          <main className="flex-1 min-w-0">
            {/* Header */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
              <div className="min-w-0">
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#222]">AI Assistants</h1>
                <p className="text-gray-500 text-sm mt-1.5 font-medium max-w-xl">
                  Discover and create your own assistants by blending instructions, knowledge, and multi-step actions.
                </p>
              </div>

              <div className="flex items-center gap-3 flex-shrink-0">
                {/* View toggle — Apple-style: a single pill slides between
                    the two segments instead of each toggling its own bg. */}
                <div className="relative flex p-1 bg-white border border-gray-200 rounded-xl shadow-sm">
                  {/* Sliding indicator (springy glide w/ slight overshoot) */}
                  <span
                    aria-hidden="true"
                    className="absolute top-1 bottom-1 left-1 w-9 rounded-lg bg-[#F0F6FB]"
                    style={{
                      transform: view === 'grid' ? 'translateX(100%)' : 'translateX(0)',
                      transition: 'transform 350ms cubic-bezier(0.34, 1.56, 0.64, 1)',
                    }}
                  />
                  <button
                    onClick={() => setView('list')}
                    title="List view"
                    className={`relative z-10 w-9 h-9 flex items-center justify-center rounded-lg transition-colors duration-200 ${view === 'list' ? 'text-[#FA6C43]' : 'text-gray-400 hover:text-gray-600'}`}
                  >
                    <FaList className="text-sm" />
                  </button>
                  <button
                    onClick={() => setView('grid')}
                    title="Grid view"
                    className={`relative z-10 w-9 h-9 flex items-center justify-center rounded-lg transition-colors duration-200 ${view === 'grid' ? 'text-[#FA6C43]' : 'text-gray-400 hover:text-gray-600'}`}
                  >
                    <FaThLarge className="text-sm" />
                  </button>
                </div>

                <button
                  className="flex items-center justify-center px-5 py-2.5 bg-[#FA6C43] hover:bg-[#E55B34] text-white rounded-xl transition-all duration-200 shadow-sm active:scale-[0.98]"
                  onClick={handleCreateNew}
                >
                  <FaPlus className="mr-2 text-sm" />
                  <span className="font-bold text-[14px]">New Assistant</span>
                </button>
              </div>
            </div>

            {/* States */}
            {loading ? (
              <div className="flex flex-col items-center justify-center h-64 rounded-[2rem] bg-white border border-gray-100 shadow-sm">
                <FaSpinner className="animate-spin text-4xl text-[#FA6C43] mb-4" />
                <p className="text-gray-500 font-medium">Loading your AI assistants...</p>
              </div>
            ) : error ? (
              <div className="rounded-[1.5rem] bg-red-50 border border-red-200 p-6">
                <div className="flex items-start">
                  <div className="flex-shrink-0 pt-0.5">
                    <svg className="w-5 h-5 text-red-500" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <div className="ml-3">
                    <h3 className="text-base font-bold text-red-800">Configuration Error</h3>
                    <p className="mt-1 text-sm text-red-600 font-medium">{error}</p>
                  </div>
                </div>
              </div>
            ) : visible.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 rounded-[2rem] bg-white border border-gray-100 shadow-sm">
                <div className="p-6 bg-[#F0F6FB] rounded-full mb-5 text-[#FA6C43]">
                  <FaRobot className="text-4xl" />
                </div>
                <h3 className="text-xl font-bold text-[#222] mb-2">
                  {configs.length === 0 ? 'No assistants yet' : 'Nothing here'}
                </h3>
                <p className="text-gray-500 mb-8 max-w-md text-center font-medium">
                  {configs.length === 0
                    ? 'Create your first AI assistant to take charge of your classroom.'
                    : 'No assistants match this filter. Try a different category or visibility.'}
                </p>
                <button
                  onClick={handleCreateNew}
                  className="px-6 py-3 bg-[#FA6C43] hover:bg-[#E55B34] text-white rounded-xl transition-colors flex items-center shadow-sm font-bold active:scale-[0.98]"
                >
                  <FaPlus className="mr-2" />
                  Create Assistant
                </button>
              </div>
            ) : (
              <div className="space-y-10 pb-20">
                {sections.map((section) => (
                  <section key={section.key}>
                    <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-4">{section.label}</p>
                    <div className={view === 'grid' ? 'grid grid-cols-1 xl:grid-cols-2 gap-5' : 'flex flex-col gap-4'}>
                      {section.items.map((config, idx) => (
                        <ConfigItem
                          key={config._id || config.config_id}
                          config={config}
                          index={idx}
                          view={view}
                          onOpen={handleOpen}
                          onResponses={handleResponses}
                          onEdit={onEdit}
                          onDelete={handleDelete}
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </main>
        </div>
      </div>

      {/* Mount Modals */}
      <ConfigModal
        isOpen={isConfigModalOpen}
        onClose={() => setIsConfigModalOpen(false)}
      />

      <ReportBugModal
        isOpen={isBugModalOpen}
        onClose={() => setIsBugModalOpen(false)}
      />

    </div>
  );
};

export default ConfigListPage;
