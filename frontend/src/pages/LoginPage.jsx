import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import apiClient from '../api/apiClient';
import { FaUser, FaLock, FaEye, FaEyeSlash, FaArrowRight, FaCheckCircle } from 'react-icons/fa';

const LoginPage = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState({});
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [isFocused, setIsFocused] = useState({
    username: false,
    password: false
  });
  const navigate = useNavigate();

  const validate = () => {
    const newErrors = {};
    if (!username.trim()) newErrors.username = 'Username is required.';
    if (!password) newErrors.password = 'Password is required.';
    else if (password.length < 8) newErrors.password = 'Password must be at least 8 characters.';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrors({});

    if (!validate()) return;

    setIsLoading(true);
    try {
      const response = await apiClient.post('/auth/login', { username, password });
      const { access_token, refresh_token } = response.data;

      if (access_token) {
        localStorage.setItem('jwtToken', access_token);
        if (rememberMe) localStorage.setItem('refreshToken', refresh_token);
        // Clear any previous errors
        setErrors({});
        // Redirect to config_list
        navigate('/config_list', { replace: true });
      } else {
        setErrors({ form: 'Login failed: No authentication token received.' });
      }
    } catch (error) {
      console.error('Login error:', error);
      if (error.response) {
        setErrors({ form: error.response.data.error || 'Invalid username or password' });
      } else if (error.request) {
        setErrors({ form: 'No response from server. Please check your connection.' });
      } else {
        setErrors({ form: 'An unexpected error occurred.' });
      }
    } finally {
      setIsLoading(false);
    }
  };

  const getPasswordStrength = (password) => {
    if (password.length >= 12 && /[A-Z].*[0-9]/.test(password)) return 'strong';
    if (password.length >= 8) return 'medium';
    return 'weak';
  };

  const LoadingSpinner = () => (
    <div className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-solid border-current border-r-transparent align-[-0.125em]"></div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 to-gray-800 text-white flex items-center justify-center px-4 sm:px-6 lg:px-8">
      <div className="w-full max-w-md">
        <div className="bg-gray-800/50 backdrop-blur-lg rounded-2xl shadow-xl border border-gray-700/50 p-8 sm:p-10 transition-all duration-300">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 to-purple-500">
              Welcome Back
            </h1>
            <p className="mt-2 text-gray-400">Sign in to access your account</p>
          </div>

          {errors.form && (
            <div className="mb-6 p-3 bg-red-900/50 border border-red-700 rounded-lg text-sm transition-opacity duration-200">
              {errors.form}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label htmlFor="username" className="block text-sm font-medium text-gray-300 mb-1">
                Username
              </label>
              <div className={`relative transition-all duration-200 ${isFocused.username ? 'ring-2 ring-indigo-500/50' : ''} rounded-lg`}>
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <FaUser className="text-gray-500" />
                </div>
                <input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  onFocus={() => setIsFocused({...isFocused, username: true})}
                  onBlur={() => setIsFocused({...isFocused, username: false})}
                  className={`w-full pl-10 pr-4 py-3 text-white bg-gray-700/70 border ${
                    errors.username ? 'border-red-500' : 'border-gray-600/50'
                  } rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500`}
                  placeholder="Enter your username"
                />
              </div>
              {errors.username && (
                <p className="mt-1 text-sm text-red-400 transition-all duration-200">
                  {errors.username}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-300 mb-1">
                Password
              </label>
              <div className={`relative transition-all duration-200 ${isFocused.password ? 'ring-2 ring-indigo-500/50' : ''} rounded-lg`}>
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <FaLock className="text-gray-500" />
                </div>
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onFocus={() => setIsFocused({...isFocused, password: true})}
                  onBlur={() => setIsFocused({...isFocused, password: false})}
                  className={`w-full pl-10 pr-12 py-3 text-white bg-gray-700/70 border ${
                    errors.password ? 'border-red-500' : 'border-gray-600/50'
                  } rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500`}
                  placeholder="Enter your password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-indigo-400 transition-colors"
                >
                  {showPassword ? <FaEyeSlash /> : <FaEye />}
                </button>
              </div>
              {password && (
                <div className="mt-2">
                  <div className="flex gap-1 h-1.5 mb-1">
                    {[...Array(3)].map((_, i) => (
                      <div 
                        key={i}
                        className={`flex-1 rounded-full ${
                          getPasswordStrength(password) === 'strong' && i <= 2 ? 'bg-green-500' :
                          getPasswordStrength(password) === 'medium' && i <= 1 ? 'bg-yellow-500' :
                          getPasswordStrength(password) === 'weak' && i === 0 ? 'bg-red-500' : 'bg-gray-600'
                        }`}
                      />
                    ))}
                  </div>
                  <p className="text-xs text-gray-400">
                    Password strength: <span className={
                      getPasswordStrength(password) === 'strong' ? 'text-green-400' :
                      getPasswordStrength(password) === 'medium' ? 'text-yellow-400' : 'text-red-400'
                    }>
                      {getPasswordStrength(password)}
                    </span>
                  </p>
                </div>
              )}
              {errors.password && (
                <p className="mt-1 text-sm text-red-400 transition-all duration-200">
                  {errors.password}
                </p>
              )}
            </div>

            <div className="flex items-center justify-between">
              <label className="flex items-center space-x-2 cursor-pointer">
                <div className={`relative w-5 h-5 rounded border ${rememberMe ? 'bg-indigo-500 border-indigo-500' : 'border-gray-500'} transition-colors duration-200`}>
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="absolute opacity-0 cursor-pointer w-full h-full"
                  />
                  {rememberMe && (
                    <FaCheckCircle className="absolute inset-0 text-white text-xs transition-opacity duration-200" />
                  )}
                </div>
                <span className="text-sm text-gray-300">Remember me</span>
              </label>
              <Link 
                to="/forgot-password" 
                className="text-sm text-indigo-400 hover:text-indigo-300 transition-colors duration-200"
              >
                Forgot password?
              </Link>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className={`w-full py-3 px-6 rounded-lg font-medium flex items-center justify-center space-x-2 transition-all duration-200 ${
                isLoading ? 'bg-indigo-700' : 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700'
              } active:scale-[0.98]`}
            >
              {isLoading ? (
                <>
                  <LoadingSpinner />
                  <span>Signing in...</span>
                </>
              ) : (
                <>
                  <span>Sign In</span>
                  <FaArrowRight className="text-sm" />
                </>
              )}
            </button>
          </form>

          <div className="mt-6 text-center text-sm text-gray-400">
            Don't have an account?{' '}
            <Link 
              to="/register" 
              className="text-indigo-400 hover:text-indigo-300 font-medium transition-colors duration-200"
            >
              Create one
            </Link>
          </div>
        </div>

        <div className="mt-8 text-center text-xs text-gray-500">
          <p>© {new Date().getFullYear()} All rights reserved.</p>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;


<div style="width: 100%; height: 600px; border: 1px solid #ddd; border-radius: 8px; overflow: hidden; margin: 20px 0;">
  <iframe 
    src="https://app.bitterlylab.com//chat/68a36fc52603648eff7b9c1f?qualtricsId=${e://Field/ResponseID}"
    width="100%" 
    height="100%" 
    frameborder="0"
    style="border: none;"
    allow="clipboard-read; clipboard-write">
  </iframe>
</div>
<p style="font-size: 14px; color: #666; text-align: center;">
  Chat with the AI assistant above, then click Next when finished.
</p>
