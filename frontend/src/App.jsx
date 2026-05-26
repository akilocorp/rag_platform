import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import './App.css'; // Assuming you still have some base CSS or will use Tailwind

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
import VideoDashboardPage from './pages/VideoDashboardPage';

// Import the ProtectedRoute component
import ProtectedRoute from './components/ProtectedRoute';
import ProfessorRoute from './components/ProfessorRoute';
import PublicChatRoute from './components/PublicChatRoute';
import { VariantProvider } from './context/VariantContext';

function App() {
  return (
    <VariantProvider>
    <Router>
      {/* Updated global background and text color to match the new light theme */}
      <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }} className="min-h-screen bg-[#F0F6FB] text-gray-900">
        <Routes>
          
          {/* Redirect root domain to the Home page */}
          <Route path="/" element={<Navigate to="/home" replace />} />

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

          {/* Video results — accessible via one-time token (anonymous) or logged-in owner/prof */}
          <Route path="/video-results/:submissionId" element={<VideoResultsPage />} />

          {/* Protected Routes - Professor only */}
          <Route element={<ProfessorRoute />}>
            <Route path="/config_list" element={<ConfigList />} />
            <Route path="/config" element={<ConfigPage />} />
            <Route path="/edit-config" element={<EditConfigPage />} />
            <Route path="/responses/:configId" element={<ResponsesPage />} />
            <Route path="/video-dashboard/:configId" element={<VideoDashboardPage />} />
            <Route path="/admin" element={<AdminPage />} />
          </Route>

        </Routes>
      </div>
    </Router>
    </VariantProvider>
  );
}

export default App;
