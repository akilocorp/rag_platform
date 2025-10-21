import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import apiClient from '../api/apiClient'; // Adjust the import path if needed
import AvatarSelector from '../components/AvatarSelector';

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

      // **USE REAL API CLIENT TO SEND THE PUT REQUEST**
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

      // **USE REAL API CLIENT TO SEND THE DELETE REQUEST**
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
    <div className="min-h-screen bg-gradient-to-br from-gray-900 to-gray-800 text-white py-12 px-4 sm:px-6 lg:px-8 font-sans">
      <div className="max-w-3xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-3xl sm:text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 to-purple-500">
            Edit AI Assistant
          </h1>
        </div>

        <div className="bg-gray-800/50 backdrop-blur-lg rounded-xl shadow-xl border border-gray-700/50 p-4 sm:p-8">
          {errors.form && (
            <div className="mb-6 p-4 bg-red-900/50 rounded-xl border border-red-700/50">
              <p className="text-red-400">{errors.form}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-8">
            {/* Chatbot Name */}
            <div>
              <label htmlFor="bot_name" className="block text-sm font-medium text-gray-300 mb-2">Chatbot Name</label>
              <input
                type="text"
                id="bot_name"
                name="bot_name"
                value={config.bot_name || ''}
                onChange={handleChange}
                className="w-full px-4 py-2 bg-gray-700/50 border border-gray-600 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                placeholder="My Awesome Assistant"
              />
              {errors.bot_name && <p className="mt-1 text-sm text-red-400">{errors.bot_name}</p>}
            </div>

            {/* Model Name */}
            <div>
              <label htmlFor="model_name" className="block text-sm font-medium text-gray-300 mb-2">Model Name</label>
              <select
                id="model_name"
                name="model_name"
                value={config.model_name || ''}
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
              {errors.model_name && <p className="mt-1 text-sm text-red-400">{errors.model_name}</p>}
            </div>

            {/* Bot Avatar Selection */}
            <AvatarSelector 
              selectedAvatar={config.bot_avatar || 'robot'} 
              onSelect={(avatarId) => setConfig(prev => ({ ...prev, bot_avatar: avatarId }))}
            />

            {/* Introduction */}
            <div>
              <label htmlFor="introduction" className="block text-sm font-medium text-gray-300 mb-2">
                Introduction
                <span className="text-xs text-gray-400 ml-2">(Optional)</span>
              </label>
              <textarea
                id="introduction"
                name="introduction"
                value={config.introduction || ''}
                onChange={handleChange}
                rows="2"
                className="w-full px-4 py-3 text-white bg-gray-700/70 border border-gray-600/50 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="e.g., You have been paired and can now begin chatting with your partner"
              />
              <p className="mt-1 text-xs text-gray-400">
                Custom introduction message shown when starting a new chat. Leave blank to show no message.
              </p>
            </div>

            {/* Public Access Toggle */}
            <div className="flex items-center justify-between p-4 bg-gray-800/50 rounded-lg">
              <div>
                <label htmlFor="is_public" className="block text-sm font-medium text-gray-300 mb-1">
                  Public Access
                </label>
                <p className="text-xs text-gray-400 max-w-xs">
                  Allow anyone with the link to chat without logging in.
                </p>
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
                <div className="w-11 h-6 bg-gray-600 rounded-full peer peer-focus:ring-2 peer-focus:ring-indigo-500 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
              </label>
            </div>

            {/* Temperature */}
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
                value={config.temperature || 0.7}
                onChange={handleChange}
                className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
              />
              <div className="flex justify-between text-xs text-gray-400 mt-1">
                <span>Precise</span>
                <span>Balanced</span>
                <span>Creative</span>
              </div>
            </div>

            {/* Response Timeout */}
            <div>
              <label htmlFor="response_timeout" className="block text-sm font-medium text-gray-300 mb-2">
                Response Timeout
                <span className="text-xs text-gray-400 ml-2">
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
                className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
              />
              <div className="flex justify-between text-xs text-gray-400 mt-1">
                <span>1s</span>
                <span>5s</span>
                <span>10s</span>
              </div>
            </div>

            {/* Prompt Mode Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Prompt Mode</label>
              <div className="flex space-x-4">
                <label className="flex items-center space-x-2">
                  <input
                    type="radio"
                    name="prompt_mode"
                    value="instructions"
                    checked={promptMode === 'instructions'}
                    onChange={() => handlePromptModeChange('instructions')}
                    className="w-4 h-4 text-indigo-500 bg-gray-700 border-gray-600 rounded focus:ring-indigo-500"
                  />
                  <span className="text-sm text-gray-300">Instructions</span>
                </label>
                <label className="flex items-center space-x-2">
                  <input
                    type="radio"
                    name="prompt_mode"
                    value="template"
                    checked={promptMode === 'template'}
                    onChange={() => handlePromptModeChange('template')}
                    className="w-4 h-4 text-indigo-500 bg-gray-700 border-gray-600 rounded focus:ring-indigo-500"
                  />
                  <span className="text-sm text-gray-300">Prompt Template</span>
                </label>
              </div>

              {promptMode === 'instructions' && (
                <textarea
                  name="instructions"
                  value={config.instructions || ''}
                  onChange={handleChange}
                  rows="4"
                  className="w-full px-4 py-2 mt-2 bg-gray-700/50 border border-gray-600 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  placeholder="Enter instructions for the bot..."
                />
              )}

              {promptMode === 'template' && (
                <textarea
                  name="prompt_template"
                  value={config.prompt_template || ''}
                  onChange={handleChange}
                  rows="4"
                  className="w-full px-4 py-2 mt-2 bg-gray-700/50 border border-gray-600 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  placeholder="Enter prompt template..."
                />
              )}

              {promptMode === 'instructions' && errors.instructions && (
                <p className="mt-1 text-sm text-red-400">{errors.instructions}</p>
              )}
              {promptMode === 'template' && errors.prompt_template && (
                <p className="mt-1 text-sm text-red-400">{errors.prompt_template}</p>
              )}
            </div>

            {/* Collection Name */}
            <div>
              <label htmlFor="collection_name" className="block text-sm font-medium text-gray-300 mb-2">Collection Name</label>
              <input
                type="text"
                id="collection_name"
                name="collection_name"
                value={config.collection_name || ''}
                onChange={handleChange}
                className="w-full px-4 py-2 bg-gray-700/50 border border-gray-600 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                placeholder="Enter collection name"
              />
            </div>

            {/* File Management */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Knowledge Base Files</label>

              {/* Display existing files from the server */}
              {config.documents && config.documents.length > 0 && (
                <div className="mt-4 space-y-2">
                  <ul className="space-y-2">
                    {config.documents.map((fileName) => (
                      <li key={fileName} className="flex items-center justify-between bg-gray-700/50 p-2 rounded-md">
                        <span className="text-sm text-gray-300 flex items-center">
                          <svg xmlns="http://www.w3.org/2000/svg" className="mr-2 h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                          {fileName}
                        </span>
                        <div className="flex items-center space-x-2">
                          <button
                            type="button"
                            onClick={() => handleViewDocument(fileName)}
                            className="text-indigo-400 hover:text-indigo-500"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRemoveDocument(fileName)}
                            className="text-red-400 hover:text-red-500"
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
                <div className="mt-4 space-y-2">
                  <h4 className="text-sm font-medium text-gray-400">Files to Upload:</h4>
                  <ul className="space-y-2">
                    {newFiles.map((file) => (
                      <li key={file.name} className="flex items-center justify-between bg-gray-700/50 p-2 rounded-md">
                        <span className="text-sm text-gray-300 flex items-center">
                          <svg xmlns="http://www.w3.org/2000/svg" className="mr-2 h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                          {file.name}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleRemoveNewFile(file.name)}
                          className="text-red-400 hover:text-red-500"
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
              <label htmlFor="file-upload" className="mt-4 flex flex-col items-center justify-center px-6 pt-8 pb-8 border-2 border-dashed rounded-xl transition-all duration-200 cursor-pointer hover:border-indigo-500 bg-gray-800/50">
                <div className="text-center">
                  <svg xmlns="http://www.w3.org/2000/svg" className="mx-auto h-8 w-8 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  <p className="text-xs text-gray-400">
                    Drag & drop files or click to browse
                  </p>
                  <p className="text-xs text-gray-500 mt-1">Supports: TXT, PDF, DOCX, MD (Max 500MB each)</p>
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
            <div className="flex flex-col-reverse sm:flex-row sm:justify-between items-center gap-4 pt-4">
              {/* Delete Button - aligned left on desktop */}
              <button
                type="button"
                onClick={handleDelete}
                disabled={isDeleting || isLoading}
                className="w-full sm:w-auto flex justify-center items-center py-3 px-6 rounded-lg font-medium text-white bg-red-600 hover:bg-red-700 transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                {isDeleting ? 'Deleting...' : 'Delete'}
              </button>

              {/* Cancel and Save Buttons - grouped on the right */}
              <div className="flex flex-col-reverse sm:flex-row items-center gap-4 w-full sm:w-auto">
                <button
                  type="button"
                  onClick={() => navigate(-1)}
                  className="w-full sm:w-auto flex items-center justify-center py-3 px-6 rounded-lg font-medium bg-gray-600 hover:bg-gray-700 transition-all active:scale-[0.98]"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isLoading || isDeleting}
                  className="w-full sm:w-auto flex justify-center items-center py-3 px-6 border border-transparent rounded-lg shadow-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-all active:scale-[0.98] disabled:opacity-50"
                >
                  {isLoading ? (
                    <>
                      <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
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

      {showConfirmModal && (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg shadow-xl p-8 max-w-sm w-full mx-4">
            <h3 className="text-xl font-bold text-white mb-4">Confirm Deletion</h3>
            <p className="text-gray-300 mb-6">Are you sure you want to permanently delete this assistant? This action cannot be undone.</p>
            <div className="flex justify-end gap-4">
              <button
                type="button"
                onClick={() => setShowConfirmModal(false)}
                className="py-2 px-4 rounded-lg font-medium bg-gray-600 hover:bg-gray-700 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                className="py-2 px-4 rounded-lg font-medium text-white bg-red-600 hover:bg-red-700 transition-colors"
              >
                Confirm Delete
              </button>
            </div>
          </div>
        </div>
      )}
      {showNotification && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-gray-900 text-white px-6 py-3 rounded-xl shadow-lg transition-all duration-300 z-50">
          {notificationMessage}
        </div>
      )}
    </div>
  );
};

export default EditConfigPage;