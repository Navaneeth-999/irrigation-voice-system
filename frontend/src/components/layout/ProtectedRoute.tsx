import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth.js';

interface ProtectedRouteProps {
  children: React.ReactElement;
  allowedRoles?: string[];
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children, allowedRoles }) => {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="flex flex-col items-center space-y-3">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-forest-700"></div>
          <p className="text-sm text-gray-500 font-medium">Verifying session...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="max-w-md w-full bg-white p-6 rounded-2xl shadow-sm border border-gray-200 text-center">
          <h2 className="text-lg font-bold text-gray-900 mb-2">Access Restricted</h2>
          <p className="text-sm text-gray-600 mb-4">
            You do not have the required permissions to view this section ({user.role}).
          </p>
          <a href="/dashboard" className="text-sm font-semibold text-forest-700 hover:underline">
            Return to Dashboard
          </a>
        </div>
      </div>
    );
  }

  return children;
};
