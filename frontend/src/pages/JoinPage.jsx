import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { FaSpinner, FaFilm } from 'react-icons/fa';
import apiClient from '../api/apiClient';

export default function JoinPage() {
  const { classCode } = useParams();
  const navigate = useNavigate();

  const [config, setConfig] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [enrolling, setEnrolling] = useState(false);

  const isLoggedIn = !!localStorage.getItem('jwtToken');

  useEffect(() => {
    apiClient.get(`/config/by-class/${classCode}`)
      .then(res => setConfig(res.data))
      .catch(() => setError('Invalid or expired class code.'))
      .finally(() => setLoading(false));
  }, [classCode]);

  // Auto-enroll logged-in users
  useEffect(() => {
    if (!config || !isLoggedIn) return;
    setEnrolling(true);
    apiClient.post('/student/enroll', { class_code: classCode })
      .then(() => navigate('/student-dashboard'))
      .catch(() => navigate('/student-dashboard'));
  }, [config, isLoggedIn, classCode, navigate]);

  const wrap = inner => (
    <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }} className="min-h-screen bg-[#F0F6FB] flex items-center justify-center px-4">
      <div className="w-full max-w-md">{inner}</div>
    </div>
  );

  if (loading || enrolling) return wrap(
    <div className="text-center py-20"><FaSpinner className="animate-spin text-3xl text-[#FA6C43] mx-auto" /></div>
  );

  if (error) return wrap(
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center">
      <FaFilm className="text-4xl text-gray-300 mx-auto mb-4" />
      <h2 className="text-xl font-bold text-[#222] mb-2">Invalid Class Code</h2>
      <p className="text-sm text-gray-500">{error}</p>
    </div>
  );

  return wrap(
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center">
      <div className="w-16 h-16 bg-[#FFF5F2] rounded-full flex items-center justify-center mx-auto mb-5">
        <FaFilm className="text-2xl text-[#FA6C43]" />
      </div>
      <p className="text-xs font-bold uppercase tracking-wider text-[#FA6C43] mb-1">{classCode}</p>
      <h1 className="text-2xl font-extrabold text-[#222] mb-2">
        You've been invited to join
      </h1>
      <p className="text-lg font-semibold text-gray-600 mb-6">{config.bot_name}</p>

      <div className="space-y-3">
        <Link
          to={`/register?class=${encodeURIComponent(classCode)}&role=student`}
          className="block w-full py-3.5 rounded-xl font-bold text-white bg-[#FA6C43] hover:bg-[#E55B34] transition-colors text-center"
        >
          Create an Account
        </Link>
        <Link
          to={`/login?class=${encodeURIComponent(classCode)}`}
          className="block w-full py-3.5 rounded-xl font-bold text-[#FA6C43] border-2 border-[#FA6C43]/30 hover:border-[#FA6C43] transition-colors text-center"
        >
          I already have an account
        </Link>
      </div>
    </div>
  );
}
