import React, { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import './App.css'; // Assuming you still have some base CSS or will use Tailwind
import MobileBlockPage from './pages/MobileBlockPage';

// Import your page components
import HomePage from './pages/HomePage';
import LandingV2 from './pages/LandingV2';
import AboutPage from './pages/AboutPage';
import RegisterPage from './pages/RegistrationPage';
import StudentRegistrationPage from './pages/StudentRegistrationPage';
import LoginPage from './pages/LoginPage';
import ConfigPage from './pages/ConfigPage';
import ChatPage from './pages/ChatPage';
import ConfigList from './pages/ConfigList';
import EmailVerificationPage from './pages/EmailVerification';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import EditConfigPage from './pages/EditConfigPage';
import GroupChatPage from './pages/GroupChatPage';
import ResponsesPage from './pages/ResponsesPage';
import AdminPage from './pages/AdminPage';
import StudentChatPage from './pages/StudentChatPage';
import VideoUploadPage from './pages/VideoUploadPage';
import VideoResultsPage from './pages/VideoResultsPage';
import VideoComparePage from './pages/VideoComparePage';
import VideoDashboardPage from './pages/VideoDashboardPage';
import JoinPage from './pages/JoinPage';
import StudentDashboardPage from './pages/StudentDashboardPage';
import ExperientialIndex from './pages/ExperientialIndex';
import ExperientialPage from './pages/ExperientialPage';
import NotFoundPage from './pages/NotFoundPage';

// Import the ProtectedRoute component
import ProtectedRoute from './components/ProtectedRoute';
import ProfessorRoute from './components/ProfessorRoute';
import PublicChatRoute from './components/PublicChatRoute';
import PageTransition from './components/PageTransition';
import { isLoggedIn, dashboardPath } from './utils/auth';

// Root: send logged-in users straight to their dashboard, everyone else to the landing page.
function RootRedirect() {
  return <Navigate to={isLoggedIn() ? dashboardPath() : '/home'} replace />;
}
function useIsMobile() {
  const detect = () => {
    if (typeof window === 'undefined') return false;
    const narrow = window.matchMedia('(max-width: 767px)').matches;
    const ua = navigator.userAgent || '';
    const mobileUA = /Android|webOS|iPhone|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
    return narrow || mobileUA;
  };
  const [isMobile, setIsMobile] = useState(detect);
  useEffect(() => {
    const onResize = () => setIsMobile(detect());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return isMobile;
}

function App() {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }} className="min-h-screen bg-[#F0F6FB] text-gray-900">
        <MobileBlockPage />
      </div>
    );
  }

  return (
    <Router>
      {/* Updated global background and text color to match the new light theme */}
      <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }} className="min-h-screen bg-[#F0F6FB] text-gray-900">
        <PageTransition>
        <Routes>

          {/* Root: dashboard if logged in, otherwise the Home page */}
          <Route path="/" element={<RootRedirect />} />

          {/* Public Static Pages */}
          <Route path="/home" element={<HomePage />} />
          <Route path="/v2" element={<LandingV2 />} />
          <Route path="/about" element={<AboutPage />} />

          {/* Public Auth Routes */}
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/student-register" element={<StudentRegistrationPage />} />
          <Route path="/student-chat" element={<StudentChatPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/verify-email" element={<EmailVerificationPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/group-chat/:configId" element={<GroupChatPage />}/>

          {/* Chat Routes (Handled by PublicChatRoute to determine if auth is needed) */}
          <Route element={<PublicChatRoute />}>
            <Route path="/chat/:configId/:chatId?" element={<ChatPage />} />
            <Route path="/chat/:configId/:chatId/:qualtricsId" element={<ChatPage />} />
            <Route path="/video-upload/:configId" element={<VideoUploadPage />} />
          </Route>

          {/* Video results / compare — accessible via one-time token (anonymous) or logged-in owner/prof */}
          <Route path="/video-results/:submissionId" element={<VideoResultsPage />} />
          <Route path="/video/compare/:configId" element={<VideoComparePage />} />

          {/* Experiential simulation labs — scripted, no auth needed (no LLM/data calls) */}
          <Route path="/experiential" element={<ExperientialIndex />} />
          <Route path="/experiential/c/:configId" element={<ExperientialPage />} />
          <Route path="/experiential/:templateId" element={<ExperientialPage />} />

          {/* Join link — public, redirects to register/login with class code */}
          <Route path="/join/:classCode" element={<JoinPage />} />

          {/* Student dashboard — requires login */}
          <Route element={<ProtectedRoute />}>
            <Route path="/student-dashboard" element={<StudentDashboardPage />} />
          </Route>

          {/* Protected Routes - Professor only */}
          <Route element={<ProfessorRoute />}>
            <Route path="/config_list" element={<ConfigList />} />
            <Route path="/config" element={<ConfigPage />} />
            <Route path="/edit-config" element={<EditConfigPage />} />
            <Route path="/responses/:configId" element={<ResponsesPage />} />
            <Route path="/video-dashboard/:configId" element={<VideoDashboardPage />} />
            <Route path="/admin" element={<AdminPage />} />
          </Route>

          {/* Catch-all 404 — must be the last route */}
          <Route path="*" element={<NotFoundPage />} />

        </Routes>
        </PageTransition>
      </div>
    </Router>
  );
}

export default App;
