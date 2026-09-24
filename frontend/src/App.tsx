import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './lib/auth.js';
import { ProtectedRoute } from './components/layout/ProtectedRoute.js';
import { AppLayout } from './components/layout/AppLayout.js';

// Phase 1 Pages
import { LoginPage } from './pages/LoginPage.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { FarmersPage } from './pages/FarmersPage.js';
import { FarmerDetailPage } from './pages/FarmerDetailPage.js';
import { PlotsPage } from './pages/PlotsPage.js';

// Subsequent Phase Pages (Placeholders)
import {
  SeasonsPage,
  WeatherPage,
  CallSimulatorPage,
  AnalyticsPage,
  CertificatesPage,
  SettingsPage,
  AuditPage,
  PublicVerifyPage,
} from './pages/PhasePlaceholders.js';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

export const App: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            {/* Public Routes */}
            <Route path="/login" element={<LoginPage />} />
            <Route path="/verify/:certificateNumber" element={<PublicVerifyPage />} />

            {/* Protected Routes inside AppLayout */}
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <AppLayout />
                </ProtectedRoute>
              }
            >
              <Route index element={<Navigate to="/dashboard" replace />} />
              <Route path="dashboard" element={<DashboardPage />} />
              <Route path="farmers" element={<FarmersPage />} />
              <Route path="farmers/:id" element={<FarmerDetailPage />} />
              <Route path="plots" element={<PlotsPage />} />
              
              {/* Future Phase Placeholders */}
              <Route path="seasons" element={<SeasonsPage />} />
              <Route path="weather" element={<WeatherPage />} />
              <Route path="demo/call-simulator" element={<CallSimulatorPage />} />
              <Route path="analytics" element={<AnalyticsPage />} />
              <Route path="certificates" element={<CertificatesPage />} />
              <Route
                path="settings"
                element={
                  <ProtectedRoute allowedRoles={['ADMIN']}>
                    <SettingsPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="audit"
                element={
                  <ProtectedRoute allowedRoles={['ADMIN']}>
                    <AuditPage />
                  </ProtectedRoute>
                }
              />
            </Route>

            {/* Catch-all redirect */}
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
};

export default App;
