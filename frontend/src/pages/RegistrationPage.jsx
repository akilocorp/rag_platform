import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import apiClient from '../api/apiClient';
import { FaEye, FaEyeSlash, FaCheckCircle } from 'react-icons/fa';
import logo from '../assets/logo.png';
import Navbar from './NavBar';

const slides = [
  {
    line1: "Take charge of",
    line2: "your classroom,",
    prefix: "with ",
    highlight: "actrLabs"
  },
  {
    line1: "Engage students",
    line2: "like never before,",
    prefix: "",
    highlight: "effortlessly"
  },
  {
    line1: "Automate grading",
    line2: "and save hours,",
    prefix: "every single ",
    highlight: "week"
  }
];

const RegistrationPage = () => {
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState({});
  const [registrationSuccess, setRegistrationSuccess] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  
  // Slider state
  const [currentSlide, setCurrentSlide] = useState(0);

  // Auto-slide effect
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentSlide((prev) => (prev + 1) % slides.length);
    }, 4000);
    return () => clearInterval(timer);
  }, []);

  const validate = () => {
    const newErrors = {};
    
    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      newErrors.email = 'Please enter a valid email address.';
    }

    // Password validation
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
    if (!passwordRegex.test(password)) {
      newErrors.password = 'Password must be at least 8 characters with uppercase, lowercase, number, and special character.';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrors({});
    setRegistrationSuccess(false);

    if (!validate()) return;

    setIsLoading(true);
    try {
      await apiClient.post('/auth/register', { email, username, password });
      setRegistrationSuccess(true);
    } catch (error) {
      console.error('Registration error:', error);
      if (error.response) {
        setErrors({ form: error.response.data.error || 'Registration failed. Please try again.' });
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
    const hasLetter = /[a-zA-Z]/.test(password);
    const hasNumber = /[0-9]/.test(password);
    const hasSymbol = /[^a-zA-Z0-9]/.test(password);
    if (hasLetter && hasNumber && hasSymbol) return 'strong';
    if (hasLetter && hasNumber) return 'medium';
    return 'weak';
  };

  const LoadingSpinner = () => (
    <div className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-solid border-gray-900 border-r-transparent align-[-0.125em] mr-2"></div>
  );

  return (
    <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }} className="min-h-screen bg-[#F0F6FB] text-gray-900 relative overflow-x-hidden flex flex-col">
      
      <Navbar/>
      {/* Main Content */}
      <div className="flex-1 flex flex-col lg:flex-row items-center justify-center max-w-[1440px] mx-auto w-full px-6 lg:px-8 gap-12 lg:gap-32 z-10 pt-6 pb-16 lg:pb-20">
        
        {/* Left Form Card (Order 2 on mobile, Order 1 on desktop) */}
        <div className="order-2 lg:order-1 w-full max-w-[420px] bg-white rounded-[2rem] shadow-sm p-8 lg:p-10 flex flex-col z-20 transition-all duration-300">
          
          {registrationSuccess ? (
            <div className="text-center animate-in fade-in zoom-in-95 duration-300 py-4">
              <div className="w-20 h-20 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-6">
                <FaCheckCircle className="text-emerald-500 text-4xl animate-in scale-in-0 duration-500 delay-150" />
              </div>
              <h2 className="text-2xl font-bold text-[#222] mb-3 tracking-tight">Registration Successful!</h2>
              <p className="text-gray-600 font-medium leading-relaxed mb-8">
                We've sent a verification link to <span className="font-bold text-gray-900">{email}</span>. 
                Please check your inbox (and spam folder) to complete your registration.
              </p>
              <Link 
                to="/login" 
                className="w-full py-3.5 px-6 flex justify-center rounded-xl font-bold text-gray-900 bg-[#F9D0C4] hover:bg-[#F4BFB0] transition-all active:scale-[0.98] shadow-sm"
              >
                Go to Login
              </Link>
            </div>
          ) : (
            <>
              {errors.form && (
                <div className="mb-6 p-3 bg-red-50 text-red-600 border border-red-200 rounded-xl text-sm text-center">
                  {errors.form}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label htmlFor="email" className="block text-[13px] font-semibold text-gray-700 mb-1.5">
                    Email Address
                  </label>
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className={`w-full px-4 py-3 bg-white border ${
                      errors.email ? 'border-red-500' : 'border-gray-200'
                    } rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F9D0C4] focus:border-[#FA6C43] transition-all`}
                    placeholder="account@ust.hk"
                  />
                  {errors.email && <p className="mt-1 text-xs text-red-500">{errors.email}</p>}
                </div>

                <div>
                  <label htmlFor="username" className="block text-[13px] font-semibold text-gray-700 mb-1.5">
                    Username
                  </label>
                  <input
                    id="username"
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className={`w-full px-4 py-3 bg-white border ${
                      errors.username ? 'border-red-500' : 'border-gray-200'
                    } rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F9D0C4] focus:border-[#FA6C43] transition-all`}
                    placeholder="Choose a username"
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
                      placeholder="Create a strong password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-0 top-0 bottom-0 w-[3.75rem] flex items-center justify-center text-gray-400 hover:text-gray-600 shrink-0"
                    >
                      {showPassword ? <FaEyeSlash size={58} /> : <FaEye size={58} />}
                    </button>
                  </div>
                  
                  {/* Password Strength Indicator */}
                  {password && (
                    <div className="mt-2.5">
                      <div className="flex gap-1 h-1.5 mb-1.5">
                        {[...Array(3)].map((_, i) => (
                          <div 
                            key={i}
                            className={`flex-1 rounded-full transition-colors duration-300 ${
                              getPasswordStrength(password) === 'strong' && i <= 2 ? 'bg-emerald-500' :
                              getPasswordStrength(password) === 'medium' && i <= 1 ? 'bg-amber-400' :
                              getPasswordStrength(password) === 'weak' && i === 0 ? 'bg-red-400' : 'bg-gray-200'
                            }`}
                          />
                        ))}
                      </div>
                      <p className="text-[11px] font-medium text-gray-500">
                        Password strength: <span className={
                          getPasswordStrength(password) === 'strong' ? 'text-emerald-600' :
                          getPasswordStrength(password) === 'medium' ? 'text-amber-600' : 'text-red-500'
                        }>
                          {getPasswordStrength(password).charAt(0).toUpperCase() + getPasswordStrength(password).slice(1)}
                        </span>
                      </p>
                    </div>
                  )}

                  {errors.password && <p className="mt-1 text-xs text-red-500">{errors.password}</p>}
                </div>

                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full py-3.5 px-4 rounded-xl font-bold text-gray-900 flex items-center justify-center transition-all bg-[#F9D0C4] hover:bg-[#F4BFB0] active:scale-[0.98] mt-4"
                >
                  {isLoading ? (
                    <><LoadingSpinner /> Creating account...</>
                  ) : (
                    'Register'
                  )}
                </button>
              </form>

              <div className="mt-6 text-[13px] text-gray-600 text-center">
                <span className="font-medium text-gray-800">Already have an account?</span>{' '}
                <Link to="/login" className="text-blue-500 hover:text-blue-600 font-semibold transition-colors">
                  Login here
                </Link>
              </div>

              <div className="mt-10 text-center text-[11px] text-gray-400 leading-relaxed">
                <p>By registering, you agree to our</p>
                <p className="mt-1">
                  <Link to="/terms" className="underline hover:text-gray-600">Terms of Service</Link> and <Link to="/privacy" className="underline hover:text-gray-600">Privacy Policy</Link>
                </p>
              </div>
            </>
          )}
        </div>

        {/* Right Hero Section (Order 1 on mobile, Order 2 on desktop) */}
        <div className="order-1 lg:order-2 flex-1 relative w-full lg:h-[500px] flex flex-col items-center lg:items-start text-center lg:text-left">
          
          {/* Slider Container */}
          <div className="relative w-full h-[140px] sm:h-[160px] lg:h-[250px] mt-4 lg:mt-10 lg:pl-8">
            {slides.map((slide, index) => (
              <div 
                key={index}
                className={`absolute top-0 left-0 w-full transition-all duration-700 ease-in-out ${
                  index === currentSlide ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8 pointer-events-none'
                }`}
              >
                <h1 className="text-4xl sm:text-5xl lg:text-[3.5rem] xl:text-[4rem] font-medium tracking-tight leading-[1.15] text-[#222]">
                  {slide.line1} <br />
                  {slide.line2} <br className="hidden lg:block" />
                  <span className="text-gray-900 lg:mt-1 inline-block">
                    {slide.prefix}
                    <span className="relative inline-block">
                      {slide.highlight}
                      
                      {/* Dynamic, non-scaling SVG underline */}
                      <svg 
                        className="absolute w-full h-3 lg:h-4 -bottom-1 lg:-bottom-1 left-0 text-[#FA6C43]" 
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
          <div className="flex space-x-2 mt-6 lg:absolute lg:top-[320px] lg:left-8 z-20">
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

          {/* CSS-based floating shapes - Hidden on mobile (hidden lg:block) */}
          <div className="hidden lg:block absolute inset-0 pointer-events-none overflow-visible">
            
            {/* Tablet Shape */}
            <div className="absolute top-[280px] right-[20%] w-36 h-24 bg-[#F9D0C4] border-4 border-[#FA6C43] rounded-sm transform -rotate-12 shadow-lg z-0 transition-transform hover:scale-105 duration-500">
               <div className="absolute inset-1 border-2 border-[#FA6C43]/30 rounded-sm"></div>
            </div>
            
            {/* Laptop Shape */}
            <div className="absolute top-[360px] right-[-5%] w-48 h-[100px] bg-[#8FCBEA] border-2 border-[#1E88E5] rounded-t-lg transform rotate-6 z-10 shadow-md transition-transform hover:scale-105 duration-500">
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

export default RegistrationPage;