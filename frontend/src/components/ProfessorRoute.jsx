import React, { useState, useEffect } from 'react';
import { Navigate, Outlet, useNavigate } from 'react-router-dom';
import apiClient from '../api/apiClient';

const ProfessorRoute = () => {
  const token = localStorage.getItem('jwtToken');
  const navigate = useNavigate();

  const [role, setRole] = useState(localStorage.getItem('userRole') || 'professor');
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!token) return;
    apiClient.get('/auth/me')
      .then(res => {
        const r = res.data.role || 'professor';
        localStorage.setItem('userRole', r);
        setRole(r);
      })
      .catch(() => {})
      .finally(() => setChecked(true));
  }, [token]);

  if (!token) return <Navigate to="/login" replace />;

  if (role === 'student' && checked) {
    return (
      <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }} className="min-h-screen bg-[#F0F6FB] flex items-center justify-center p-6">
        <div className="bg-white rounded-[2rem] shadow-sm border border-gray-200 p-10 max-w-md w-full text-center">
          <div className="text-5xl mb-4">🎓</div>
          <h2 className="text-2xl font-bold text-[#222] mb-3">You're registered as a student</h2>
          <p className="text-gray-500 mb-8 text-sm leading-relaxed">
            This area is for professors and researchers. Ask your professor to send you the chat link for your activity.
          </p>
          <button
            onClick={() => {
              localStorage.removeItem('jwtToken');
              localStorage.removeItem('refreshToken');
              localStorage.removeItem('userRole');
              navigate('/login');
            }}
            className="px-6 py-3 bg-[#FA6C43] hover:bg-[#E55B34] text-white font-bold rounded-xl transition-all"
          >
            Log out
          </button>
        </div>
      </div>
    );
  }

  return <Outlet />;
};

export default ProfessorRoute;
