import { FaFile, FaInfoCircle, FaRobot, FaSave, FaTimes, FaTrash, FaUpload } from 'react-icons/fa';
import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import apiClient from '../api/apiClient';

const EditConfigPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [config, setConfig] = useState(() => {
    const configFromState = location.state?.config;
    if (!configFromState) {
      console.error('No config received in state');
      return {
        bot_name: '',
        model_name: '',
        temperature: 0.7,
        is_public: false,
        instructions: '',
        prompt_template: '',
        collection_name: '',
        documents: [],
        config_id: null
      };
    }
    
    // Ensure we have a valid ID
    if (!configFromState.config_id) {
      console.error('Config state has no valid ID');
      return {
        ...configFromState,
        files: configFromState.documents?.map(doc => ({
          name: doc,
          size: 0
        })) || [],
        config_id: null
      };
    }
    
    return {
      ...configFromState,
      files: configFromState.documents?.map(doc => ({
        name: doc,
        size: 0
      })) || []
    };
  });

  const [isLoading, setIsLoading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [errors, setErrors] = useState({});
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [promptMode, setPromptMode] = useState('instructions');

  // Effect to handle cases where the user navigates directly to the page without a config.
  useEffect(() => {
    if (!location.state?.config) {
      navigate('/config_list', { state: { error: 'No configuration selected to edit.' } });
      return;
    }

    // Initialize config with documents from state
    const configFromState = location.state.config;
    setConfig(prev => ({
      ...prev,
      ...configFromState,
      files: configFromState.documents?.map(doc => ({
        name: doc,
        size: 0 // We don't have the actual size here
      })) || []
    }));
  }, [location.state, navigate]);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    const val = type === 'checkbox' ? checked : value;
    setConfig(prev => ({ ...prev, [name]: val }));
  };

  const handleFileChange = (newFiles) => {
    const updatedFiles = [...config.files, ...newFiles];
    const updatedDocuments = updatedFiles.map(f => f.name);

    setConfig(prev => ({
      ...prev,
      files: updatedFiles,
      documents: updatedDocuments
    }));
  };

  const handleRemoveFile = (fileName) => {
    const updatedFiles = config.files.filter(file => file.name !== fileName);
    const updatedDocuments = updatedFiles.map(f => f.name);

    setConfig(prev => ({
      ...prev,
      files: updatedFiles,
      documents: updatedDocuments
    }));
  };

  const handlePromptModeChange = (mode) => {
    setPromptMode(mode);
  };

  const handleSubmit = async (e) => {
    console.log('Current config state:', config); // Debug log
    console.log('ID in config:', config.config_id);
    e.preventDefault();
    setIsLoading(true);
    setErrors({});
    
    try {
      // Basic validation
      const newErrors = {};
      if (!config.bot_name?.trim()) newErrors.bot_name = 'Chatbot name is required';
      if (!config.model_name?.trim()) newErrors.model_name = 'Model name is required';
      if (promptMode === 'instructions' && !config.instructions?.trim()) {
        newErrors.instructions = 'Instructions are required';
      }
      if (promptMode === 'template' && !config.prompt_template?.trim()) {
        newErrors.prompt_template = 'Prompt template is required';
      }

      if (Object.keys(newErrors).length > 0) {
        setErrors(newErrors);
        setIsLoading(false);
        return;
      }

      // Prepare request data
      const requestData = {
        bot_name: config.bot_name || '',
        model_name: config.model_name || '',
        temperature: config.temperature || 0.7,
        is_public: config.is_public || false,
        instructions: config.instructions || '',
        prompt_template: config.prompt_template || '',
        collection_name: config.collection_name || ''
      };

      // Determine if we need to use FormData based on whether files exist
      let configData;
      let configHeaders = {};
      
      if (config.files && config.files.length > 0) {
        const formData = new FormData();
        Object.entries(requestData).forEach(([key, value]) => {
          formData.append(key, value);
        });
        config.files.forEach(file => {
          formData.append('files', file);
        });
        configData = formData;
        configHeaders = {
          'Content-Type': 'multipart/form-data'
        };
      } else {
        configData = requestData;
        configHeaders = {
          'Content-Type': 'application/json'
        };
      }

      // Debug log the ID before making the request
      console.log('Sending PUT request with ID:', config.config_id);
      await apiClient.put(`/config/${config.config_id}`, configData, {
        headers: configHeaders
      });

      // Navigate back to config list with refresh flag
      navigate('/config_list', { state: { refresh: true } });
    } catch (error) {
      console.error('Error updating configuration:', error);
      setErrors({
        form: error.message || 'Failed to update configuration. Please try again.'
      });
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
      // Log the ID to debug
      console.log('Deleting config with ID:', config.config_id);
      
      // Ensure we have a valid ID
      if (!config.config_id) {
        throw new Error('No valid ID found');
      }

      // Use the correct API endpoint
      const response = await apiClient.delete(`/config/${config.config_id}`);
      if (response.status === 200) {
        navigate('/config_list', { state: { refresh: true, message: 'Assistant deleted successfully.' } });
      } else {
        throw new Error('Failed to delete configuration');
      }
    } catch (error) {
      console.error('Error deleting configuration:', error);
      setErrors({ form: 'Failed to delete configuration.' });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 to-gray-800 text-white py-12 px-4 sm:px-6 lg:px-8">
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
              <label className="block text-sm font-medium text-gray-300 mb-2">Chatbot Name</label>
              <input
                type="text"
                name="bot_name"
                value={config.bot_name}
                onChange={handleChange}
                className="w-full px-4 py-2 bg-gray-700/50 border border-gray-600 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                placeholder="My Awesome Assistant"
              />
              {errors.bot_name && <p className="mt-1 text-sm text-red-400">{errors.bot_name}</p>}
            </div>

            {/* Model Name */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Model Name</label>
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
              {errors.model_name && <p className="mt-1 text-sm text-red-400">{errors.model_name}</p>}
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
                  checked={config.is_public}
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
                  value={config.instructions}
                  onChange={handleChange}
                  rows="4"
                  className="w-full px-4 py-2 mt-2 bg-gray-700/50 border border-gray-600 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  placeholder="Enter instructions for the bot..."
                />
              )}

              {promptMode === 'template' && (
                <textarea
                  name="prompt_template"
                  value={config.prompt_template}
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
              <label className="block text-sm font-medium text-gray-300 mb-2">Collection Name</label>
              <input
                type="text"
                name="collection_name"
                value={config.collection_name}
                onChange={handleChange}
                className="w-full px-4 py-2 bg-gray-700/50 border border-gray-600 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                placeholder="Enter collection name"
              />
            </div>

            {/* File Upload */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Knowledge Base Files</label>
              
              {/* Display existing files */}
              {config.documents && config.documents.length > 0 && (
                <div className="mt-4 space-y-2">
                  
                  <ul className="space-y-2">
                    {config.documents.map((fileName) => (
                      <li key={fileName} className="flex items-center justify-between bg-gray-700/50 p-2 rounded-md">
                        <span className="text-sm text-gray-300">{fileName}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveFile(fileName)}
                          className="text-red-400 hover:text-red-500"
                        >
                          <FaTrash className="text-sm" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* File upload area */}
              <div className="mt-4 flex flex-col items-center justify-center px-6 pt-8 pb-8 border-2 border-dashed rounded-xl transition-all duration-200 cursor-pointer hover:border-indigo-500 bg-gray-800/50">
                <div className="text-center">
                  <FaUpload className="mx-auto text-2xl mb-3 text-gray-500" />
                  <p className="text-xs text-gray-400">
                    Drag & drop files or click to browse
                  </p>
                  <p className="text-xs text-gray-500 mt-1">Supports: TXT, PDF, DOCX, MD (Max 10MB each)</p>
                </div>
                <input
                  type="file"
                  multiple
                  onChange={(e) => handleFileChange(Array.from(e.target.files))}
                  className="hidden"
                  accept=".txt,.pdf,.md,.docx"
                />
              </div>
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
                <FaTrash className="mr-2" />
                {isDeleting ? 'Deleting...' : 'Delete'}
              </button>

              {/* Cancel and Save Buttons - grouped on the right */}
              <div className="flex flex-col-reverse sm:flex-row items-center gap-4 w-full sm:w-auto">
                <button
                  type="button"
                  onClick={() => navigate(-1)}
                  className="w-full sm:w-auto flex items-center justify-center py-3 px-6 rounded-lg font-medium bg-gray-600 hover:bg-gray-700 transition-all active:scale-[0.98]"
                >
                  <FaTimes className="mr-2" />
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
                      <FaSave className="mr-2" />
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
                onClick={() => setShowConfirmModal(false)}
                className="py-2 px-4 rounded-lg font-medium bg-gray-600 hover:bg-gray-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                className="py-2 px-4 rounded-lg font-medium text-white bg-red-600 hover:bg-red-700 transition-colors"
              >
                Confirm Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default EditConfigPage;