import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import logo from '../assets/logo.png'; // Adjust path if necessary

const Navbar = () => {
  const location = useLocation();

  // Helper function to check if a path is active
  const isActive = (path) => location.pathname === path;

  return (
    <nav className="w-full flex justify-between items-center px-6 lg:px-8 py-6 max-w-[1440px] mx-auto z-10">
      <Link to="/home" className="flex items-center hover:opacity-90 transition-opacity cursor-pointer">
        <img 
          src={logo} 
          alt="Actr Logo" 
          className="h-10 lg:h-12 w-auto object-contain" 
        />
      </Link>
      
      <div className="bg-white px-4 lg:px-6 py-2 rounded-2xl shadow-sm flex items-center space-x-4 lg:space-x-8">
        <Link 
          to="/home" 
          className={`text-sm lg:text-base transition-colors hidden sm:block ${
            isActive('/home') 
              ? 'text-[#FA6C43] font-bold' 
              : 'text-gray-700 font-medium hover:text-black'
          }`}
        >
          Home
        </Link>
        
        <Link 
          to="/about" 
          className={`text-sm lg:text-base transition-colors hidden sm:block ${
            isActive('/about') 
              ? 'text-[#FA6C43] font-bold' 
              : 'text-gray-700 font-medium hover:text-black'
          }`}
        >
          About Us
        </Link>

        {/* If we are already on the login page, maybe point to Register instead. Otherwise, point to Login. */}
        {isActive('/login') ? (
          <Link 
            to="/register" 
            className="bg-[#FA6C43] text-white px-4 lg:px-6 py-2 rounded-xl text-sm lg:text-base font-bold hover:bg-[#E55B34] transition-colors shadow-sm"
          >
            Register
          </Link>
        ) : (
          <Link 
            to="/login" 
            className="bg-[#FA6C43] text-white px-4 lg:px-6 py-2 rounded-xl text-sm lg:text-base font-bold hover:bg-[#E55B34] transition-colors shadow-sm"
          >
            Login
          </Link>
        )}
      </div>
    </nav>
  );
};

export default Navbar;