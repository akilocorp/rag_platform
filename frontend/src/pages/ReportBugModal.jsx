import React, { useState, useEffect } from 'react';
import { FaTimes, FaBug, FaCheckCircle, FaInfoCircle } from 'react-icons/fa';
import apiClient from '../api/apiClient';

const ReportBugModal = ({ isOpen, onClose }) => {
  const defaultState = {
    category: 'chat',
    description: '',
    stepsToReproduce: '',
  };

  const [formData, setFormData] = useState(defaultState);
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState('');

  // Reset form when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setFormData(defaultState);
      setIsSuccess(false);
      setError('');
    }
  }, [isOpen]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (error) setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!formData.description.trim()) {
      setError('Please provide a description of the bug.');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      // Assuming you have an endpoint for this. Adjust the URL as needed.
      await apiClient.post('/report-bug', formData);
      setIsSuccess(true);
    } catch (err) {
      console.error('Error reporting bug:', err);
      setError('Failed to submit bug report. Please try again later.');
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }} className="fixed inset-0 z-[100] flex items-center justify-center bg-white/60 p-4 backdrop-blur-sm">
      <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-lg overflow-hidden flex flex-col relative animate-in zoom-in-95 duration-200">
        
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-5 right-5 p-2.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-full transition-all z-10 focus:outline-none"
          title="Close"
        >
          <FaTimes className="text-xl" />
        </button>

        <div className="p-8 sm:p-10">
          
          {isSuccess ? (
            <div className="flex flex-col items-center justify-center text-center py-8">
              <div className="w-20 h-20 bg-green-50 rounded-full flex items-center justify-center mb-6">
                <FaCheckCircle className="text-5xl text-green-500" />
              </div>
              <h2 className="text-2xl font-bold text-[#222] mb-3">Bug Reported!</h2>
              <p className="text-gray-500 font-medium mb-8 max-w-sm">
                Thank you for helping us improve. Our engineering team will look into this issue shortly.
              </p>
              <button
                onClick={onClose}
                className="w-full py-3.5 px-6 rounded-xl font-bold text-white bg-[#FA6C43] hover:bg-[#E55B34] transition-all focus:outline-none shadow-sm active:scale-[0.98]"
              >
                Close
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center mb-8">
                <div className="p-3 bg-red-50 rounded-xl text-red-500 mr-4">
                  <FaBug className="text-2xl" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-[#222]">Report a Bug</h2>
                  <p className="text-sm text-gray-500 font-medium mt-1">Found an issue? Let us know what happened.</p>
                </div>
              </div>

              {error && (
                <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-700 rounded-xl text-sm flex items-start space-x-3">
                  <FaInfoCircle className="mt-0.5 flex-shrink-0 text-lg" />
                  <span className="font-medium">{error}</span>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-5">
                
                {/* Bug Category */}
                <div>
                  <label htmlFor="category" className="block text-[13px] font-semibold text-gray-700 mb-1.5">
                    Where did you encounter this issue?
                  </label>
                  <select
                    id="category"
                    name="category"
                    value={formData.category}
                    onChange={handleChange}
                    className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F9D0C4] focus:border-[#FA6C43] transition-all text-gray-900"
                  >
                    <option value="chat">Chat / RAG Accuracy</option>
                    <option value="config">Assistant Configuration</option>
                    <option value="auth">Login / Sign Up</option>
                    <option value="files">File Uploads / Knowledge Base</option>
                    <option value="ui">General UI / Visual Glitch</option>
                    <option value="other">Other</option>
                  </select>
                </div>

                {/* Bug Description */}
                <div>
                  <label htmlFor="description" className="block text-[13px] font-semibold text-gray-700 mb-1.5">
                    What happened? <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    id="description"
                    name="description"
                    value={formData.description}
                    onChange={handleChange}
                    rows="4"
                    className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F9D0C4] focus:border-[#FA6C43] transition-all resize-none"
                    placeholder="Describe the issue you are facing..."
                  />
                </div>

                {/* Steps to Reproduce */}
                <div>
                  <label htmlFor="stepsToReproduce" className="block text-[13px] font-semibold text-gray-700 mb-1.5">
                    Steps to reproduce <span className="text-gray-400 font-normal ml-1">(Optional)</span>
                  </label>
                  <textarea
                    id="stepsToReproduce"
                    name="stepsToReproduce"
                    value={formData.stepsToReproduce}
                    onChange={handleChange}
                    rows="3"
                    className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F9D0C4] focus:border-[#FA6C43] transition-all resize-none"
                    placeholder="1. Go to...&#10;2. Click on...&#10;3. Then I saw..."
                  />
                </div>

                {/* Action Buttons */}
                <div className="flex gap-4 pt-4 mt-2 border-t border-gray-100">
                  <button 
                    type="button" 
                    onClick={onClose} 
                    className="w-full py-3.5 px-6 rounded-xl font-bold border-2 border-gray-200 text-gray-700 bg-white hover:bg-gray-50 hover:border-gray-300 transition-all"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit" 
                    disabled={isLoading} 
                    className={`w-full py-3.5 px-6 rounded-xl font-bold flex items-center justify-center transition-all ${
                      isLoading 
                      ? 'bg-[#F9D0C4] text-[#FA6C43] cursor-not-allowed' 
                      : 'bg-[#FA6C43] hover:bg-[#E55B34] text-white active:scale-[0.98] shadow-sm'
                    }`}
                  >
                    {isLoading ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current mr-2"></div>
                        <span>Submitting...</span>
                      </>
                    ) : (
                      'Submit Report'
                    )}
                  </button>
                </div>

              </form>
            </>
          )}

        </div>
      </div>
    </div>
  );
};

export default ReportBugModal;