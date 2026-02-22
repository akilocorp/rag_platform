import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import apiClient from '../api/apiClient'; // Adjust the import path if needed
import AvatarSelector from '../components/AvatarSelector';
import { FaInfoCircle } from 'react-icons/fa';
import logo from '../assets/logo.png';

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

  // Effect to handle cases where the user navigates directly to the page without a config.
  useEffect(() => {
    const configFromState = location.state?.config;
    if (!configFromState) {
      console.error('No config received in state');
      navigate('/config_list', { state: { error: 'No configuration selected to edit.' } });
      return;
    }

    // Set initial state from the passed-in config
    setConfig(configFromState);
    setInitialDocuments(configFromState.documents || []);
    setPromptMode(configFromState.prompt_template ? 'template' : 'instructions');
  }, [location.state, navigate]);

  const showNotificationMessage = (message) => {
    setNotificationMessage(message);
    setShowNotification(true);
    setTimeout(() => {
      setShowNotification(false);
      setNotificationMessage('');
    }, 3000);
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    const val = type === 'checkbox' ? checked : value;
    setConfig(prev => ({ ...prev, [name]: val }));
  };

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

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    // Perform validation first
    const newErrors = {};
    if (!config.bot_name?.trim()) newErrors.bot_name = 'Chatbot name is required';
    if (!config.model_name?.trim()) newErrors.model_name = 'Model name is required';
    if (promptMode === 'instructions' && !config.instructions?.trim()) {
      newErrors.instructions = 'Instructions are required';
    }
    if (promptMode === 'template' && !config.prompt_template?.trim()) {
      newErrors.prompt_template = 'Prompt template is required';
    }

    // If there are any errors, update the state and stop the submission
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setIsLoading(true);
    setErrors({}); // Clear any old errors

    try {
      const formData = new FormData();
      Object.entries(config).forEach(([key, value]) => {
        if (key !== 'documents' && key !== 'files') {
          formData.append(key, value);
        }
      });

      newFiles.forEach(file => {
        formData.append('files', file);
      });

      const filesToDelete = initialDocuments.filter(doc => !config.documents.includes(doc));
      formData.append('files_to_delete', JSON.stringify(filesToDelete));

      await apiClient.put(`/config/${config.config_id}`, formData);

      navigate('/config_list', { state: { refresh: true, message: 'Assistant updated successfully.' } });
    } catch (error) {
      console.error('Error updating configuration:', error);
      const errorMessage = error.response?.data?.error || 'Failed to update configuration. Please try again.';
      setErrors({ form: errorMessage });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = () => {
    setShowConfirmModal(true);
  };

  const confirmDelete = async () => {
    setShowConfirmModal(false);
    setIsDeleting(true);
    try {
      if (!config.config_id) {
        throw new Error('No valid ID found');
      }

      await apiClient.delete(`/config/${config.config_id}`);
      
      navigate('/config_list', { state: { refresh: true, message: 'Assistant deleted successfully.' } });
    } catch (error) {
      console.error('Error deleting configuration:', error);
      const errorMessage = error.response?.data?.error || 'Failed to delete configuration.';
      setErrors({ form: errorMessage });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }} className="min-h-screen bg-[#F0F6FB] text-gray-900 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto">
        
        <div className="text-center mb-10">
          <h1 className="text-4xl font-bold text-[#222] tracking-tight">
            Edit AI Assistant
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
            
            {/* Chatbot Name and Model - Grid Layout */}
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              <div>
                <label htmlFor="bot_name" className="block text-[13px] font-semibold text-gray-700 mb-1.5">Assistant Name</label>
                <input
                  type="text"
                  id="bot_name"
                  name="bot_name"
                  value={config.bot_name || ''}
                  onChange={handleChange}
                  className={`w-full px-4 py-3 bg-white border ${
                    errors.bot_name ? 'border-red-500' : 'border-gray-200'
                  } rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F9D0C4] focus:border-[#FA6C43] transition-all`}
                  placeholder="My Awesome Assistant"
                />
                {errors.bot_name && <p className="mt-1.5 text-xs font-medium text-red-500">{errors.bot_name}</p>}
              </div>

              <div>
                <label htmlFor="model_name" className="block text-[13px] font-semibold text-gray-700 mb-1.5">Model Name</label>
                <select
                  id="model_name"
                  name="model_name"
                  value={config.model_name || ''}
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
                {errors.model_name && <p className="mt-1.5 text-xs font-medium text-red-500">{errors.model_name}</p>}
              </div>
            </div>

            {/* Bot Avatar Selection (UI Icon) */}
            <div className="pt-2">
              <AvatarSelector 
                selectedAvatar={config.bot_avatar || 'robot'} 
                onSelect={(avatarId) => setConfig(prev => ({ ...prev, bot_avatar: avatarId }))}
              />
            </div>

            {/* Introduction */}
            <div>
              <label htmlFor="introduction" className="block text-[13px] font-semibold text-gray-700 mb-1.5">
                Introduction
                <span className="text-gray-400 font-normal ml-1">(Optional)</span>
              </label>
              <textarea
                id="introduction"
                name="introduction"
                value={config.introduction || ''}
                onChange={handleChange}
                rows="2"
                className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F9D0C4] focus:border-[#FA6C43] transition-all"
                placeholder="e.g., You have been paired and can now begin chatting with your partner"
              />
              <p className="mt-2 text-xs font-medium text-gray-500">
                Custom introduction message shown when starting a new chat. Leave blank to show no message.
              </p>
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
                    checked={!!config.is_public}
                    onChange={handleChange}
                  />
                  <div className="w-11 h-6 bg-gray-200 rounded-full peer peer-focus:ring-2 peer-focus:ring-[#F9D0C4] peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#FA6C43]"></div>
                </label>
              </div>
            </div>

            {/* Prompt Mode Selection */}
            <div className="space-y-4 border-t border-gray-100 pt-8 mt-8">
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

              {promptMode === 'instructions' ? (
                <div>
                  <textarea
                    name="instructions"
                    value={config.instructions || ''}
                    onChange={handleChange}
                    rows="5"
                    className={`w-full px-4 py-3 mt-2 bg-white border ${
                      errors.instructions ? 'border-red-500' : 'border-gray-200'
                    } rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F9D0C4] focus:border-[#FA6C43] transition-all`}
                    placeholder="Enter instructions for the bot..."
                  />
                  {errors.instructions && <p className="mt-1.5 text-xs font-medium text-red-500">{errors.instructions}</p>}
                </div>
              ) : (
                <div>
                  <textarea
                    name="prompt_template"
                    value={config.prompt_template || ''}
                    onChange={handleChange}
                    rows="5"
                    className={`w-full px-4 py-3 mt-2 bg-white border ${
                      errors.prompt_template ? 'border-red-500' : 'border-gray-200'
                    } rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F9D0C4] focus:border-[#FA6C43] transition-all`}
                    placeholder="Enter prompt template..."
                  />
                  {errors.prompt_template && <p className="mt-1.5 text-xs font-medium text-red-500">{errors.prompt_template}</p>}
                </div>
              )}
            </div>

            {/* Sliders: Temperature & Timeout */}
            <div className="grid grid-cols-1 gap-8 sm:grid-cols-2">
              <div>
                <label htmlFor="temperature" className="block text-[13px] font-semibold text-gray-700 mb-3">
                  Temperature
                  <span className="text-gray-500 ml-1 font-medium">
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
                  value={config.temperature || 0.7}
                  onChange={handleChange}
                  className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-[#FA6C43]"
                />
              </div>

              <div>
                <label htmlFor="response_timeout" className="block text-[13px] font-semibold text-gray-700 mb-3">
                  Response Timeout
                  <span className="text-gray-500 ml-1 font-medium">
                    ({config.response_timeout || 3} second{(config.response_timeout || 3) !== 1 ? 's' : ''})
                  </span>
                </label>
                <input
                  id="response_timeout"
                  type="range"
                  name="response_timeout"
                  min="1"
                  max="10"
                  step="1"
                  value={config.response_timeout || 3}
                  onChange={handleChange}
                  className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-[#FA6C43]"
                />
              </div>
            </div>

            {/* Collection Name */}
            <div>
              <label htmlFor="collection_name" className="block text-[13px] font-semibold text-gray-700 mb-1.5">Collection Name</label>
              <input
                type="text"
                id="collection_name"
                name="collection_name"
                value={config.collection_name || ''}
                onChange={handleChange}
                className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F9D0C4] focus:border-[#FA6C43] transition-all"
                placeholder="e.g., company-docs-2024"
              />
            </div>

            {/* File Management */}
            <div className="border-t border-gray-100 pt-8 mt-8">
              <label className="block text-[13px] font-semibold text-gray-700 mb-2">Knowledge Base Files</label>

              {/* Display existing files from the server */}
              {config.documents && config.documents.length > 0 && (
                <div className="mt-3 space-y-2">
                  <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Currently Uploaded</h4>
                  <ul className="space-y-2">
                    {config.documents.map((fileName) => (
                      <li key={fileName} className="flex items-center justify-between bg-white border border-gray-100 shadow-sm p-3 rounded-xl">
                        <span className="text-sm font-medium text-gray-700 flex items-center">
                          <div className="p-2 bg-[#F0F6FB] rounded-lg text-blue-500 mr-3">
                             <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                             </svg>
                          </div>
                          {fileName}
                        </span>
                        <div className="flex items-center space-x-2">
                          <button
                            type="button"
                            onClick={() => handleViewDocument(fileName)}
                            className="text-blue-500 hover:text-blue-600 p-2 rounded-lg hover:bg-blue-50 transition-colors"
                            title="View Document"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRemoveDocument(fileName)}
                            className="text-gray-400 hover:text-red-500 p-2 rounded-lg hover:bg-red-50 transition-colors"
                            title="Remove Document"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Display newly added files */}
              {newFiles.length > 0 && (
                <div className="mt-6 space-y-2">
                  <h4 className="text-xs font-bold text-[#FA6C43] uppercase tracking-wider mb-3">Pending Upload</h4>
                  <ul className="space-y-2">
                    {newFiles.map((file) => (
                      <li key={file.name} className="flex items-center justify-between bg-white border border-[#FA6C43]/30 shadow-sm p-3 rounded-xl">
                        <span className="text-sm font-medium text-gray-700 flex items-center">
                           <div className="p-2 bg-[#F9D0C4]/30 rounded-lg text-[#FA6C43] mr-3">
                             <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                             </svg>
                          </div>
                          {file.name}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleRemoveNewFile(file.name)}
                          className="text-gray-400 hover:text-red-500 p-2 rounded-lg hover:bg-red-50 transition-colors"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* File upload area */}
              <label htmlFor="file-upload" className="mt-6 flex flex-col items-center justify-center px-6 pt-8 pb-8 border-2 border-dashed rounded-xl transition-all duration-200 cursor-pointer border-gray-300 hover:border-[#FA6C43]/50 bg-gray-50">
                <div className="text-center">
                  <svg xmlns="http://www.w3.org/2000/svg" className="mx-auto h-8 w-8 text-gray-400 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  <p className="text-sm font-medium text-gray-600">
                    Drag & drop files or click to browse
                  </p>
                  <p className="text-xs text-gray-400 mt-1.5">Supports: TXT, PDF, DOCX, MD (Max 500MB each)</p>
                </div>
                <input
                  id="file-upload"
                  type="file"
                  multiple
                  onChange={handleFileChange}
                  className="hidden"
                  accept=".txt,.pdf,.md,.docx"
                />
              </label>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-col-reverse sm:flex-row sm:justify-between items-center gap-4 pt-8 mt-4 border-t border-gray-100">
              
              {/* Delete Button - aligned left on desktop */}
              <button
                type="button"
                onClick={handleDelete}
                disabled={isDeleting || isLoading}
                className="w-full sm:w-auto flex justify-center items-center py-3.5 px-6 rounded-xl font-bold text-red-600 bg-red-50 hover:bg-red-100 hover:text-red-700 transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed border border-red-200"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                {isDeleting ? 'Deleting...' : 'Delete Assistant'}
              </button>

              {/* Cancel and Save Buttons - grouped on the right */}
              <div className="flex flex-col-reverse sm:flex-row items-center gap-3 w-full sm:w-auto">
                <button
                  type="button"
                  onClick={() => navigate(-1)}
                  className="w-full sm:w-auto flex items-center justify-center py-3.5 px-6 rounded-xl font-bold border-2 border-gray-200 text-gray-700 bg-white hover:bg-gray-50 hover:border-gray-300 transition-all active:scale-[0.98]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isLoading || isDeleting}
                  className={`w-full sm:w-auto flex justify-center items-center py-3.5 px-6 border border-transparent rounded-xl shadow-sm font-bold transition-all active:scale-[0.98] disabled:opacity-50 ${
                    isLoading || isDeleting
                    ? 'bg-[#F9D0C4] text-[#FA6C43] cursor-not-allowed'
                    : 'bg-[#FA6C43] hover:bg-[#E55B34] text-white'
                  }`}
                >
                  {isLoading ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current mr-2"></div>
                      Saving...
                    </>
                  ) : (
                    <>
                      <svg xmlns="http://www.w3.org/2000/svg" className="mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                      </svg>
                      Save Changes
                    </>
                  )}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>

      {/* Delete Confirmation Modal (Also updated styling) */}
      {showConfirmModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-[2rem] shadow-2xl p-8 max-w-sm w-full mx-4 animate-in zoom-in-95 duration-200">
            <h3 className="text-xl font-bold text-[#222] mb-3">Confirm Deletion</h3>
            <p className="text-gray-600 font-medium mb-8 leading-relaxed">
              Are you sure you want to permanently delete <span className="font-bold text-gray-900">{config.bot_name}</span>? This action cannot be undone.
            </p>
            <div className="flex flex-col-reverse sm:flex-row justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowConfirmModal(false)}
                className="w-full sm:w-auto py-3 px-5 rounded-xl font-bold border-2 border-gray-200 text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                className="w-full sm:w-auto py-3 px-5 rounded-xl font-bold text-white bg-red-600 hover:bg-red-700 transition-colors shadow-sm"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {showNotification && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-900 text-white font-medium px-6 py-3 rounded-xl shadow-xl transition-all duration-300 z-50">
          {notificationMessage}
        </div>
      )}
    </div>
  );
};

export default EditConfigPage;