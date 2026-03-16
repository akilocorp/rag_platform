import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import apiClient from '../api/apiClient';
import { FaRobot, FaUpload, FaTrash, FaInfoCircle, FaFile, FaVideo, FaComments, FaTimes } from 'react-icons/fa';
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
          <p className="text-xs text-gray-400 mt-1.5">Supports: TXT, DOCX, MD (Max 500MB each)</p>
        </div>
      </div>
      <p className="text-xs text-center text-gray-400 mt-4">More files can be uploaded after publishing</p>
      
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        multiple
        className="hidden"
        accept=".txt,.pdf,.md,.docx"
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

// Main Modal Component
const ConfigModal = ({ isOpen, onClose }) => {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [promptMode, setPromptMode] = useState('instructions');
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
    bot_avatar: 'robot',
    introduction: '',
  });
  
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState({});
  const [fileUploadKey, setFileUploadKey] = useState(Date.now());
  const [heygenAvatars, setHeygenAvatars] = useState([]);
  const [isFetchingAvatars, setIsFetchingAvatars] = useState(false);

  const aiModels = [
    { id: 'deepseek-chat', name: 'Deepseek Chat' },
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 flash', desc: 'Fast and accurate' },
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 pro', desc: 'Advanced reasoning' },
    { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo' },
    { id: 'gpt-4', name: 'GPT-4' },
    { id: 'gpt-4-turbo', name: 'GPT-4 Turbo' },
    { id: 'gpt-4.1', name: 'GPT-4.1', desc: 'Fastest, great for TAs' },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
    { id: 'gpt-5-nano', name: 'GPT-5-nano', desc: 'Best reasoning agent' },
    { id: 'qwen-turbo', name: 'Qwen Turbo' }
  ];

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

  const handleFileChange = (files) => {
    setConfig(prev => ({ ...prev, rag_files: files }));
    setFileUploadKey(Date.now());
  };

  const handlePromptModeChange = (mode) => {
    setPromptMode(mode);
    setErrors(prev => ({ ...prev, instructions: null, prompt_template: null }));
  };

  const validateStep = () => {
    const newErrors = {};
    if (step === 1 && (!config.bot_name || !config.bot_name.trim())) {
      newErrors.bot_name = 'Assistant Name is required';
    }
    if (step === 4) {
      if (promptMode === 'instructions' && !config.instructions.trim()) {
        newErrors.instructions = 'Instructions are required';
      }
      if (promptMode === 'template' && !config.prompt_template.trim()) {
        newErrors.prompt_template = 'Prompt template is required';
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
      setErrors({ form: 'Please select a video avatar for your Avatar Bot on step 5.' });
      setIsLoading(false);
      return;
    }

    const formData = new FormData();
    config.rag_files.forEach(file => {
      formData.append('files', file);
    });

    const configToSend = { ...config };
    delete configToSend.rag_files;

    if (promptMode === 'instructions') {
      delete configToSend.prompt_template;
    } else {
      delete configToSend.instructions;
    }

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
      
      navigate(`/chat/${response.data.data._id}`);
      if (onClose) onClose();

    } catch (error) {
      console.error('Config error:', error);
      let errorMessage = 'An unexpected error occurred';
      if (error.response) {
        errorMessage = error.response.data.error || errorMessage;
      }
      setErrors({ form: errorMessage });
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  const renderProgress = () => {
    return (
      <div className="flex justify-between space-x-2 mb-6 px-4">
        {[1, 2, 3, 4, 5].map(i => (
          <div 
            key={i} 
            className={`h-2 flex-1 rounded-full transition-colors duration-300 ${i <= step ? 'bg-[#FA6C43]' : 'bg-gray-200'}`}
          />
        ))}
      </div>
    );
  };

  return (
    <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col relative min-h-[550px] max-h-[90vh]">
        
        {/* Close Button placed in the absolute top-right of the modal */}
        <button
          onClick={onClose}
          className="absolute top-5 right-5 p-2.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-full transition-all z-10 focus:outline-none"
          title="Close"
        >
          <FaTimes className="text-xl" />
        </button>

        <div className="p-8 sm:p-10 flex-1 flex flex-col pt-12">
          {renderProgress()}

          {errors.form && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-700 rounded-xl text-sm flex items-start space-x-3">
              <FaInfoCircle className="mt-0.5 flex-shrink-0 text-lg" />
              <span className="font-medium">{errors.form}</span>
            </div>
          )}

          <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
            
            {/* STEP 1: Basic Info */}
            {step === 1 && (
              <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
                <h2 className="text-2xl font-bold text-center text-[#222] mb-8">What do we call your Custom AI?</h2>
                
                <div>
                  <label className="block text-[13px] font-semibold text-gray-700 mb-1.5">Custom AI Name</label>
                  <input
                    type="text"
                    name="bot_name"
                    value={config.bot_name}
                    onChange={handleChange}
                    className={`w-full p-3 bg-white border ${errors.bot_name ? 'border-red-500' : 'border-gray-200'} rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F9D0C4] focus:border-[#FA6C43] transition-all`}
                    placeholder='e.g., "Advanced Physiology Lab 402"'
                  />
                  {errors.bot_name && <p className="text-xs font-medium text-red-500 mt-1.5">{errors.bot_name}</p>}
                </div>

                <div>
                  <label className="block text-[13px] font-semibold text-gray-700 mb-1.5">Associated Course <span className="text-gray-400 font-normal ml-1">(optional)</span></label>
                  <input
                    type="text"
                    name="associated_course"
                    value={config.associated_course}
                    onChange={handleChange}
                    className="w-full p-3 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F9D0C4] focus:border-[#FA6C43] transition-all"
                    placeholder='e.g., "Medical Sciences"'
                  />
                </div>

                <div>
                  <label className="block text-[13px] font-semibold text-gray-700 mb-2">Assistant Type</label>
                  <div className="grid grid-cols-2 gap-4">
                    <label className={`cursor-pointer p-4 border-2 rounded-xl flex items-start space-x-3 transition-all ${config.bot_type === 'chat' ? 'border-[#FA6C43] bg-[#F9D0C4]/20 shadow-sm' : 'border-gray-200 hover:border-gray-300 bg-white'}`}>
                      <input 
                        type="radio" 
                        name="bot_type" 
                        value="chat" 
                        checked={config.bot_type === 'chat'} 
                        onChange={handleChange} 
                        className="mt-1 w-4 h-4 text-[#FA6C43] border-gray-300 focus:ring-[#FA6C43]"
                      />
                      <div>
                        <p className="font-bold text-[#222] text-sm">Chat Bot</p>
                        <p className="text-xs text-gray-500 font-medium">Text-based interface</p>
                      </div>
                    </label>

                    <label className={`cursor-pointer p-4 border-2 rounded-xl flex items-start space-x-3 transition-all ${config.bot_type === 'avatar' ? 'border-[#FA6C43] bg-[#F9D0C4]/20 shadow-sm' : 'border-gray-200 hover:border-gray-300 bg-white'}`}>
                      <input 
                        type="radio" 
                        name="bot_type" 
                        value="avatar" 
                        checked={config.bot_type === 'avatar'} 
                        onChange={handleChange} 
                        className="mt-1 w-4 h-4 text-[#FA6C43] border-gray-300 focus:ring-[#FA6C43]"
                      />
                      <div>
                        <p className="font-bold text-[#222] text-sm">Avatar Bot</p>
                        <p className="text-xs text-gray-500 font-medium">Real-time Video</p>
                      </div>
                    </label>
                  </div>
                </div>
                <p className="text-center text-xs text-gray-400 font-medium mt-6">These settings cannot be changed after publishing.</p>
              </div>
            )}

            {/* STEP 2: Pick Base Model */}
            {step === 2 && (
              <div className="space-y-4 animate-in fade-in slide-in-from-right-4">
                <h2 className="text-2xl font-bold text-center text-[#222] mb-6">Pick the Base AI Model</h2>
                <div className="space-y-3 max-h-[350px] overflow-y-auto pr-2 custom-scrollbar">
                  {aiModels.map(model => (
                    <div 
                      key={model.id}
                      onClick={() => setConfig(prev => ({...prev, model_name: model.id}))}
                      className={`cursor-pointer p-4 border-2 rounded-xl transition-all ${config.model_name === model.id ? 'border-[#FA6C43] bg-[#F9D0C4]/10 shadow-sm' : 'border-gray-200 hover:border-gray-300 bg-white'}`}
                    >
                      <h3 className="font-bold text-[#222]">{model.name}</h3>
                      {model.desc && <p className="text-sm text-gray-500 font-medium mt-1">{model.desc}</p>}
                    </div>
                  ))}
                </div>
                <p className="text-center text-xs text-gray-400 font-medium mt-6">This setting cannot be changed after publishing.</p>
              </div>
            )}

            {/* STEP 3: Knowledge Base */}
            {step === 3 && (
              <div className="space-y-4 animate-in fade-in slide-in-from-right-4">
                <h2 className="text-2xl font-bold text-center text-[#222] mb-6">Upload Knowledge Base</h2>
                <FileUpload key={fileUploadKey} onFileChange={handleFileChange} initialFiles={config.rag_files} />
              </div>
            )}

            {/* STEP 4: AI Behavior */}
            {step === 4 && (
              <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
                <h2 className="text-2xl font-bold text-center text-[#222] mb-6">Customize AI Behavior</h2>
                
                <div className="space-y-4">
                  <label className="block text-[13px] font-semibold text-gray-700">Configuration Method</label>
                  <div className="flex space-x-3 w-fit mb-4">
                    <button
                      type="button"
                      onClick={() => handlePromptModeChange('instructions')}
                      className={`px-5 py-2 text-sm rounded-lg transition-all border ${
                        promptMode === 'instructions' 
                        ? 'bg-[#FA6C43] border-[#FA6C43] text-white font-bold shadow-sm' 
                        : 'bg-white border-gray-300 text-gray-600 hover:text-gray-900 hover:bg-gray-50 font-medium'
                      }`}
                    >
                      Instructions
                    </button>
                    <button
                      type="button"
                      onClick={() => handlePromptModeChange('template')}
                      className={`px-5 py-2 text-sm rounded-lg transition-all border ${
                        promptMode === 'template' 
                        ? 'bg-[#FA6C43] border-[#FA6C43] text-white font-bold shadow-sm' 
                        : 'bg-white border-gray-300 text-gray-600 hover:text-gray-900 hover:bg-gray-50 font-medium'
                      }`}
                    >
                      Template
                    </button>
                  </div>
                </div>

                {promptMode === 'instructions' ? (
                  <div>
                    <label className="block text-[13px] font-semibold text-gray-700 mb-1.5">Behavior Instructions</label>
                    <textarea
                      name="instructions"
                      value={config.instructions}
                      onChange={handleChange}
                      rows="4"
                      className={`w-full p-3 bg-white border ${errors.instructions ? 'border-red-500' : 'border-gray-200'} rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F9D0C4] focus:border-[#FA6C43] transition-all resize-none`}
                      placeholder='e.g., "You are a teaching assistant who does not answer students directly. Rather you nudge students towards the correct answer."'
                    />
                    {errors.instructions && <p className="text-xs font-medium text-red-500 mt-1.5">{errors.instructions}</p>}
                  </div>
                ) : (
                  <div>
                    <label className="block text-[13px] font-semibold text-gray-700 mb-1.5">Prompt Template</label>
                    <textarea
                      name="prompt_template"
                      value={config.prompt_template}
                      onChange={handleChange}
                      rows="4"
                      className={`w-full p-3 bg-white border ${errors.prompt_template ? 'border-red-500' : 'border-gray-200'} rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F9D0C4] focus:border-[#FA6C43] transition-all resize-none`}
                      placeholder="Example template:\nYou are an expert in {topic}..."
                    />
                    {errors.prompt_template && <p className="text-xs font-medium text-red-500 mt-1.5">{errors.prompt_template}</p>}
                  </div>
                )}

                <div>
                  <label className="block text-[13px] font-semibold text-gray-700 mb-3">
                    Creativity <span className="text-gray-500 ml-1 font-medium">({config.temperature < 0.3 ? 'Precise' : config.temperature < 0.7 ? 'Balanced' : 'Creative'})</span>
                  </label>
                  <input
                    type="range"
                    name="temperature"
                    min="0"
                    max="1"
                    step="0.1"
                    value={config.temperature}
                    onChange={handleChange}
                    className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-[#FA6C43]"
                  />
                </div>

                <div>
                  <label className="flex justify-between text-[13px] font-semibold text-gray-700 mb-3">
                    <span>Response Timeout</span>
                    <span className="text-gray-500 font-medium">({config.response_timeout}s)</span>
                  </label>
                  <input
                    type="range"
                    name="response_timeout"
                    min="0"
                    max="10"
                    step="1"
                    value={config.response_timeout}
                    onChange={handleChange}
                    className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-[#FA6C43]"
                  />
                  <p className="text-center text-xs text-gray-400 font-medium mt-4">The custom AI will respond generically if this option is left empty</p>
                </div>
              </div>
            )}

            {/* STEP 5: Fine Tune */}
            {step === 5 && (
              <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
                <h2 className="text-2xl font-bold text-center text-[#222] mb-6">Fine-tune your Custom AI</h2>
                
                <div>
                  <label className="block text-[13px] font-semibold text-gray-700 mb-2">Bot Avatar</label>
                  {config.bot_type === 'avatar' ? (
                    isFetchingAvatars ? (
                      <div className="flex justify-center py-4"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-[#FA6C43]"></div></div>
                    ) : (
                      <div className="grid grid-cols-4 gap-3 max-h-40 overflow-y-auto custom-scrollbar">
                        {heygenAvatars.map((avatar) => (
                          <div
                            key={avatar.avatar_id}
                            onClick={() => setConfig(prev => ({ ...prev, heygen_avatar_id: avatar.avatar_id }))}
                            className={`cursor-pointer rounded-xl overflow-hidden border-2 transition-all ${
                              config.heygen_avatar_id === avatar.avatar_id ? 'border-[#FA6C43] shadow-md scale-95' : 'border-transparent hover:border-gray-300'
                            }`}
                          >
                            <img src={avatar.normal_preview} alt="Avatar" className="w-full h-16 object-cover bg-gray-100" />
                          </div>
                        ))}
                      </div>
                    )
                  ) : (
                    <AvatarSelector 
                      selectedAvatar={config.bot_avatar} 
                      onSelect={(avatarId) => setConfig(prev => ({ ...prev, bot_avatar: avatarId }))}
                    />
                  )}
                </div>

                <div>
                  <label htmlFor="introduction" className="block text-[13px] font-semibold text-gray-700 mb-1.5">
                    Introduction <span className="text-gray-400 font-normal ml-1">(Optional)</span>
                  </label>
                  <textarea
                    id="introduction"
                    name="introduction"
                    value={config.introduction}
                    onChange={handleChange}
                    rows="2"
                    className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F9D0C4] focus:border-[#FA6C43] transition-all"
                    placeholder="e.g., Welcome to the class! How can I help you today?"
                  />
                </div>

                <div>
                  <label className="block text-[13px] font-semibold text-gray-700 mb-1.5">Collection Name <span className="text-gray-400 font-normal ml-1">(Optional)</span></label>
                  <input
                    type="text"
                    name="collection_name"
                    value={config.collection_name}
                    onChange={handleChange}
                    className="w-full p-3 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F9D0C4] focus:border-[#FA6C43] transition-all"
                    placeholder='e.g., "MGMTXXXX"'
                  />
                </div>

                <div>
                  <label className="block text-[13px] font-semibold text-gray-700 mb-2">Access Permissions</label>
                  <div className="flex border border-gray-200 rounded-xl overflow-hidden bg-white">
                    <label className={`flex-1 flex items-center justify-center p-3 cursor-pointer transition-all ${config.is_public ? 'bg-[#F9D0C4]/20' : 'hover:bg-gray-50'}`}>
                      <input 
                        type="radio" 
                        name="is_public" 
                        checked={config.is_public === true} 
                        onChange={() => setConfig(prev => ({...prev, is_public: true}))}
                        className="mr-2 text-[#FA6C43] focus:ring-[#FA6C43]"
                      />
                      <div className="text-sm">
                        <span className="block font-bold text-[#222]">Public</span>
                        <span className="text-xs text-gray-500 font-medium">Anyone with a link</span>
                      </div>
                    </label>
                    <div className="w-px bg-gray-200"></div>
                    <label className={`flex-1 flex items-center justify-center p-3 cursor-pointer transition-all ${!config.is_public ? 'bg-[#F9D0C4]/20' : 'hover:bg-gray-50'}`}>
                      <input 
                        type="radio" 
                        name="is_public" 
                        checked={config.is_public === false} 
                        onChange={() => setConfig(prev => ({...prev, is_public: false}))}
                        className="mr-2 text-[#FA6C43] focus:ring-[#FA6C43]"
                      />
                      <div className="text-sm">
                        <span className="block font-bold text-[#222]">Private</span>
                        <span className="text-xs text-gray-500 font-medium">Registered Students Only</span>
                      </div>
                    </label>
                  </div>
                </div>
                <p className="text-center text-xs text-gray-400 font-medium mt-4">These are optional settings which can be configured later</p>
              </div>
            )}
          </div>

          {/* Footer Navigation */}
          <div className="flex justify-between items-center mt-8 pt-4 border-t border-gray-100">
            <button 
              onClick={handleBack}
              disabled={isLoading}
              className="px-8 py-3 rounded-xl font-bold text-gray-700 bg-white border-2 border-gray-200 hover:bg-gray-50 hover:border-gray-300 transition-all focus:outline-none disabled:opacity-50"
            >
              {step === 1 ? 'Cancel' : 'Back'}
            </button>
            <button 
              onClick={handleNext}
              disabled={isLoading}
              className="px-8 py-3 rounded-xl font-bold text-white bg-[#FA6C43] hover:bg-[#E55B34] transition-all focus:outline-none shadow-sm active:scale-[0.98] flex items-center justify-center min-w-[120px] disabled:opacity-70 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              ) : step === 5 ? 'Done' : 'Next'}
            </button>
          </div>

        </div>
      </div>
    </div>
  );
};

export default ConfigModal;