import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.js';
import { apiRequest } from '../api/client.js';
import { Droplets, ShieldCheck, AlertCircle, KeyRound } from 'lucide-react';
import { Button } from '../components/ui/Button.js';
import { Input } from '../components/ui/Input.js';
import { APP_NAME, APP_NAME_TE, APP_TAGLINE, ORG_NAME } from '../config/branding.js';

export const LoginPage: React.FC = () => {
  const { login, refetchUser } = useAuth();
  const navigate = useNavigate();

  // In production builds, fields are empty; in dev mode, convenience default for testing
  const isDev = import.meta.env.DEV;
  const [email, setEmail] = useState(isDev ? 'admin@csp-irrigation.org' : '');
  const [password, setPassword] = useState(isDev ? 'ChangeMeAdmin123!' : '');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Forced password change state
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const user = await login(email, password);
      if (user.must_change_password) {
        setMustChangePassword(true);
        setCurrentPassword(password);
      } else {
        navigate('/dashboard');
      }
    } catch (err: any) {
      setError(err.message || 'Login failed. Please verify your credentials.');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePasswordChangeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters long.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setIsLoading(true);
    try {
      await apiRequest('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      await refetchUser();
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.message || 'Failed to update password.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-forest-950 via-forest-900 to-gray-950 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <div className="mx-auto w-16 h-16 rounded-2xl bg-forest-600 flex items-center justify-center text-white shadow-xl mb-4 border border-forest-400/30">
          <Droplets className="w-9 h-9" />
        </div>
        <h2 className="text-2xl font-extrabold text-white tracking-tight">
          {APP_NAME_TE}
        </h2>
        <h3 className="text-xl font-bold text-forest-300 mt-0.5">
          {APP_NAME}
        </h3>
        <p className="mt-2 text-sm text-forest-200/80">
          {APP_TAGLINE}
        </p>
        <p className="text-[11px] text-forest-300/60 uppercase tracking-widest mt-1">
          {ORG_NAME}
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-6 shadow-2xl rounded-3xl sm:px-10 border border-gray-100">
          {mustChangePassword ? (
            /* Forced Password Change Form */
            <form className="space-y-5" onSubmit={handlePasswordChangeSubmit}>
              <div className="text-center pb-2">
                <div className="w-10 h-10 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center mx-auto mb-2">
                  <KeyRound className="w-5 h-5" />
                </div>
                <h3 className="text-base font-bold text-gray-900">Password Change Required</h3>
                <p className="text-xs text-gray-500 mt-1">
                  For system security, you must set a new strong password on your first login.
                </p>
              </div>

              {error && (
                <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl flex items-center space-x-2 text-sm text-red-700">
                  <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
                  <span>{error}</span>
                </div>
              )}

              <div>
                <Input
                  label="New Password (min 8 chars) *"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  placeholder="••••••••••••"
                />
              </div>

              <div>
                <Input
                  label="Confirm New Password *"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  placeholder="••••••••••••"
                />
              </div>

              <Button
                type="submit"
                variant="primary"
                size="lg"
                className="w-full mt-2"
                isLoading={isLoading}
              >
                Set New Password & Continue
              </Button>
            </form>
          ) : (
            /* Standard Login Form */
            <form className="space-y-5" onSubmit={handleSubmit}>
              {error && (
                <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl flex items-center space-x-2 text-sm text-red-700">
                  <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
                  <span>{error}</span>
                </div>
              )}

              <div>
                <Input
                  label="Email Address"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  placeholder="name@domain.org"
                />
              </div>

              <div>
                <Input
                  label="Password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  placeholder="••••••••"
                />
              </div>

              <Button
                type="submit"
                variant="primary"
                size="lg"
                className="w-full mt-2"
                isLoading={isLoading}
              >
                Sign In to System
              </Button>
            </form>
          )}

          <div className="mt-6 pt-6 border-t border-gray-100">
            <div className="flex items-center justify-center text-xs text-gray-500 space-x-1.5">
              <ShieldCheck className="w-4 h-4 text-forest-700" />
              <span>Role-Based Access: Admin, CSP Member & Panchayat</span>
            </div>
            {isDev && !mustChangePassword && (
              <p className="text-[11px] text-amber-700 bg-amber-50 p-2 rounded-lg text-center mt-3 border border-amber-200/60 font-medium">
                Dev Mode: Default credentials pre-filled for local testing.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
