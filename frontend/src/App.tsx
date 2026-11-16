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

// Phase 2 Pages
import { SeasonsPage } from './pages/SeasonsPage.js';
import { SeasonDetailPage } from './pages/SeasonDetailPage.js';
import { ActionQueuePage } from './pages/ActionQueuePage.js';

// Phase 3 Pages
import { CallSimulatorPage } from './pages/CallSimulatorPage.js';

// Phase 4 Pages
import { WeatherAlertsPage } from './pages/WeatherAlertsPage.js';

// Phase 5 Page
import { AnalyticsPage } from './pages/AnalyticsPage.js';

// Phase 6 Pages
import { CertificatesPage } from './pages/CertificatesPage.js';
import { PublicVerificationPage } from './pages/PublicVerificationPage.js';
import { ObservationsPage } from './pages/ObservationsPage.js';

import { SettingsPage } from './pages/SettingsPage.js';
import { AuditPage } from './pages/AuditPage.js';

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
            <Route path="/verify/:code" element={<PublicVerificationPage />} />
            <Route path="/verify/:certificateNumber" element={<PublicVerificationPage />} />

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
              
              {/* Phase 2 Routes */}
              <Route path="seasons" element={<SeasonsPage />} />
              <Route path="seasons/:id" element={<SeasonDetailPage />} />
              <Route path="action-items" element={<ActionQueuePage />} />
              
              {/* Phase 4 Route */}
              <Route path="weather" element={<WeatherAlertsPage />} />
              <Route path="demo/call-simulator" element={<CallSimulatorPage />} />
              <Route path="call-simulator" element={<CallSimulatorPage />} />
              <Route path="simulator" element={<CallSimulatorPage />} />
              <Route path="analytics" element={<AnalyticsPage />} />
              <Route path="certificates" element={<CertificatesPage />} />
              <Route path="observations" element={<ObservationsPage />} />
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
