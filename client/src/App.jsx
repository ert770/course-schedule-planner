import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { useAuth } from './contexts/useAuth';
import { ThemeProvider } from './contexts/ThemeContext';
import LoginPage from './pages/LoginPage';
import OnboardingPage from './pages/OnboardingPage';
import SetupPage from './pages/SetupPage';
import DashboardPage from './pages/DashboardPage';
import GraduationPage from './pages/GraduationPage';
import SearchPage from './pages/SearchPage';
import SchedulePage from './pages/SchedulePage';
import './App.css';

import { useLocation } from 'react-router-dom';

function ProtectedRoute({ children }) {
  const { isLoggedIn, isSetupDone } = useAuth();
  const location = useLocation();

  if (!isLoggedIn) return <Navigate to="/login" replace />;

  if (!isSetupDone() && location.pathname !== '/onboarding' && location.pathname !== '/setup') {
    return <Navigate to="/onboarding" replace />;
  }

  return children;
}

function AppRoutes() {
  const { isLoggedIn, isSetupDone } = useAuth();

  return (
    <Routes>
      <Route
        path="/login"
        element={
          isLoggedIn ? (
            <Navigate to={isSetupDone() ? "/" : "/onboarding"} replace />
          ) : (
            <LoginPage />
          )
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
        path="/"
        element={
          <ProtectedRoute>
            <DashboardPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/schedule"
        element={
          <ProtectedRoute>
            <SchedulePage />
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
          <AppRoutes />
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}

export default App;
