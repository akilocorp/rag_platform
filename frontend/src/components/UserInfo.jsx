import React, { useState, useEffect } from 'react';
import apiClient from '../api/apiClient';
import { clearRememberMe } from '../utils/auth';
import { FaUser, FaChevronDown, FaSignOutAlt, FaShieldAlt } from 'react-icons/fa';
import { useNavigate } from 'react-router-dom';

const UserInfo = () => {
  const [userInfo, setUserInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showDropdown, setShowDropdown] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchUserInfo = async () => {
      try {
        const response = await apiClient.get('/auth/me');
        setUserInfo(response.data);
      } catch (error) {
        console.error('Error fetching user info:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchUserInfo();
  }, []);

  const handleLogout = async () => {
    try {
      await apiClient.post('/auth/logout');
      localStorage.removeItem('jwtToken');
      localStorage.removeItem('refreshToken');
      clearRememberMe();
      navigate('/login');
    } catch (error) {
      console.error('Error during logout:', error);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center">
        <div className="animate-spin h-4 w-4 border-2 border-indigo-500 border-t-transparent"></div>
      </div>
    );
  }

  if (!userInfo) {
    return null;
  }

  return (
    <div className="relative">
      <div className="flex items-center text-sm text-gray-400 cursor-pointer" onClick={(e) => {
        e.stopPropagation();
        setShowDropdown(!showDropdown);
      }}>
        <FaUser className="mr-2 text-[#FA6C43]" />
        <span>{userInfo.username}</span>
        <FaChevronDown className="ml-2 text-gray-400" />
      </div>

      {showDropdown && (
        <div className="absolute right-0 top-full mt-2 w-48 bg-white rounded-lg shadow-lg border border-gray-100 py-1 z-50">
          {userInfo.role === 'admin' && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowDropdown(false);
                navigate('/admin');
              }}
              className="block w-full px-3 py-1.5 text-left text-xs text-purple-700 bg-white flex items-center gap-2 hover:bg-purple-50 rounded-md border-0"
            >
              <FaShieldAlt className="w-4 h-4" />
              Admin Panel
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleLogout();
            }}
            className="block w-full px-3 py-1.5 text-left text-xs text-gray-900 bg-white flex items-center gap-2 hover:bg-gray-50 hover:outline-none hover:ring-0 rounded-md border-0"
          >
            <FaSignOutAlt className="w-4 h-4" />
            Logout
          </button>
        </div>
      )}
    </div>
  );
};

export default UserInfo;
