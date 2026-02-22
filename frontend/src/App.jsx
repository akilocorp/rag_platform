import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import './App.css'; // Assuming you still have some base CSS or will use Tailwind

// Import your page components
import HomePage from './pages/HomePage';
import AboutPage from './pages/AboutPage';
import RegisterPage from './pages/RegistrationPage';
import LoginPage from './pages/LoginPage';
import ConfigPage from './pages/ConfigPage';
import ChatPage from './pages/ChatPage';
import ConfigList from './pages/ConfigList';
import EmailVerificationPage from './pages/EmailVerification';
import EditConfigPage from './pages/EditConfigPage';

// Import the ProtectedRoute component
import ProtectedRoute from './components/ProtectedRoute';
import PublicChatRoute from './components/PublicChatRoute'; 

function App() {
  return (
    <Router>
      {/* Updated global background and text color to match the new light theme */}
      <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }} className="min-h-screen bg-[#F0F6FB] text-gray-900">
        <Routes>
          
          {/* Redirect root domain to the Home page */}
          <Route path="/" element={<Navigate to="/home" replace />} />

          {/* Public Static Pages */}
          <Route path="/home" element={<HomePage />} />
          <Route path="/about" element={<AboutPage />} />

          {/* Public Auth Routes */}
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/verify-email" element={<EmailVerificationPage />} />

          {/* Chat Routes (Handled by PublicChatRoute to determine if auth is needed) */}
          <Route element={<PublicChatRoute />}>
            <Route path="/chat/:configId/:chatId?" element={<ChatPage />} />
            <Route path="/chat/:configId/:chatId/:qualtricsId" element={<ChatPage />} />
          </Route>

          {/* Protected Routes - Requires authentication */}
          <Route element={<ProtectedRoute />}>
            <Route path="/config_list" element={<ConfigList />} />
            <Route path="/config" element={<ConfigPage />} />
            <Route path="/edit-config" element={<EditConfigPage />} />
          </Route>

        </Routes>
      </div>
    </Router>
  );
}

export default App;