import React from 'react';
import { FaRobot, FaChartBar, FaTimes } from 'react-icons/fa';

const ConfigTypeModal = ({ isOpen, onClose, onSelectType }) => {
  if (!isOpen) return null;

  const handleTypeSelect = (type) => {
    onSelectType(type);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-xl p-6 max-w-md w-full mx-4 border border-gray-700">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold text-white">Choose Assistant Type</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <FaTimes />
          </button>
        </div>

        <div className="space-y-4">
          {/* Normal Assistant */}
          <button
            onClick={() => handleTypeSelect('normal')}
            className="w-full p-4 bg-gray-700/50 hover:bg-gray-700 rounded-lg border border-gray-600 hover:border-indigo-500 transition-all duration-200 group"
          >
            <div className="flex items-center space-x-4">
              <div className="p-3 bg-indigo-500/10 rounded-lg text-indigo-400 group-hover:bg-indigo-500/20">
                <FaRobot className="text-xl" />
              </div>
              <div className="text-left">
                <h3 className="text-lg font-semibold text-white">Normal Assistant</h3>
                <p className="text-sm text-gray-400">Standard AI assistant for general conversations</p>
              </div>
            </div>
          </button>

          {/* Qualtrics Assistant */}
          <button
            onClick={() => handleTypeSelect('qualtrics')}
            className="w-full p-4 bg-gray-700/50 hover:bg-gray-700 rounded-lg border border-gray-600 hover:border-green-500 transition-all duration-200 group"
          >
            <div className="flex items-center space-x-4">
              <div className="p-3 bg-green-500/10 rounded-lg text-green-400 group-hover:bg-green-500/20">
                <FaChartBar className="text-xl" />
              </div>
              <div className="text-left">
                <h3 className="text-lg font-semibold text-white">Qualtrics Assistant</h3>
                <p className="text-sm text-gray-400">AI assistant with Qualtrics integration for survey data</p>
              </div>
            </div>
          </button>
        </div>

        <div className="mt-6 text-center">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-400 hover:text-white transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfigTypeModal;
