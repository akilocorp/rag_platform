import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FaSpinner } from 'react-icons/fa';
import apiClient from '../api/apiClient';

const StudentChatPage = () => {
  const navigate = useNavigate();

  useEffect(() => {
    apiClient.get('/student/personal-config')
      .then(res => navigate(`/chat/${res.data.config_id}`, { replace: true }))
      .catch(() => navigate('/login', { replace: true }));
  }, [navigate]);

  return (
    <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }} className="min-h-screen bg-[#F0F6FB] flex items-center justify-center">
      <FaSpinner className="animate-spin text-3xl text-[#FA6C43]" />
    </div>
  );
};

export default StudentChatPage;
