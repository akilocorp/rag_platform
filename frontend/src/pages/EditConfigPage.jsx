import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import apiClient from '../api/apiClient';
import AvatarSelector from '../components/AvatarSelector';
import { FaInfoCircle, FaTrash, FaPlus, FaUsers, FaRobot, FaListAlt } from 'react-icons/fa';
import { SIMULATION_TEMPLATES } from '../data/simulationTemplates';
import VideoScoringEditor from '../components/VideoScoringEditor';
import LabGenerator from '../components/experiential/LabGenerator';
import InfoTip from '../components/InfoTip';
import InstructionsInfoTip from '../components/InstructionsInfoTip';

const EditConfigPage = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const [config, setConfig] = useState({});
  const [initialDocuments, setInitialDocuments] = useState([]);
  const [newFiles, setNewFiles] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [errors, setErrors] = useState({});
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showNotification, setShowNotification] = useState(false);
  const [notificationMessage, setNotificationMessage] = useState('');
  
  // HeyGen State
  const [heygenAvatars, setHeygenAvatars] = useState([]);
  const [isFetchingAvatars, setIsFetchingAvatars] = useState(false);

  // Class rollout usage tiers
  const [usageTiers, setUsageTiers] = useState([]);
  useEffect(() => {
    apiClient.get('/usage/tiers').then(res => setUsageTiers(res.data.tiers || [])).catch(() => {});
  }, []);

  const aiModels = [
    { id: 'deepseek-chat', name: 'Deepseek Chat' },
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 flash' },
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 pro' },
    // { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo' },
    // { id: 'gpt-4', name: 'GPT-4' },
    // { id: 'gpt-4-turbo', name: 'GPT-4 Turbo' },
    // { id: 'gpt-4.1', name: 'GPT-4.1' },
    // { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
    { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' },
    { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5' }
  ];

  // Ensures the <select> always contains the currently-saved id, even if it
  // predates the canonical list (e.g. legacy "gpt-4o"). Without this, the
  // browser silently falls back to the first option and onChange stops firing
  // when the user tries to pick that option.
  const withCurrent = (currentId) => {
    if (!currentId || aiModels.some(m => m.id === currentId)) return aiModels;
    return [{ id: currentId, name: `${currentId} (current)` }, ...aiModels];
  };

  // Initialize Data
  useEffect(() => {
    const configFromState = location.state?.config;
    if (!configFromState) {
      console.error('No config received in state');
      navigate('/config_list', { state: { error: 'No configuration selected to edit.' } });
      return;
    }

    // Safely parse bots if it's a group chat and came as a string
    let parsedBots = [];
    if (configFromState.bot_type === 'group_chat') {
        try {
            parsedBots = typeof configFromState.bots === 'string' ? JSON.parse(configFromState.bots) : (configFromState.bots || []);
        } catch(e) {
            parsedBots = [];
        }
        if (parsedBots.length === 0) {
             parsedBots = [{ name: 'Assistant', prompt: '', model_name: 'claude-sonnet-4-6', temperature: 0.7 }];
        }
    }

    // Unified instructions panel: legacy bots created with "Advanced Template"
    // stored their raw system prompt in prompt_template with instructions empty.
    // Pull that text into the single instructions field so editing doesn't
    // silently drop their prompt. Strip the standard scaffold marker if present
    // (mirrors backend agent_runner scrubbing).
    let resolvedInstructions = configFromState.instructions || '';
    if (!resolvedInstructions.trim() && configFromState.prompt_template) {
        const tmpl = configFromState.prompt_template;
        const marker = 'Follow these specific instructions:';
        const idx = tmpl.indexOf(marker);
        resolvedInstructions = idx !== -1 ? tmpl.slice(idx + marker.length).trim() : tmpl.trim();
    }

    setConfig({
        ...configFromState,
        instructions: resolvedInstructions,
        bots: parsedBots,
        group_size: configFromState.group_size || 2,
        group_duration: configFromState.group_duration || 10,
        web_access: configFromState.web_access !== undefined ? configFromState.web_access : true,
        audio_enabled: !!configFromState.audio_enabled,
        hume_config_id: configFromState.hume_config_id || ''
    });
    
    setInitialDocuments(configFromState.documents || []);
  }, [location.state, navigate]);

  // Fetch HeyGen Avatars if needed
  useEffect(() => {
    if (config.bot_type === 'avatar' && heygenAvatars.length === 0) {
      const fetchAvatars = async () => {
        setIsFetchingAvatars(true);
        try {
          const response = await apiClient.get('/heygen/avatars'); 
          setHeygenAvatars(response.data.avatars || []);
        } catch (err) {
          console.error("Failed to fetch HeyGen avatars", err);
        } finally {
          setIsFetchingAvatars(false);
        }
      };
      fetchAvatars();
    }
  }, [config.bot_type]);

  const showNotificationMessage = (message) => {
    setNotificationMessage(message);
    setShowNotification(true);
    setTimeout(() => {
      setShowNotification(false);
      setNotificationMessage('');
    }, 3000);
  };

  const navigateToThisAgentChat = () => {
    const id = config.config_id || config._id;
    if (id) {
      if (config.bot_type === 'group_chat') navigate(`/group-chat/${id}`);
      else if (config.bot_type === 'video_analysis') navigate(`/video-dashboard/${id}`);
      else navigate(`/chat/${id}`, { state: { fromEdit: true } });
    } else {
      navigate('/config_list');
    }
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    const val = type === 'checkbox' ? checked : value;
    setConfig(prev => ({ ...prev, [name]: val }));
  };

  // --- Group Chat Bot Handlers ---
  const handleBotChange = (index, field, value) => {
    const updatedBots = [...config.bots];
    updatedBots[index][field] = value;
    setConfig(prev => ({ ...prev, bots: updatedBots }));
  };

  const addBot = () => {
    setConfig(prev => ({
      ...prev,
      bots: [...prev.bots, { name: `Bot ${prev.bots.length + 1}`, prompt: '', model_name: 'claude-sonnet-4-6', temperature: 0.7 }]
    }));
  };

  const removeBot = (index) => {
    if (config.bots.length > 1) {
      setConfig(prev => ({ ...prev, bots: prev.bots.filter((_, i) => i !== index) }));
    }
  };

  // --- File Handlers ---
  const handleFileChange = (e) => {
    const files = Array.from(e.target.files);
    setNewFiles(prev => [...prev, ...files]);
  };

  const handleRemoveDocument = (fileName) => {
    setConfig(prev => ({
      ...prev,
      documents: prev.documents.filter(doc => doc !== fileName)
    }));
  };

  const handleViewDocument = (fileName) => {
    const fileUrl = `/file/${fileName}`;
    window.open(fileUrl, '_blank', 'noopener,noreferrer');
  };

  const handleRemoveNewFile = (fileName) => {
    setNewFiles(prev => prev.filter(file => file.name !== fileName));
  };

  // --- Submit Handler ---
  const handleSubmit = async (e) => {
    e.preventDefault();
    
    const newErrors = {};
    if (!config.bot_name?.trim()) newErrors.bot_name = 'Name is required';
    
    if (config.bot_type === 'group_chat') {
        config.bots.forEach((b, i) => {
            if (!b.name.trim()) newErrors[`bot_${i}_name`] = 'Required';
            if (!b.prompt.trim()) newErrors[`bot_${i}_prompt`] = 'Required';
        });
    } else if (config.bot_type === 'video_analysis') {
        if (!config.assignment_type) newErrors.form = 'Please choose an assignment type.';
    } else if (config.bot_type === 'experiential') {
        if (!(config.experiential_config && config.experiential_config.layers)) newErrors.form = 'Generate the lab from your prompt before saving.';
    } else {
        if (!config.instructions?.trim()) newErrors.instructions = 'Required';
    }

    if (config.bot_type === 'avatar' && !config.heygen_avatar_id) {
        newErrors.form = 'Please select a video avatar.';
    }

    if (config.bot_type === 'audio_call') {
        if (!(config.model_name || '').toLowerCase().startsWith('claude')) {
            newErrors.form = 'Audio Call mode requires a Claude model.';
        }
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setIsLoading(true);
    setErrors({});

    try {
      const formData = new FormData();
      const configToSubmit = { ...config };
      
      // Satisfy backend validation
      if (configToSubmit.bot_type === 'group_chat') {
          configToSubmit.instructions = "Group Space: Managing multiple AI agents.";
          configToSubmit.prompt_template = "";
      } else if (configToSubmit.bot_type === 'video_analysis') {
          configToSubmit.instructions = `Video analysis assignment: ${configToSubmit.assignment_type}`;
          configToSubmit.prompt_template = "";
      } else if (configToSubmit.bot_type === 'experiential') {
          configToSubmit.instructions = `Experiential lab: ${configToSubmit.experiential_config?.meta?.title || 'custom'}`;
          configToSubmit.prompt_template = "";
      } else {
          // Unified instructions panel — always send instructions; backend wraps it.
          configToSubmit.prompt_template = '';
      }

      // scoring_spec / experiential_config are objects — serialize them
      // (the generic loop would coerce to "[object Object]").
      const scoringSpec = configToSubmit.scoring_spec;
      const experientialConfig = configToSubmit.experiential_config;

      Object.entries(configToSubmit).forEach(([key, value]) => {
        if (key !== 'documents' && key !== 'files' && key !== 'bots' && key !== 'scoring_spec' && key !== 'experiential_config') {
          formData.append(key, value);
        }
      });
      if (scoringSpec && typeof scoringSpec === 'object') {
        formData.append('scoring_spec', JSON.stringify(scoringSpec));
      }
      if (experientialConfig && typeof experientialConfig === 'object') {
        formData.append('experiential_config', JSON.stringify(experientialConfig));
      }
      
      // Append bots safely
      if (configToSubmit.bot_type === 'group_chat') {
        formData.append('bots', JSON.stringify(configToSubmit.bots));
      } else {
        formData.append('bots', '[]');
      }

      newFiles.forEach(file => formData.append('files', file));
      const filesToDelete = initialDocuments.filter(doc => !configToSubmit.documents.includes(doc));
      formData.append('files_to_delete', JSON.stringify(filesToDelete));

      await apiClient.put(`/config/${config.config_id}`, formData);

      if (config.bot_type === 'group_chat') navigate(`/group-chat/${config.config_id}`);
      else if (config.bot_type === 'video_analysis') navigate(`/video-dashboard/${config.config_id}`);
      else if (config.bot_type === 'experiential') navigate(`/experiential/c/${config.config_id}`);
      else navigate(`/chat/${config.config_id}`, { state: { fromEdit: true, message: 'Updated successfully.' } });
      
    } catch (error) {
      console.error('Error updating config:', error);
      setErrors({ form: error.response?.data?.error || 'Failed to update.' });
    } finally {
      setIsLoading(false);
    }
  };

  // --- NEW: Handle opening the delete confirmation modal ---
  const handleDelete = () => {
    setShowConfirmModal(true);
  };

  const confirmDelete = async () => {
    setShowConfirmModal(false);
    setIsDeleting(true);
    try {
      await apiClient.delete(`/config/${config.config_id}`);
      navigate('/config_list', { state: { refresh: true, message: 'Deleted successfully.' } });
    } catch (error) {
      setErrors({ form: error.response?.data?.error || 'Failed to delete.' });
    } finally {
      setIsDeleting(false);
    }
  };

  const _selectedTier = usageTiers.find(t => t.id === config.usage_tier);
  const _computedPool = _selectedTier && config.student_count
    ? _selectedTier.messages_per_student * Number(config.student_count) : null;
  const classUsageFields = config.class_code ? (
    <div className="grid grid-cols-2 gap-4 mt-3">
      <div>
        <label className="block text-[13px] font-semibold text-gray-700 mb-1.5">Usage tier</label>
        <select
          value={config.usage_tier || ''}
          onChange={e => setConfig(prev => ({ ...prev, usage_tier: e.target.value }))}
          className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F9D0C4] focus:border-[#FA6C43]"
        >
          <option value="">Select a tier…</option>
          {usageTiers.map(t => (
            <option key={t.id} value={t.id}>{t.name} ({t.messages_per_student}/student)</option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-[13px] font-semibold text-gray-700 mb-1.5">Number of students</label>
        <input
          type="number" min="1"
          value={config.student_count || ''}
          onChange={e => setConfig(prev => ({ ...prev, student_count: e.target.value }))}
          placeholder="e.g. 40"
          className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F9D0C4] focus:border-[#FA6C43]"
        />
      </div>
      {_computedPool != null && (
        <p className="col-span-2 text-[12px] text-gray-500">
          Shared class pool: <span className="font-bold text-[#FA6C43]">{_computedPool.toLocaleString()}</span> messages
        </p>
      )}
    </div>
  ) : null;

  return (
    <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }} className="min-h-screen bg-[#F0F6FB] text-gray-900 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto">
        
        <div className="text-center mb-10">
          <h1 className="text-4xl font-bold text-[#222] tracking-tight">
            Edit {config.bot_type === 'group_chat' ? 'Group Space' : config.bot_type === 'avatar' ? 'Avatar Assistant' : config.bot_type === 'audio_call' ? 'Audio Call' : config.bot_type === 'video_analysis' ? 'Video Assignment' : 'AI Assistant'}
          </h1>
        </div>

        <div className="bg-white rounded-[2rem] shadow-sm border border-gray-100 p-8 sm:p-10">
          {errors.form && (
            <div className="mb-8 p-4 bg-red-50 border border-red-200 rounded-xl text-sm flex items-start space-x-3">
              <FaInfoCircle className="text-red-500 mt-0.5 flex-shrink-0 text-lg" />
              <span className="text-red-700 font-medium">{errors.form}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-8">
            
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              <div>
                <label className="block text-[13px] font-semibold text-gray-700 mb-1.5">{config.bot_type === 'group_chat' ? 'Group Lobby Name' : 'Assistant Name'}</label>
                <input
                  type="text"
                  name="bot_name"
                  value={config.bot_name || ''}
                  onChange={handleChange}
                  className={`w-full px-4 py-3 bg-white border ${errors.bot_name ? 'border-red-500' : 'border-gray-200'} rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F9D0C4] focus:border-[#FA6C43] transition-all`}
                />
                {errors.bot_name && <p className="mt-1.5 text-xs font-medium text-red-500">{errors.bot_name}</p>}
              </div>

              {config.bot_type !== 'group_chat' && config.bot_type !== 'video_analysis' && (
                <div>
                  <label className="block text-[13px] font-semibold text-gray-700 mb-1.5">Model Name</label>
                  <select
                    name="model_name"
                    value={config.model_name || ''}
                    onChange={handleChange}
                    className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-[#FA6C43]"
                  >
                    {withCurrent(config.model_name).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </div>
              )}
            </div>

            {/* Avatar Selection Based on Type */}
            <div className={`pt-2 ${(config.bot_type === 'audio_call' || config.bot_type === 'video_analysis') ? 'hidden' : ''}`}>
                {config.bot_type === 'avatar' ? (
                    <>
                      <label className="block text-[13px] font-semibold text-gray-700 mb-2">Video Avatar</label>
                      <div className="grid grid-cols-4 gap-3 max-h-40 overflow-y-auto custom-scrollbar">
                        {isFetchingAvatars ? (
                           <p className="text-sm text-gray-400">Loading avatars...</p>
                        ) : (
                           heygenAvatars.map((avatar) => (
                             <div key={avatar.avatar_id} onClick={() => setConfig(prev => ({ ...prev, heygen_avatar_id: avatar.avatar_id }))} className={`cursor-pointer rounded-xl overflow-hidden border-2 transition-all ${config.heygen_avatar_id === avatar.avatar_id ? 'border-[#FA6C43] shadow-md scale-95' : 'border-transparent hover:border-gray-300'}`}>
                                 <img src={avatar.normal_preview} alt="Avatar" className="w-full h-16 object-cover bg-gray-100" />
                             </div>
                           ))
                        )}
                      </div>
                    </>
                ) : (
                    <AvatarSelector
                        selectedAvatar={config.bot_avatar}
                        onSelect={(avatarId) => setConfig(prev => ({ ...prev, bot_avatar: avatarId }))}
                        label={config.bot_type === 'group_chat' ? 'Lobby / Space Icon' : 'Bot Avatar'}
                        hint={
                          config.bot_type === 'group_chat'
                            ? 'Shown in your list and at the top of this group space.'
                            : undefined
                        }
                    />
                )}
            </div>

            {/* Introduction */}
            <div>
              <label className="block text-[13px] font-semibold text-gray-700 mb-1.5">Introduction <span className="text-gray-400 font-normal ml-1">(Optional)</span></label>
              <textarea
                name="introduction"
                value={config.introduction || ''}
                onChange={handleChange}
                rows="2"
                className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-[#FA6C43]"
              />
            </div>

            {/* Public Access Toggle */}
            <div className="p-5 bg-gray-50 border border-gray-100 rounded-xl">
              <div className="flex items-center justify-between">
                <div>
                  <label className="block text-[13px] font-bold text-gray-800 mb-0.5">Public Access</label>
                  <p className="text-xs text-gray-500 font-medium">Allow anyone with the link to access this space</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" name="is_public" className="sr-only peer" checked={!!config.is_public} onChange={handleChange} />
                  <div className="w-11 h-6 bg-gray-200 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#FA6C43]"></div>
                </label>
              </div>
            </div>

            {/* CONDITIONAL LOGIC: Video Analysis vs Group Chat vs Standard */}
            {config.bot_type === 'experiential' ? (
              <div className="border-t border-gray-100 pt-8 mt-8">
                <h3 className="text-[13px] font-bold text-gray-800 uppercase flex items-center mb-5"><FaListAlt className="mr-2 text-[#FA6C43]"/> Simulation Lab</h3>
                <LabGenerator
                  prompt={config.experiential_prompt}
                  onPromptChange={(v) => setConfig(prev => ({ ...prev, experiential_prompt: v }))}
                  generated={config.experiential_config}
                  onGenerated={(cfg) => setConfig(prev => ({ ...prev, experiential_config: cfg }))}
                  configId={config.config_id}
                />
                <div className="mt-4">
                  <label className="block text-[13px] font-semibold text-gray-700 mb-1.5">
                    Class Code <span className="font-normal text-gray-400">(optional - generates a student invite link)</span>
                  </label>
                  <input
                    type="text"
                    value={config.class_code || ''}
                    onChange={e => setConfig(prev => ({ ...prev, class_code: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }))}
                    maxLength={20}
                    placeholder="e.g. macro101"
                    className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F9D0C4] focus:border-[#FA6C43] transition-all"
                  />
                  {classUsageFields}
                </div>
              </div>
            ) : config.bot_type === 'video_analysis' ? (
              <div className="border-t border-gray-100 pt-8 mt-8">
                <h3 className="text-[13px] font-bold text-gray-800 uppercase flex items-center mb-5"><FaListAlt className="mr-2 text-[#FA6C43]"/> Rubric & Scoring</h3>
                <VideoScoringEditor
                  assignmentType={config.assignment_type}
                  scoringSpec={config.scoring_spec}
                  onChange={({ assignment_type, scoring_spec }) =>
                    setConfig(prev => ({ ...prev, assignment_type, scoring_spec }))}
                />
                <div className="mt-4">
                  <label className="block text-[13px] font-semibold text-gray-700 mb-1.5">
                    Class Code <span className="font-normal text-gray-400">(optional - generates a student invite link)</span>
                  </label>
                  <input
                    type="text"
                    value={config.class_code || ''}
                    onChange={e => setConfig(prev => ({ ...prev, class_code: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }))}
                    maxLength={20}
                    placeholder="e.g. actr101"
                    className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F9D0C4] focus:border-[#FA6C43] transition-all"
                  />
                  <p className="text-[11px] text-gray-400 mt-1">3-20 characters, letters, numbers, hyphens. Must be unique.</p>
                  {classUsageFields}
                </div>
                <p className="text-xs text-gray-400 mt-4">Editing weights or prompts applies to new submissions. Use "Rescore" on the dashboard to re-grade existing ones.</p>
              </div>
            ) : config.bot_type === 'group_chat' ? (
              <div className="border-t border-gray-100 pt-8 mt-8 space-y-6">
                <h3 className="text-[13px] font-bold text-gray-800 uppercase flex items-center"><FaUsers className="mr-2 text-[#FA6C43]"/> Matchmaking Rules</h3>
                <div className="grid grid-cols-2 gap-8 bg-gray-50 p-6 rounded-2xl border border-gray-100">
                  <div>
                    <label className="flex justify-between text-xs font-semibold text-gray-700 mb-2"><span>Target Size</span><span className="text-[#FA6C43] font-bold">{Number(config.group_size) === 1 ? 'Solo (1 user + AIs)' : config.group_size}</span></label>
                    <input type="range" name="group_size" min="1" max="10" value={config.group_size} onChange={handleChange} className="w-full h-2 bg-gray-200 rounded-lg appearance-none accent-[#FA6C43]" />
                  </div>
                  <div>
                    <label className="flex justify-between text-xs font-semibold text-gray-700 mb-2"><span className="inline-flex items-center gap-1">Duration<InfoTip text="How long the group chat stays open before it automatically ends. Adjustable from 5 to 60 minutes." /></span><span className="text-[#FA6C43] font-bold">{config.group_duration} Mins</span></label>
                    <input type="range" name="group_duration" min="5" max="60" step="5" value={config.group_duration} onChange={handleChange} className="w-full h-2 bg-gray-200 rounded-lg appearance-none accent-[#FA6C43]" />
                  </div>
                </div>

                <h3 className="text-[13px] font-bold text-gray-800 uppercase flex items-center mt-6"><FaRobot className="mr-2 text-[#FA6C43]"/> AI Agents</h3>
                {config.bots.map((bot, index) => {
                   const noTemp = bot.model_name?.includes('gpt-5') || bot.model_name?.includes('gemini');
                   return (
                    <div key={index} className="bg-white p-5 rounded-2xl border-2 border-gray-100 shadow-sm relative">
                        {config.bots.length > 1 && (
                            <button type="button" onClick={() => removeBot(index)} className="absolute top-4 right-4 text-gray-400 hover:text-red-500 bg-gray-50 hover:bg-red-50 p-1.5 rounded-lg"><FaTrash/></button>
                        )}
                        <div className="grid grid-cols-2 gap-4 mb-4 pr-8">
                            <div>
                                <label className="block text-[11px] font-bold text-gray-500 uppercase mb-1">Agent Name</label>
                                <input type="text" value={bot.name} onChange={(e) => handleBotChange(index, 'name', e.target.value)} className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm outline-none focus:border-[#FA6C43]" />
                            </div>
                            <div>
                                <label className="block text-[11px] font-bold text-gray-500 uppercase mb-1">Model</label>
                                <select value={bot.model_name} onChange={(e) => handleBotChange(index, 'model_name', e.target.value)} className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm outline-none focus:border-[#FA6C43]">
                                    {withCurrent(bot.model_name).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                                </select>
                            </div>
                        </div>
                        <div className="mb-4">
                            <label className="block text-[11px] font-bold text-gray-500 uppercase mb-1">System Prompt</label>
                            <textarea value={bot.prompt} onChange={(e) => handleBotChange(index, 'prompt', e.target.value)} rows="2" className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm outline-none focus:border-[#FA6C43] resize-none" />
                        </div>
                        <div>
                            <label className="flex justify-between text-[11px] font-bold text-gray-500 uppercase mb-2">
                                <span className="inline-flex items-center gap-1">Response style<InfoTip text="Controls how much the bot varies its wording. Lower (Precise) = consistent, predictable answers; higher (Creative) = more varied phrasing. It affects tone and word choice, not the facts the bot knows. Default 0.7 — around 'Conversational.'" /></span>
                                {noTemp && <span className="text-gray-400 font-normal normal-case">Auto-managed</span>}
                            </label>
                            {!noTemp && (
                              <>
                                <input type="range" min="0" max="1" step="0.1" value={bot.temperature} onChange={(e) => handleBotChange(index, 'temperature', parseFloat(e.target.value))} className="w-full h-2 bg-gray-200 rounded-lg appearance-none accent-[#FA6C43]" />
                                <div className="flex justify-between text-[10px] font-medium text-gray-400 mt-1.5 normal-case tracking-normal">
                                  <span>Precise</span>
                                  <span>Balanced</span>
                                  <span>Conversational</span>
                                  <span>Creative</span>
                                </div>
                              </>
                            )}
                        </div>
                    </div>
                   )
                })}
                <button type="button" onClick={addBot} className="w-full py-4 border-2 border-dashed border-gray-300 text-gray-500 rounded-2xl hover:text-[#FA6C43] hover:border-[#FA6C43] font-bold text-sm flex justify-center"><FaPlus className="mr-2 mt-0.5"/> Add Agent</button>
              </div>
            ) : (
              // Standard AI Settings
              <>
                <div className="space-y-4 border-t border-gray-100 pt-8 mt-8">
                  {/* Template Gallery (collapsible) */}
                  <div className="mb-2">
                    <button type="button" onClick={() => setShowTemplates(v => !v)} className="flex items-center gap-2 text-sm font-semibold text-[#FA6C43] hover:underline">
                      {showTemplates ? '▾' : '▸'} Apply a simulation template
                    </button>
                    {showTemplates && (
                      <div className="grid grid-cols-2 gap-3 mt-3">
                        {SIMULATION_TEMPLATES.map(t => (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => {
                              setConfig(prev => ({ ...prev, instructions: t.instructions, temperature: t.temperature }));
                              setShowTemplates(false);
                            }}
                            className="text-left p-3 rounded-xl border-2 border-gray-200 hover:border-[#FA6C43] hover:bg-[#F9D0C4]/20 bg-white transition-all"
                          >
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-lg">{t.icon}</span>
                              <span className="text-sm font-bold text-[#222]">{t.title}</span>
                            </div>
                            <p className="text-[11px] text-gray-500 leading-snug">{t.description}</p>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <label className="flex items-center gap-1.5 text-[13px] font-semibold text-gray-700">
                    Instructions
                    <InstructionsInfoTip />
                  </label>
                  <textarea name="instructions" value={config.instructions || ''} onChange={handleChange} rows="5" className={`w-full px-4 py-3 bg-white border ${errors.instructions ? 'border-red-500' : 'border-gray-200'} rounded-xl text-sm outline-none focus:border-[#FA6C43]`} placeholder="Describe how the bot should behave. You can also request JSON / structured output — see the ⓘ tip." />
                  {errors.instructions && <p className="mt-1.5 text-xs font-medium text-red-500">{errors.instructions}</p>}
                </div>

                <div>
                  <label className="flex items-center gap-1.5 text-[13px] font-semibold text-gray-700 mb-3">Response style<InfoTip text="Controls how much the bot varies its wording. Lower (Precise) = consistent, predictable answers; higher (Creative) = more varied phrasing. It affects tone and word choice, not the facts the bot knows. Default 0.7 — around 'Conversational.'" /></label>
                  <input type="range" name="temperature" min="0" max="1" step="0.1" value={config.temperature || 0.7} onChange={handleChange} className="w-full h-2 bg-gray-200 rounded-lg appearance-none accent-[#FA6C43]" />
                  <div className="flex justify-between text-xs font-medium text-gray-400 mt-2">
                    <span>Precise</span>
                    <span>Balanced</span>
                    <span>Conversational</span>
                    <span>Creative</span>
                  </div>
                </div>

                <div className="p-5 bg-gray-50 border border-gray-100 rounded-xl">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <label className="block text-[13px] font-bold text-gray-800 mb-0.5">Allow web search & URL access</label>
                      <p className="text-xs text-gray-500 font-medium">When off, the bot only uses your uploaded files.</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer shrink-0">
                      <input type="checkbox" name="web_access" className="sr-only peer" checked={!!config.web_access} onChange={handleChange} />
                      <div className="w-11 h-6 bg-gray-200 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#FA6C43]"></div>
                    </label>
                  </div>
                </div>

                {/* Class rollout — optional class code + shared message pool */}
                <div className="border-t border-gray-100 pt-8 mt-8">
                  <label className="block text-[13px] font-semibold text-gray-700 mb-1.5">
                    Class Code <span className="font-normal text-gray-400">(optional — roll this bot out to a class with a shared message pool)</span>
                  </label>
                  <input
                    type="text"
                    value={config.class_code || ''}
                    onChange={e => setConfig(prev => ({ ...prev, class_code: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }))}
                    maxLength={20}
                    placeholder="e.g. actr101"
                    className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F9D0C4] focus:border-[#FA6C43] transition-all"
                  />
                  <p className="text-[11px] text-gray-400 mt-1">3-20 characters, letters, numbers, hyphens. Must be unique.</p>
                  {classUsageFields}
                </div>

              </>
            )}

            <div className={`border-t border-gray-100 pt-8 mt-8 ${config.bot_type === 'video_analysis' ? 'hidden' : ''}`}>
              <label className="block text-[13px] font-semibold text-gray-700 mb-2">Knowledge Base Files</label>

              {config.documents && config.documents.length > 0 && (
                <div className="mt-3 space-y-2">
                  <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Currently Uploaded</h4>
                  <ul className="space-y-2">
                    {config.documents.map((fileName) => (
                      <li key={fileName} className="flex items-center justify-between bg-white border border-gray-100 p-3 rounded-xl">
                        <span className="text-sm font-medium text-gray-700 flex items-center"><div className="p-2 bg-[#F0F6FB] rounded-lg text-blue-500 mr-3"><FaInfoCircle/></div>{fileName}</span>
                        <div className="flex space-x-2">
                          <button type="button" onClick={() => handleViewDocument(fileName)} className="text-blue-500 p-2"><FaInfoCircle/></button>
                          <button type="button" onClick={() => handleRemoveDocument(fileName)} className="text-gray-400 hover:text-red-500 p-2"><FaTrash/></button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {newFiles.length > 0 && (
                <div className="mt-6 space-y-2">
                  <h4 className="text-xs font-bold text-[#FA6C43] uppercase tracking-wider mb-3">Pending Upload</h4>
                  <ul className="space-y-2">
                    {newFiles.map((file) => (
                      <li key={file.name} className="flex items-center justify-between bg-white border border-[#FA6C43]/30 p-3 rounded-xl">
                        <span className="text-sm font-medium text-gray-700">{file.name}</span>
                        <button type="button" onClick={() => handleRemoveNewFile(file.name)} className="text-gray-400 hover:text-red-500 p-2"><FaTrash/></button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <label className="mt-6 flex flex-col items-center justify-center px-6 py-8 border-2 border-dashed border-gray-300 rounded-xl cursor-pointer hover:border-[#FA6C43]/50 bg-gray-50">
                <span className="text-sm font-medium text-gray-600">Drag & drop files or click to browse</span>
                <input type="file" multiple onChange={handleFileChange} className="hidden" accept=".txt,.pdf,.md,.docx,.pptx" />
              </label>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-col-reverse sm:flex-row sm:justify-between items-center gap-4 pt-8 border-t border-gray-100">
              <button type="button" onClick={handleDelete} disabled={isDeleting || isLoading} className="w-full sm:w-auto py-3.5 px-6 rounded-xl font-bold text-red-600 bg-red-50 border border-red-200">
                {isDeleting ? 'Deleting...' : 'Delete Space'}
              </button>
              <div className="flex gap-3 w-full sm:w-auto flex-wrap justify-end">
                <button type="button" onClick={() => navigate(config.bot_type === 'video_analysis' ? `/video-dashboard/${config.config_id}` : `/responses/${config.config_id}`)} className="w-full sm:w-auto py-3.5 px-5 rounded-xl font-bold border-2 border-gray-200 bg-white flex items-center gap-2">
                  <FaListAlt className="text-sm text-gray-500" /><span>{config.bot_type === 'video_analysis' ? 'Dashboard' : 'View Responses'}</span>
                </button>
                <button type="button" onClick={navigateToThisAgentChat} className="w-full sm:w-auto py-3.5 px-6 rounded-xl font-bold border-2 border-gray-200 bg-white">Cancel</button>
                <button type="submit" disabled={isLoading || isDeleting} className="w-full sm:w-auto py-3.5 px-6 rounded-xl font-bold text-white bg-[#FA6C43]">
                  {isLoading ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>

          </form>
        </div>
      </div>

      {showConfirmModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-[2rem] p-8 max-w-sm w-full mx-4">
            <h3 className="text-xl font-bold mb-3">Confirm Deletion</h3>
            <p className="text-gray-600 mb-8">Are you sure you want to permanently delete {config.bot_name}? This action cannot be undone.</p>
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => setShowConfirmModal(false)} className="py-3 px-5 rounded-xl font-bold border-2 border-gray-200">Cancel</button>
              <button type="button" onClick={confirmDelete} className="py-3 px-5 rounded-xl font-bold text-white bg-red-600">Delete</button>
            </div>
          </div>
        </div>
      )}

      {showNotification && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-900 text-white font-medium px-6 py-3 rounded-xl shadow-xl z-50">
          {notificationMessage}
        </div>
      )}
    </div>
  );
};

export default EditConfigPage;