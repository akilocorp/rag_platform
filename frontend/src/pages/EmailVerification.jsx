import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import apiClient from '../api/apiClient';
import logo from '../assets/logo.png';
import { FaCheckCircle, FaExclamationCircle, FaSpinner } from 'react-icons/fa';

const EmailVerificationPage = () => {
  // We'll use a 'status' state to show different icons (loading, success, error)
  const [status, setStatus] = useState('loading');
  const [message, setMessage] = useState('Verifying your email, please wait...');
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const verifyEmail = async () => {
      // Get token from the URL query string
      const query = new URLSearchParams(location.search);
      const token = query.get('token');

      if (!token) {
        setMessage('Verification token not found. Please use the link sent to your email.');
        setStatus('error');
        return;
      }

      try {
        // API call to your backend to verify the token
        const response = await apiClient.post('/auth/verify-email', { token });

        setMessage(response.data.message || 'Email verified successfully! You can now Sign in.');
        setStatus('success');

        // Redirect to login page after a few seconds
        setTimeout(() => {
          navigate('/login');
        }, 5000);

      } catch (error) {
        setStatus('error');
        if (error.response) {
          setMessage(error.response.data.message || 'Verification failed. The link may be invalid or expired.');
        } else {
          setMessage('An error occurred during verification. Please try again later.');
        }
      }
    };

    verifyEmail();
  }, [location, navigate]);

  return (
    <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }} className="min-h-screen bg-[#F0F6FB] text-gray-900 flex flex-col relative overflow-hidden">
      
      {/* Simple Navbar with Logo */}
      <nav className="w-full flex justify-center lg:justify-start items-center px-6 lg:px-8 py-6 max-w-[1440px] mx-auto z-10">
        <Link to="/" className="hover:opacity-90 transition-opacity">
          <img 
            src={logo} 
            alt="actrLabs Logo" 
            className="h-10 lg:h-12 w-auto object-contain" 
          />
        </Link>
      </nav>

      {/* Main Content */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 pb-20 z-10">
        <div className="w-full max-w-md bg-white rounded-[2rem] shadow-sm border border-gray-100 p-10 text-center flex flex-col items-center animate-in zoom-in-95 duration-300">
          
          {/* Status Icon */}
          <div className="mb-6">
            {status === 'loading' && (
              <FaSpinner className="animate-spin text-5xl text-[#FA6C43]" />
            )}
            {status === 'success' && (
              <FaCheckCircle className="text-5xl text-emerald-500 animate-in scale-in-0 duration-300" />
            )}
            {status === 'error' && (
              <FaExclamationCircle className="text-5xl text-red-500 animate-in scale-in-0 duration-300" />
            )}
          </div>

          {/* Heading */}
          <h1 className="text-2xl font-bold text-[#222] mb-3 tracking-tight">
            {status === 'loading' && 'Verifying Email'}
            {status === 'success' && 'Verification Complete'}
            {status === 'error' && 'Verification Failed'}
          </h1>
          
          {/* Message */}
          <p className="text-gray-600 font-medium leading-relaxed mb-8">
            {message}
          </p>

          {/* Action / Next Steps */}
          {status === 'success' && (
            <div className="w-full">
              <button
                onClick={() => navigate('/login')}
                className="w-full py-3.5 px-6 rounded-xl font-bold text-white bg-[#FA6C43] hover:bg-[#E55B34] transition-all active:scale-[0.98] shadow-sm"
              >
                Go to Login
              </button>
              <p className="mt-4 text-xs font-medium text-gray-400">
                You will be redirected automatically in 5 seconds...
              </p>
            </div>
          )}

          {status === 'error' && (
            <button
              onClick={() => navigate('/login')}
              className="w-full py-3.5 px-6 rounded-xl font-bold border-2 border-gray-200 text-gray-700 bg-white hover:bg-gray-50 hover:border-gray-300 transition-all active:scale-[0.98]"
            >
              Return to Login
            </button>
          )}
        </div>
      </div>

      {/* Decorative Background Element (Optional, adds a subtle touch matching the theme) */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-gradient-to-tr from-[#F9D0C4]/20 to-[#8FCBEA]/20 rounded-full blur-[100px] pointer-events-none -z-10"></div>
    </div>
  );
};

export default EmailVerificationPage;