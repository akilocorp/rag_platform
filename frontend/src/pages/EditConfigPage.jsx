import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import apiClient from '../api/apiClient';
import AvatarSelector from '../components/AvatarSelector';
import { FaInfoCircle, FaTrash, FaPlus, FaUsers, FaRobot } from 'react-icons/fa';

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
  const [promptMode, setPromptMode] = useState('instructions');
  const [showNotification, setShowNotification] = useState(false);
  const [notificationMessage, setNotificationMessage] = useState('');
  
  // HeyGen State
  const [heygenAvatars, setHeygenAvatars] = useState([]);
  const [isFetchingAvatars, setIsFetchingAvatars] = useState(false);

  const aiModels = [
    { id: 'deepseek-chat', name: 'Deepseek Chat' },
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 flash' },
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 pro' },
    { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo' },
    { id: 'gpt-4', name: 'GPT-4' },
    { id: 'gpt-4-turbo', name: 'GPT-4 Turbo' },
    { id: 'gpt-4.1', name: 'GPT-4.1' },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
    { id: 'gpt-5-nano', name: 'GPT-5-nano' },
    { id: 'qwen-turbo', name: 'Qwen Turbo' }
  ];

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
             parsedBots = [{ name: 'Assistant', prompt: '', model_name: 'gpt-4o', temperature: 0.7 }];
        }
    }

    setConfig({
        ...configFromState,
        bots: parsedBots,
        group_size: configFromState.group_size || 2,
        group_duration: configFromState.group_duration || 10
    });
    
    setInitialDocuments(configFromState.documents || []);
    setPromptMode(configFromState.prompt_template ? 'template' : 'instructions');
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
      bots: [...prev.bots, { name: `Bot ${prev.bots.length + 1}`, prompt: '', model_name: 'gpt-3.5-turbo', temperature: 0.7 }]
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

  const handlePromptModeChange = (mode) => {
    setPromptMode(mode);
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
    } else {
        if (promptMode === 'instructions' && !config.instructions?.trim()) newErrors.instructions = 'Required';
        if (promptMode === 'template' && !config.prompt_template?.trim()) newErrors.prompt_template = 'Required';
    }

    if (config.bot_type === 'avatar' && !config.heygen_avatar_id) {
        newErrors.form = 'Please select a video avatar.';
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
      } else {
          if (promptMode === 'instructions') configToSubmit.prompt_template = '';
          else configToSubmit.instructions = '';
      }

      Object.entries(configToSubmit).forEach(([key, value]) => {
        if (key !== 'documents' && key !== 'files' && key !== 'bots') {
          formData.append(key, value);
        }
      });
      
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

  return (
    <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }} className="min-h-screen bg-[#F0F6FB] text-gray-900 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto">
        
        <div className="text-center mb-10">
          <h1 className="text-4xl font-bold text-[#222] tracking-tight">
            Edit {config.bot_type === 'group_chat' ? 'Group Space' : config.bot_type === 'avatar' ? 'Avatar Assistant' : 'AI Assistant'}
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

              {config.bot_type !== 'group_chat' && (
                <div>
                  <label className="block text-[13px] font-semibold text-gray-700 mb-1.5">Model Name</label>
                  <select
                    name="model_name"
                    value={config.model_name || ''}
                    onChange={handleChange}
                    className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-[#FA6C43]"
                  >
                    {aiModels.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </div>
              )}
            </div>

            {/* Avatar Selection Based on Type */}
            <div className="pt-2">
                <label className="block text-[13px] font-semibold text-gray-700 mb-2">Space / UI Icon</label>
                {config.bot_type === 'avatar' ? (
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
                ) : (
                    <AvatarSelector 
                        selectedAvatar={config.bot_avatar} 
                        onSelect={(avatarId) => setConfig(prev => ({ ...prev, bot_avatar: avatarId }))}
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

            {/* CONDITIONAL LOGIC: Group Chat vs Standard */}
            {config.bot_type === 'group_chat' ? (
              <div className="border-t border-gray-100 pt-8 mt-8 space-y-6">
                <h3 className="text-[13px] font-bold text-gray-800 uppercase flex items-center"><FaUsers className="mr-2 text-[#FA6C43]"/> Matchmaking Rules</h3>
                <div className="grid grid-cols-2 gap-8 bg-gray-50 p-6 rounded-2xl border border-gray-100">
                  <div>
                    <label className="flex justify-between text-xs font-semibold text-gray-700 mb-2"><span>Target Size</span><span className="text-[#FA6C43] font-bold">{config.group_size}</span></label>
                    <input type="range" name="group_size" min="2" max="10" value={config.group_size} onChange={handleChange} className="w-full h-2 bg-gray-200 rounded-lg appearance-none accent-[#FA6C43]" />
                  </div>
                  <div>
                    <label className="flex justify-between text-xs font-semibold text-gray-700 mb-2"><span>Duration</span><span className="text-[#FA6C43] font-bold">{config.group_duration} Mins</span></label>
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
                                    {aiModels.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                                </select>
                            </div>
                        </div>
                        <div className="mb-4">
                            <label className="block text-[11px] font-bold text-gray-500 uppercase mb-1">System Prompt</label>
                            <textarea value={bot.prompt} onChange={(e) => handleBotChange(index, 'prompt', e.target.value)} rows="2" className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm outline-none focus:border-[#FA6C43] resize-none" />
                        </div>
                        <div>
                            <label className="flex justify-between text-[11px] font-bold text-gray-500 uppercase mb-2">
                                <span>Temperature</span>
                                {noTemp ? <span>Auto-managed</span> : <span className="text-[#FA6C43] font-bold">{bot.temperature}</span>}
                            </label>
                            {!noTemp && <input type="range" min="0" max="1" step="0.1" value={bot.temperature} onChange={(e) => handleBotChange(index, 'temperature', parseFloat(e.target.value))} className="w-full h-2 bg-gray-200 rounded-lg appearance-none accent-[#FA6C43]" />}
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
                  <div className="flex space-x-3 w-fit">
                    <button type="button" onClick={() => handlePromptModeChange('instructions')} className={`px-5 py-2 text-sm rounded-lg transition-all border ${promptMode === 'instructions' ? 'bg-[#FA6C43] text-white font-bold' : 'bg-white text-gray-600'}`}>Simple Instructions</button>
                    <button type="button" onClick={() => handlePromptModeChange('template')} className={`px-5 py-2 text-sm rounded-lg transition-all border ${promptMode === 'template' ? 'bg-[#FA6C43] text-white font-bold' : 'bg-white text-gray-600'}`}>Advanced Template</button>
                  </div>

                  <textarea name={promptMode === 'instructions' ? 'instructions' : 'prompt_template'} value={promptMode === 'instructions' ? config.instructions || '' : config.prompt_template || ''} onChange={handleChange} rows="5" className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm outline-none focus:border-[#FA6C43]" placeholder="Instructions..." />
                </div>

                <div className="grid grid-cols-1 gap-8 sm:grid-cols-2">
                  <div>
                    <label className="block text-[13px] font-semibold text-gray-700 mb-3">Temperature ({config.temperature || 0.7})</label>
                    <input type="range" name="temperature" min="0" max="1" step="0.1" value={config.temperature || 0.7} onChange={handleChange} className="w-full h-2 bg-gray-200 rounded-lg appearance-none accent-[#FA6C43]" />
                  </div>
                  <div>
                    <label className="block text-[13px] font-semibold text-gray-700 mb-3">Response Timeout ({config.response_timeout || 3}s)</label>
                    <input type="range" name="response_timeout" min="1" max="10" step="1" value={config.response_timeout || 3} onChange={handleChange} className="w-full h-2 bg-gray-200 rounded-lg appearance-none accent-[#FA6C43]" />
                  </div>
                </div>
              </>
            )}

            {/* Collection Name & File Management (Same for all types) */}
            <div>
              <label className="block text-[13px] font-semibold text-gray-700 mb-1.5">RAG Collection Name</label>
              <input type="text" name="collection_name" value={config.collection_name || ''} onChange={handleChange} className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm focus:border-[#FA6C43] outline-none" />
            </div>

            <div className="border-t border-gray-100 pt-8 mt-8">
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
                <input type="file" multiple onChange={handleFileChange} className="hidden" accept=".txt,.pdf,.md,.docx" />
              </label>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-col-reverse sm:flex-row sm:justify-between items-center gap-4 pt-8 border-t border-gray-100">
              <button type="button" onClick={handleDelete} disabled={isDeleting || isLoading} className="w-full sm:w-auto py-3.5 px-6 rounded-xl font-bold text-red-600 bg-red-50 border border-red-200">
                {isDeleting ? 'Deleting...' : 'Delete Space'}
              </button>
              <div className="flex gap-3 w-full sm:w-auto">
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