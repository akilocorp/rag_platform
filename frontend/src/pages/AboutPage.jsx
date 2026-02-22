import React from 'react';
import { Link } from 'react-router-dom';
import logo from '../assets/logo.png';
import Navbar from './NavBar';

const AboutPage = () => {
  return (
    <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }} className="min-h-screen bg-[#F0F6FB] text-gray-900 flex flex-col relative overflow-hidden">
      
     <Navbar/>

      {/* Header Section */}
      <div className="w-full max-w-[1440px] mx-auto px-6 lg:px-8 pt-12 lg:pt-20 pb-10 z-10 text-center">
        <h1 className="text-4xl lg:text-5xl xl:text-6xl font-bold text-[#222] tracking-tight mb-6">
          Designed by <span className="text-[#FA6C43]">faculty</span>. Engineered by <span className="text-[#FA6C43]">students</span>.
        </h1>
        <p className="text-lg lg:text-xl text-gray-600 font-medium max-w-4xl mx-auto leading-relaxed mb-8">
          Actr was built from both sides of the desk. By combining the deep pedagogical expertise of our educators with the technical innovation of our student developers, we created an AI platform tailored specifically for real classroom needs. Grounded in experiential learning and research, Actr empowers both teaching and learning.
        </p>
      </div>

      {/* The Team Section */}
      <div className="w-full max-w-[1440px] mx-auto px-6 lg:px-8 py-12 z-10">
        <div className="bg-white rounded-[2rem] shadow-sm border border-gray-100 p-8 lg:p-12 mb-12">
          <h2 className="text-3xl font-bold text-[#222] mb-8 border-b border-gray-100 pb-4">Our Cross-Disciplinary Team</h2>
          
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
            <div>
              <h3 className="text-xl font-bold text-[#FA6C43] mb-4 uppercase tracking-wide text-sm">Project Leaders</h3>
              <ul className="space-y-4">
                <li className="flex items-center space-x-3">
                  <div className="w-10 h-10 bg-[#F0F6FB] rounded-full flex items-center justify-center text-[#FA6C43] font-bold">BB</div>
                  <span className="text-lg font-bold text-gray-900">Bradford Bitterly</span>
                </li>
                <li className="flex items-center space-x-3">
                  <div className="w-10 h-10 bg-[#F0F6FB] rounded-full flex items-center justify-center text-[#FA6C43] font-bold">SN</div>
                  <span className="text-lg font-bold text-gray-900">Stephen Nason</span>
                </li>
              </ul>
            </div>

            <div>
              <h3 className="text-xl font-bold text-[#FA6C43] mb-4 uppercase tracking-wide text-sm">Project Members</h3>
              <ul className="space-y-4">
                <li className="flex items-center space-x-3">
                  <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center text-gray-600 font-bold">YK</div>
                  <span className="text-lg font-medium text-gray-800">Yonathan A. Kidanemariam</span>
                </li>
                <li className="flex items-center space-x-3">
                  <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center text-gray-600 font-bold">XH</div>
                  <span className="text-lg font-medium text-gray-800">Xinjie (Monica) Huang</span>
                </li>
                <li className="flex items-center space-x-3">
                  <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center text-gray-600 font-bold">ML</div>
                  <span className="text-lg font-medium text-gray-800">Mingyu Li</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      {/* Adopters & Research Integration */}
      <div className="w-full max-w-[1440px] mx-auto px-6 lg:px-8 pb-20 z-10">
        <h2 className="text-3xl font-bold text-[#222] mb-8 text-center">People who are already using it</h2>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          <div className="bg-white p-8 rounded-[2rem] shadow-sm border border-gray-100">
            <h4 className="text-xl font-bold text-gray-900 mb-2">Carlos Fernández-Loría</h4>
            <p className="text-sm text-[#FA6C43] font-bold mb-4">Information Systems</p>
            <p className="text-gray-600 font-medium">Developing an AI Teaching Assistant for IS class.</p>
          </div>

          <div className="bg-white p-8 rounded-[2rem] shadow-sm border border-gray-100">
            <h4 className="text-xl font-bold text-gray-900 mb-2">Melvin McInnis, M.D.</h4>
            <p className="text-sm text-[#FA6C43] font-bold mb-4">Psychiatry & Research</p>
            <p className="text-gray-600 font-medium">Ran experiments with ~1,800 participants examining the effects of mania and depression on trust.</p>
          </div>

          <div className="bg-white p-8 rounded-[2rem] shadow-sm border border-gray-100">
            <h4 className="text-xl font-bold text-gray-900 mb-2">Siyin Chen</h4>
            <p className="text-sm text-[#FA6C43] font-bold mb-4">Assistant Professor</p>
            <p className="text-gray-600 font-medium">Designing study with over 100k participants examining effects of AI therapy bots.</p>
          </div>

        </div>
      </div>

      {/* Decorative Background Element */}
      <div className="absolute top-[20%] left-[-10%] w-[500px] h-[500px] bg-gradient-to-tr from-[#8FCBEA]/30 to-transparent rounded-full blur-[120px] pointer-events-none -z-10"></div>
    </div>
  );
};

export default AboutPage;