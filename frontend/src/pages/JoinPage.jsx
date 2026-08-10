import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { FaSpinner, FaFilm } from 'react-icons/fa';
import apiClient from '../api/apiClient';
import { studentPathFor } from '../utils/botTypes';

export default function JoinPage() {
  const { classCode } = useParams();
  const navigate = useNavigate();

  const [config, setConfig] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [enrolling, setEnrolling] = useState(false);

  const isLoggedIn = !!localStorage.getItem('jwtToken');

  useEffect(() => {
    apiClient.get(`/config/by-class/${classCode}`)
      .then(res => setConfig(res.data))
      .catch(() => setError('Invalid or expired class code.'))
      .finally(() => setLoading(false));
  }, [classCode]);

  // Where an enrolled student should land, by bot_type. Shared with the dashboard's
  // "Enter class" button and the professor's share links so all three agree.
  const studentRouteFor = (cfg) => studentPathFor(cfg?.bot_type, cfg?.config_id);

  // Already a member — nothing to consent to, just walk them back in.
  useEffect(() => {
    if (!config || !isLoggedIn || !config.enrolled) return;
    navigate(studentRouteFor(config), { replace: true });
  }, [config, isLoggedIn, navigate]);

  // Someone who accepted the invite and then signed in has already consented,
  // so don't ask a second time when login bounces them back here. Held in
  // sessionStorage, not the URL, so a crafted /join link can't set it.
  const consentKey = `joinConsent:${classCode}`;
  const carriedConsent = isLoggedIn && !!config && !config.enrolled && !!sessionStorage.getItem(consentKey);

  // Joining is opt-in: a signed-in student only enrols when they accept.
  const handleAccept = () => {
    sessionStorage.removeItem(consentKey);
    setEnrolling(true);
    const dest = studentRouteFor(config);
    apiClient.post('/student/enroll', { class_code: classCode })
      .then(() => navigate(dest))
      .catch(() => navigate(dest));
  };

  useEffect(() => {
    if (carriedConsent) handleAccept();
  }, [carriedConsent]);

  const handleDecline = () => {
    const role = localStorage.getItem('userRole');
    navigate(role === 'student' ? '/student-dashboard' : '/config_list', { replace: true });
  };

  const wrap = inner => (
    <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }} className="min-h-screen bg-[#F0F6FB] flex items-center justify-center px-4">
      <div className="w-full max-w-md">{inner}</div>
    </div>
  );

  // The already-enrolled redirect fires from an effect, so hold the spinner
  // rather than flashing a "join?" card at someone who is already a member.
  if (loading || enrolling || carriedConsent || (isLoggedIn && config?.enrolled)) return wrap(
    <div className="text-center py-20"><FaSpinner className="animate-spin text-3xl text-[#FA6C43] mx-auto" /></div>
  );

  if (error) return wrap(
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center">
      <FaFilm className="text-4xl text-gray-300 mx-auto mb-4" />
      <h2 className="text-xl font-bold text-[#222] mb-2">Invalid Class Code</h2>
      <p className="text-sm text-gray-500">{error}</p>
    </div>
  );

  return wrap(
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center">
      <div className="w-16 h-16 bg-[#FFF5F2] rounded-full flex items-center justify-center mx-auto mb-5">
        <FaFilm className="text-2xl text-[#FA6C43]" />
      </div>
      <p className="text-xs font-bold uppercase tracking-wider text-[#FA6C43] mb-1">{classCode.toUpperCase()}</p>
      <h1 className="text-2xl font-extrabold text-[#222] mb-2">
        You're about to join
      </h1>
      <p className="text-lg font-semibold text-gray-600 mb-2">{config.bot_name}</p>
      <p className="text-sm text-gray-500 mb-6">
        Your professor will see that you're in this class and be able to review your work in it.
      </p>

      {isLoggedIn ? (
        <div className="space-y-3">
          <button
            onClick={handleAccept}
            className="block w-full py-3.5 rounded-xl font-bold text-white bg-[#FA6C43] hover:bg-[#E55B34] transition-colors text-center"
          >
            Accept &amp; Join
          </button>
          <button
            onClick={handleDecline}
            className="block w-full py-3.5 rounded-xl font-bold text-gray-500 border-2 border-gray-200 hover:border-gray-300 transition-colors text-center"
          >
            Decline
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm font-semibold text-[#222] mb-1">Sign in to join</p>
          <Link
            onClick={() => sessionStorage.setItem(consentKey, '1')}
            to={`/register?class=${encodeURIComponent(classCode)}&role=student`}
            className="block w-full py-3.5 rounded-xl font-bold text-white bg-[#FA6C43] hover:bg-[#E55B34] transition-colors text-center"
          >
            Create an Account
          </Link>
          <Link
            onClick={() => sessionStorage.setItem(consentKey, '1')}
            to={`/login?class=${encodeURIComponent(classCode)}`}
            className="block w-full py-3.5 rounded-xl font-bold text-[#FA6C43] border-2 border-[#FA6C43]/30 hover:border-[#FA6C43] transition-colors text-center"
          >
            I already have an account
          </Link>
          <Link
            to="/"
            className="block w-full py-2 text-sm font-semibold text-gray-400 hover:text-gray-600 transition-colors text-center"
          >
            Decline
          </Link>
        </div>
      )}
    </div>
  );
}
