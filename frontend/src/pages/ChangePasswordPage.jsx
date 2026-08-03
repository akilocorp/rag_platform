// @language  JavaScript (React / JSX)
// @updated   2026-08-03
// @changed   New page: replaces an admin-issued one-time password (forced, no way past it) and doubles
//            as the ordinary change-password screen for everyone else.
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FaEye, FaEyeSlash, FaKey } from 'react-icons/fa';
import apiClient from '../api/apiClient';
import { dashboardPath } from '../utils/auth';
import Navbar from './NavBar';

const PASSWORD_RE = /^(?=.*[a-zA-Z])(?=.*\d)(?=.*[^a-zA-Z0-9]).{8,}$/;

// Mirrors the meter on ForgotPasswordPage so the two screens rate a password
// the same way.
const passwordStrength = (password) => {
  const hasLetter = /[a-zA-Z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSymbol = /[^a-zA-Z0-9]/.test(password);
  if (hasLetter && hasNumber && hasSymbol) return 'strong';
  if (hasLetter && hasNumber) return 'medium';
  return 'weak';
};

const ChangePasswordPage = () => {
  const navigate = useNavigate();
  const [forced, setForced] = useState(null);   // null until /auth/me answers
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  // /auth/me is reachable even while the password gate is up, so it is what
  // tells us whether to ask for the current password or hide the escape routes.
  useEffect(() => {
    if (!localStorage.getItem('jwtToken')) {
      navigate('/login', { replace: true });
      return;
    }
    apiClient.get('/auth/me')
      .then(res => setForced(!!res.data.must_change_password))
      .catch(() => setForced(false));
  }, [navigate]);

  const validate = () => {
    const next = {};
    if (forced === false && !currentPassword) {
      next.currentPassword = 'Enter your current password.';
    }
    if (!PASSWORD_RE.test(newPassword)) {
      next.newPassword = 'Password must be at least 8 characters with a letter, a number, and a special character.';
    }
    if (newPassword !== confirmPassword) {
      next.confirmPassword = 'Passwords do not match.';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  // On success the server issues fresh tokens — the old one still carries the
  // claim the API gate rejects, so swapping them is what actually unlocks the app.
  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError(null);
    if (!validate()) return;

    setIsLoading(true);
    try {
      const { data } = await apiClient.post('/auth/change-password', {
        current_password: currentPassword,
        new_password: newPassword,
        confirm_password: confirmPassword,
      });
      if (data.access_token) localStorage.setItem('jwtToken', data.access_token);
      if (data.refresh_token) localStorage.setItem('refreshToken', data.refresh_token);
      navigate(dashboardPath(), { replace: true });
    } catch (error) {
      setFormError(error.response?.data?.error || 'Could not update your password.');
    } finally {
      setIsLoading(false);
    }
  };

  const isFormValid = PASSWORD_RE.test(newPassword)
    && newPassword === confirmPassword
    && (forced !== false || !!currentPassword);

  const passwordField = (id, label, value, onChange, error, placeholder) => (
    <div>
      <label htmlFor={id} className="block text-[13px] font-semibold text-gray-700 mb-1.5">{label}</label>
      <div className={`relative overflow-hidden rounded-xl border ${error ? 'border-red-500' : 'border-gray-200'} focus-within:ring-2 focus-within:ring-inset focus-within:ring-[#F9D0C4] focus-within:border-[#FA6C43]`}>
        <input
          id={id}
          type={showPassword ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full pl-4 pr-[3.75rem] py-3 bg-white rounded-xl text-sm border-0 focus:outline-none focus:ring-0"
          placeholder={placeholder}
        />
        <button
          type="button"
          onClick={() => setShowPassword(!showPassword)}
          className="absolute right-0 top-0 bottom-0 w-[3.75rem] flex items-center justify-center text-gray-400 hover:text-gray-600 shrink-0"
        >
          {showPassword ? <FaEyeSlash size={20} /> : <FaEye size={20} />}
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  );

  return (
    <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }} className="min-h-screen bg-[#F0F6FB] text-gray-900 flex flex-col">
      <Navbar />
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12">
        <div className="w-full max-w-[420px] bg-white rounded-[2rem] shadow-sm p-8 lg:p-10">
          <div className="w-12 h-12 rounded-full bg-[#FFF5F2] flex items-center justify-center mb-4">
            <FaKey className="text-[#FA6C43]" />
          </div>

          <h1 className="text-2xl font-bold text-[#222] mb-2">
            {forced ? 'Set your password' : 'Change password'}
          </h1>
          <p className="text-gray-600 text-sm mb-6">
            {forced
              ? 'You signed in with a one-time password. Choose your own to finish setting up your account — it only works once.'
              : 'Pick a new password for your account.'}
          </p>

          {formError && (
            <div className="mb-6 p-3 bg-red-50 text-red-600 border border-red-200 rounded-xl text-sm text-center">
              {formError}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            {forced === false && passwordField(
              'currentPassword', 'Current password', currentPassword, setCurrentPassword,
              errors.currentPassword, 'Your current password',
            )}

            {passwordField(
              'newPassword', 'New password', newPassword, setNewPassword,
              errors.newPassword, 'Create a strong password',
            )}

            {newPassword && (
              <div className="-mt-2">
                <div className="flex gap-1 h-1.5 mb-1.5">
                  {[...Array(3)].map((_, i) => (
                    <div
                      key={i}
                      className={`flex-1 rounded-full transition-colors duration-300 ${
                        passwordStrength(newPassword) === 'strong' && i <= 2 ? 'bg-emerald-500' :
                        passwordStrength(newPassword) === 'medium' && i <= 1 ? 'bg-amber-400' :
                        passwordStrength(newPassword) === 'weak' && i === 0 ? 'bg-red-400' : 'bg-gray-200'
                      }`}
                    />
                  ))}
                </div>
                <p className="text-[11px] font-medium text-gray-500">
                  Password strength:{' '}
                  <span className={
                    passwordStrength(newPassword) === 'strong' ? 'text-emerald-600' :
                    passwordStrength(newPassword) === 'medium' ? 'text-amber-600' : 'text-red-500'
                  }>
                    {passwordStrength(newPassword).charAt(0).toUpperCase() + passwordStrength(newPassword).slice(1)}
                  </span>
                </p>
              </div>
            )}

            {passwordField(
              'confirmPassword', 'Confirm new password', confirmPassword, setConfirmPassword,
              errors.confirmPassword, 'Re-enter your new password',
            )}

            <button
              type="submit"
              disabled={!isFormValid || isLoading || forced === null}
              className="w-full py-3 px-4 rounded-xl font-bold text-white bg-[#FA6C43] hover:bg-[#E55B34] disabled:opacity-50 transition-all"
            >
              {isLoading ? 'Saving…' : 'Save password'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default ChangePasswordPage;
