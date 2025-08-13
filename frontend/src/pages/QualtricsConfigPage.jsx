import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import apiClient from '../api/apiClient';
import { FaRobot, FaUpload, FaTrash, FaInfoCircle, FaFile, FaChartBar } from 'react-icons/fa';

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
      <label className="block text-sm font-medium text-gray-300 mb-2">Knowledge Base Files</label>
      <div
        className={`mt-1 flex flex-col items-center justify-center px-6 pt-8 pb-8 border-2 border-dashed rounded-xl transition-all duration-200 cursor-pointer ${
          isDragging 
            ? 'border-green-500 bg-green-500/10' 
            : 'border-gray-600 hover:border-green-500 bg-gray-800/50'
        }`}
        onClick={() => fileInputRef.current.click()}
        onDragEnter={handleDragEnter}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="text-center">
          <FaUpload className={`mx-auto text-2xl mb-3 ${isDragging ? 'text-green-400' : 'text-gray-500'}`} />
          <p className={`text-sm ${isDragging ? 'text-green-400' : 'text-gray-400'}`}>
            {isDragging ? 'Drop files here' : 'Drag & drop files or click to browse'}
          </p>
          <p className="text-xs text-gray-500 mt-1">Supports: TXT, PDF, DOCX, MD (Max 50MB each)</p>
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
                  <div className="p-2 bg-green-500/10 rounded-md text-green-400">
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

const QualtricsConfigPage = () => {
  const navigate = useNavigate();
  const [promptMode, setPromptMode] = useState('instructions');
  const [config, setConfig] = useState({
    bot_name: '',
    model_name: 'gpt-3.5-turbo',
    instructions: '',
    prompt_template: '',
    temperature: 0.7,
    rag_files: [],
    collection_name: '',
    is_public: false,
    // Qualtrics-specific fields
    qualtrics_api_token: '',
    qualtrics_datacenter: '',
    qualtrics_user_id: '',
    qualtrics_username: '',
    qualtrics_org_id: ''
  });
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState({});
  const [fileUploadKey, setFileUploadKey] = useState(Date.now());

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setConfig(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
    
    // Clear error when user starts typing
    if (errors[name]) {
      setErrors(prev => ({
        ...prev,
        [name]: ''
      }));
    }
  };

  const handlePromptModeChange = (mode) => {
    setPromptMode(mode);
    // Clear the other field when switching modes
    if (mode === 'instructions') {
      setConfig(prev => ({ ...prev, prompt_template: '' }));
    } else {
      setConfig(prev => ({ ...prev, instructions: '' }));
    }
  };

  const handleFileChange = (files) => {
    setConfig(prev => ({
      ...prev,
      rag_files: files
    }));
  };

  const validateForm = () => {
    const newErrors = {};
    
    if (!config.bot_name.trim()) {
      newErrors.bot_name = 'Assistant name is required';
    }
    
    if (promptMode === 'instructions' && !config.instructions.trim()) {
      newErrors.instructions = 'Instructions are required';
    }
    
    if (promptMode === 'prompt_template' && !config.prompt_template.trim()) {
      newErrors.prompt_template = 'Prompt template is required';
    }

    if (!config.qualtrics_api_token.trim()) {
      newErrors.qualtrics_api_token = 'Qualtrics API token is required';
    }

    if (!config.qualtrics_datacenter.trim()) {
      newErrors.qualtrics_datacenter = 'Qualtrics datacenter is required';
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }

    setIsLoading(true);
    setErrors({});

    try {
      const formData = new FormData();
      
      // Add config data
      const configData = {
        ...config,
        config_type: 'qualtrics'
      };
      
      // Remove rag_files from config data as it will be handled separately
      const { rag_files, ...configWithoutFiles } = configData;
      
      Object.keys(configWithoutFiles).forEach(key => {
        if (configWithoutFiles[key] !== null && configWithoutFiles[key] !== undefined) {
          formData.append(key, configWithoutFiles[key]);
        }
      });

      // Add files
      if (config.rag_files && config.rag_files.length > 0) {
        config.rag_files.forEach(file => {
          formData.append('files', file);
        });
      }

      const response = await apiClient.post('/qualtrics/create-config', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      // Navigate to chat page with the new config (same as normal config)
      navigate(`/chat/${response.data.data._id}`);
    } catch (error) {
      console.error('Error creating assistant:', error);
      setErrors({ 
        submit: error.response?.data?.message || 'Failed to create assistant. Please try again.' 
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        {/* Header */}
        <div className="flex items-center space-x-4 mb-8">
          <div className="flex items-center space-x-3">
            <div className="p-3 bg-green-500/10 rounded-lg text-green-400">
              <FaChartBar className="text-xl" />
            </div>
            <div>
              <h1 className="text-3xl font-bold">Create Qualtrics Assistant</h1>
              <p className="text-gray-400">AI assistant with Qualtrics integration</p>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-8">
          {/* Basic Configuration - Same as normal config */}
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
              className="w-full px-4 py-3 text-white bg-gray-700/70 border border-gray-600/50 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
              placeholder="My Qualtrics Assistant"
              required
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
              className="w-full px-4 py-3 text-white bg-gray-700/70 border border-gray-600/50 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
            >
              <option value="deepseek-chat">Deepseek Chat</option>
              <option value="gpt-3.5-turbo">GPT-3.5 Turbo</option>
              <option value="qwen-turbo">Qwen Turbo</option>
            </select>
          </div>

          {/* Prompt Mode Toggle - Same as normal config */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-3">
              How would you like to configure your assistant?
            </label>
            <div className="flex space-x-1 bg-gray-800/50 p-1 rounded-lg">
              <button
                type="button"
                onClick={() => handlePromptModeChange('instructions')}
                className={`flex-1 px-4 py-2 text-sm font-medium rounded-md transition-all ${
                  promptMode === 'instructions'
                    ? 'bg-green-600 text-white shadow-sm'
                    : 'text-gray-400 hover:text-gray-300'
                }`}
              >
                <div className="flex items-center justify-center space-x-2">
                  <FaInfoCircle />
                  <span>Simple Instructions</span>
                </div>
              </button>
              <button
                type="button"
                onClick={() => handlePromptModeChange('prompt_template')}
                className={`flex-1 px-4 py-2 text-sm font-medium rounded-md transition-all ${
                  promptMode === 'prompt_template'
                    ? 'bg-green-600 text-white shadow-sm'
                    : 'text-gray-400 hover:text-gray-300'
                }`}
              >
                <div className="flex items-center justify-center space-x-2">
                  <FaRobot />
                  <span>Custom Template</span>
                </div>
              </button>
            </div>
          </div>

          {/* Instructions or Template - Same as normal config */}
          {promptMode === 'instructions' ? (
            <div>
              <label htmlFor="instructions" className="block text-sm font-medium text-gray-300 mb-2">
                Instructions
                <span className="text-xs text-gray-400 ml-2">(Tell your assistant how to behave)</span>
              </label>
              <textarea
                id="instructions"
                name="instructions"
                value={config.instructions}
                onChange={handleChange}
                rows="6"
                className="w-full px-4 py-3 text-white bg-gray-700/70 border border-gray-600/50 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                placeholder="You are a helpful Qualtrics-integrated assistant. Answer questions based on the provided context and help users with survey-related tasks..."
              />
              {errors.instructions && (
                <p className="mt-1 text-sm text-red-400">{errors.instructions}</p>
              )}
            </div>
          ) : (
            <div>
              <label htmlFor="prompt_template" className="block text-sm font-medium text-gray-300 mb-2">
                Custom Prompt Template
                <span className="text-xs text-gray-400 ml-2">(Advanced users only)</span>
              </label>
              <textarea
                id="prompt_template"
                name="prompt_template"
                value={config.prompt_template}
                onChange={handleChange}
                rows="8"
                className="w-full px-4 py-3 text-white bg-gray-700/70 border border-gray-600/50 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 font-mono text-sm"
                placeholder="You are a helpful Qualtrics-integrated AI assistant named '{bot_name}'.&#10;&#10;Based on the context below, please answer the user's question. If the context doesn't contain the answer, say so.&#10;&#10;Context: {context}&#10;Question: {question}&#10;Answer:"
              />
              {errors.prompt_template && (
                <p className="mt-1 text-sm text-red-400">{errors.prompt_template}</p>
              )}
              <p className="mt-2 text-xs text-gray-400">
                Use placeholders like {'{context}'} and {'{question}'} that will be replaced during runtime
              </p>
            </div>
          )}

          {/* Temperature - Same as normal config */}
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
              className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-green-500"
            />
            <div className="flex justify-between text-xs text-gray-400 mt-1">
              <span>Precise</span>
              <span>Balanced</span>
              <span>Creative</span>
            </div>
          </div>

          {/* File Upload - Same as normal config */}
          <FileUpload 
            key={fileUploadKey}
            onFileChange={handleFileChange} 
            initialFiles={config.rag_files} 
          />

          {/* Collection Name - Same as normal config */}
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
              className="w-full px-4 py-3 text-white bg-gray-700/70 border border-gray-600/50 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
              placeholder="e.g., qualtrics-surveys-2024"
            />
            <p className="mt-1 text-xs text-gray-400">
              Name your knowledge base for easy reference. Leave blank to auto-generate.
            </p>
          </div>

          {/* Public/Private Toggle - Same as normal config */}
          <div>
            <label className="flex items-center space-x-3 cursor-pointer">
              <input
                type="checkbox"
                name="is_public"
                checked={config.is_public}
                onChange={handleChange}
                className="w-4 h-4 text-green-600 bg-gray-700 border-gray-600 rounded focus:ring-green-500 focus:ring-2"
              />
              <span className="text-sm font-medium text-gray-300">
                Make this assistant publicly accessible
              </span>
            </label>
            <p className="mt-1 text-xs text-gray-400 ml-7">
              Public assistants can be accessed without login via direct links
            </p>
          </div>

          {/* Qualtrics Configuration Section */}
          <div className="bg-gray-800/30 p-6 rounded-xl border border-green-500/20">
            <h3 className="text-lg font-semibold text-green-400 mb-4 flex items-center space-x-2">
              <FaChartBar />
              <span>Qualtrics Integration</span>
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="qualtrics_api_token" className="block text-sm font-medium text-gray-300 mb-2">
                  API Token *
                </label>
                <input
                  id="qualtrics_api_token"
                  type="password"
                  name="qualtrics_api_token"
                  value={config.qualtrics_api_token}
                  onChange={handleChange}
                  required
                  className="w-full px-4 py-3 text-white bg-gray-700/70 border border-gray-600/50 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                  placeholder="Your Qualtrics API Token"
                />
              </div>

              <div>
                <label htmlFor="qualtrics_datacenter" className="block text-sm font-medium text-gray-300 mb-2">
                  Datacenter *
                </label>
                <input
                  id="qualtrics_datacenter"
                  type="text"
                  name="qualtrics_datacenter"
                  value={config.qualtrics_datacenter}
                  onChange={handleChange}
                  required
                  className="w-full px-4 py-3 text-white bg-gray-700/70 border border-gray-600/50 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                  placeholder="e.g., pdx1, ca1, eu"
                />
              </div>

              <div>
                <label htmlFor="qualtrics_survey_id" className="block text-sm font-medium text-gray-300 mb-2">
                  Survey ID *
                </label>
                <input
                  id="qualtrics_survey_id"
                  type="text"
                  name="qualtrics_survey_id"
                  value={config.qualtrics_survey_id}
                  onChange={handleChange}
                  required
                  className="w-full px-4 py-3 text-white bg-gray-700/70 border border-gray-600/50 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                  placeholder="e.g., SV_abc123xyz"
                />
              </div>

              <div>
                <label htmlFor="qualtrics_user_id" className="block text-sm font-medium text-gray-300 mb-2">
                  User ID
                  <span className="text-xs text-gray-400 ml-2">(Optional)</span>
                </label>
                <input
                  id="qualtrics_user_id"
                  type="text"
                  name="qualtrics_user_id"
                  value={config.qualtrics_user_id}
                  onChange={handleChange}
                  className="w-full px-4 py-3 text-white bg-gray-700/70 border border-gray-600/50 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                  placeholder="Your Qualtrics User ID"
                />
              </div>

              <div>
                <label htmlFor="qualtrics_username" className="block text-sm font-medium text-gray-300 mb-2">
                  Username
                  <span className="text-xs text-gray-400 ml-2">(Optional)</span>
                </label>
                <input
                  id="qualtrics_username"
                  type="text"
                  name="qualtrics_username"
                  value={config.qualtrics_username}
                  onChange={handleChange}
                  className="w-full px-4 py-3 text-white bg-gray-700/70 border border-gray-600/50 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                  placeholder="Your Qualtrics Username"
                />
              </div>

              <div className="md:col-span-2">
                <label htmlFor="qualtrics_org_id" className="block text-sm font-medium text-gray-300 mb-2">
                  Organization ID
                  <span className="text-xs text-gray-400 ml-2">(Optional)</span>
                </label>
                <input
                  id="qualtrics_org_id"
                  type="text"
                  name="qualtrics_org_id"
                  value={config.qualtrics_org_id}
                  onChange={handleChange}
                  className="w-full px-4 py-3 text-white bg-gray-700/70 border border-gray-600/50 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                  placeholder="Your Qualtrics Organization ID"
                />
              </div>
            </div>
          </div>

          {/* Error Messages */}
          {errors.submit && (
            <div className="bg-red-900/30 border border-red-800/50 p-4 rounded-lg">
              <p className="text-red-200">{errors.submit}</p>
            </div>
          )}

          {/* Submit Buttons - Same as normal config */}
          <div className="flex flex-col sm:flex-row items-center gap-4 pt-4">
            <button
              type="button"
              onClick={() => navigate('/config_list')}
              className="w-full py-3 px-6 rounded-lg font-medium bg-gray-600 hover:bg-gray-700 transition-all active:scale-[0.98]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className={`w-full py-3 px-6 rounded-lg font-medium flex items-center justify-center space-x-2 transition-all ${
                isLoading ? 'bg-green-700' : 'bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800'
              } active:scale-[0.98]`}
            >
              {isLoading ? (
                <div className="flex items-center space-x-2">
                  <div className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-solid border-current border-r-transparent"></div>
                  <span>Creating...</span>
                </div>
              ) : (
                <>
                  <span>Save & Start Chatting</span>
                  <FaChartBar className="text-sm" />
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default QualtricsConfigPage;
