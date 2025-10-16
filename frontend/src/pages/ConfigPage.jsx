import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import apiClient from '../api/apiClient';
import { FaRobot, FaUpload, FaTrash, FaInfoCircle, FaFile } from 'react-icons/fa';
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
    const maxFileSize = 50 * 1024 * 1024; // 50MB
    const updatedFiles = [...files];

    newFiles.forEach(file => {
      if (file.size > maxFileSize) {
        alert(`File ${file.name} is too large. Maximum size is 50MB.`);
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
      <label className="block text-sm font-medium text-gray-300 mb-2">Knowledge Base Files (Optional)</label>
      <div
        className={`mt-1 flex flex-col items-center justify-center px-6 pt-8 pb-8 border-2 border-dashed rounded-xl transition-all duration-200 cursor-pointer ${
          isDragging 
            ? 'border-indigo-500 bg-indigo-500/10' 
            : 'border-gray-600 hover:border-indigo-500 bg-gray-800/50'
        }`}
        onClick={() => fileInputRef.current.click()}
        onDragEnter={handleDragEnter}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="text-center">
          <FaUpload className={`mx-auto text-2xl mb-3 ${isDragging ? 'text-indigo-400' : 'text-gray-500'}`} />
          <p className={`text-sm ${isDragging ? 'text-indigo-400' : 'text-gray-400'}`}>
            {isDragging ? 'Drop files here' : 'Drag & drop files or click to browse'}
          </p>
          <p className="text-xs text-gray-500 mt-1">Supports: TXT, DOCX, MD (Max 50MB each)</p>
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
          <h4 className="text-sm font-medium text-gray-300 mb-2">Selected files:</h4>
          <ul className="space-y-2">
            {files.map((file, index) => (
              <li key={index} className="flex items-center justify-between p-3 bg-gray-700/50 rounded-lg">
                <div className="flex items-center space-x-3">
                  <div className="p-2 bg-indigo-500/10 rounded-md text-indigo-400">
                    <FaFile className="text-sm" />
                  </div>
                  <span className="text-sm text-white truncate max-w-xs">{file.name}</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemoveFile(file.name)}
                  className="text-gray-400 hover:text-red-400 transition-colors p-1"
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
    model_name: 'gpt-3.5-turbo',
    instructions: '',
    prompt_template: '',
    temperature: 0.7,
    response_timeout: 3,
    rag_files: [],
    collection_name: '',
    is_public: false,
    bot_avatar: 'robot',
    welcome_message: '',
  });
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState({});
  const [fileUploadKey, setFileUploadKey] = useState(Date.now()); // Key to force re-render

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    const val = type === 'checkbox' ? checked : value;
    setConfig(prev => ({ ...prev, [name]: val }));
  };

  const handleFileChange = (files) => {
    setConfig(prev => ({ ...prev, rag_files: files }));
    // Force re-render of file upload component to prevent black screen
    setFileUploadKey(Date.now());
  };

  const handlePromptModeChange = (mode) => {
    setPromptMode(mode);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setErrors({});

    // Basic validation
    const newErrors = {};
    if (!config.bot_name.trim()) newErrors.bot_name = 'Chatbot name is required';
    if (promptMode === 'instructions' && !config.instructions.trim()) {
      newErrors.instructions = 'Instructions are required';
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
      if (file.size > 500 * 1024 * 1024) { // 500MB limit
        setErrors({ form: `File ${file.name} is too large. Maximum size is 100MB.` });
        return;
      }
      formData.append('files', file);
    });

    // if (config.rag_files.length === 0) {
    //   setErrors({ form: 'Please select at least one file to upload.' });
    //   return;
    // }

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
        },
        onUploadProgress: (progressEvent) => {
          const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          console.log(`Upload progress: ${percentCompleted}%`);
        }
      });
      
      navigate(`/chat/${response.data.data._id}`);

    } catch (error) {
      console.error('Config error:', error);
      let errorMessage = 'An unexpected error occurred';
      
      if (error.response) {
        errorMessage = error.response.data.error || errorMessage;
        if (error.response.status === 413) {
          errorMessage = 'File size too large. Maximum size is 10MB.';
        }
      } else if (error.request) {
        errorMessage = 'No response from server. Please check your connection';
      }
      
      setErrors({ form: errorMessage });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 to-gray-800 text-white py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto">
        <div className="text-center mb-10">
          <h1 className="text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 to-purple-500">
            Create Your AI Assistant
          </h1>
          <p className="mt-3 text-gray-400 max-w-lg mx-auto">
            Configure your custom chatbot with personalized instructions and knowledge
          </p>
        </div>

        <div className="bg-gray-800/50 backdrop-blur-lg rounded-xl shadow-xl border border-gray-700/50 p-8">
          {errors.form && (
            <div className="mb-6 p-3 bg-red-900/50 border border-red-700 rounded-lg text-sm flex items-start space-x-2">
              <FaInfoCircle className="text-red-400 mt-0.5 flex-shrink-0" />
              <span>{errors.form}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-8">
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              <div>
                <label htmlFor="bot_name" className="block text-sm font-medium text-gray-300 mb-2">
                  Assistant Name
                </label>
                <input
                  id="bot_name"
                  type="text"
                  name="bot_name"
                  value={config.bot_name}
                  onChange={handleChange}
                  className={`w-full px-4 py-3 text-white bg-gray-700/70 border ${
                    errors.bot_name ? 'border-red-500' : 'border-gray-600/50'
                  } rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500`}
                  placeholder="e.g., Customer Support Bot"
                />
                {errors.bot_name && (
                  <p className="mt-1 text-sm text-red-400">{errors.bot_name}</p>
                )}
              </div>

              <div>
                <label htmlFor="model_name" className="block text-sm font-medium text-gray-300 mb-2">
                  AI Model
                </label>
                <select
                  id="model_name"
                  name="model_name"
                  value={config.model_name}
                  onChange={handleChange}
                  className="w-full px-4 py-3 text-white bg-gray-700/70 border border-gray-600/50 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="deepseek-chat">Deepseek Chat</option>
                  <option value="gpt-3.5-turbo">GPT-3.5 Turbo</option>
                  <option value="gpt-4">GPT-4</option>
                  <option value="gpt-4-turbo">GPT-4 Turbo</option>
                  <option value="gpt-4o">GPT-4o</option>
                  <option value="gpt-4o-mini">GPT-4o Mini</option>
                  <option value="gpt-5">GPT-5</option>
                  <option value="qwen-turbo">Qwen Turbo</option>
                </select>
              </div>
            </div>

            <AvatarSelector 
              selectedAvatar={config.bot_avatar} 
              onSelect={(avatarId) => setConfig(prev => ({ ...prev, bot_avatar: avatarId }))}
            />

            <div>
              <label htmlFor="welcome_message" className="block text-sm font-medium text-gray-300 mb-2">
                Introduction (Optional)
              </label>
              <textarea
                id="welcome_message"
                name="welcome_message"
                value={config.welcome_message}
                onChange={handleChange}
                rows="2"
                className="w-full px-4 py-3 text-white bg-gray-700/70 border border-gray-600/50 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="e.g., You have been paired and can now begin chatting with your partner"
              />
              <p className="mt-1 text-xs text-gray-400">
                Shown at the top of a new chat. Leave blank for no intro.
              </p>
            </div>

            <div className="p-4 bg-gray-700/50 rounded-lg">
              <div className="flex items-center justify-between">
                <div>
                  <label htmlFor="is_public" className="block text-sm font-medium text-gray-300 mb-1">
                    Public Access
                  </label>
                  <p className="text-xs text-gray-400">
                    Allow anyone with the link to chat without logging in
                  </p>
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
                  <div className="w-11 h-6 bg-gray-600 rounded-full peer peer-focus:ring-2 peer-focus:ring-indigo-800 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                </label>
              </div>
            </div>

            <div className="space-y-4">
              <label className="block text-sm font-medium text-gray-300">Configuration Method</label>
              <div className="flex space-x-4">
                <button
                  type="button"
                  onClick={() => handlePromptModeChange('instructions')}
                  className={`px-4 py-2 rounded-lg transition-all ${
                    promptMode === 'instructions'
                      ? 'bg-indigo-600 text-white'
                      : 'bg-gray-700/50 text-gray-300 hover:bg-gray-700'
                  }`}
                >
                  Simple Instructions
                </button>
                <button
                  type="button"
                  onClick={() => handlePromptModeChange('template')}
                  className={`px-4 py-2 rounded-lg transition-all ${
                    promptMode === 'template'
                      ? 'bg-indigo-600 text-white'
                      : 'bg-gray-700/50 text-gray-300 hover:bg-gray-700'
                  }`}
                >
                  Advanced Template
                </button>
              </div>
            </div>

            {promptMode === 'instructions' ? (
              <div>
                <label htmlFor="instructions" className="block text-sm font-medium text-gray-300 mb-2">
                  Behavior Instructions
                </label>
                <textarea
                  id="instructions"
                  name="instructions"
                  value={config.instructions}
                  onChange={handleChange}
                  rows="5"
                  className={`w-full px-4 py-3 text-white bg-gray-700/70 border ${
                    errors.instructions ? 'border-red-500' : 'border-gray-600/50'
                  } rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500`}
                  placeholder="Example: You are a helpful customer support assistant for a tech company. Be polite and professional in your responses."
                />
                {errors.instructions && (
                  <p className="mt-1 text-sm text-red-400">{errors.instructions}</p>
                )}
              </div>
            ) : (
              <div>
                <label htmlFor="prompt_template" className="block text-sm font-medium text-gray-300 mb-2">
                  Prompt Template
                </label>
                <textarea
                  id="prompt_template"
                  name="prompt_template"
                  value={config.prompt_template}
                  onChange={handleChange}
                  rows="5"
                  className="w-full px-4 py-3 text-white bg-gray-700/70 border border-gray-600/50 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder={`Example template:\nYou are an expert in \\{topic\\}. Given the following context:\n\n\\{context\\}\n\nAnswer this question: \\{query\\}\n\nAnswer in a professional tone.`}
                />
                {errors.prompt_template && (
                  <p className="mt-1 text-sm text-red-400">{errors.prompt_template}</p>
                )}
                <p className="mt-2 text-xs text-gray-400">
                  Use placeholders like {'{context}'} and {'{query}'} that will be replaced during runtime
                </p>
              </div>
            )}

            <div>
              <label htmlFor="temperature" className="block text-sm font-medium text-gray-300 mb-2">
                Temperature
                <span className="text-xs text-gray-400 ml-2">
                  ({config.temperature < 0.3 ? 'Precise' : config.temperature < 0.7 ? 'Balanced' : 'Creative'})
                </span>
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
                className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
              />
              <div className="flex justify-between text-xs text-gray-400 mt-1">
                <span>Precise</span>
                <span>Balanced</span>
                <span>Creative</span>
              </div>
            </div>

            <div>
              <label htmlFor="response_timeout" className="block text-sm font-medium text-gray-300 mb-2">
                Response Timeout
                <span className="text-xs text-gray-400 ml-2">
                  ({config.response_timeout} second{config.response_timeout !== 1 ? 's' : ''})
                </span>
              </label>
              <input
                id="response_timeout"
                type="range"
                name="response_timeout"
                min="1"
                max="10"
                step="1"
                value={config.response_timeout}
                onChange={handleChange}
                className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
              />
              <div className="flex justify-between text-xs text-gray-400 mt-1">
                <span>1s</span>
                <span>5s</span>
                <span>10s</span>
              </div>
            </div>

            <FileUpload 
              key={fileUploadKey} // Force re-render to prevent black screen
              onFileChange={handleFileChange} 
              initialFiles={config.rag_files} 
            />

            <div>
              <label htmlFor="collection_name" className="block text-sm font-medium text-gray-300 mb-2">
                Collection Name
                <span className="text-xs text-gray-400 ml-2">(Optional)</span>
              </label>
              <input
                id="collection_name"
                type="text"
                name="collection_name"
                value={config.collection_name}
                onChange={handleChange}
                className="w-full px-4 py-3 text-white bg-gray-700/70 border border-gray-600/50 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="e.g., company-docs-2024"
              />
              <p className="mt-1 text-xs text-gray-400">
                Name your knowledge base for easy reference. Leave blank to auto-generate.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row items-center gap-4 pt-4">
              <button
                type="button"
                onClick={() => navigate(-1)}
                className="w-full py-3 px-6 rounded-lg font-medium bg-gray-600 hover:bg-gray-700 transition-all active:scale-[0.98]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isLoading}
                className={`w-full py-3 px-6 rounded-lg font-medium flex items-center justify-center space-x-2 transition-all ${
                  isLoading ? 'bg-indigo-700' : 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700'
                } active:scale-[0.98]`}
              >
                {isLoading ? (
                  <div className="flex items-center space-x-2">
                    <div className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-solid border-current border-r-transparent"></div>
                    <span>Saving...</span>
                  </div>
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