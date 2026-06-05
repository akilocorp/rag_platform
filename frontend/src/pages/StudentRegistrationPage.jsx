import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import apiClient from '../api/apiClient';
import { FaEye, FaEyeSlash, FaCheckCircle } from 'react-icons/fa';
import logo from '../assets/logo.png';
import Navbar from './NavBar';

const HK_UNIVERSITIES = [
  { id: 'hkust', name: 'HKUST', label: 'Hong Kong Univ. of Science & Technology', formats: ['@connect.ust.hk', '@ust.hk', '@gmail.com'] },
  { id: 'hku',   name: 'HKU',   label: 'The University of Hong Kong', formats: ['@connect.hku.hk', '@hku.hk'] },
  { id: 'polyu', name: 'PolyU', label: 'Hong Kong Polytechnic University', formats: ['@connect.polyu.hk', '@polyu.edu.hk'] },
  { id: 'hkbu',  name: 'HKBU',  label: 'Hong Kong Baptist University', formats: ['@life.hkbu.edu.hk', '@hkbu.edu.hk'] },
  { id: 'cuhk',  name: 'CUHK',  label: 'The Chinese University of Hong Kong', formats: ['@link.cuhk.edu.hk', '@cuhk.edu.hk'] },
];

const slides = [
  { line1: "Join your professor's", line2: "simulation,", prefix: "powered by ", highlight: "actrLabs" },
  { line1: "Practice real skills", line2: "with AI feedback,", prefix: "built for ", highlight: "learners" },
  { line1: "Chat with AI bots", line2: "designed by your class,", prefix: "for your ", highlight: "growth" }
];

const StudentRegistrationPage = () => {
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState({});
  const [registrationSuccess, setRegistrationSuccess] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [currentSlide, setCurrentSlide] = useState(0);
  const [university, setUniversity] = useState(null);
  const [uniSearch, setUniSearch] = useState('');
  const [uniOpen, setUniOpen] = useState(false);
  const uniRef = useRef(null);

  const filteredUnis = HK_UNIVERSITIES.filter(u =>
    u.name.toLowerCase().includes(uniSearch.toLowerCase()) ||
    u.label.toLowerCase().includes(uniSearch.toLowerCase())
  );

  useEffect(() => {
    const timer = setInterval(() => setCurrentSlide(prev => (prev + 1) % slides.length), 4000);
    return () => clearInterval(timer);
  }, []);

  const validate = () => {
    const newErrors = {};
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) newErrors.email = 'Please enter a valid email address.';
    if (!username.trim()) newErrors.username = 'Username is required.';
    const passwordRegex = /^(?=.*[a-zA-Z])(?=.*\d)(?=.*[^a-zA-Z0-9]).{8,}$/;
    if (!passwordRegex.test(password)) newErrors.password = 'Password must be at least 8 characters with letter, number, and special character.';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrors({});
    if (!validate()) return;
    setIsLoading(true);
    try {
      await apiClient.post('/auth/student-register', { email, username, password, university: university?.name || null });
      setRegistrationSuccess(true);
    } catch (error) {
      const msg = error.response?.data?.error || 'Registration failed. Please try again.';
      setErrors({ form: msg });
    } finally {
      setIsLoading(false);
    }
  };

  const getPasswordStrength = (p) => {
    const hasLetter = /[a-zA-Z]/.test(p);
    const hasNumber = /[0-9]/.test(p);
    const hasSymbol = /[^a-zA-Z0-9]/.test(p);
    if (hasLetter && hasNumber && hasSymbol) return 'strong';
    if (hasLetter && hasNumber) return 'medium';
    return 'weak';
  };

  const isFormValid = () => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) return false;
    if (!username.trim()) return false;
    const passwordRegex = /^(?=.*[a-zA-Z])(?=.*\d)(?=.*[^a-zA-Z0-9]).{8,}$/;
    return passwordRegex.test(password);
  };

  return (
    <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }} className="min-h-screen bg-[#F0F6FB] text-gray-900 relative overflow-x-hidden flex flex-col">
      <Navbar />
      <div className="flex-1 flex flex-col lg:flex-row items-center justify-center max-w-[1440px] mx-auto w-full px-6 lg:px-8 gap-12 lg:gap-32 z-10 pt-6 pb-16 lg:pb-20">

        {/* Left Form Card */}
        <div className="order-2 lg:order-1 w-full max-w-[420px] bg-white rounded-[2rem] shadow-sm p-8 lg:p-10 flex flex-col z-20">
          {registrationSuccess ? (
            <div className="text-center py-4">
              <div className="w-20 h-20 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-6">
                <FaCheckCircle className="text-emerald-500 text-4xl" />
              </div>
              <h2 className="text-2xl font-bold text-[#222] mb-3 tracking-tight">Registration Successful!</h2>
              <p className="text-gray-600 font-medium leading-relaxed mb-8">
                We've sent a verification link to <span className="font-bold text-gray-900">{email}</span>. Check your inbox to activate your account.
              </p>
              <Link to="/login" className="w-full py-3.5 px-6 flex justify-center rounded-xl font-bold text-gray-900 bg-[#F9D0C4] hover:bg-[#F4BFB0] transition-all">
                Go to Login
              </Link>
            </div>
          ) : (
            <>
              <div className="mb-6">
                <h1 className="text-2xl font-bold text-[#222] mb-1">Student Registration</h1>
                <p className="text-sm text-gray-500">Create an account to join your professor's simulation.</p>
              </div>

              {errors.form && (
                <div className="mb-4 p-3 bg-red-50 text-red-600 border border-red-200 rounded-xl text-sm text-center">{errors.form}</div>
              )}

              <form onSubmit={handleSubmit} className="space-y-5" autoComplete="off">
                <div ref={uniRef} className="relative">
                  <label className="block text-[13px] font-semibold text-gray-700 mb-1.5">University</label>
                  <input
                    type="text"
                    value={university ? `${university.name} — ${university.label}` : uniSearch}
                    onChange={e => { setUniSearch(e.target.value); setUniversity(null); setUniOpen(true); }}
                    onFocus={() => setUniOpen(true)}
                    onBlur={() => setTimeout(() => setUniOpen(false), 150)}
                    placeholder="Search your university..."
                    className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F9D0C4] focus:border-[#FA6C43] transition-all"
                  />
                  {uniOpen && filteredUnis.length > 0 && (
                    <div className="absolute top-full mt-1 left-0 right-0 bg-white border border-gray-200 rounded-xl shadow-lg z-20 max-h-48 overflow-y-auto">
                      {filteredUnis.map(u => (
                        <button key={u.id} type="button"
                          onMouseDown={() => { setUniversity(u); setUniSearch(''); setUniOpen(false); }}
                          className="w-full text-left px-4 py-2.5 hover:bg-[#FFF5F2] transition-colors text-sm">
                          <span className="font-bold text-[#FA6C43]">{u.name}</span>
                          <span className="text-gray-500"> — {u.label}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {university && (
                    <p className="mt-1.5 text-xs text-gray-500">Accepted: <span className="font-medium text-gray-700">{university.formats.join(', ')}</span></p>
                  )}
                </div>

                <div>
                  <label htmlFor="email" className="block text-[13px] font-semibold text-gray-700 mb-1.5">Email Address</label>
                  <input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="off"
                    className={`w-full px-4 py-3 bg-white border ${errors.email ? 'border-red-500' : 'border-gray-200'} rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F9D0C4] focus:border-[#FA6C43] transition-all`}
                    placeholder="your@email.com" />
                  {errors.email && <p className="mt-1 text-xs text-red-500">{errors.email}</p>}
                </div>

                <div>
                  <label htmlFor="username" className="block text-[13px] font-semibold text-gray-700 mb-1.5">Username</label>
                  <input id="username" type="text" value={username} onChange={e => setUsername(e.target.value)} autoComplete="off"
                    className={`w-full px-4 py-3 bg-white border ${errors.username ? 'border-red-500' : 'border-gray-200'} rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F9D0C4] focus:border-[#FA6C43] transition-all`}
                    placeholder="Choose a username" />
                  {errors.username && <p className="mt-1 text-xs text-red-500">{errors.username}</p>}
                </div>

                <div>
                  <label htmlFor="password" className="block text-[13px] font-semibold text-gray-700 mb-1.5">Password</label>
                  <div className={`relative rounded-xl border ${errors.password ? 'border-red-500' : 'border-gray-200'} focus-within:ring-2 focus-within:ring-[#F9D0C4] focus-within:border-[#FA6C43]`}>
                    <input id="password" type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password"
                      className="w-full pl-4 pr-12 py-3 bg-white rounded-xl text-sm border-0 focus:outline-none focus:ring-0"
                      placeholder="Create a strong password" />
                    <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-lg bg-gray-50 text-gray-500 hover:bg-gray-100 transition-colors">
                      {showPassword ? <FaEyeSlash style={{ width: '16px', height: '16px' }} /> : <FaEye style={{ width: '16px', height: '16px' }} />}
                    </button>
                  </div>
                  {password && (
                    <div className="mt-2.5">
                      <div className="flex gap-1 h-1.5 mb-1.5">
                        {[...Array(3)].map((_, i) => (
                          <div key={i} className={`flex-1 rounded-full transition-colors duration-300 ${
                            getPasswordStrength(password) === 'strong' && i <= 2 ? 'bg-emerald-500' :
                            getPasswordStrength(password) === 'medium' && i <= 1 ? 'bg-amber-400' :
                            getPasswordStrength(password) === 'weak' && i === 0 ? 'bg-red-400' : 'bg-gray-200'
                          }`} />
                        ))}
                      </div>
                      <p className="text-[11px] font-medium text-gray-500">Password strength: <span className={
                        getPasswordStrength(password) === 'strong' ? 'text-emerald-600' :
                        getPasswordStrength(password) === 'medium' ? 'text-amber-600' : 'text-red-500'
                      }>{getPasswordStrength(password).charAt(0).toUpperCase() + getPasswordStrength(password).slice(1)}</span></p>
                    </div>
                  )}
                  {errors.password && <p className="mt-1 text-xs text-red-500">{errors.password}</p>}
                </div>

                <button type="submit" disabled={isLoading}
                  className={`w-full py-3.5 px-4 rounded-xl font-bold flex items-center justify-center transition-all active:scale-[0.98] mt-4 ${
                    isFormValid() ? 'bg-[#FA6C43] hover:bg-[#E55B34] text-white' : 'bg-[#F9D0C4] hover:bg-[#F4BFB0] text-gray-900'
                  }`}>
                  {isLoading ? <div className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-solid border-current border-r-transparent mr-2" /> : null}
                  Create Student Account
                </button>
              </form>

              <p className="text-center text-sm text-gray-500 mt-6">
                Are you a professor? <Link to="/register" className="font-bold text-[#FA6C43] hover:underline">Register here</Link>
              </p>
              <p className="text-center text-sm text-gray-500 mt-2">
                Already have an account? <Link to="/login" className="font-bold text-[#FA6C43] hover:underline">Sign in</Link>
              </p>
            </>
          )}
        </div>

        {/* Right Hero Panel */}
        <div className="order-1 lg:order-2 w-full max-w-lg flex flex-col items-start">
          <img src={logo} alt="actrLabs Logo" className="h-10 lg:h-12 w-auto object-contain mb-8 lg:mb-10" />
          <div className="h-[100px] overflow-hidden">
            {slides.map((slide, index) => (
              <div key={index} className={`transition-all duration-700 ${index === currentSlide ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 absolute'}`}>
                {index === currentSlide && (
                  <h2 className="text-4xl sm:text-5xl font-medium tracking-tight leading-[1.2] text-[#222]">
                    {slide.line1}<br />{slide.line2}<br />
                    <span className="text-gray-400">{slide.prefix}</span>
                    <span className="text-[#FA6C43]">{slide.highlight}</span>
                  </h2>
                )}
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
};

export default StudentRegistrationPage;
