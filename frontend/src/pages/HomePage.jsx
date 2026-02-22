import React from 'react';
import { Link } from 'react-router-dom';
import logo from '../assets/logo.png';
import { FaUserGraduate, FaFileAlt, FaShareAlt, FaCogs, FaCheckCircle } from 'react-icons/fa';
import Navbar from './NavBar';

const HomePage = () => {
  return (
    <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }} className="min-h-screen bg-[#F0F6FB] text-gray-900 flex flex-col relative overflow-hidden">
      
      {/* Navbar */}
      <Navbar/>

      {/* Hero Section */}
      <div className="w-full max-w-[1440px] mx-auto px-6 lg:px-8 pt-12 lg:pt-24 pb-16 z-10 flex flex-col items-center text-center">
        <h1 className="text-5xl lg:text-7xl font-bold text-[#222] tracking-tight leading-[1.1] mb-6 max-w-4xl">
          Bring custom AI assistants to your <span className="relative inline-block">
            classroom
            {/* Dynamic, non-scaling SVG underline */}
            <svg className="absolute w-full h-3 lg:h-4 -bottom-1 left-0 text-[#FA6C43]" viewBox="0 0 200 20" fill="none" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none">
              <path d="M2 15.5C45.5 5.5 120 -2 198 12" stroke="currentColor" strokeWidth="4" strokeLinecap="round" vectorEffect="non-scaling-stroke"/>
            </svg>
          </span>.
        </h1>
        <p className="text-lg lg:text-xl text-gray-600 font-medium max-w-3xl mb-10 leading-relaxed">
          Actr empowers faculty to create custom chatbots using top models like ChatGPT, Gemini, and Qwen. Upload your course files, set instructions, and instantly distribute them to students for test prep, tutoring, and assessments.
        </p>
        <div className="flex flex-col sm:flex-row space-y-4 sm:space-y-0 sm:space-x-4">
          <Link to="/register" className="py-4 px-8 rounded-xl font-bold text-white bg-[#FA6C43] hover:bg-[#E55B34] transition-all active:scale-[0.98] shadow-sm text-lg">
            Get Started
          </Link>
          <Link to="/about_us" className="py-4 px-8 rounded-xl font-bold border-2 border-gray-200 text-gray-700 bg-white hover:bg-gray-50 transition-all active:scale-[0.98] text-lg">
            Learn More
          </Link>
        </div>
      </div>

      {/* Core Features Grid */}
      <div className="w-full max-w-[1440px] mx-auto px-6 lg:px-8 py-16 z-10">
        <div className="text-center mb-12">
          <h2 className="text-3xl lg:text-4xl font-bold text-[#222] tracking-tight">How Actr Works</h2>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Feature 1 */}
          <div className="bg-white p-8 rounded-[2rem] shadow-sm border border-gray-100 hover:border-[#FA6C43]/30 transition-colors">
            <div className="w-14 h-14 bg-[#F9D0C4]/40 rounded-2xl flex items-center justify-center text-[#FA6C43] mb-6">
              <FaCogs className="text-2xl" />
            </div>
            <h3 className="text-xl font-bold text-[#222] mb-3">Choose Your Model</h3>
            <p className="text-gray-600 font-medium leading-relaxed">
              Select the best AI for the job. Whether it's ChatGPT, Gemini, or Qwen, you have full control over the engine powering your classroom assistant.
            </p>
          </div>

          {/* Feature 2 */}
          <div className="bg-white p-8 rounded-[2rem] shadow-sm border border-gray-100 hover:border-[#FA6C43]/30 transition-colors">
            <div className="w-14 h-14 bg-[#F9D0C4]/40 rounded-2xl flex items-center justify-center text-[#FA6C43] mb-6">
              <FaFileAlt className="text-2xl" />
            </div>
            <h3 className="text-xl font-bold text-[#222] mb-3">Upload Your Knowledge</h3>
            <p className="text-gray-600 font-medium leading-relaxed">
              Upload your syllabus, lecture slides, and reading materials. Actr grounds the AI in your specific documents so it gives accurate, relevant answers.
            </p>
          </div>

          {/* Feature 3 */}
          <div className="bg-white p-8 rounded-[2rem] shadow-sm border border-gray-100 hover:border-[#FA6C43]/30 transition-colors">
            <div className="w-14 h-14 bg-[#F9D0C4]/40 rounded-2xl flex items-center justify-center text-[#FA6C43] mb-6">
              <FaShareAlt className="text-2xl" />
            </div>
            <h3 className="text-xl font-bold text-[#222] mb-3">Distribute with a Click</h3>
            <p className="text-gray-600 font-medium leading-relaxed">
              Generate a secure link to share your custom chatbot with your class. Perfect for homework help, exam preparation, or interactive assignments.
            </p>
          </div>

          {/* Feature 4 */}
          <div className="bg-white p-8 rounded-[2rem] shadow-sm border border-gray-100 hover:border-[#FA6C43]/30 transition-colors">
            <div className="w-14 h-14 bg-[#F9D0C4]/40 rounded-2xl flex items-center justify-center text-[#FA6C43] mb-6">
              <FaUserGraduate className="text-2xl" />
            </div>
            <h3 className="text-xl font-bold text-[#222] mb-3">Empower Students</h3>
            <p className="text-gray-600 font-medium leading-relaxed">
              Give students a safe, tailored AI environment to test their knowledge, ask questions without fear of judgment, and prepare for success.
            </p>
          </div>
        </div>
      </div>

      
      {/* Advantage Section */}
      <div className="w-full max-w-[1440px] mx-auto px-6 lg:px-8 py-16 z-10 mb-10">
        <div className="bg-[#222] rounded-[2.5rem] p-10 lg:p-16 text-white relative overflow-hidden shadow-xl">
          <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-[#FA6C43] rounded-full blur-[120px] opacity-20 pointer-events-none"></div>
          
          <h2 className="text-3xl lg:text-4xl font-bold mb-8 relative z-10">Why faculty choose Actr</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 relative z-10">
            <div className="flex items-start space-x-3">
              <FaCheckCircle className="text-[#FA6C43] text-xl mt-1 shrink-0" />
              <p className="text-gray-300 font-medium text-lg">Model flexibility: Effortlessly switch between GPT-4, Gemini, and DeepSeek.</p>
            </div>
            <div className="flex items-start space-x-3">
              <FaCheckCircle className="text-[#FA6C43] text-xl mt-1 shrink-0" />
              <p className="text-gray-300 font-medium text-lg">Contextual accuracy: AI grounded strictly in your uploaded course files.</p>
            </div>
            <div className="flex items-start space-x-3">
              <FaCheckCircle className="text-[#FA6C43] text-xl mt-1 shrink-0" />
              <p className="text-gray-300 font-medium text-lg">Admin visibility: Access structured chat logs to see where students need help.</p>
            </div>
            <div className="flex items-start space-x-3">
              <FaCheckCircle className="text-[#FA6C43] text-xl mt-1 shrink-0" />
              <p className="text-gray-300 font-medium text-lg">Seamless integrations: Connects directly with Qualtrics for academic research.</p>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
};

export default HomePage;