import { FaCog, FaPlus, FaRobot, FaSpinner, FaChartBar } from 'react-icons/fa';
import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import UserInfo from '../components/UserInfo';
import apiClient from '../api/apiClient';
import logo from '../assets/logo.png'; // Make sure this path is correct!

const ConfigItem = ({ config, onSelect, onEdit, setError }) => {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div
      className={`relative bg-white p-6 rounded-[1.5rem] border shadow-sm transition-all duration-300 cursor-pointer ${
        isHovered 
          ? 'border-[#FA6C43]/40 shadow-md transform -translate-y-1' 
          : 'border-gray-200 hover:border-gray-300'
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
        <div className="flex-shrink-0 p-4 rounded-2xl bg-[#F9D0C4]/40 text-[#FA6C43]">
          <FaRobot className="text-2xl" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center space-x-2">
            <h3 className="text-lg font-bold text-[#222] truncate">{config.bot_name}</h3>
          </div>
          <p className="text-sm text-gray-500 mt-1">Model: {config.model_name}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            
            {/* Hover Overlay */}
            {isHovered && (
              <div className="absolute inset-0 flex items-center justify-center bg-white/70 backdrop-blur-[2px] rounded-[1.5rem] pointer-events-none transition-all duration-200 z-10">
                <div className="px-5 py-2 text-sm font-bold text-white rounded-xl bg-[#FA6C43] shadow-md transform scale-100 animate-in fade-in zoom-in-95 duration-200">
                  Click to chat
                </div>
              </div>
            )}

            <span className="px-3 py-1 text-xs font-semibold rounded-lg bg-[#F0F6FB] text-gray-600 border border-gray-100">
              {config.temperature ? `Temp: ${config.temperature}` : 'Default temp'}
            </span>
          </div>
        </div>
      </div>
      
      <div className="mt-4 flex justify-end relative z-20">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onEdit(config);
          }}
          className="px-3 py-1.5 text-xs font-bold bg-gray-50 border border-gray-200 text-gray-600 rounded-lg hover:bg-[#F9D0C4]/30 hover:text-[#FA6C43] hover:border-[#FA6C43]/30 transition-colors flex items-center space-x-1.5"
        >
          <FaCog className="text-sm" />
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
    navigate(`/chat/${configId}`);
  };

  const onEdit = (config) => {
    const configForEdit = {
      ...config,
      config_id: config.config_id, 
      _id: config.config_id, 
      documents: config.documents || [] 
    };
    navigate(`/edit-config`, { state: { config: configForEdit } });
  };

  const handleCreateNew = () => {
    navigate('/config');
  };

  return (
    <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }} className="min-h-screen bg-[#F0F6FB] text-gray-900 flex flex-col">
      
      {/* Navbar */}
      <nav className="w-full flex justify-between items-center px-6 lg:px-8 py-6 max-w-[1440px] mx-auto z-10">
        <div 
          className="flex items-center hover:opacity-90 transition-opacity cursor-pointer"
          onClick={() => navigate('/')}
        >
          <img 
            src={logo} 
            alt="actrLabs Logo" 
            className="h-10 lg:h-12 w-auto object-contain" 
          />
        </div>
        <div className="flex items-center space-x-4 lg:space-x-8">
          <UserInfo />
        </div>
      </nav>

      {/* Main Content Area */}
      <div className="container mx-auto px-6 lg:px-8 py-4 lg:py-8 max-w-[1440px] flex-1">
        
        <div className="mt-4 lg:mt-8">
          {/* Header */}
          <div className="flex flex-col mb-10 lg:mb-12">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6 mb-8">
              <div className="space-y-2">
                <h1 className="text-4xl sm:text-5xl font-medium tracking-tight leading-[1.1] text-[#222]">
                  AI Assistants
                  <span className="relative inline-block ml-2">
                    <svg className="absolute w-[110%] h-3 lg:h-4 -bottom-1 lg:-bottom-1 left-0 text-[#FA6C43]" viewBox="0 0 200 20" fill="none" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none">
                      <path d="M2 15.5C45.5 5.5 120 -2 198 12" stroke="currentColor" strokeWidth="4" strokeLinecap="round" vectorEffect="non-scaling-stroke"/>
                    </svg>
                  </span>
                </h1>
                <p className="text-gray-500 text-sm mt-3 font-medium">
                  Manage your personalized AI Assistance configurations
                </p>
              </div>
              
              <button 
                className="flex items-center px-6 py-3 bg-[#FA6C43] hover:bg-[#E55B34] text-white rounded-xl transition-all duration-200 shadow-sm active:scale-[0.98]" 
                onClick={handleCreateNew}
              >
                <FaPlus className="mr-2 text-sm" />
                <span className="font-bold text-[15px]">New Assistant</span>
              </button>
            </div>
          </div>
        </div>

        {/* Configurations List / States */}
        <div className="space-y-8 pb-20">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-64 rounded-[2rem] bg-white border border-gray-100 shadow-sm">
              <FaSpinner className="animate-spin text-4xl text-[#FA6C43] mb-4" />
              <p className="text-gray-500 font-medium">Loading your AI assistants...</p>
            </div>
          ) : error ? (
            <div className="rounded-[1.5rem] bg-red-50 border border-red-200 p-6">
              <div className="flex items-start">
                <div className="flex-shrink-0 pt-0.5">
                  <svg className="w-5 h-5 text-red-500" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="ml-3">
                  <h3 className="text-base font-bold text-red-800">Configuration Error</h3>
                  <p className="mt-1 text-sm text-red-600 font-medium">{error}</p>
                </div>
              </div>
            </div>
          ) : (
            <>
              {configs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 rounded-[2rem] bg-white border border-gray-100 shadow-sm">
                  <div className="p-6 bg-[#F0F6FB] rounded-full mb-5 text-[#FA6C43]">
                    <FaRobot className="text-4xl" />
                  </div>
                  <h3 className="text-xl font-bold text-[#222] mb-2">No assistants yet</h3>
                  <p className="text-gray-500 mb-8 max-w-md text-center font-medium">
                    Create your first AI assistant to take charge of your classroom.
                  </p>
                  <button
                    onClick={handleCreateNew}
                    className="px-6 py-3 bg-[#FA6C43] hover:bg-[#E55B34] text-white rounded-xl transition-colors flex items-center shadow-sm font-bold active:scale-[0.98]"
                  >
                    <FaPlus className="mr-2" />
                    Create Assistant
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8">
                  {configs.map((config) => (
                    <ConfigItem
                      key={config._id}
                      config={config}
                      onSelect={handleSelectConfig}
                      onEdit={onEdit}
                      setError={setError}
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