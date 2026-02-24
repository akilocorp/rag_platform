import React from 'react';
import { Link } from 'react-router-dom';
import logo from '../assets/logo.png';
import { FaUserGraduate, FaFileAlt, FaShareAlt, FaCogs, FaCheckCircle, FaInfoCircle, FaComments, FaGraduationCap, FaBook, FaLightbulb } from 'react-icons/fa';
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
            <svg className="absolute w-full h-3 lg:h-4 -bottom-[14px] left-0 text-[#FA6C43]" viewBox="0 0 200 20" fill="none" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none">
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
          <button
            type="button"
            onClick={() => document.getElementById('how-actr-works')?.scrollIntoView({ behavior: 'smooth' })}
            className="py-4 px-8 rounded-xl font-bold border-2 border-gray-200 text-gray-700 bg-white hover:bg-gray-50 transition-all active:scale-[0.98] text-lg"
          >
            Learn More
          </button>
        </div>
      </div>

      {/* Core Features Grid */}
      <div id="how-actr-works" className="w-full max-w-[1440px] mx-auto px-6 lg:px-8 py-16 z-10">
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

      {/* Plans and Pricing */}
      <div className="relative bg-gray-100 py-16 overflow-hidden">
        {/* Academic icons pattern - faint, semi-transparent */}
        <div className="absolute inset-0 pointer-events-none opacity-[0.06]">
          <FaGraduationCap className="absolute top-[10%] left-[5%] text-6xl text-gray-600" />
          <FaBook className="absolute top-[20%] right-[15%] text-5xl text-gray-600" />
          <FaComments className="absolute top-[60%] left-[10%] text-5xl text-gray-600" />
          <FaLightbulb className="absolute top-[70%] right-[8%] text-6xl text-gray-600" />
          <FaGraduationCap className="absolute top-[40%] right-[25%] text-4xl text-gray-600" />
          <FaBook className="absolute top-[80%] left-[30%] text-4xl text-gray-600" />
          <FaComments className="absolute top-[15%] left-[40%] text-4xl text-gray-600" />
          <FaLightbulb className="absolute top-[50%] left-[20%] text-5xl text-gray-600" />
        </div>

        <div className="relative z-10 w-full max-w-[1440px] mx-auto px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl lg:text-4xl font-bold text-[#4338CA] tracking-tight mb-2">Pick your perfect plan</h2>
            <p className="text-gray-500 text-lg">Define your study environment</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {/* Free Plan */}
            <div className="bg-white rounded-[2rem] p-8 shadow-sm border border-gray-100 flex flex-col">
              <h3 className="text-2xl font-bold text-[#374151] mb-1">Free</h3>
              <p className="text-gray-500 text-sm mb-6">Individual students starting their research journey.</p>
              <div className="text-5xl font-bold text-[#374151] mb-8">$0</div>
              <Link
                to="/register"
                className="w-full py-3 px-6 rounded-xl font-semibold text-[#374151] bg-gray-200 hover:bg-gray-300 transition-all text-center mb-8"
              >
                Start For Free
              </Link>
              <div className="mt-auto">
                <p className="text-sm font-semibold text-[#374151] mb-4">What&apos;s included</p>
                <ul className="space-y-3">
                  <li className="flex items-start gap-2">
                    <FaCheckCircle className="text-emerald-500 mt-0.5 shrink-0" />
                    <span className="text-gray-600 text-sm">
                      Limited to 2-hour daily usage
                      <FaInfoCircle className="inline-block ml-1 text-gray-400 text-xs cursor-help" title="Usage resets daily" />
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <FaCheckCircle className="text-emerald-500 mt-0.5 shrink-0" />
                    <span className="text-gray-600 text-sm">Share PDFs, images, notes, and videos (up to 5 items)</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <FaCheckCircle className="text-emerald-500 mt-0.5 shrink-0" />
                    <span className="text-gray-600 text-sm">10 daily messages with top-tier models (like GPT-4o or Claude 3.5 Sonnet)</span>
                  </li>
                </ul>
              </div>
            </div>

            {/* Regular Plan - Popular */}
            <div className="bg-white rounded-[2rem] p-8 shadow-sm border border-gray-100 flex flex-col">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="text-2xl font-bold text-[#374151]">Regular</h3>
                <span className="px-3 py-0.5 rounded-full bg-amber-400 text-white text-xs font-semibold">Popular</span>
              </div>
              <p className="text-gray-500 text-sm mb-6">Audience Descriptor</p>
              <div className="text-5xl font-bold text-[#374151] mb-8">$3</div>
              <Link
                to="/register"
                className="w-full py-3 px-6 rounded-xl font-semibold text-white bg-[#7C3AED] hover:bg-[#6D28D9] transition-all text-center mb-8"
              >
                Start your 7-day trial
              </Link>
              <div className="mt-auto">
                <p className="text-sm font-semibold text-[#374151] mb-4">All Free features, plus</p>
                <ul className="space-y-3">
                  <li className="flex items-start gap-2">
                    <FaCheckCircle className="text-emerald-500 mt-0.5 shrink-0" />
                    <span className="text-gray-600 text-sm">No daily time limit</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <FaCheckCircle className="text-emerald-500 mt-0.5 shrink-0" />
                    <span className="text-gray-600 text-sm">No file upload limit</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <FaCheckCircle className="text-emerald-500 mt-0.5 shrink-0" />
                    <span className="text-gray-600 text-sm">Lorem ipsum dolor sit amet</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <FaCheckCircle className="text-emerald-500 mt-0.5 shrink-0" />
                    <span className="text-gray-600 text-sm">consectetur adipiscing elit. Etiam porttitor id leo sit amet elementum</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <FaCheckCircle className="text-emerald-500 mt-0.5 shrink-0" />
                    <span className="text-gray-600 text-sm">Phasellus et fringilla lectus. Duis eget elementum nisl</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <FaCheckCircle className="text-emerald-500 mt-0.5 shrink-0" />
                    <span className="text-gray-600 text-sm">Nullam pharetra risus varius, accumsan ligula eu, malesuada felis</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <FaCheckCircle className="text-emerald-500 mt-0.5 shrink-0" />
                    <span className="text-gray-600 text-sm">Praesent a tincidunt est. Mauris sed</span>
                  </li>
                </ul>
              </div>
            </div>

            {/* Pro Plan */}
            <div className="bg-white rounded-[2rem] p-8 shadow-sm border border-gray-100 flex flex-col">
              <div className="flex justify-center mb-4">
                <FaComments className="text-6xl text-[#374151]" />
              </div>
              <h3 className="text-2xl font-bold text-[#374151] mb-1">Pro</h3>
              <p className="text-gray-500 text-sm mb-6">Audience Descriptor</p>
              <a
                href="#"
                className="w-full py-3 px-6 rounded-xl font-semibold text-[#374151] bg-gray-200 hover:bg-gray-300 transition-all text-center mb-8 block"
              >
                Contact Sales
              </a>
              <div className="mt-auto">
                <p className="text-sm font-semibold text-[#374151] mb-4">All Regular features, plus</p>
                <ul className="space-y-3">
                  <li className="flex items-start gap-2">
                    <FaCheckCircle className="text-emerald-500 mt-0.5 shrink-0" />
                    <span className="text-gray-600 text-sm">No daily time limit</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <FaCheckCircle className="text-emerald-500 mt-0.5 shrink-0" />
                    <span className="text-gray-600 text-sm">No file upload limit</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <FaCheckCircle className="text-emerald-500 mt-0.5 shrink-0" />
                    <span className="text-gray-600 text-sm">Lorem ipsum dolor sit amet</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <FaCheckCircle className="text-emerald-500 mt-0.5 shrink-0" />
                    <span className="text-gray-600 text-sm">consectetur adipiscing elit. Etiam porttitor id leo sit amet elementum</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <FaCheckCircle className="text-emerald-500 mt-0.5 shrink-0" />
                    <span className="text-gray-600 text-sm">Phasellus et fringilla lectus. Duis eget elementum nisl</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <FaCheckCircle className="text-emerald-500 mt-0.5 shrink-0" />
                    <span className="text-gray-600 text-sm">Nullam pharetra risus varius, accumsan ligula eu, malesuada felis</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <FaCheckCircle className="text-emerald-500 mt-0.5 shrink-0" />
                    <span className="text-gray-600 text-sm">Eleifend aliquet magna</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <FaCheckCircle className="text-emerald-500 mt-0.5 shrink-0" />
                    <span className="text-gray-600 text-sm">Praesent a tincidunt est. Mauris sed</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <FaCheckCircle className="text-emerald-500 mt-0.5 shrink-0" />
                    <span className="text-gray-600 text-sm">Quisque aliquam dolor sed scelerisque dictum</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <FaCheckCircle className="text-emerald-500 mt-0.5 shrink-0" />
                    <span className="text-gray-600 text-sm">Aliquam iaculis neque felis</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <FaCheckCircle className="text-emerald-500 mt-0.5 shrink-0" />
                    <span className="text-gray-600 text-sm">vitae pretium velit mollis id</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <FaCheckCircle className="text-emerald-500 mt-0.5 shrink-0" />
                    <span className="text-gray-600 text-sm">Proin tempus ornare elit</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
};

export default HomePage;