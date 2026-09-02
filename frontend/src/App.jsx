/* @language JSX  @updated 2026-08-25  @changed Removed the mobile block gate — the app is not desktop-only anymore, so every route renders regardless of viewport/user-agent. Prior: Added the professor-only /video-boxes/:configId route (visual rubric editor). Prior: added the public /course-plan route (syllabus advisor) and exempted it from the mobile block. */
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
import ChangePasswordPage from './pages/ChangePasswordPage';
import EditConfigPage from './pages/EditConfigPage';
import GroupChatPage from './pages/GroupChatPage';
import ManagerExercisePage from './pages/ManagerExercisePage';
import ManagerExerciseRunPage from './pages/ManagerExerciseRunPage';
import ManagerExerciseResultsPage from './pages/ManagerExerciseResultsPage';
import ResponsesPage from './pages/ResponsesPage';
import AdminPage from './pages/AdminPage';
import StudentChatPage from './pages/StudentChatPage';
import VideoUploadPage from './pages/VideoUploadPage';
import VideoResultsPage from './pages/VideoResultsPage';
import VideoComparePage from './pages/VideoComparePage';
import VideoDashboardPage from './pages/VideoDashboardPage';
import VideoBoxesPage from './pages/VideoBoxesPage';
import JoinPage from './pages/JoinPage';
import StudentDashboardPage from './pages/StudentDashboardPage';
import ExperientialPage from './pages/ExperientialPage';
import ExperientialSessionPage from './pages/ExperientialSessionPage';
import ExperientialDashboardPage from './pages/ExperientialDashboardPage';
import UserGuidePage from './pages/UserGuidePage';
import CoursePlanPage from './pages/CoursePlanPage';
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
function App() {
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
          {/* User guide — public and unauthenticated on purpose: a locked-out user needs
              to read the password pages, and students hit it before they have an account. */}
          <Route path="/userguide" element={<UserGuidePage />} />
          <Route path="/userguide/:pageId" element={<UserGuidePage />} />
          {/* Syllabus advisor — public on purpose: the audience is a professor who
              does not have an account yet. The backend caps what a logged-out
              caller receives; nothing here is trusted to hide it. */}
          <Route path="/course-plan" element={<CoursePlanPage />} />

          {/* Public Auth Routes */}
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/student-register" element={<StudentRegistrationPage />} />
          <Route path="/student-chat" element={<StudentChatPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/verify-email" element={<EmailVerificationPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          {/* Where an admin-issued one-time password lands, and where anyone can
              change their own. Auth is checked inside the page, not by a guard,
              because a gated account can reach nothing else. */}
          <Route path="/change-password" element={<ChangePasswordPage />} />
          <Route path="/group-chat/:configId" element={<GroupChatPage />}/>
          {/* Manager Exercise — student-facing hidden-profile decision game (public, like group chat) */}
          <Route path="/manager-exercise/:configId" element={<ManagerExercisePage />}/>

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
          {/* The standalone index is gone; labs are reached from the dashboard. */}
          <Route path="/experiential" element={<Navigate to="/config_list" replace />} />
          <Route path="/experiential/c/:configId" element={<ExperientialPage />} />
          <Route path="/experiential/:templateId" element={<ExperientialPage />} />

          {/* Join link — public, redirects to register/login with class code */}
          <Route path="/join/:classCode" element={<JoinPage />} />

          {/* Student dashboard — requires login */}
          <Route element={<ProtectedRoute />}>
            <Route path="/student-dashboard" element={<StudentDashboardPage />} />
            <Route path="/experiential/session/:sessionId" element={<ExperientialSessionPage />} />
          </Route>

          {/* Protected Routes - Professor only */}
          <Route element={<ProfessorRoute />}>
            <Route path="/config_list" element={<ConfigList />} />
            <Route path="/config" element={<ConfigPage />} />
            <Route path="/edit-config" element={<EditConfigPage />} />
            <Route path="/responses/:configId" element={<ResponsesPage />} />
            <Route path="/video-dashboard/:configId" element={<VideoDashboardPage />} />
            {/* The rubric editor, shown as the report a student gets. Professor-only:
                it writes the scoring spec every submission is graded against. */}
            <Route path="/video-boxes/:configId" element={<VideoBoxesPage />} />
            <Route path="/experiential-dashboard/:configId" element={<ExperientialDashboardPage />} />
            {/* A test run's transcript. Professor-only: it carries the case
                pack's answer key in the open, which is the one thing a student
                must not read. */}
            <Route path="/manager-exercise/:configId/run/:roomId" element={<ManagerExerciseRunPage />} />
            {/* The class's answers. Professor-only for the same reason: it names
                every student's private pick and the case's answer key. */}
            <Route path="/manager-exercise/:configId/results" element={<ManagerExerciseResultsPage />} />
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
