/**
 * @language  JavaScript (React / JSX)
 * @updated   2026-10-02
 * @changed   Dashboard shortcut + Back fallback follow the user's role via dashboardPath().
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { FaArrowLeft, FaThLarge } from 'react-icons/fa';
import { dashboardPath } from '../utils/auth';

const BTN = 'flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-[#FA6C43] px-3 py-1.5 rounded-lg border border-gray-200 hover:border-[#FA6C43] transition-colors';

/**
 * Consistent top nav for the video flow (upload / loading / results / compare).
 * "Back" uses history when available; the dashboard shortcut shows for any
 * logged-in user and goes to *their* dashboard — professors reviewing results
 * land on their space list, not the student dashboard. Anonymous viewers get none.
 */
export default function VideoNav({ className = '' }) {
  const navigate = useNavigate();
  const loggedIn = typeof window !== 'undefined' && !!localStorage.getItem('jwtToken');
  const goBack = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate(loggedIn ? dashboardPath() : '/');
  };
  return (
    <div className={`no-print flex items-center justify-between gap-3 ${className}`}>
      <button onClick={goBack} className={BTN}><FaArrowLeft /> Back</button>
      {loggedIn && (
        <button onClick={() => navigate(dashboardPath())} className={BTN}>
          <FaThLarge /> {localStorage.getItem('userRole') === 'student' ? 'Student Dashboard' : 'My Dashboard'}
        </button>
      )}
    </div>
  );
}
