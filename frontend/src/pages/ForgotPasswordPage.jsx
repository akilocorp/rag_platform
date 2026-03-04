import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import apiClient from '../api/apiClient';
import { FaEye, FaEyeSlash } from 'react-icons/fa';
import Navbar from './NavBar';

const ForgotPasswordPage = () => {
  const [email, setEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [success, setSuccess] = useState(false);
  const navigate = useNavigate();

  const getPasswordStrength = (password) => {
    const hasLetter = /[a-zA-Z]/.test(password);
    const hasNumber = /[0-9]/.test(password);
    const hasSymbol = /[^a-zA-Z0-9]/.test(password);
    if (hasLetter && hasNumber && hasSymbol) return 'strong';
    if (hasLetter && hasNumber) return 'medium';
    return 'weak';
  };

  const validate = () => {
    const newErrors = {};
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      newErrors.email = 'Please enter a valid email address.';
    }
    const passwordRegex = /^(?=.*[a-zA-Z])(?=.*\d)(?=.*[^a-zA-Z0-9]).{8,}$/;
    if (!passwordRegex.test(newPassword)) {
      newErrors.newPassword = 'Password must be at least 8 characters with letter, number, and special character.';
    }
    if (newPassword !== confirmPassword) {
      newErrors.confirmPassword = 'Passwords do not match.';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError(null);
    setErrors({});

    if (!validate()) return;

    setIsLoading(true);
    try {
      const response = await apiClient.post('/auth/forgot-password', {
        email: email.trim(),
        new_password: newPassword,
        confirm_password: confirmPassword,
      });
      setSuccess(true);
      setFormError(null);
    } catch (error) {
      console.error('Forgot password error:', error);
      if (error.response) {
        const msg = error.response?.data?.error ?? error.response?.data?.message;
        setFormError(msg || 'Something went wrong. Please try again.');
      } else if (error.request) {
        setFormError('No response from server. Please check your connection.');
      } else {
        setFormError('An unexpected error occurred.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const LoadingSpinner = () => (
    <div className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-solid border-gray-900 border-r-transparent align-[-0.125em] mr-2"></div>
  );

  const isFormValid = () => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const passwordRegex = /^(?=.*[a-zA-Z])(?=.*\d)(?=.*[^a-zA-Z0-9]).{8,}$/;
    return (
      emailRegex.test(email.trim()) &&
      passwordRegex.test(newPassword) &&
      newPassword === confirmPassword
    );
  };

  if (success) {
    return (
      <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }} className="min-h-screen bg-[#F0F6FB] text-gray-900 flex flex-col">
        <Navbar />
        <div className="flex-1 flex flex-col items-center justify-center px-6">
          <div className="w-full max-w-md bg-white rounded-[2rem] shadow-sm border border-gray-100 p-10 text-center">
            <div className="mb-6 p-4 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-xl">
              <p className="font-medium">Check your email</p>
              <p className="text-sm mt-1">If this email is registered, you will receive a reset link shortly. Please check your inbox and spam folder.</p>
            </div>
            <Link
              to="/login"
              className="inline-block w-full py-3 px-4 rounded-xl font-bold text-white bg-[#FA6C43] hover:bg-[#E55B34] transition-all text-center"
            >
              Back to Login
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }} className="min-h-screen bg-[#F0F6FB] text-gray-900 flex flex-col">
      <Navbar />
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12">
        <div className="w-full max-w-[420px] bg-white rounded-[2rem] shadow-sm p-8 lg:p-10">
          <h1 className="text-2xl font-bold text-[#222] mb-2">Reset Password</h1>
          <p className="text-gray-600 text-sm mb-6">Enter your email and new password. We'll send you a verification link.</p>

          {formError && (
            <div className="mb-6 p-3 bg-red-50 text-red-600 border border-red-200 rounded-xl text-sm text-center">
              {formError}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="email" className="block text-[13px] font-semibold text-gray-700 mb-1.5">Email</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={`w-full px-4 py-3 bg-white border ${errors.email ? 'border-red-500' : 'border-gray-200'} rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400`}
                placeholder="account@ust.hk"
              />
              {errors.email && <p className="mt-1 text-xs text-red-500">{errors.email}</p>}
            </div>

            <div>
              <label htmlFor="newPassword" className="block text-[13px] font-semibold text-gray-700 mb-1.5">New Password</label>
              <div className={`relative overflow-hidden rounded-xl border ${
                errors.newPassword ? 'border-red-500' : 'border-gray-200'
              } focus-within:ring-2 focus-within:ring-inset focus-within:ring-[#F9D0C4] focus-within:border-[#FA6C43] focus-within:outline-none`}>
                <input
                  id="newPassword"
                  type={showPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full pl-4 pr-[3.75rem] py-3 bg-white rounded-xl text-sm border-0 focus:outline-none focus:ring-0"
                  placeholder="Create a strong password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-0 top-0 bottom-0 w-[3.75rem] flex items-center justify-center text-gray-400 hover:text-gray-600 shrink-0"
                >
                  {showPassword ? <FaEyeSlash size={20} /> : <FaEye size={20} />}
                </button>
              </div>
              {newPassword && (
                <div className="mt-2.5">
                  <div className="flex gap-1 h-1.5 mb-1.5">
                    {[...Array(3)].map((_, i) => (
                      <div
                        key={i}
                        className={`flex-1 rounded-full transition-colors duration-300 ${
                          getPasswordStrength(newPassword) === 'strong' && i <= 2 ? 'bg-emerald-500' :
                          getPasswordStrength(newPassword) === 'medium' && i <= 1 ? 'bg-amber-400' :
                          getPasswordStrength(newPassword) === 'weak' && i === 0 ? 'bg-red-400' : 'bg-gray-200'
                        }`}
                      />
                    ))}
                  </div>
                  <p className="text-[11px] font-medium text-gray-500">
                    Password strength: <span className={
                      getPasswordStrength(newPassword) === 'strong' ? 'text-emerald-600' :
                      getPasswordStrength(newPassword) === 'medium' ? 'text-amber-600' : 'text-red-500'
                    }>
                      {getPasswordStrength(newPassword).charAt(0).toUpperCase() + getPasswordStrength(newPassword).slice(1)}
                    </span>
                  </p>
                </div>
              )}
              {errors.newPassword && <p className="mt-1 text-xs text-red-500">{errors.newPassword}</p>}
            </div>

            <div>
              <label htmlFor="confirmPassword" className="block text-[13px] font-semibold text-gray-700 mb-1.5">Confirm New Password</label>
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className={`w-full px-4 py-3 bg-white border ${errors.confirmPassword ? 'border-red-500' : 'border-gray-200'} rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400`}
                placeholder="•••••••••••••••••"
              />
              {errors.confirmPassword && <p className="mt-1 text-xs text-red-500">{errors.confirmPassword}</p>}
            </div>

            <button
              type="submit"
              disabled={isLoading || !isFormValid()}
              className={`w-full py-3 px-4 rounded-xl font-bold flex items-center justify-center transition-all mt-2 ${
                isFormValid() && !isLoading
                  ? 'bg-[#FA6C43] hover:bg-[#E55B34] text-white'
                  : 'bg-[#F9D0C4] hover:bg-[#F4BFB0] text-gray-900 cursor-not-allowed'
              }`}
            >
              {isLoading ? <><LoadingSpinner /> Sending...</> : 'Send Reset Link'}
            </button>
          </form>

          <div className="mt-6 text-center">
            <Link to="/login" className="text-[13px] text-blue-500 hover:text-blue-600 font-semibold">
              Back to Login
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ForgotPasswordPage;
