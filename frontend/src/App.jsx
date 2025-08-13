// import { useState } from 'react';
import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link,  Navigate } from 'react-router-dom'; // <--- Make sure Navigate is here!
import './App.css'; // Assuming you still have some base CSS or will use Tailwind


// Import your page components
import RegisterPage from './pages/RegistrationPage';
import LoginPage from './pages/LoginPage';
import ConfigPage from './pages/ConfigPage';
import QualtricsConfigPage from './pages/QualtricsConfigPage';
import ChatPage from './pages/ChatPage';
import ConfigList from './pages/ConfigList';
import EmailVerificationPage from './pages/EmailVerification';
import SideBar from './components/SideBar'; // Import the SideBar component
import EditConfigPage from './pages/EditConfigPage';

// Import the ProtectedRoute component
import ProtectedRoute from './components/ProtectedRoute';
import PublicChatRoute from './components/PublicChatRoute'; 

function App() {
  // You might manage authentication state here or in a context
  // For now, ProtectedRoute directly checks localStorage.

  return (
    <Router>
      <div className="min-h-screen bg-gray-900 text-white">
        <Routes>
          {/* Public Routes - No authentication required */}
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/verify-email" element={<EmailVerificationPage />} />
          <Route element={<PublicChatRoute />}>
            <Route path="/chat/:configId/:chatId?" element={<ChatPage />} />
            <Route path="/chat/:configId/:chatId/:qualtricsId" element={<ChatPage />} />
          </Route>
          {/* Protected Routes - Requires authentication */}
          <Route element={<ProtectedRoute />}>
            {/* Root route - Config List */}
            <Route path="/" element={
              <div className="flex flex-1">
                <div className="flex-1">
                  <Routes>
                    <Route index element={<ConfigList />} />
                  </Routes>
                </div>
              </div>
            } />
            {}
            <Route path="/config" element={<ConfigPage />} />
            <Route path="/qualtrics-config" element={<QualtricsConfigPage />} />
            <Route path="/edit-config" element={<EditConfigPage />} />
            <Route path="/config_list" element={<ConfigList />} />

          </Route>
        </Routes>
      </div>
    </Router>
  );
}

export default App;
