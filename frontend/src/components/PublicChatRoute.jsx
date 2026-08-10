import React, { useEffect, useState } from 'react';
import { Link, Navigate, Outlet, useLocation, useParams } from 'react-router-dom';
import axios from 'axios';
import { FaLock } from 'react-icons/fa';
import LoadingScreen from './LoadingScreen';

const PublicChatRoute = ({ children }) => {
  const { configId } = useParams();
  const location = useLocation();
  // null=loading, true=show, 'login'=needs sign-in, 'denied'=signed in but not permitted
  const [canAccess, setCanAccess] = useState(null);

  // 1. Check for Token (Are we logged in?)
  const token = localStorage.getItem('jwtToken') || localStorage.getItem('access_token');
  const isAuthenticated = !!token;

  useEffect(() => {
    const checkAccess = async () => {
      if (!configId) {
        setCanAccess('denied');
        return;
      }

      try {
        // 2. Prepare Headers
        // WE MUST send the token if we have it. 
        // This ensures that if it's a Private bot but WE are the owner, it succeeds.
        const headers = token ? { Authorization: `Bearer ${token}` } : {};

        // 3. Fetch Config
        const response = await axios.get(`/api/config/${configId}`, { headers });
        const config = response.data.config;

        // 4. Decision Logic
        if (config.is_public) {
          // It's public -> Everyone allowed
          setCanAccess(true);
        } else {
          // It's private -> Only allowed if logged in (which the 200 OK response implies)
          if (isAuthenticated) {
            setCanAccess(true);
          } else {
            // Private + No Token -> Login
            setCanAccess('login');
          }
        }

      } catch (error) {
        console.error('Access check failed:', error);
        // 401 means "we don't know who you are" — signing in can fix that.
        // 403 means the server knows exactly who we are and said no, so bouncing
        // to the login screen would just look like a surprise logout.
        setCanAccess(error.response?.status === 403 ? 'denied' : 'login');
      }
    };

    checkAccess();
  }, [configId, token, isAuthenticated]);

  // --- RENDER STATES ---

  // Same loader the route transition uses, so entering a class is one continuous
  // screen rather than an illustrated overlay that fades into a bare spinner.
  if (canAccess === null) return <LoadingScreen />;

  // If allowed, render the Chat Page (children or Outlet)
  if (canAccess === true) {
    return children ? children : <Outlet />;
  }

  // Signed in, but this space isn't ours and we're not in its class. Say so —
  // don't dump the user on /login, which reads as being logged out.
  if (canAccess === 'denied') {
    return (
      <div
        style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
        className="min-h-screen bg-[#F0F6FB] flex items-center justify-center px-4"
      >
        <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center">
          <div className="w-16 h-16 bg-[#FFF5F2] rounded-full flex items-center justify-center mx-auto mb-5">
            <FaLock className="text-2xl text-[#FA6C43]" />
          </div>
          <h2 className="text-xl font-extrabold text-[#222] mb-2">This space is private</h2>
          <p className="text-sm text-gray-500 mb-6">
            You're still signed in, but this assistant isn't shared with you. Ask your
            professor for the class link, or check that you're on the right account.
          </p>
          <Link
            to="/student-dashboard"
            className="block w-full py-3 rounded-xl font-bold text-white bg-[#FA6C43] hover:bg-[#E55B34] transition-colors"
          >
            Back to my dashboard
          </Link>
        </div>
      </div>
    );
  }

  // Genuinely not signed in — send them to log in, and back here afterwards.
  return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
};

export default PublicChatRoute;