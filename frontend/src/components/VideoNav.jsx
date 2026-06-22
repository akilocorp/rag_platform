import React from 'react';
import { useNavigate } from 'react-router-dom';
import { FaArrowLeft, FaThLarge } from 'react-icons/fa';

const BTN = 'flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-[#FA6C43] px-3 py-1.5 rounded-lg border border-gray-200 hover:border-[#FA6C43] transition-colors';

/**
 * Consistent top nav for the video flow (upload / loading / results / compare).
 * "Back" uses history when available; the "Student Dashboard" shortcut only
 * shows for logged-in students (anonymous viewers have no dashboard).
 */
export default function VideoNav({ className = '' }) {
  const navigate = useNavigate();
  const loggedIn = typeof window !== 'undefined' && !!localStorage.getItem('jwtToken');
  const goBack = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate(loggedIn ? '/student-dashboard' : '/');
  };
  return (
    <div className={`no-print flex items-center justify-between gap-3 ${className}`}>
      <button onClick={goBack} className={BTN}><FaArrowLeft /> Back</button>
      {loggedIn && (
        <button onClick={() => navigate('/student-dashboard')} className={BTN}>
          <FaThLarge /> Student Dashboard
        </button>
      )}
    </div>
  );
}
