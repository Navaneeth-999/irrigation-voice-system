import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.js';
import { Droplets, ShieldCheck, AlertCircle } from 'lucide-react';
import { Button } from '../components/ui/Button.js';
import { Input } from '../components/ui/Input.js';

export const LoginPage: React.FC = () => {
  const { login } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('admin@csp-irrigation.org');
  const [password, setPassword] = useState('ChangeMeAdmin123!');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      await login(email, password);
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.message || 'Login failed. Please verify your credentials.');
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
        <h2 className="text-3xl font-extrabold text-white tracking-tight">
          జలమిత్ర <span className="text-forest-400 font-semibold text-2xl">Jalamitra</span>
        </h2>
        <p className="mt-2 text-sm text-forest-200/80">
          Voice Driven Intelligent Irrigation Management & Conservation
        </p>
        <p className="text-[11px] text-forest-300/60 uppercase tracking-widest mt-1">
          B.Tech Community Service Project
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-6 shadow-2xl rounded-3xl sm:px-10 border border-gray-100">
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

          <div className="mt-6 pt-6 border-t border-gray-100">
            <div className="flex items-center justify-center text-xs text-gray-500 space-x-1.5">
              <ShieldCheck className="w-4 h-4 text-forest-700" />
              <span>Role-Based Access: Admin, CSP Member & Panchayat</span>
            </div>
            <p className="text-[11px] text-gray-400 text-center mt-2">
              Default bootstrap credentials pre-filled for convenience in local development.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
