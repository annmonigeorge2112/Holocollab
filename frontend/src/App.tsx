import React, { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';

// Lazy loading pages
const LandingPage = lazy(() => import('./pages/LandingPage'));
const LoginPage = lazy(() => import('./pages/LoginPage'));
const RegisterPage = lazy(() => import('./pages/RegisterPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const LobbyPage = lazy(() => import('./pages/LobbyPage'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));
const SessionPage = lazy(() => import('./pages/SessionPage'));
const SessionReportPage = lazy(() => import('./pages/SessionReportPage'));

const LoadingFallback: React.FC = () => (
  <div className="flex items-center justify-center min-h-screen bg-slate-950 text-purple-300">
    <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-purple-500"></div>
  </div>
);

export const App: React.FC = () => {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Suspense fallback={<LoadingFallback />}>
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />

            {import.meta.env.DEV && (
              <Route
                path="/dev/ar"
                element={
                  React.createElement(
                    lazy(() => import('./pages/DevARPage'))
                  )
                }
              />
            )}

            <Route
              path="/dashboard"
              element={
                <ProtectedRoute>
                  <DashboardPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/lobby/:code"
              element={
                <ProtectedRoute>
                  <LobbyPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/session/:id"
              element={
                <ProtectedRoute>
                  <SessionPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/session/:id/report"
              element={
                <ProtectedRoute>
                  <SessionReportPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/profile"
              element={
                <ProtectedRoute>
                  <ProfilePage />
                </ProtectedRoute>
              }
            />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </AuthProvider>
  );
};

export default App;
