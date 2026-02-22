import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import apiClient from '../api/apiClient';
import { FaRobot, FaUpload, FaTrash, FaInfoCircle, FaFile, FaVideo, FaComments } from 'react-icons/fa';
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
    <div>
      <label className="block text-[13px] font-semibold text-gray-700 mb-2">Knowledge Base Files <span className="text-gray-400 font-normal ml-1">(Optional)</span></label>
      <div
        className={`mt-1 flex flex-col items-center justify-center px-6 pt-8 pb-8 border-2 border-dashed rounded-xl transition-all duration-200 cursor-pointer ${
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
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        multiple
        className="hidden"
        accept=".txt,.pdf,.md,.docx"
      />
      {files.length > 0 && (
        <div className="mt-4">
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

const ConfigPage = () => {
  const navigate = useNavigate();
  const [promptMode, setPromptMode] = useState('instructions');
  const [config, setConfig] = useState({
    bot_name: '',
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
  };

  const handleFileChange = (files) => {
    setConfig(prev => ({ ...prev, rag_files: files }));
    setFileUploadKey(Date.now());
  };

  const handlePromptModeChange = (mode) => {
    setPromptMode(mode);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setErrors({});

    const newErrors = {};
    if (!config.bot_name.trim()) newErrors.bot_name = 'Assistant name is required';
    if (promptMode === 'instructions' && !config.instructions.trim()) {
      newErrors.instructions = 'Instructions are required';
    }
    if (config.bot_type === 'avatar' && !config.heygen_avatar_id) {
      newErrors.form = 'Please select a video avatar for your Avatar Bot.';
    }
    if (promptMode === 'template' && !config.prompt_template.trim()) {
      newErrors.prompt_template = 'Prompt template is required';
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      setIsLoading(false);
      return;
    }

    const formData = new FormData();
    config.rag_files.forEach(file => {
      if (file.size > 500 * 1024 * 1024) {
        setErrors({ form: `File ${file.name} is too large. Maximum size is 500MB.` });
        return;
      }
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

  return (
    <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }} className="min-h-screen bg-[#F0F6FB] text-gray-900 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto">
        
        <div className="text-center mb-10">
          <h1 className="text-4xl font-bold text-[#222] tracking-tight">
            Create Your AI Assistant
          </h1>
          <p className="mt-3 text-gray-500 max-w-lg mx-auto font-medium">
            Configure your custom assistant with personalized instructions and knowledge.
          </p>
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
                <label htmlFor="bot_name" className="block text-[13px] font-semibold text-gray-700 mb-1.5">
                  Assistant Name
                </label>
                <input
                  id="bot_name"
                  type="text"
                  name="bot_name"
                  value={config.bot_name}
                  onChange={handleChange}
                  className={`w-full px-4 py-3 bg-white border ${
                    errors.bot_name ? 'border-red-500' : 'border-gray-200'
                  } rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F9D0C4] focus:border-[#FA6C43] transition-all`}
                  placeholder="e.g., Grader Bot"
                />
                {errors.bot_name && (
                  <p className="mt-1.5 text-xs font-medium text-red-500">{errors.bot_name}</p>
                )}
              </div>

              <div>
                <label htmlFor="model_name" className="block text-[13px] font-semibold text-gray-700 mb-1.5">
                  AI Model
                </label>
                <select
                  id="model_name"
                  name="model_name"
                  value={config.model_name}
                  onChange={handleChange}
                  className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F9D0C4] focus:border-[#FA6C43] transition-all text-gray-900"
                >
                  <option value="deepseek-chat">Deepseek Chat</option>
                  <option value="gemini-2.5-flash">Gemini 2.5 flash (Fast and accurate)</option>
                  <option value="gemini-2.5-pro">Gemini 2.5 pro (Advanced reasoning)</option>
                  <option value="gpt-3.5-turbo">GPT-3.5 Turbo</option>
                  <option value="gpt-4">GPT-4</option>
                  <option value="gpt-4-turbo">GPT-4 Turbo</option>
                  <option value="gpt-4.1">GPT-4.1 (Fastest, great for TAs)</option>
                  <option value="gpt-4o-mini">GPT-4o Mini</option>
                  <option value="gpt-5-nano">GPT-5-nano (Best reasoning agent)</option>
                  <option value="qwen-turbo">Qwen Turbo</option>
                </select>
              </div>
            </div>

            <div className="space-y-3">
              <label className="block text-[13px] font-semibold text-gray-700">Assistant Type</label>
              <div className="grid grid-cols-2 gap-4">
                
                {/* Chat Bot Toggle */}
                <div 
                  onClick={() => setConfig(prev => ({...prev, bot_type: 'chat'}))}
                  className={`cursor-pointer p-4 rounded-xl border-2 transition-all flex items-center space-x-4 ${
                    config.bot_type === 'chat' 
                    ? 'border-[#FA6C43] bg-[#F9D0C4]/20 shadow-sm' 
                    : 'border-gray-200 bg-white hover:border-gray-300'
                  }`}
                >
                  <div className={`p-3 rounded-xl transition-colors ${config.bot_type === 'chat' ? 'bg-[#FA6C43] text-white' : 'bg-gray-100 text-gray-400'}`}>
                    <FaComments size={20} />
                  </div>
                  <div>
                    <p className="font-bold text-sm text-[#222]">Chat Bot</p>
                    <p className="text-xs text-gray-500 font-medium">Text-based interface</p>
                  </div>
                </div>

                {/* Avatar Bot Toggle */}
                <div 
                  onClick={() => setConfig(prev => ({...prev, bot_type: 'avatar'}))}
                  className={`cursor-pointer p-4 rounded-xl border-2 transition-all flex items-center space-x-4 ${
                    config.bot_type === 'avatar' 
                    ? 'border-[#FA6C43] bg-[#F9D0C4]/20 shadow-sm' 
                    : 'border-gray-200 bg-white hover:border-gray-300'
                  }`}
                >
                  <div className={`p-3 rounded-xl transition-colors ${config.bot_type === 'avatar' ? 'bg-[#FA6C43] text-white' : 'bg-gray-100 text-gray-400'}`}>
                    <FaVideo size={20} />
                  </div>
                  <div>
                    <p className="font-bold text-sm text-[#222]">Avatar Bot</p>
                    <p className="text-xs text-gray-500 font-medium">Real-time video</p>
                  </div>
                </div>

              </div>
            </div>

            {/* Video Avatar Selection (For Avatar Bots) */}
            {config.bot_type === 'avatar' && (
              <div className="space-y-4 p-5 bg-[#F0F6FB] rounded-xl border border-gray-200 animate-in fade-in slide-in-from-top-4">
                <label className="block text-[13px] font-bold text-gray-800">
                  Select Video Avatar
                </label>
                {isFetchingAvatars ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#FA6C43]"></div>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-4 max-h-60 overflow-y-auto pr-2 custom-scrollbar">
                    {heygenAvatars.map((avatar) => (
                      <div
                        key={avatar.avatar_id}
                        onClick={() => setConfig(prev => ({ ...prev, heygen_avatar_id: avatar.avatar_id }))}
                        className={`relative cursor-pointer rounded-xl overflow-hidden border-2 transition-all bg-white ${
                          config.heygen_avatar_id === avatar.avatar_id 
                          ? 'border-[#FA6C43] scale-95 shadow-[0_0_15px_rgba(250,108,67,0.3)]' 
                          : 'border-transparent hover:border-gray-300 shadow-sm'
                        }`}
                      >
                        <img 
                          src={avatar.normal_preview} 
                          alt={avatar.pose_name} 
                          className="w-full h-28 object-cover bg-gray-100"
                        />
                        <div className="absolute bottom-0 left-0 right-0 bg-white/95 backdrop-blur-sm p-1.5 border-t border-gray-100">
                          <p className="text-[10px] font-bold text-center truncate text-gray-800">{avatar.avatar_name}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {!config.heygen_avatar_id && !isFetchingAvatars && (
                  <p className="text-xs font-semibold text-red-500">Please select an avatar for the video stream.</p>
                )}
              </div>
            )}

            {/* UI Icon Selector (Conditional: Only for Chat Bots) */}
            {config.bot_type === 'chat' && (
              <div className="pt-2">
                <AvatarSelector 
                  selectedAvatar={config.bot_avatar} 
                  onSelect={(avatarId) => setConfig(prev => ({ ...prev, bot_avatar: avatarId }))}
                />
              </div>
            )}

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

            {/* Public Access Toggle */}
            <div className="p-5 bg-gray-50 border border-gray-100 rounded-xl">
              <div className="flex items-center justify-between">
                <div>
                  <label htmlFor="is_public" className="block text-[13px] font-bold text-gray-800 mb-0.5">
                    Public Access
                  </label>
                  <p className="text-xs text-gray-500 font-medium">Allow anyone with the link to chat without logging in</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    id="is_public"
                    name="is_public"
                    className="sr-only peer"
                    checked={config.is_public}
                    onChange={handleChange}
                  />
                  <div className="w-11 h-6 bg-gray-200 rounded-full peer peer-focus:ring-2 peer-focus:ring-[#F9D0C4] peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#FA6C43]"></div>
                </label>
              </div>
            </div>

            <div className="space-y-4">
  <label className="block text-[13px] font-semibold text-gray-700">Configuration Method</label>
  <div className="flex space-x-3 w-fit">
    <button
      type="button"
      onClick={() => handlePromptModeChange('instructions')}
      className={`px-5 py-2 text-sm rounded-lg transition-all border ${
        promptMode === 'instructions' 
        ? 'bg-[#FA6C43] border-[#FA6C43] text-white font-bold shadow-sm' 
        : 'bg-white border-gray-300 text-gray-600 hover:text-gray-900 hover:bg-gray-50 font-medium'
      }`}
    >
      Simple Instructions
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
      Advanced Template
    </button>
  </div>
</div>

            {promptMode === 'instructions' ? (
              <div>
                <label htmlFor="instructions" className="block text-[13px] font-semibold text-gray-700 mb-1.5">Behavior Instructions</label>
                <textarea
                  id="instructions"
                  name="instructions"
                  value={config.instructions}
                  onChange={handleChange}
                  rows="5"
                  className={`w-full px-4 py-3 bg-white border ${
                    errors.instructions ? 'border-red-500' : 'border-gray-200'
                  } rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F9D0C4] focus:border-[#FA6C43] transition-all`}
                  placeholder="Example: You are a helpful teaching assistant..."
                />
                {errors.instructions && <p className="mt-1.5 text-xs font-medium text-red-500">{errors.instructions}</p>}
              </div>
            ) : (
              <div>
                <label htmlFor="prompt_template" className="block text-[13px] font-semibold text-gray-700 mb-1.5">Prompt Template</label>
                <textarea
                  id="prompt_template"
                  name="prompt_template"
                  value={config.prompt_template}
                  onChange={handleChange}
                  rows="5"
                  className={`w-full px-4 py-3 bg-white border ${
                    errors.prompt_template ? 'border-red-500' : 'border-gray-200'
                  } rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F9D0C4] focus:border-[#FA6C43] transition-all`}
                  placeholder={`Example template:\nYou are an expert in {topic}...`}
                />
                {errors.prompt_template && <p className="mt-1.5 text-xs font-medium text-red-500">{errors.prompt_template}</p>}
              </div>
            )}

            <div className="grid grid-cols-1 gap-8 sm:grid-cols-2">
              <div>
                <label htmlFor="temperature" className="block text-[13px] font-semibold text-gray-700 mb-3">
                  Temperature <span className="text-gray-500 ml-1 font-medium">({config.temperature < 0.3 ? 'Precise' : config.temperature < 0.7 ? 'Balanced' : 'Creative'})</span>
                </label>
                <input
                  id="temperature"
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
                <label htmlFor="response_timeout" className="block text-[13px] font-semibold text-gray-700 mb-3">
                  Response Timeout <span className="text-gray-500 ml-1 font-medium">({config.response_timeout} seconds)</span>
                </label>
                <input
                  id="response_timeout"
                  type="range"
                  name="response_timeout"
                  min="0"
                  max="10"
                  step="1"
                  value={config.response_timeout}
                  onChange={handleChange}
                  className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-[#FA6C43]"
                />
              </div>
            </div>

            <div className="border-t border-gray-100 pt-6">
              <FileUpload 
                key={fileUploadKey}
                onFileChange={handleFileChange} 
                initialFiles={config.rag_files} 
              />
            </div>

            <div>
              <label htmlFor="collection_name" className="block text-[13px] font-semibold text-gray-700 mb-1.5">
                Collection Name <span className="text-gray-400 font-normal ml-1">(Optional)</span>
              </label>
              <input
                id="collection_name"
                type="text"
                name="collection_name"
                value={config.collection_name}
                onChange={handleChange}
                className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F9D0C4] focus:border-[#FA6C43] transition-all"
                placeholder="e.g., class-syllabus-2024"
              />
            </div>

            <div className="flex flex-col sm:flex-row items-center gap-4 pt-8 mt-4 border-t border-gray-100">
              <button 
                type="button" 
                onClick={() => navigate(-1)} 
                className="w-full py-3.5 px-6 rounded-xl font-bold border-2 border-gray-200 text-gray-700 bg-white hover:bg-gray-50 hover:border-gray-300 transition-all"
              >
                Cancel
              </button>
              <button 
                type="submit" 
                disabled={isLoading} 
                className={`w-full py-3.5 px-6 rounded-xl font-bold flex items-center justify-center space-x-2 transition-all ${
                  isLoading 
                  ? 'bg-[#F9D0C4] text-[#FA6C43] cursor-not-allowed' 
                  : 'bg-[#FA6C43] hover:bg-[#E55B34] text-white active:scale-[0.98] shadow-sm'
                }`}
              >
                {isLoading ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current mr-2"></div>
                    <span>Saving...</span>
                  </>
                ) : (
                  <>
                    <span>Save & Start Chatting</span>
                    <FaRobot className="text-sm" />
                  </>
                )}
              </button>
            </div>
          </form>

        </div>
      </div>
    </div>
  );
};

export default ConfigPage;