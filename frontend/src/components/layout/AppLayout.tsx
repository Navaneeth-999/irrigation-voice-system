import React from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth.js';
import {
  LayoutDashboard,
  Users,
  MapPin,
  Calendar,
  CloudSun,
  PhoneCall,
  BarChart3,
  Award,
  Camera,
  Settings,
  ShieldAlert,
  LogOut,
  Droplets,
  AlertCircle,
} from 'lucide-react';
import { Badge } from '../ui/Badge.js';
import { APP_NAME, APP_NAME_TE, APP_TAGLINE, ORG_NAME } from '../../config/branding.js';

export const AppLayout: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const navItems = [
    { label: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
    { label: 'Farmers', path: '/farmers', icon: Users },
    { label: 'Plots & Water', path: '/plots', icon: MapPin },
    { label: 'Seasons', path: '/seasons', icon: Calendar },
    { label: 'Action Queue', path: '/action-items', icon: AlertCircle },
    { label: 'Weather & Alerts', path: '/weather', icon: CloudSun },
    { label: 'Call Simulator', path: '/demo/call-simulator', icon: PhoneCall },
    { label: 'Water Analytics', path: '/analytics', icon: BarChart3 },
    { label: 'Certificates', path: '/certificates', icon: Award },
    { label: 'Field Observations', path: '/observations', icon: Camera },
    ...(user?.role === 'ADMIN' ? [
      { label: 'Settings', path: '/settings', icon: Settings },
      { label: 'Audit Logs', path: '/audit', icon: ShieldAlert },
    ] : []),
  ];

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans">
      {/* Top Demo Banner */}
      <div className="bg-emerald-800 text-white text-xs font-semibold py-1 px-4 text-center tracking-wide flex items-center justify-center space-x-2">
        <span>🌱 {APP_NAME} — {APP_TAGLINE}</span>
        <span className="bg-emerald-950/80 px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider">Active System</span>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar */}
        <aside className="w-64 bg-forest-950 text-white flex flex-col justify-between shrink-0 shadow-lg border-r border-forest-900">
          <div>
            {/* Logo / Branding */}
            <div className="h-16 px-4 flex items-center space-x-2.5 border-b border-forest-900/80 bg-forest-950/60">
              <div className="w-9 h-9 rounded-xl bg-forest-600 flex items-center justify-center text-white shadow-inner shrink-0">
                <Droplets className="w-5 h-5 text-white" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-semibold text-forest-300 leading-tight truncate">{APP_NAME_TE}</div>
                <div className="text-xs font-bold text-white leading-tight truncate">{APP_NAME}</div>
              </div>
            </div>

            {/* Navigation links */}
            <nav className="p-4 space-y-1.5">
              {navItems.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    className={({ isActive }) =>
                      `flex items-center space-x-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all ${
                        isActive
                          ? 'bg-forest-800 text-white shadow-sm border border-forest-700/60 font-semibold'
                          : 'text-forest-200/80 hover:bg-forest-900/80 hover:text-white'
                      }`
                    }
                  >
                    <Icon className="w-4 h-4 text-forest-400 shrink-0" />
                    <span>{item.label}</span>
                  </NavLink>
                );
              })}
            </nav>
          </div>

          {/* User profile & Logout */}
          <div className="p-4 border-t border-forest-900 bg-forest-950/80">
            <div className="flex items-center justify-between mb-3">
              <div className="truncate">
                <p className="text-xs font-semibold text-white truncate">{user?.name}</p>
                <div className="mt-0.5">
                  <Badge variant={user?.role === 'ADMIN' ? 'danger' : user?.role === 'CSP_MEMBER' ? 'info' : 'warning'} size="sm">
                    {user?.role}
                  </Badge>
                </div>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="w-full flex items-center justify-center space-x-2 px-3 py-2 text-xs font-semibold text-forest-300 hover:text-white bg-forest-900/60 hover:bg-forest-800 rounded-lg transition-colors border border-forest-800/80"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out</span>
            </button>
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 overflow-y-auto p-8 bg-gray-50/80">
          <div className="max-w-7xl mx-auto">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
};
