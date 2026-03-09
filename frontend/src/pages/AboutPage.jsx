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
      </div>

      {/* The Team Section */}
      <div className="w-full max-w-[1440px] mx-auto px-6 lg:px-8 py-12 z-10">
        <h2 className="text-3xl font-bold text-[#222] mb-8 text-center">Our Cross-Disciplinary Team</h2>
        
        <div className="space-y-8 mb-12">
          <h3 className="text-xl font-bold text-[#FA6C43] uppercase tracking-wide text-sm">Project Leaders</h3>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="bg-white p-8 rounded-[2rem] shadow-sm border border-gray-100">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 bg-[#F0F6FB] rounded-full flex items-center justify-center text-[#FA6C43] font-bold shrink-0">BB</div>
                <h4 className="text-xl font-bold text-gray-900">T. Bradford Bitterly</h4>
              </div>
              <p className="text-gray-600 font-medium leading-relaxed">
                He is an Assistant Professor in the Department of Management at the HKUST Business School, Hong Kong University of Science and Technology, focusing on negotiation, power, trust, and communication. He earned his Ph.D. in Operations, Information and Decisions from The Wharton School, University of Pennsylvania and a B.A. in Psychology from the University of Notre Dame.
              </p>
            </div>
            <div className="bg-white p-8 rounded-[2rem] shadow-sm border border-gray-100">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 bg-[#F0F6FB] rounded-full flex items-center justify-center text-[#FA6C43] font-bold shrink-0">SN</div>
                <h4 className="text-xl font-bold text-gray-900">Stephen W. Nason</h4>
              </div>
              <p className="text-gray-600 font-medium leading-relaxed">
                Prof. Nason has taught at The Hong Kong University of Science and Technology since 1995. He is a faculty member in the Department of Management and the Co-director of LABU (Language-Business Case Program). Prof. Nason has worked with a variety of organizations, including Samsung Electronics, Cisco, Motorola, and the Health Care forum.
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-8">
          <h3 className="text-xl font-bold text-[#FA6C43] uppercase tracking-wide text-sm">Project Members</h3>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="bg-white p-8 rounded-[2rem] shadow-sm border border-gray-100">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center text-gray-600 font-bold shrink-0">XH</div>
                <h4 className="text-xl font-bold text-gray-900">Monica Xinjie Huang</h4>
              </div>
              <p className="text-gray-600 font-medium leading-relaxed text-sm">
                Monica Xinjie Huang is a Research Assistant in the Department of Management at the Hong Kong University of Science and Technology (HKUST), Hong Kong SAR, China. Her work focuses on how AI influences psychological interpersonal perceptions in organizations. Her research interests include AI adoption, trust, and status.
              </p>
            </div>
            <div className="bg-white p-8 rounded-[2rem] shadow-sm border border-gray-100">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center text-gray-600 font-bold shrink-0">YK</div>
                <h4 className="text-xl font-bold text-gray-900">Yonathan Aklilu Kidanemariam</h4>
              </div>
              <p className="text-gray-600 font-medium leading-relaxed text-sm">
                Yonathan Aklilu Kidanemariam is a second year GBUS student at HKUST. He is a Research Assistant in the Department of Management at the Hong Kong University of Science and Technology (HKUST). He has extensive experience in developing AI platforms dedicated to helping researchers and faculty.
              </p>
            </div>
            <div className="bg-white p-8 rounded-[2rem] shadow-sm border border-gray-100">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center text-gray-600 font-bold shrink-0">ML</div>
                <h4 className="text-xl font-bold text-gray-900">Mingyu Li</h4>
              </div>
              <p className="text-gray-600 font-medium leading-relaxed text-sm">
                Mingyu Li is a Ph.D. Candidate at HKUST Business School. She has worked in extensive research in power, trust, and communication. She provides insight from a researcher&apos;s perspective in helping Actr tailor the platform to serve that segment.
              </p>
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