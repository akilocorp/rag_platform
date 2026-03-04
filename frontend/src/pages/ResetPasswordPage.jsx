import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import apiClient from '../api/apiClient';
import logo from '../assets/logo.png';
import { FaCheckCircle, FaExclamationCircle, FaSpinner } from 'react-icons/fa';

let resetCompletedForToken = null;

const ResetPasswordPage = () => {
  const [status, setStatus] = useState('loading');
  const [message, setMessage] = useState('Resetting your password, please wait...');
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const query = new URLSearchParams(location.search);
    const token = query.get('token');

    if (!token) {
      setMessage('Reset token not found. Please use the link sent to your email.');
      setStatus('error');
      return;
    }

    if (resetCompletedForToken === token) {
      setMessage('Password updated successfully! You can now log in with your new password.');
      setStatus('success');
      setTimeout(() => navigate('/login'), 5000);
      return;
    }

    const resetPassword = async () => {
      try {
        const response = await apiClient.post('/auth/reset-password', { token });
        resetCompletedForToken = token;
        setMessage(response.data.message || 'Password updated successfully! You can now log in with your new password.');
        setStatus('success');
        setTimeout(() => navigate('/login'), 5000);
      } catch (error) {
        if (resetCompletedForToken === token) return;
        setStatus('error');
        if (error.response) {
          setMessage(error.response.data.error || 'Reset failed. The link may be invalid or expired.');
        } else {
          setMessage('An error occurred. Please try again later.');
        }
      }
    };

    resetPassword();
  }, [location.search, navigate]);

  return (
    <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }} className="min-h-screen bg-[#F0F6FB] text-gray-900 flex flex-col relative overflow-hidden">
      <nav className="w-full flex justify-center lg:justify-start items-center px-6 lg:px-8 py-6 max-w-[1440px] mx-auto z-10">
        <Link to="/" className="hover:opacity-90 transition-opacity">
          <img src={logo} alt="actrLabs Logo" className="h-10 lg:h-12 w-auto object-contain" />
        </Link>
      </nav>

      <div className="flex-1 flex flex-col items-center justify-center px-6 pb-20 z-10">
        <div className="w-full max-w-md bg-white rounded-[2rem] shadow-sm border border-gray-100 p-10 text-center flex flex-col items-center">
          <div className="mb-6">
            {status === 'loading' && (
              <FaSpinner className="animate-spin text-5xl text-[#FA6C43]" />
            )}
            {status === 'success' && (
              <FaCheckCircle className="text-5xl text-emerald-500" />
            )}
            {status === 'error' && (
              <FaExclamationCircle className="text-5xl text-red-500" />
            )}
          </div>

          <h1 className="text-2xl font-bold text-[#222] mb-3 tracking-tight">
            {status === 'loading' && 'Resetting Password'}
            {status === 'success' && 'Password Updated'}
            {status === 'error' && 'Reset Failed'}
          </h1>

          <p className="text-gray-600 font-medium leading-relaxed mb-8">{message}</p>

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
              onClick={() => navigate('/forgot-password')}
              className="w-full py-3.5 px-6 rounded-xl font-bold border-2 border-gray-200 text-gray-700 bg-white hover:bg-gray-50 hover:border-gray-300 transition-all active:scale-[0.98]"
            >
              Request New Link
            </button>
          )}
        </div>
      </div>

      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-gradient-to-tr from-[#F9D0C4]/20 to-[#8FCBEA]/20 rounded-full blur-[100px] pointer-events-none -z-10"></div>
    </div>
  );
};

export default ResetPasswordPage;
