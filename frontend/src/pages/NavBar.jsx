// @language  JavaScript (React / JSX)
// @updated   2026-10-02
// @changed   Phones get a menu button + fade-in dropdown with Home / About Us / Guide / Plan my course
//            (those links were hidden below sm with no replacement).
// @changed   Prior: Logo -> '/', Home -> '/v2' (the real landing page) instead of the old /home splash.
// @changed   Prior: Added a "Plan my course" link to the public syllabus advisor.
//            Prior: added a Guide link so the /userguide site is reachable before anyone signs in.
import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import logo from '../assets/logo.png'; // Adjust path if necessary
import { isLoggedIn, dashboardPath } from '../utils/auth';
import { FiMenu, FiX } from 'react-icons/fi';

// Nav links shared by the desktop row and the phone menu; `match` decides when a link is lit.
// Guide stays lit on every /userguide sub-page. Guide and Plan my course are reachable logged
// out on purpose — a professor who hasn't signed up yet is exactly who they're for.
const NAV_LINKS = [
  { to: '/v2', label: 'Home', match: (p) => p === '/v2' },
  { to: '/about', label: 'About Us', match: (p) => p === '/about' },
  { to: '/userguide', label: 'Guide', match: (p) => p.startsWith('/userguide') },
  { to: '/course-plan', label: 'Plan my course', match: (p) => p.startsWith('/course-plan') },
];

const Navbar = () => {
  const location = useLocation();

  // Helper function to check if a path is active
  const isActive = (path) => location.pathname === path;

  const loggedIn = isLoggedIn();
  const [menuOpen, setMenuOpen] = useState(false);

  // Phone menu closes on navigation and on Escape.
  useEffect(() => { setMenuOpen(false); }, [location.pathname]);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e) => { if (e.key === 'Escape') setMenuOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  // nav is raised while the phone menu is open: page sections below also sit at z-10 and would cover the dropdown
  return (
    <nav className={`relative w-full flex justify-between items-center px-6 lg:px-8 py-6 max-w-[1440px] mx-auto ${menuOpen ? 'z-30' : 'z-10'}`}>
      <Link to="/" className="flex items-center hover:opacity-90 transition-opacity cursor-pointer">
        <img 
          src={logo} 
          alt="Actr Logo" 
          className="h-10 lg:h-12 w-auto object-contain" 
        />
      </Link>
      
      <div className="bg-white px-4 lg:px-6 py-2 rounded-2xl shadow-sm flex items-center space-x-4 lg:space-x-8">
        {NAV_LINKS.map(({ to, label, match }) => (
          <Link
            key={to}
            to={to}
            className={`text-sm lg:text-base transition-colors hidden sm:block ${
              match(location.pathname)
                ? 'text-[#FA6C43] font-bold hover:text-[#FA6C43]'
                : 'text-gray-700 font-medium hover:text-[#F8CABA]'
            }`}
          >
            {label}
          </Link>
        ))}

        {/* Logged in → Dashboard. On the login page → Register. Otherwise → Login. */}
        {loggedIn ? (
          <Link
            to={dashboardPath()}
            className="bg-[#FA6C43] text-white px-4 lg:px-6 py-2 rounded-xl text-sm lg:text-base font-bold hover:text-[#F8CABA] transition-colors shadow-sm"
          >
            Dashboard
          </Link>
        ) : isActive('/login') ? (
          <Link
            to="/register"
            className="bg-[#FA6C43] text-white px-4 lg:px-6 py-2 rounded-xl text-sm lg:text-base font-bold hover:text-[#F8CABA] transition-colors shadow-sm"
          >
            Register
          </Link>
        ) : (
          <Link
            to="/login"
            className="bg-[#FA6C43] text-white px-4 lg:px-6 py-2 rounded-xl text-sm lg:text-base font-bold hover:text-[#F8CABA] transition-colors shadow-sm"
          >
            Login
          </Link>
        )}

        <button
          type="button"
          onClick={() => setMenuOpen((o) => !o)}
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={menuOpen}
          className="sm:hidden -mr-1 p-2 rounded-lg text-gray-700 hover:text-[#FA6C43] transition-colors"
        >
          {menuOpen ? <FiX className="w-5 h-5" /> : <FiMenu className="w-5 h-5" />}
        </button>
      </div>

      {/* Phone menu: the links hidden from the pill below sm. Fade only, per the house motion rule. */}
      {menuOpen && (
        <div className="sm:hidden absolute left-6 right-6 top-full -mt-3 z-20 bg-white rounded-2xl shadow-lg border border-gray-100 py-2"
          style={{ opacity: 0, animation: 'fac-fade-in 150ms ease-out forwards' }}
        >
          {NAV_LINKS.map(({ to, label, match }) => (
            <Link
              key={to}
              to={to}
              className={`block px-5 py-3 text-base transition-colors ${
                match(location.pathname) ? 'text-[#FA6C43] font-bold' : 'text-gray-700 font-medium hover:text-[#FA6C43]'
              }`}
            >
              {label}
            </Link>
          ))}
        </div>
      )}
    </nav>
  );
};

export default Navbar;
