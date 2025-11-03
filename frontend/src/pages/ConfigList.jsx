import { FaCog, FaPlus, FaRobot, FaSpinner, FaChartBar } from 'react-icons/fa';
import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import UserInfo from '../components/UserInfo';
import apiClient from '../api/apiClient';

// Your perfect ConfigItem component remains exactly the same
const ConfigItem = ({ config, onSelect, onEdit }) => {
  const [isHovered, setIsHovered] = useState(false);
  const isQualtrics = false; // Removed Qualtrics config type

  return (
    <div
      className={`relative bg-gray-800/50 backdrop-blur-sm p-6 rounded-xl border border-gray-700/50 shadow-lg transition-all duration-300 ${
        isHovered 
          ? isQualtrics 
            ? 'border-green-500/50 transform -translate-y-1' 
            : 'border-indigo-500/50 transform -translate-y-1'
          : 'hover:border-gray-600'
      }`}
      onClick={() => {
        if (!config.config_id) {
          console.error('Invalid config:', config);
          setError('Failed to select configuration');
          return;
        }
        onSelect(config.config_id);
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="flex items-start space-x-4">
        <div className="flex-shrink-0 p-3 rounded-lg bg-indigo-500/10 text-indigo-400">
          <FaRobot className="text-xl" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center space-x-2">
            <h3 className="text-lg font-bold text-white truncate">{config.bot_name}</h3>
          </div>
          <p className="text-sm text-gray-400 mt-1">Model: {config.model_name}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {isHovered && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/20 rounded-xl pointer-events-none">
                <div className={`px-3 py-1 text-xs font-medium text-white rounded-full ${
                  isQualtrics ? 'bg-green-500/90' : 'bg-indigo-500/90'
                }`}>
                  Click to chat
                </div>
              </div>
            )}
            <span className="px-2 py-1 text-xs rounded-full bg-gray-700/50 text-gray-300">
              {config.temperature ? `Temp: ${config.temperature}` : 'Default temp'}
            </span>
          </div>
        </div>
      </div>
      <div className="mt-3 flex justify-end">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onEdit(config);
          }}
          className="px-2 py-1 text-xs font-medium bg-gray-700/50 text-gray-300 hover:text-gray-300 transition-colors flex items-center space-x-1"
        >
          <FaCog className="text-xs" />
          <span>Edit</span>
        </button>
      </div>
    </div>
  );
};

const ConfigListPage = () => {
  const [configs, setConfigs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const loadPageData = async () => {
      setLoading(true);
      try {
        // Fetch all configurations from single endpoint
        const response = await apiClient.get('/config_list');
        setConfigs(response.data.configs);
      } catch (err) {
        console.error('Failed to load configurations:', err);
        setError('Failed to load configurations');
        if (err.response?.status === 401) {
          navigate('/login');
        }
      } finally {
        setLoading(false);
      }
    };

    loadPageData();
  }, [location.key, navigate]);

  const handleSelectConfig = (configId) => {
    if (!configId) {
      console.error('Invalid configId:', configId);
      setError('Failed to select configuration');
      return;
    }
    
    // All configs are normal now - navigate directly to chat
    navigate(`/chat/${configId}`);
  };

  const onEdit = (config) => {
    console.log('ConfigList - Original config object:', config);
    console.log('ConfigList - Config.config_id:', config.config_id);
    console.log('ConfigList - Config._id:', config._id);
    console.log('ConfigList - Config.config_type:', config.config_type);
    
    const configForEdit = {
      ...config,
      config_id: config.config_id, // Use the config_id from backend
      _id: config.config_id, // Set _id to config_id for compatibility
      documents: config.documents || [] // Ensure documents are included
    };
    
    console.log('ConfigList - ConfigForEdit object:', configForEdit);
    
    // Navigate to edit page (all configs use normal edit now)
    console.log('ConfigList - Navigating to edit-config');
    navigate(`/edit-config`, { state: { config: configForEdit } });
  };

  const handleCreateNew = () => {
    navigate('/config');
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="container mx-auto px-4 py-8 max-w-7xl relative">
        <div className="absolute top-4 right-4 z-50">
          <UserInfo />
        </div>
        <div className="mt-8">
          {/* Modern header with subtle glass effect */}
          <div className="flex flex-col mb-12">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6 mb-8">
              <div className="space-y-2">
                <h1 className="text-4xl sm:text-5xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-300 to-purple-400 tracking-tight">
                  AI Assistants
                </h1>
                <p className="text-gray-400/90 text-sm">
                  Manage your personalized AI Assistance configurations
                </p>
              </div>
              <button className="flex items-center px-5 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl transition-all duration-200 hover:shadow-lg hover:shadow-indigo-500/20" onClick={handleCreateNew}>
                <FaPlus className="mr-3 text-sm" />
                <span className="font-medium">New Assistant</span>
              </button>
            </div>
          </div>
          
          
        </div>

        {/* Content area */}
        <div className="space-y-8">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-64 rounded-2xl bg-gray-900/80 border border-gray-800 backdrop-blur-sm">
              <FaSpinner className="animate-spin text-4xl text-indigo-400 mb-4" />
              <p className="text-gray-400/80">Loading your AI assistants...</p>
            </div>
          ) : error ? (
            <div className="rounded-2xl bg-red-900/30 border border-red-800/50 p-6 backdrop-blur-sm">
              <div className="flex items-start">
                <div className="flex-shrink-0 pt-0.5">
                  <svg className="w-5 h-5 text-red-400" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="ml-3">
                  <h3 className="text-base font-medium text-red-100">Configuration Error</h3>
                  <p className="mt-1 text-sm text-red-200/90">{error}</p>
                </div>
              </div>
            </div>
          ) : (
            <>
              {configs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 rounded-2xl bg-gray-900/50 border border-gray-800/50">
                  <div className="p-5 bg-gray-800/50 rounded-full mb-4">
                    <FaRobot className="text-3xl text-gray-500" />
                  </div>
                  <h3 className="text-lg font-medium text-gray-300 mb-2">No assistants yet</h3>
                  <p className="text-gray-500 mb-6 max-w-md text-center">
                    Create your first AI assistant to get started
                  </p>
                  <button
                    onClick={handleCreateNew}
                    className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors flex items-center"
                  >
                    <FaPlus className="mr-2" />
                    Create Assistant
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                  {configs.map((config) => (
                    <ConfigItem
                      key={config._id}
                      config={config}
                      onSelect={handleSelectConfig}
                      onEdit={onEdit}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>

      </div>
    </div>
  );
};

export default ConfigListPage;