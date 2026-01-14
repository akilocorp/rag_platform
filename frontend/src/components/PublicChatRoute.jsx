import React, { useEffect, useState } from 'react';
import { Navigate, Outlet, useParams } from 'react-router-dom';
import axios from 'axios';
import { FaSpinner } from 'react-icons/fa';

const PublicChatRoute = ({ children }) => {
  const { configId } = useParams();
  const [canAccess, setCanAccess] = useState(null); // null=loading, true=show, false=redirect
  
  // 1. Check for Token (Are we logged in?)
  const token = localStorage.getItem('jwtToken') || localStorage.getItem('access_token');
  const isAuthenticated = !!token;

  useEffect(() => {
    const checkAccess = async () => {
      if (!configId) {
        setCanAccess(false);
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
            setCanAccess(false);
          }
        }

      } catch (error) {
        console.error('Access check failed:', error);
        // If the backend returned 401 (Unauthorized) or 403 (Forbidden),
        // it means we are definitely not allowed in.
        setCanAccess(false);
      }
    };

    checkAccess();
  }, [configId, token, isAuthenticated]);

  // --- RENDER STATES ---

  if (canAccess === null) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900">
        <FaSpinner className="animate-spin text-3xl text-indigo-400 mb-4" />
        <p className="text-gray-400">Verifying access...</p>
      </div>
    );
  }

  // If allowed, render the Chat Page (children or Outlet)
  if (canAccess) {
    return children ? children : <Outlet />;
  }

  // If not allowed, Redirect to Login
  return <Navigate to="/login" replace />;
};

export default PublicChatRoute;