import React, { useState, useEffect } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import apiClient from '../api/apiClient';

const ProfessorRoute = () => {
  const token = localStorage.getItem('jwtToken');

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
  if (role === 'student' && checked) return <Navigate to="/student-chat" replace />;

  return <Outlet />;
};

export default ProfessorRoute;
