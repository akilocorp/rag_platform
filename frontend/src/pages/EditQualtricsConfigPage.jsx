import { FaFile, FaInfoCircle, FaChartBar, FaSave, FaTimes, FaTrash, FaUpload } from 'react-icons/fa';
import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import apiClient from '../api/apiClient';

const EditQualtricsConfigPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [config, setConfig] = useState(() => {
    const configFromState = location.state?.config;
    console.log('EditQualtricsConfigPage - Received config from state:', configFromState);
    
    if (!configFromState) {
      console.error('No Qualtrics config received in state');
      return {
        bot_name: '',
        model_name: '',
        temperature: 0.7,
        is_public: false,
        instructions: '',
        prompt_template: '',
        collection_name: '',
        documents: [],
        config_id: null,
        qualtrics_config: {
          api_token: '',
          datacenter: '',
          survey_id: '',
          user_id: '',
          username: '',
          org_id: ''
        }
      };
    }
    
    // Ensure we have a valid ID (same pattern as normal EditConfigPage)
    if (!configFromState.config_id) {
      console.error('Qualtrics config state has no valid ID');
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
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isAdvancedMode, setIsAdvancedMode] = useState(false);

  // Check if we have a valid config (same pattern as normal EditConfigPage)
  useEffect(() => {
    if (!config.config_id) {
      console.error('No valid Qualtrics config ID found, redirecting...');
      navigate('/config_list');
    }
  }, [config.config_id, navigate]);

  const handleInputChange = (e) => {
    const { name, value, type, checked } = e.target;
    
    if (name.startsWith('qualtrics_')) {
      const qualtricsField = name.replace('qualtrics_', '');
      setConfig(prev => ({
        ...prev,
        qualtrics_config: {
          ...prev.qualtrics_config,
          [qualtricsField]: value
        }
      }));
    } else {
      setConfig(prev => ({
        ...prev,
        [name]: type === 'checkbox' ? checked : value
      }));
    }
  };

  const handleFileChange = (e) => {
    const selectedFiles = Array.from(e.target.files);
    setConfig(prev => ({
      ...prev,
      files: selectedFiles
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const formData = new FormData();
      
      // Add basic config fields
      formData.append('bot_name', config.bot_name);
      formData.append('model_name', config.model_name);
      formData.append('temperature', config.temperature.toString());
      formData.append('is_public', config.is_public.toString());
      formData.append('instructions', config.instructions || '');
      formData.append('prompt_template', config.prompt_template || '');
      formData.append('collection_name', config.collection_name || '');

      // Add Qualtrics-specific fields
      if (config.qualtrics_config.api_token) {
        formData.append('api_token', config.qualtrics_config.api_token);
      }
      if (config.qualtrics_config.datacenter) {
        formData.append('datacenter', config.qualtrics_config.datacenter);
      }
      if (config.qualtrics_config.survey_id) {
        formData.append('survey_id', config.qualtrics_config.survey_id);
      }
      if (config.qualtrics_config.user_id) {
        formData.append('user_id_qualtrics', config.qualtrics_config.user_id);
      }
      if (config.qualtrics_config.username) {
        formData.append('username', config.qualtrics_config.username);
      }
      if (config.qualtrics_config.org_id) {
        formData.append('org_id', config.qualtrics_config.org_id);
      }

      // Add files if any
      if (config.files && config.files.length > 0) {
        config.files.forEach(file => {
          formData.append('files', file);
        });
      }

      const response = await apiClient.put(`/qualtrics/config/${config.config_id}`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      if (response.status === 200) {
        alert('Qualtrics configuration updated successfully!');
        navigate('/config_list');
      }
    } catch (error) {
      console.error('Error updating Qualtrics config:', error);
      alert(error.response?.data?.error || 'Failed to update Qualtrics configuration');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      const response = await apiClient.delete(`/qualtrics/config/${config.config_id}`);
      
      if (response.status === 200) {
        alert('Qualtrics configuration deleted successfully!');
        navigate('/config_list');
      }
    } catch (error) {
      console.error('Error deleting Qualtrics config:', error);
      alert(error.response?.data?.error || 'Failed to delete Qualtrics configuration');
    } finally {
      setIsDeleting(false);
      setShowDeleteModal(false);
    }
  };

  const removeFile = (indexToRemove) => {
    setConfig(prev => ({
      ...prev,
      files: prev.files.filter((_, index) => index !== indexToRemove)
    }));
  };

  if (!config.config_id) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-white">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center space-x-3">
            <FaChartBar className="text-3xl text-green-400" />
            <div>
              <h1 className="text-3xl font-bold">Edit Qualtrics Assistant</h1>
              <p className="text-gray-400">Modify your Qualtrics-enabled AI assistant configuration</p>
            </div>
          </div>
          <button
            onClick={() => navigate('/config_list')}
            className="flex items-center space-x-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
          >
            <FaTimes />
            <span>Cancel</span>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-8">
          {/* Basic Configuration */}
          <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
            <h2 className="text-xl font-semibold mb-6 flex items-center space-x-2">
              <FaChartBar className="text-green-400" />
              <span>Basic Configuration</span>
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium mb-2">Assistant Name *</label>
                <input
                  type="text"
                  name="bot_name"
                  value={config.bot_name}
                  onChange={handleInputChange}
                  className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                  placeholder="e.g., Research Assistant"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">AI Model *</label>
                <select
                  name="model_name"
                  value={config.model_name}
                  onChange={handleInputChange}
                  className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                  required
                >
                  <option value="">Select a model</option>
                  <option value="gpt-4o">GPT-4o</option>
                  <option value="gpt-4o-mini">GPT-4o Mini</option>
                  <option value="gpt-3.5-turbo">GPT-3.5 Turbo</option>
                  <option value="qwen-plus">Qwen Plus</option>
                  <option value="qwen-turbo">Qwen Turbo</option>
                  <option value="deepseek-chat">DeepSeek Chat</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Temperature</label>
                <input
                  type="number"
                  name="temperature"
                  value={config.temperature}
                  onChange={handleInputChange}
                  min="0"
                  max="2"
                  step="0.1"
                  className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                />
                <p className="text-xs text-gray-400 mt-1">0 = focused, 2 = creative</p>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Collection Name</label>
                <input
                  type="text"
                  name="collection_name"
                  value={config.collection_name}
                  onChange={handleInputChange}
                  className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                  placeholder="e.g., research_docs"
                />
              </div>
            </div>

            <div className="mt-6">
              <div className="flex items-center space-x-2 mb-2">
                <input
                  type="checkbox"
                  name="is_public"
                  id="is_public"
                  checked={config.is_public}
                  onChange={handleInputChange}
                  className="w-4 h-4 text-green-600 bg-gray-700 border-gray-600 rounded focus:ring-green-500"
                />
                <label htmlFor="is_public" className="text-sm font-medium">Make this assistant public</label>
              </div>
              <p className="text-xs text-gray-400">Public assistants can be used by anyone without authentication</p>
            </div>
          </div>

          {/* Qualtrics Configuration */}
          <div className="bg-gray-800 rounded-xl p-6 border border-green-500/30">
            <h2 className="text-xl font-semibold mb-6 flex items-center space-x-2">
              <FaChartBar className="text-green-400" />
              <span>Qualtrics Configuration</span>
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium mb-2">API Token</label>
                <input
                  type="password"
                  name="qualtrics_api_token"
                  value={config.qualtrics_config.api_token}
                  onChange={handleInputChange}
                  className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                  placeholder="Leave empty to keep current token"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Data Center *</label>
                <input
                  type="text"
                  name="qualtrics_datacenter"
                  value={config.qualtrics_config.datacenter}
                  onChange={handleInputChange}
                  className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                  placeholder="e.g., yourdatacenter"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Survey ID *</label>
                <input
                  type="text"
                  name="qualtrics_survey_id"
                  value={config.qualtrics_config.survey_id}
                  onChange={handleInputChange}
                  className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                  placeholder="e.g., SV_xxxxxxxxx"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">User ID</label>
                <input
                  type="text"
                  name="qualtrics_user_id"
                  value={config.qualtrics_config.user_id}
                  onChange={handleInputChange}
                  className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                  placeholder="Optional"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Username</label>
                <input
                  type="text"
                  name="qualtrics_username"
                  value={config.qualtrics_config.username}
                  onChange={handleInputChange}
                  className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                  placeholder="Optional"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Organization ID</label>
                <input
                  type="text"
                  name="qualtrics_org_id"
                  value={config.qualtrics_config.org_id}
                  onChange={handleInputChange}
                  className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                  placeholder="Optional"
                />
              </div>
            </div>
          </div>

          {/* Instructions */}
          <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
            <h2 className="text-xl font-semibold mb-6">Instructions & Behavior</h2>
            
            <div className="mb-4">
              <div className="flex items-center space-x-4 mb-4">
                <button
                  type="button"
                  onClick={() => setIsAdvancedMode(false)}
                  className={`px-4 py-2 rounded-lg transition-colors ${
                    !isAdvancedMode 
                      ? 'bg-green-600 text-white' 
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  Simple Instructions
                </button>
                <button
                  type="button"
                  onClick={() => setIsAdvancedMode(true)}
                  className={`px-4 py-2 rounded-lg transition-colors ${
                    isAdvancedMode 
                      ? 'bg-green-600 text-white' 
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  Advanced Template
                </button>
              </div>
              
              {!isAdvancedMode ? (
                <div>
                  <label className="block text-sm font-medium mb-2">Instructions</label>
                  <textarea
                    name="instructions"
                    value={config.instructions}
                    onChange={handleInputChange}
                    rows={6}
                    className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent resize-none"
                    placeholder="Describe how your assistant should behave, what it should focus on, and any specific guidelines..."
                  />
                </div>
              ) : (
                <div>
                  <label className="block text-sm font-medium mb-2">Advanced Prompt Template</label>
                  <textarea
                    name="prompt_template"
                    value={config.prompt_template}
                    onChange={handleInputChange}
                    rows={8}
                    className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent resize-none font-mono text-sm"
                    placeholder={`Use placeholders like {'{context}'} and {'{query}'} that will be replaced during runtime`}
                  />
                  <p className="text-xs text-gray-400 mt-2">
                    <FaInfoCircle className="inline mr-1" />
                    Use placeholders like {'{context}'} and {'{query}'} that will be replaced during runtime
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* File Upload */}
          <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
            <h2 className="text-xl font-semibold mb-6 flex items-center space-x-2">
              <FaUpload className="text-blue-400" />
              <span>Knowledge Base Documents</span>
            </h2>

            <div className="mb-4">
              <label className="block text-sm font-medium mb-2">Upload New Documents (Optional)</label>
              <input
                type="file"
                multiple
                onChange={handleFileChange}
                accept=".txt,.pdf,.md,.docx"
                className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-green-600 file:text-white hover:file:bg-green-700"
              />
              <p className="text-xs text-gray-400 mt-2">Supported formats: TXT, PDF, MD, DOCX</p>
            </div>

            {/* Current Documents */}
            {config.documents && config.documents.length > 0 && (
              <div className="mb-4">
                <h3 className="text-sm font-medium mb-2">Current Documents:</h3>
                <div className="space-y-2">
                  {config.documents.map((doc, index) => (
                    <div key={index} className="flex items-center space-x-2 text-sm text-gray-300 bg-gray-700 p-2 rounded">
                      <FaFile className="text-blue-400" />
                      <span>{doc}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* New Files Preview */}
            {config.files && config.files.length > 0 && (
              <div>
                <h3 className="text-sm font-medium mb-2">New Files to Upload:</h3>
                <div className="space-y-2">
                  {config.files.map((file, index) => (
                    <div key={index} className="flex items-center justify-between bg-gray-700 p-3 rounded-lg">
                      <div className="flex items-center space-x-3">
                        <FaFile className="text-blue-400" />
                        <div>
                          <p className="text-sm font-medium">{file.name}</p>
                          <p className="text-xs text-gray-400">{(file.size / 1024).toFixed(1)} KB</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeFile(index)}
                        className="text-red-400 hover:text-red-300 p-1"
                      >
                        <FaTimes />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setShowDeleteModal(true)}
              className="flex items-center space-x-2 px-6 py-3 bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
            >
              <FaTrash />
              <span>Delete Configuration</span>
            </button>

            <div className="flex items-center space-x-4">
              <button
                type="button"
                onClick={() => navigate('/config_list')}
                className="px-6 py-3 bg-gray-600 hover:bg-gray-700 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isLoading}
                className="flex items-center space-x-2 px-6 py-3 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 rounded-lg transition-colors"
              >
                <FaSave />
                <span>{isLoading ? 'Updating...' : 'Update Configuration'}</span>
              </button>
            </div>
          </div>
        </form>

        {/* Delete Confirmation Modal */}
        {showDeleteModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-gray-800 p-6 rounded-xl max-w-md w-full mx-4 border border-gray-700">
              <h3 className="text-xl font-semibold mb-4">Delete Qualtrics Configuration</h3>
              <p className="text-gray-300 mb-6">
                Are you sure you want to delete this Qualtrics configuration? This action cannot be undone and will also delete all associated documents and chat history.
              </p>
              <div className="flex items-center justify-end space-x-4">
                <button
                  onClick={() => setShowDeleteModal(false)}
                  className="px-4 py-2 bg-gray-600 hover:bg-gray-700 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDelete}
                  disabled={isDeleting}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-600 rounded-lg transition-colors"
                >
                  {isDeleting ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default EditQualtricsConfigPage;
