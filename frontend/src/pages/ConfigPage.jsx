import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import apiClient from '../api/apiClient';
import { FaRobot, FaUpload, FaTrash, FaInfoCircle, FaFile, FaVideo, FaComments, FaTimes, FaUsers, FaPlus } from 'react-icons/fa';
import AvatarSelector from '../components/AvatarSelector';

const FileUpload = ({ onFileChange, initialFiles }) => {
  const [files, setFiles] = useState(initialFiles || []);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    setFiles(initialFiles || []);
  }, [initialFiles]);

  const handleDragEnter = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const newFiles = Array.from(e.dataTransfer.files);
    const updatedFiles = [...files, ...newFiles];
    setFiles(updatedFiles);
    onFileChange(updatedFiles);
  };

  const handleFileChange = (e) => {
    const newFiles = Array.from(e.target.files);
    const maxFileSize = 500 * 1024 * 1024; // 500MB
    const updatedFiles = [...files];

    newFiles.forEach(file => {
      if (file.size > maxFileSize) {
        alert(`File ${file.name} is too large. Maximum size is 500MB.`);
        return;
      }
      updatedFiles.push(file);
    });

    setFiles(updatedFiles);
    onFileChange(updatedFiles);
  };

  const handleRemoveFile = (fileName) => {
    const updatedFiles = files.filter(file => file.name !== fileName);
    setFiles(updatedFiles);
    onFileChange(updatedFiles);
  };

  return (
    <div className="w-full">
      <div
        className={`mt-1 flex flex-col items-center justify-center px-6 py-12 border-2 border-dashed rounded-xl transition-all duration-200 cursor-pointer ${
          isDragging 
            ? 'border-[#FA6C43] bg-[#F9D0C4]/20' 
            : 'border-gray-300 hover:border-[#FA6C43]/50 bg-gray-50'
        }`}
        onClick={() => fileInputRef.current.click()}
        onDragEnter={handleDragEnter}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="text-center">
          <FaUpload className={`mx-auto text-3xl mb-3 transition-colors ${isDragging ? 'text-[#FA6C43]' : 'text-gray-400'}`} />
          <p className={`text-sm font-medium ${isDragging ? 'text-[#FA6C43]' : 'text-gray-600'}`}>
            {isDragging ? 'Drop files here' : 'Drag & drop files or click to browse'}
          </p>
          <p className="text-xs text-gray-400 mt-1.5">Supports: TXT, DOCX, MD, PDF, PPTX (Max 500MB each)</p>
        </div>
      </div>
      <p className="text-xs text-center text-gray-400 mt-4">More files can be uploaded after publishing</p>
      
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        multiple
        className="hidden"
        accept=".txt,.pdf,.md,.docx,.pptx"
      />
      {files.length > 0 && (
        <div className="mt-4 max-h-40 overflow-y-auto">
          <h4 className="text-[13px] font-semibold text-gray-700 mb-2">Selected files:</h4>
          <ul className="space-y-2">
            {files.map((file, index) => (
              <li key={index} className="flex items-center justify-between p-3 bg-white border border-gray-100 shadow-sm rounded-xl">
                <div className="flex items-center space-x-3">
                  <div className="p-2 bg-[#F0F6FB] rounded-lg text-[#FA6C43]">
                    <FaFile className="text-sm" />
                  </div>
                  <span className="text-sm font-medium text-gray-700 truncate max-w-xs">{file.name}</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemoveFile(file.name)}
                  className="text-gray-400 hover:text-red-500 transition-colors p-2 rounded-lg hover:bg-red-50"
                >
                  <FaTrash className="text-sm" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

const ConfigModal = ({ isOpen, onClose }) => {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [promptMode, setPromptMode] = useState('instructions');
  
  const aiModels = [
    { id: 'deepseek-chat', name: 'Deepseek Chat' },
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 flash', desc: 'Fast and accurate' },
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 pro', desc: 'Advanced reasoning' },
    { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo' },
    { id: 'gpt-4', name: 'GPT-4' },
    { id: 'gpt-4-turbo', name: 'GPT-4 Turbo' },
    { id: 'gpt-4.1', name: 'GPT-4.1', desc: 'Fastest, great for TAs' },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
    { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', desc: 'Balanced Claude model' },
    { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', desc: 'Fast, lightweight Claude' }
  ];

  const [config, setConfig] = useState({
    bot_name: '',
    associated_course: '',
    bot_type: 'chat',
    heygen_avatar_id: '',
    model_name: 'gpt-3.5-turbo',
    instructions: '',
    prompt_template: '',
    temperature: 0.7,
    response_timeout: 3,
    rag_files: [],
    collection_name: '',
    is_public: false,
    web_access: true,
    bot_avatar: 'robot',
    introduction: '',
    // Group Chat Specifics
    group_size: 3,
    group_duration: 15,
    bots: [
      { name: 'Assistant', prompt: '', model_name: 'gpt-3.5-turbo', temperature: 0.7 }
    ]
  });
  
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState({});
  const [fileUploadKey, setFileUploadKey] = useState(Date.now());
  const [heygenAvatars, setHeygenAvatars] = useState([]);
  const [isFetchingAvatars, setIsFetchingAvatars] = useState(false);

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

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    const val = type === 'checkbox' ? checked : value;
    setConfig(prev => ({ ...prev, [name]: val }));
    if (errors[name]) setErrors(prev => ({ ...prev, [name]: null }));
  };

  const handleBotChange = (index, field, value) => {
    const updatedBots = [...config.bots];
    updatedBots[index][field] = value;
    setConfig(prev => ({ ...prev, bots: updatedBots }));
  };

  const addBot = () => {
    setConfig(prev => ({
      ...prev,
      bots: [...prev.bots, { name: `Bot ${prev.bots.length + 1}`, prompt: '', model_name: config.model_name, temperature: 0.7 }]
    }));
  };

  const removeBot = (index) => {
    if (config.bots.length > 1) {
      setConfig(prev => ({
        ...prev,
        bots: prev.bots.filter((_, i) => i !== index)
      }));
    }
  };

  const handleFileChange = (files) => {
    setConfig(prev => ({ ...prev, rag_files: files }));
    setFileUploadKey(Date.now());
  };

  const validateStep = () => {
    const newErrors = {};
    if (step === 1 && (!config.bot_name || !config.bot_name.trim())) {
      newErrors.bot_name = 'Name is required';
    }
    if (step === 4) {
      if (config.bot_type === 'group_chat') {
        config.bots.forEach((bot, idx) => {
          if (!bot.name.trim()) newErrors[`bot_${idx}_name`] = 'Required';
          if (!bot.prompt.trim()) newErrors[`bot_${idx}_prompt`] = 'Required';
        });
      } else {
        if (promptMode === 'instructions' && !config.instructions.trim()) {
          newErrors.instructions = 'Instructions are required';
        }
        if (promptMode === 'template' && !config.prompt_template.trim()) {
          newErrors.prompt_template = 'Prompt template is required';
        }
      }
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleNext = () => {
    if (validateStep()) {
      if (step < 5) setStep(prev => prev + 1);
      else handleSubmit();
    }
  };

  const handleBack = () => {
    if (step > 1) setStep(prev => prev - 1);
    else if (onClose) onClose();
  };

  const handleSubmit = async () => {
    setIsLoading(true);
    setErrors({});
    
    if (config.bot_type === 'avatar' && !config.heygen_avatar_id) {
      setErrors({ form: 'Please select a video avatar on step 5.' });
      setIsLoading(false);
      return;
    }

    const formData = new FormData();
    config.rag_files.forEach(file => {
      formData.append('files', file);
    });

    const configToSend = { ...config };
    delete configToSend.rag_files;
    if (configToSend.bot_type === 'group_chat') {
      // 1. Stringify the bots array for the backend
      configToSend.bots = JSON.stringify(configToSend.bots);
      
      // 2. Inject a dummy instruction to satisfy the backend's validation requirement
      configToSend.instructions = "Group Space: Managing multiple AI agents.";
      delete configToSend.prompt_template;
      
    } else {
      // Standard Chat / Avatar Chat logic
      configToSend.bots = [];
      
      if (promptMode === 'instructions') {
        delete configToSend.prompt_template;
      } else {
        delete configToSend.instructions;
      }
    }
    // --------------------------------------------------------------

    formData.append('config', JSON.stringify(configToSend));
    

    try {
      const token = localStorage.getItem('jwtToken');
      if (!token) {
        navigate('/login');
        return;
      }
      
      const response = await apiClient.post('/config', formData, { 
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'multipart/form-data'
        }
      });
      const newConfigId = response.data.data._id;
      
      if (configToSend.bot_type === 'group_chat') {
        navigate(`/group-chat/${newConfigId}`);
      } else {
        navigate(`/chat/${newConfigId}`);
      }
      
      if (onClose) onClose();

    } catch (error) {
      console.error('Config error:', error);
      const d = error.response?.data;
      const apiMsg = d && (d.error || d.message || d.msg);
      setErrors({ form: apiMsg || error.message || 'An unexpected error occurred' });
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col relative min-h-[550px] max-h-[90vh]">
        <button onClick={onClose} className="absolute top-5 right-5 p-2.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-full transition-all z-10">
          <FaTimes className="text-xl" />
        </button>

        <div className="p-8 sm:p-10 flex-1 flex flex-col pt-12 min-h-0 min-w-0">
          {/* Progress Bar */}
          <div className="flex justify-between space-x-2 mb-6 px-4 flex-shrink-0">
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className={`h-2 flex-1 rounded-full transition-colors duration-300 ${i <= step ? 'bg-[#FA6C43]' : 'bg-gray-200'}`} />
            ))}
          </div>

          {errors.form && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-700 rounded-xl text-sm flex items-start space-x-3 flex-shrink-0">
              <FaInfoCircle className="mt-0.5 flex-shrink-0 text-lg" />
              <span className="font-medium">{errors.form}</span>
            </div>
          )}

          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden pl-2 pr-2 custom-scrollbar">
            
            {/* STEP 1: Basic Info */}
            {step === 1 && (
              <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
                <h2 className="text-2xl font-bold text-center text-[#222] mb-8">What do we call your Space?</h2>
                
                <div>
                  <label className="block text-[13px] font-semibold text-gray-700 mb-1.5">{config.bot_type === 'group_chat' ? 'Group Lobby Name' : 'Custom AI Name'}</label>
                  <input type="text" name="bot_name" value={config.bot_name} onChange={handleChange} className="w-full p-3 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F9D0C4] focus:border-[#FA6C43] transition-all" placeholder='e.g., "Physiology Study Group"' />
                  {errors.bot_name && <p className="text-xs font-medium text-red-500 mt-1.5">{errors.bot_name}</p>}
                </div>

                <div>
                  <label className="block text-[13px] font-semibold text-gray-700 mb-2">Space Type</label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <label className={`cursor-pointer p-4 border-2 rounded-xl flex flex-col items-center text-center transition-all ${config.bot_type === 'chat' ? 'border-[#FA6C43] bg-[#F9D0C4]/20 shadow-sm' : 'border-gray-200 hover:border-gray-300 bg-white'}`}>
                      <input type="radio" name="bot_type" value="chat" checked={config.bot_type === 'chat'} onChange={handleChange} className="hidden" />
                      <FaComments className={`text-2xl mb-2 ${config.bot_type === 'chat' ? 'text-[#FA6C43]' : 'text-gray-400'}`} />
                      <p className="font-bold text-[#222] text-sm">Chat Bot</p>
                      <p className="text-[10px] text-gray-500 font-medium mt-1">1-on-1 Text</p>
                    </label>

                    <label className={`cursor-pointer p-4 border-2 rounded-xl flex flex-col items-center text-center transition-all ${config.bot_type === 'avatar' ? 'border-[#FA6C43] bg-[#F9D0C4]/20 shadow-sm' : 'border-gray-200 hover:border-gray-300 bg-white'}`}>
                      <input type="radio" name="bot_type" value="avatar" checked={config.bot_type === 'avatar'} onChange={handleChange} className="hidden" />
                      <FaVideo className={`text-2xl mb-2 ${config.bot_type === 'avatar' ? 'text-[#FA6C43]' : 'text-gray-400'}`} />
                      <p className="font-bold text-[#222] text-sm">Avatar Bot</p>
                      <p className="text-[10px] text-gray-500 font-medium mt-1">1-on-1 Video</p>
                    </label>

                    <label className={`cursor-pointer p-4 border-2 rounded-xl flex flex-col items-center text-center transition-all ${config.bot_type === 'group_chat' ? 'border-[#FA6C43] bg-[#F9D0C4]/20 shadow-sm' : 'border-gray-200 hover:border-gray-300 bg-white'}`}>
                      <input type="radio" name="bot_type" value="group_chat" checked={config.bot_type === 'group_chat'} onChange={handleChange} className="hidden" />
                      <FaUsers className={`text-2xl mb-2 ${config.bot_type === 'group_chat' ? 'text-[#FA6C43]' : 'text-gray-400'}`} />
                      <p className="font-bold text-[#222] text-sm">Group Chat</p>
                      <p className="text-[10px] text-gray-500 font-medium mt-1">Multi-User & Multi-AI</p>
                    </label>
                  </div>
                </div>

                {config.bot_type === 'group_chat' && (
                  <div className="pt-2 border-t border-gray-100">
                    <AvatarSelector
                      selectedAvatar={config.bot_avatar}
                      onSelect={(avatarId) => setConfig((prev) => ({ ...prev, bot_avatar: avatarId }))}
                      label="Lobby / Space Icon"
                      hint="Shown in your agent list and at the top of this group space."
                    />
                  </div>
                )}
              </div>
            )}

            {/* STEP 2: Pick Base Model (Skipped visually for groups to avoid confusion, but kept for logic) */}
            {step === 2 && (
              <div className="space-y-4 animate-in fade-in slide-in-from-right-4">
                <h2 className="text-2xl font-bold text-center text-[#222] mb-6">{config.bot_type === 'group_chat' ? 'Select Default Lobby AI' : 'Pick the Base AI Model'}</h2>
                <div className="space-y-3 max-h-[350px] overflow-y-auto pr-2 custom-scrollbar">
                  {aiModels.map(model => (
                    <div key={model.id} onClick={() => setConfig(prev => ({...prev, model_name: model.id}))} className={`cursor-pointer p-4 border-2 rounded-xl transition-all ${config.model_name === model.id ? 'border-[#FA6C43] bg-[#F9D0C4]/10 shadow-sm' : 'border-gray-200 hover:border-gray-300 bg-white'}`}>
                      <h3 className="font-bold text-[#222]">{model.name}</h3>
                      {model.desc && <p className="text-sm text-gray-500 font-medium mt-1">{model.desc}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* STEP 3: Knowledge Base */}
            {step === 3 && (
              <div className="space-y-4 animate-in fade-in slide-in-from-right-4">
                <h2 className="text-2xl font-bold text-center text-[#222] mb-6">Upload Knowledge Base</h2>
                <p className="text-center text-sm text-gray-500 mb-4">{config.bot_type === 'group_chat' ? 'These files will be shared across the entire group chat and all AI agents.' : 'Provide documents for the AI to study.'}</p>
                <FileUpload key={fileUploadKey} onFileChange={handleFileChange} initialFiles={config.rag_files} />
              </div>
            )}

            {/* STEP 4: AI Behavior OR Group Configuration */}
            {step === 4 && (
              <div className="space-y-6 animate-in fade-in slide-in-from-right-4 pb-4">
                {config.bot_type === 'group_chat' ? (
                  // ==============================
                  // GROUP CHAT CONFIGURATION DASHBOARD
                  // ==============================
                  <>
                    <h2 className="text-2xl font-bold text-center text-[#222] mb-6">Configure Group Settings</h2>
                    
                    <div className="bg-gray-50 p-5 rounded-2xl border border-gray-100 mb-6">
                      <h3 className="text-[13px] font-bold text-gray-800 uppercase tracking-wider mb-4 flex items-center"><FaUsers className="mr-2 text-[#FA6C43]"/> Matchmaking Rules</h3>
                      <div className="grid grid-cols-2 gap-6">
                        <div>
                          <label className="flex justify-between text-xs font-semibold text-gray-700 mb-2">
                            <span>Target Group Size</span>
                            <span className="text-[#FA6C43] font-bold">{config.group_size} Users</span>
                          </label>
                          <input type="range" name="group_size" min="2" max="10" step="1" value={config.group_size} onChange={handleChange} className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-[#FA6C43]" />
                        </div>
                        <div>
                          <label className="flex justify-between text-xs font-semibold text-gray-700 mb-2">
                            <span>Chat Duration</span>
                            <span className="text-[#FA6C43] font-bold">{config.group_duration} Mins</span>
                          </label>
                          <input type="range" name="group_duration" min="5" max="60" step="5" value={config.group_duration} onChange={handleChange} className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-[#FA6C43]" />
                        </div>
                      </div>
                    </div>

                    <h3 className="text-[13px] font-bold text-gray-800 uppercase tracking-wider mb-3 flex items-center"><FaRobot className="mr-2 text-[#FA6C43]"/> AI Agents in Lobby</h3>
                    
                    <div className="space-y-4">
                      {config.bots.map((bot, index) => {
                        const noTemp = bot.model_name.includes('gpt-5') || bot.model_name.includes('gemini');
                        return (
                          <div key={index} className="bg-white p-5 rounded-2xl border-2 border-gray-100 shadow-sm relative">
                            {config.bots.length > 1 && (
                              <button onClick={() => removeBot(index)} className="absolute top-4 right-4 text-gray-400 hover:text-red-500 transition-colors bg-gray-50 hover:bg-red-50 p-1.5 rounded-lg">
                                <FaTrash className="text-sm"/>
                              </button>
                            )}
                            
                            <div className="grid grid-cols-2 gap-4 mb-4 pr-8">
                              <div>
                                <label className="block text-[11px] font-bold text-gray-500 uppercase mb-1">Agent Name</label>
                                <input type="text" value={bot.name} onChange={(e) => handleBotChange(index, 'name', e.target.value)} className={`w-full p-2.5 bg-gray-50 border ${errors[`bot_${index}_name`] ? 'border-red-500' : 'border-gray-200'} rounded-lg text-sm focus:outline-none focus:border-[#FA6C43] transition-all`} placeholder="e.g., Prof. Smith" />
                              </div>
                              <div>
                                <label className="block text-[11px] font-bold text-gray-500 uppercase mb-1">AI Engine</label>
                                <select value={bot.model_name} onChange={(e) => handleBotChange(index, 'model_name', e.target.value)} className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-[#FA6C43] transition-all">
                                  {aiModels.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                                </select>
                              </div>
                            </div>
                            
                            <div className="mb-4">
                              <label className="block text-[11px] font-bold text-gray-500 uppercase mb-1">System Prompt / Role</label>
                              <textarea value={bot.prompt} onChange={(e) => handleBotChange(index, 'prompt', e.target.value)} rows="2" className={`w-full p-2.5 bg-gray-50 border ${errors[`bot_${index}_prompt`] ? 'border-red-500' : 'border-gray-200'} rounded-lg text-sm focus:outline-none focus:border-[#FA6C43] transition-all resize-none`} placeholder="You are a stern college professor..." />
                            </div>

                            <div>
                              <label className="flex justify-between text-[11px] font-bold text-gray-500 uppercase mb-2">
                                <span>Creativity / Temperature</span>
                                {noTemp ? <span className="text-gray-400 font-normal normal-case">Auto-managed</span> : <span className="text-[#FA6C43] font-bold">{bot.temperature}</span>}
                              </label>
                              {noTemp ? (
                                <div className="w-full h-2 bg-gray-100 rounded-lg overflow-hidden"><div className="w-full h-full bg-gray-300 opacity-50" style={{background: 'repeating-linear-gradient(45deg, transparent, transparent 10px, #ccc 10px, #ccc 20px)'}}></div></div>
                              ) : (
                                <input type="range" min="0" max="1" step="0.1" value={bot.temperature} onChange={(e) => handleBotChange(index, 'temperature', parseFloat(e.target.value))} className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-[#FA6C43]" />
                              )}
                            </div>
                          </div>
                        );
                      })}

                      <button onClick={addBot} className="w-full py-4 border-2 border-dashed border-gray-300 text-gray-500 rounded-2xl hover:bg-[#F9D0C4]/10 hover:text-[#FA6C43] hover:border-[#FA6C43]/50 transition-all font-bold text-sm flex items-center justify-center">
                        <FaPlus className="mr-2"/> Add Another AI Agent
                      </button>
                    </div>
                  </>
                ) : (
                  // ==============================
                  // STANDARD 1-ON-1 CONFIGURATION
                  // ==============================
                  <>
                    <h2 className="text-2xl font-bold text-center text-[#222] mb-6">Customize AI Behavior</h2>
                    
                    <div className="space-y-4">
                      <div className="flex space-x-3 w-fit mb-4">
                        <button type="button" onClick={() => setPromptMode('instructions')} className={`px-5 py-2 text-sm rounded-lg transition-all border ${promptMode === 'instructions' ? 'bg-[#FA6C43] border-[#FA6C43] text-white font-bold' : 'bg-white border-gray-300 text-gray-600'}`}>Simple Instructions</button>
                        <button type="button" onClick={() => setPromptMode('template')} className={`px-5 py-2 text-sm rounded-lg transition-all border ${promptMode === 'template' ? 'bg-[#FA6C43] border-[#FA6C43] text-white font-bold' : 'bg-white border-gray-300 text-gray-600'}`}>Advanced Template</button>
                      </div>
                    </div>

                    {promptMode === 'instructions' ? (
                      <div><textarea name="instructions" value={config.instructions} onChange={handleChange} rows="4" className="w-full p-3 border border-gray-200 rounded-xl text-sm focus:border-[#FA6C43] outline-none" placeholder='Instructions...'/></div>
                    ) : (
                      <div><textarea name="prompt_template" value={config.prompt_template} onChange={handleChange} rows="4" className="w-full p-3 border border-gray-200 rounded-xl text-sm focus:border-[#FA6C43] outline-none" placeholder="Template..."/></div>
                    )}

                    <div className="grid grid-cols-2 gap-8 pt-4">
                      <div>
                        <label className="block text-[13px] font-semibold text-gray-700 mb-3">Temperature ({config.temperature})</label>
                        <input type="range" name="temperature" min="0" max="1" step="0.1" value={config.temperature} onChange={handleChange} className="w-full h-2 bg-gray-200 rounded-lg appearance-none accent-[#FA6C43]" />
                      </div>
                      <div>
                        <label className="block text-[13px] font-semibold text-gray-700 mb-3">Timeout ({config.response_timeout}s)</label>
                        <input type="range" name="response_timeout" min="1" max="10" step="1" value={config.response_timeout} onChange={handleChange} className="w-full h-2 bg-gray-200 rounded-lg appearance-none accent-[#FA6C43]" />
                      </div>
                    </div>

                    <div className="pt-4 mt-2 border-t border-gray-100">
                      <label className="flex items-center justify-between cursor-pointer gap-4">
                        <div>
                          <p className="text-[13px] font-semibold text-gray-700">Allow web search & URL access</p>
                          <p className="text-xs text-gray-500 mt-0.5">When off, the bot only uses your uploaded files.</p>
                        </div>
                        <span className="relative inline-flex items-center cursor-pointer shrink-0">
                          <input
                            type="checkbox"
                            name="web_access"
                            className="sr-only peer"
                            checked={!!config.web_access}
                            onChange={handleChange}
                          />
                          <span className="w-11 h-6 bg-gray-200 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#FA6C43]"></span>
                        </span>
                      </label>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* STEP 5: Fine Tune */}
            {step === 5 && (
              <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
                <h2 className="text-2xl font-bold text-center text-[#222] mb-6">Final Polish</h2>
                
                {config.bot_type !== 'group_chat' && (
                  <div>
                    <label className="block text-[13px] font-semibold text-gray-700 mb-2">
                      {config.bot_type === 'avatar' ? 'Video Avatar' : 'Bot Avatar'}
                    </label>
                    {config.bot_type === 'avatar' ? (
                      <div className="grid grid-cols-4 gap-3 max-h-40 overflow-y-auto custom-scrollbar">
                        {heygenAvatars.map((avatar) => (
                          <div key={avatar.avatar_id} onClick={() => setConfig(prev => ({ ...prev, heygen_avatar_id: avatar.avatar_id }))} className={`cursor-pointer rounded-xl overflow-hidden border-2 transition-all ${config.heygen_avatar_id === avatar.avatar_id ? 'border-[#FA6C43] shadow-md scale-95' : 'border-transparent hover:border-gray-300'}`}><img src={avatar.normal_preview} alt="Avatar" className="w-full h-16 object-cover bg-gray-100" /></div>
                        ))}
                      </div>
                    ) : (
                      <AvatarSelector
                        selectedAvatar={config.bot_avatar}
                        onSelect={(avatarId) => setConfig(prev => ({ ...prev, bot_avatar: avatarId }))}
                        label={null}
                      />
                    )}
                  </div>
                )}

                <div>
                  <label className="block text-[13px] font-semibold text-gray-700 mb-1.5">Introduction Message</label>
                  <textarea name="introduction" value={config.introduction} onChange={handleChange} rows="2" className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-[#FA6C43]" placeholder="e.g., Welcome to the class!" />
                </div>

                <div>
                  <label className="block text-[13px] font-semibold text-gray-700 mb-2">Access Permissions</label>
                  <div className="flex border border-gray-200 rounded-xl overflow-hidden bg-white">
                    <label className={`flex-1 flex items-center justify-center p-3 cursor-pointer transition-all ${config.is_public ? 'bg-[#F9D0C4]/20' : 'hover:bg-gray-50'}`}>
                      <input type="radio" name="is_public" checked={config.is_public === true} onChange={() => setConfig(prev => ({...prev, is_public: true}))} className="mr-2 text-[#FA6C43] focus:ring-[#FA6C43]"/>
                      <div className="text-sm"><span className="block font-bold text-[#222]">Public</span><span className="text-xs text-gray-500 font-medium">Link Access</span></div>
                    </label>
                    <div className="w-px bg-gray-200"></div>
                    <label className={`flex-1 flex items-center justify-center p-3 cursor-pointer transition-all ${!config.is_public ? 'bg-[#F9D0C4]/20' : 'hover:bg-gray-50'}`}>
                      <input type="radio" name="is_public" checked={config.is_public === false} onChange={() => setConfig(prev => ({...prev, is_public: false}))} className="mr-2 text-[#FA6C43] focus:ring-[#FA6C43]"/>
                      <div className="text-sm"><span className="block font-bold text-[#222]">Private</span><span className="text-xs text-gray-500 font-medium">Login Required</span></div>
                    </label>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-between items-center mt-8 pt-4 border-t border-gray-100 flex-shrink-0">
            <button onClick={handleBack} disabled={isLoading} className="px-8 py-3 rounded-xl font-bold text-gray-700 bg-white border-2 border-gray-200 hover:bg-gray-50 transition-all">{step === 1 ? 'Cancel' : 'Back'}</button>
            <button onClick={handleNext} disabled={isLoading} className="px-8 py-3 rounded-xl font-bold text-white bg-[#FA6C43] hover:bg-[#E55B34] transition-all shadow-sm active:scale-[0.98] min-w-[120px] flex justify-center">
              {isLoading ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div> : (step === 5 ? 'Publish' : 'Next')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ConfigModal;