import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import apiClient from '../api/apiClient';
import { FaEye, FaEyeSlash } from 'react-icons/fa';
import logo from '../assets/logo.png';
import Navbar from './NavBar';

 const slides = [
  {
    line1: "Bring custom AI",
    line2: "to your classroom,",
    prefix: "with ",
    highlight: "ActrLabs"
  },
  {
    line1: "Use GPT or Gemini",
    line2: "with your own files",
    prefix: "and ",
    highlight: "instructions"
  },
  {
    line1: "Distribute in class",
    line2: "for test prep and",
    prefix: "student ",
    highlight: "assessments"
  }
];

const LoginPage = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [showPassword, setShowPassword] = useState(false);
  
  const [currentSlide, setCurrentSlide] = useState(0);
  const navigate = useNavigate();

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentSlide((prev) => (prev + 1) % slides.length);
    }, 4000);
    return () => clearInterval(timer);
  }, []);

  const validate = () => {
    const newErrors = {};
    if (!username.trim()) newErrors.username = 'Email is required.';
    if (!password) newErrors.password = 'Password is required.';
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return false;
    }
    return true;
  };


  const isFormValid = () => {
    return !!username.trim() && !!password;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!validate()) return;

    setIsLoading(true);
    try {
      const response = await apiClient.post('/auth/login', { username, password });
      const { access_token, refresh_token } = response.data;

      if (access_token) {
        localStorage.setItem('jwtToken', access_token);
        localStorage.setItem('refreshToken', refresh_token);
        setErrors({});
        setFormError(null);
        navigate('/config_list', { replace: true });
      } else {
        setFormError('Login failed: No authentication token received.');
      }
    } catch (error) {
      console.error('Login error:', error);
      if (error.response) {
        setFormError(error.response.data.error || 'Invalid credentials');
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

  return (
    <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }} className="min-h-screen bg-[#F0F6FB] text-gray-900 relative overflow-x-hidden flex flex-col">
      
      {/* Navbar */}
      <Navbar/>

      {/* Main Content */}
      {/* Increased the gap from gap-32 to gap-40 and xl:gap-52 to push text further right */}
      <div className="flex-1 flex flex-col lg:flex-row items-center justify-center max-w-[1440px] mx-auto w-full px-6 lg:px-8 gap-12 lg:gap-40 xl:gap-52 z-10 pt-6 pb-16 lg:pb-20">
        
        {/* Left Form Card (Order 2 on mobile, Order 1 on desktop) */}
        <div className="order-2 lg:order-1 w-full max-w-[420px] bg-white rounded-[2rem] shadow-sm p-8 lg:p-10 flex flex-col z-20">
          
          {formError && (
            <div className="mb-6 p-3 bg-red-50 text-red-600 border border-red-200 rounded-xl text-sm text-center">
              {formError}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="username" className="block text-[13px] font-semibold text-gray-700 mb-1.5">
                ITSC Email
              </label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className={`w-full px-4 py-3 bg-white border ${
                  errors.username ? 'border-red-500' : 'border-gray-200'
                } rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 transition-all`}
                placeholder="account@ust.hk"
              />
              {errors.username && <p className="mt-1 text-xs text-red-500">{errors.username}</p>}
            </div>

            <div>
              <label htmlFor="password" className="block text-[13px] font-semibold text-gray-700 mb-1.5">
                Password
              </label>
              <div className={`relative overflow-hidden rounded-xl border ${
                errors.password ? 'border-red-500' : 'border-gray-200'
              } focus-within:ring-2 focus-within:ring-inset focus-within:ring-[#F9D0C4] focus-within:border-[#FA6C43] focus-within:outline-none`}>
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-4 pr-[3.75rem] py-3 bg-white rounded-xl text-sm border-0 focus:outline-none focus:ring-0"
                  placeholder="•••••••••••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-0 top-0 bottom-0 w-[3.75rem] flex items-center justify-center text-gray-400 hover:text-gray-600 shrink-0"
                >
                  {showPassword ? <FaEyeSlash size={58} /> : <FaEye size={58} />}
                </button>
              </div>
              {errors.password && <p className="mt-1 text-xs text-red-500">{errors.password}</p>}
            </div>

            <div className="pt-1">
              <Link to="/forgot-password" className="text-[13px] text-[#222] hover:text-blue-600 font-semibold transition-colors">
                Forgot Password?
              </Link>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className={`w-full py-3 px-4 rounded-xl font-bold flex items-center justify-center transition-all active:scale-[0.98] mt-2 ${
                isFormValid()
                  ? 'bg-[#FA6C43] hover:bg-[#E55B34] text-white'
                  : 'bg-[#F9D0C4] hover:bg-[#F4BFB0] text-gray-900'
              }`}
            >
              {isLoading ? (
                <><LoadingSpinner /> Logging in...</>
              ) : (
                'Login'
              )}
            </button>
          </form>

          <div className="mt-6 text-[13px] text-gray-600">
            <span className="font-medium text-gray-800">New User?</span>{' '}
            <Link to="/register" className="text-blue-500 hover:text-blue-600 font-semibold transition-colors">
              Link your ITSC Account
            </Link>
          </div>

          <div className="mt-10 text-center text-[11px] text-gray-400 leading-relaxed">
            <p>Our website uses cookies to distinguish you from other</p>
            <p>users of our website.</p>
            <p className="mt-2">
              Our <Link to="/privacy" className="underline hover:text-gray-600">Privacy Policy</Link>
            </p>
          </div>
        </div>

        {/* Right Hero Section */}
        {/* Increased height to h-[600px] to make room for text at the top and shapes at the bottom */}
        <div className="order-1 lg:order-2 flex-1 relative w-full lg:h-[600px] flex flex-col items-center lg:items-start text-center lg:text-left">
          
          {/* Slider Container - Added z-30 to ensure it stays strictly above shapes */}
          <div className="relative z-30 w-full h-[140px] sm:h-[160px] lg:h-[250px] mt-4 lg:mt-12 lg:pl-4">
            {slides.map((slide, index) => (
              <div 
                key={index}
                className={`absolute top-0 left-0 w-full transition-[opacity_0.3s_ease-out,transform_1s_ease-in-out] ${
                  index === currentSlide ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8 pointer-events-none'
                }`}
              >
                <h1 className="text-4xl sm:text-5xl lg:text-[3.5rem] xl:text-[4.2rem] font-medium tracking-tight leading-[1.15] text-[#222]">
                  {slide.line1} <br />
                  {slide.line2} <br className="hidden lg:block" />
                  <span className="text-gray-900 lg:mt-2 inline-block">
                    {slide.prefix}
                    <span className="relative inline-block">
                      {slide.highlight}
                      
                      {/* Dynamic, non-scaling SVG underline */}
                      <svg 
                        className="absolute w-full h-3 lg:h-4 -bottom-[14px] lg:-bottom-[14px] left-0 text-[#FA6C43]" 
                        viewBox="0 0 200 20" 
                        fill="none" 
                        xmlns="http://www.w3.org/2000/svg"
                        preserveAspectRatio="none"
                      >
                        <path 
                          d="M2 15.5C45.5 5.5 120 -2 198 12" 
                          stroke="currentColor" 
                          strokeWidth="4" 
                          strokeLinecap="round" 
                          vectorEffect="non-scaling-stroke"
                        />
                      </svg>
                    </span>
                  </span>
                </h1>
              </div>
            ))}
          </div>

          {/* Carousel Indicators (Dots) */}
          <div className="flex space-x-2 mt-6 lg:absolute lg:top-[340px] lg:left-4 z-30">
            {slides.map((_, index) => (
              <button
                key={index}
                onClick={() => setCurrentSlide(index)}
                className={`w-2 h-2 lg:w-2.5 lg:h-2.5 rounded-full transition-all duration-300 ${
                  index === currentSlide ? 'bg-[#FA6C43] w-5 lg:w-6' : 'bg-gray-300 hover:bg-gray-400'
                }`}
                aria-label={`Go to slide ${index + 1}`}
              />
            ))}
          </div>

          {/* CSS-based floating shapes - Pushed further down via top-[Xpx] */}
          <div className="hidden lg:block absolute inset-0 pointer-events-none overflow-visible z-10">
            
            {/* Tablet Shape */}
            <div className="absolute top-[340px] right-[30%] w-36 h-24 bg-[#F9D0C4] border-4 border-[#FA6C43] rounded-sm transform -rotate-12 shadow-lg z-0 transition-transform hover:scale-105 duration-500">
               <div className="absolute inset-1 border-2 border-[#FA6C43]/30 rounded-sm"></div>
            </div>
            
            {/* Laptop Shape */}
            <div className="absolute top-[440px] right-[5%] w-48 h-[100px] bg-[#8FCBEA] border-2 border-[#1E88E5] rounded-t-lg transform rotate-6 z-10 shadow-md transition-transform hover:scale-105 duration-500">
                <div className="absolute inset-2 border-2 border-[#1E88E5]/20 rounded-sm"></div>
                <div className="absolute -bottom-[14px] -left-[20px] w-[230px] h-4 bg-[#8FCBEA] border-2 border-[#1E88E5] transform skew-x-[45deg] rounded-b-md shadow-lg"></div>
                <div className="absolute -bottom-[10px] left-[70px] w-12 h-1 bg-[#1E88E5]/30 transform skew-x-[45deg] rounded-full"></div>
            </div>
          </div>

        </div>

      </div>
    </div>
  );
};

export default LoginPage;