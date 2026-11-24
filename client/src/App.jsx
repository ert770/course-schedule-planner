import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { useAuth } from './contexts/useAuth';
import { ThemeProvider } from './contexts/ThemeContext';
import { ScheduleProvider } from './contexts/ScheduleContext';
import LoginPage from './pages/LoginPage';
import ControlledHistoryMockPage from './pages/ControlledHistoryMockPage';
import RegisterPage from './pages/RegisterPage';
import CourseHistoryImportPage from './pages/CourseHistoryImportPage';
import CourseHistoryPage from './pages/CourseHistoryPage';
import OnboardingPage from './pages/OnboardingPage';
import SetupPage from './pages/SetupPage';
import InterestExplorationPage from './pages/InterestExplorationPage';
import DashboardPage from './pages/DashboardPage';
import GraduationPage from './pages/GraduationPage';
import PrivacyPage from './pages/PrivacyPage';
import SearchPage from './pages/SearchPage';
import ExplorePage from './pages/ExplorePage';
import './App.css';

import { useLocation } from 'react-router-dom';

function ProtectedRoute({ children }) {
  const { isLoggedIn, isSetupDone, privacyStatus, privacyLoading } = useAuth();
  const location = useLocation();

  if (!isLoggedIn) return <Navigate to="/login" replace />;

  if (privacyLoading) return <div className="route-loading">正在確認資料使用設定…</div>;

  if (privacyStatus?.requiresAction && location.pathname !== '/privacy') {
    return <Navigate to="/privacy" replace />;
  }

  if (!isSetupDone() && !['/privacy', '/onboarding', '/setup'].includes(location.pathname)) {
    return <Navigate to="/onboarding" replace />;
  }

  return children;
}

function AppRoutes() {
  const { isLoggedIn, isSetupDone, privacyStatus } = useAuth();

  return (
    <Routes>
      {import.meta.env.DEV && <Route path="/history-import-mock" element={<ProtectedRoute><ControlledHistoryMockPage /></ProtectedRoute>} />}
      <Route path="/history-import" element={<ProtectedRoute><CourseHistoryImportPage /></ProtectedRoute>} />
      <Route path="/course-history" element={<ProtectedRoute><CourseHistoryPage /></ProtectedRoute>} />
      <Route path="/register" element={isLoggedIn ? <Navigate to="/" replace /> : <RegisterPage />} />
      <Route
        path="/login"
        element={
          isLoggedIn ? (
            <Navigate to={privacyStatus?.requiresAction ? '/privacy' : (isSetupDone() ? '/' : '/onboarding')} replace />
          ) : (
            <LoginPage />
          )
        }
      />
      <Route
        path="/privacy"
        element={
          <ProtectedRoute>
            <PrivacyPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/onboarding"
        element={
          <ProtectedRoute>
            <OnboardingPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/setup"
        element={
          <ProtectedRoute>
            <SetupPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/interest-exploration"
        element={
          <ProtectedRoute>
            <InterestExplorationPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <DashboardPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/search"
        element={
          <ProtectedRoute>
            <SearchPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/explore"
        element={
          <ProtectedRoute>
            <ExplorePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/graduation"
        element={
          <ProtectedRoute>
            <GraduationPage />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <ScheduleProvider>
            <AppRoutes />
          </ScheduleProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}

export default App;
