/**
 * @language  JavaScript (React / JSX)
 * @updated   2026-10-02
 * @changed   Only 401/422 go to login; a missing space or server failure gets its own card (was a login loop for signed-in users).
 * @changed   Prior: Private-space screen: role-aware copy and Back goes to dashboardPath() instead of always /student-dashboard.
 */
import React, { useEffect, useState } from 'react';
import { Link, Navigate, Outlet, useLocation, useParams } from 'react-router-dom';
import axios from 'axios';
import { FaLock } from 'react-icons/fa';
import LoadingScreen from './LoadingScreen';
import { dashboardPath } from '../utils/auth';

const PublicChatRoute = ({ children }) => {
  const { configId } = useParams();
  const location = useLocation();
  // null=loading, true=show, 'login'=needs sign-in, 'denied'=signed in but not permitted,
  // 'missing'=no such space, 'unavailable'=server/network failure
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
        // 401/422 mean "we don't know who you are" — signing in can fix that.
        // 403 means the server knows exactly who we are and said no, so bouncing
        // to the login screen would just look like a surprise logout. 400/404 and
        // server/network errors aren't fixed by logging in either — sending those to
        // /login looped a signed-in user straight back to the same failing URL.
        const status = error.response?.status;
        if (status === 401 || status === 422) setCanAccess('login');
        else if (status === 403) setCanAccess('denied');
        else if (status === 400 || status === 404) setCanAccess('missing');
        else setCanAccess('unavailable');
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
  // Copy and the way back depend on role: a professor here has no "professor" to ask.
  if (canAccess === 'denied') {
    const isStudent = localStorage.getItem('userRole') === 'student';
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
            {isStudent
              ? "You're still signed in, but this assistant isn't shared with you. Ask your professor for the class link, or check that you're on the right account."
              : "You're still signed in, but this assistant belongs to another account. Ask its owner to add you as a collaborator, or check that you're on the right account."}
          </p>
          <Link
            to={dashboardPath()}
            className="block w-full py-3 rounded-xl font-bold text-white bg-[#FA6C43] hover:bg-[#E55B34] transition-colors"
          >
            Back to my dashboard
          </Link>
        </div>
      </div>
    );
  }

  // The space doesn't exist, or the server couldn't be reached. Logging in won't help,
  // so say what happened; a server failure gets a retry.
  if (canAccess === 'missing' || canAccess === 'unavailable') {
    const missing = canAccess === 'missing';
    return (
      <div
        style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
        className="min-h-screen bg-[#F0F6FB] flex items-center justify-center px-4"
      >
        <div role="alert" className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center">
          <h2 className="text-xl font-extrabold text-[#222] mb-2">
            {missing ? "This space doesn't exist" : "We couldn't load this space"}
          </h2>
          <p className="text-sm text-gray-500 mb-6">
            {missing
              ? 'The link may be mistyped, or the space may have been deleted. Check the link with whoever shared it.'
              : 'Something went wrong on our side or with your connection. Please try again in a moment.'}
          </p>
          {missing ? (
            <Link
              to={isAuthenticated ? dashboardPath() : '/'}
              className="block w-full py-3 rounded-xl font-bold text-white bg-[#FA6C43] hover:bg-[#E55B34] transition-colors"
            >
              {isAuthenticated ? 'Back to my dashboard' : 'Go to home page'}
            </Link>
          ) : (
            <button
              onClick={() => window.location.reload()}
              className="block w-full py-3 rounded-xl font-bold text-white bg-[#FA6C43] hover:bg-[#E55B34] transition-colors"
            >
              Try again
            </button>
          )}
        </div>
      </div>
    );
  }

  // Genuinely not signed in — send them to log in, and back here afterwards.
  return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
};

export default PublicChatRoute;