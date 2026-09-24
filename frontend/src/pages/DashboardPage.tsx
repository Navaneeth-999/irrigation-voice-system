import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { apiRequest } from '../api/client.js';
import {
  Users,
  MapPin,
  Calendar,
  PhoneCall,
  Droplets,
  AlertTriangle,
  ArrowRight,
  UserPlus,
} from 'lucide-react';
import { Card } from '../components/ui/Card.js';
import { Button } from '../components/ui/Button.js';
import { Badge } from '../components/ui/Badge.js';

interface DashboardKPIs {
  totalFarmers: number;
  activeFarmers: number;
  totalAcres: number;
  activeSeasons: number;
  completedSeasons: number;
  callsCompleted: number;
  callsPending: number;
  openActionItems: number;
  estimatedWaterUsageL: number;
}

export const DashboardPage: React.FC = () => {
  const { data: kpis, isLoading: kpisLoading } = useQuery<DashboardKPIs>({
    queryKey: ['dashboard-kpis'],
    queryFn: () => apiRequest<DashboardKPIs>('/analytics/dashboard'),
  });

  const { data: recentFarmers, isLoading: farmersLoading } = useQuery<any[]>({
    queryKey: ['recent-farmers'],
    queryFn: () => apiRequest<any[]>('/farmers?limit=5'),
  });

  const kpiCards = [
    { label: 'Total Farmers', value: kpis?.totalFarmers ?? 0, sub: `${kpis?.activeFarmers ?? 0} active`, icon: Users, color: 'text-forest-700 bg-forest-50' },
    { label: 'Cultivated Land', value: `${(kpis?.totalAcres ?? 0).toFixed(1)} Ac`, sub: 'Across registered plots', icon: MapPin, color: 'text-soil-700 bg-soil-50' },
    { label: 'Active Seasons', value: kpis?.activeSeasons ?? 0, sub: `${kpis?.completedSeasons ?? 0} completed`, icon: Calendar, color: 'text-emerald-700 bg-emerald-50' },
    { label: 'Voice Calls', value: kpis?.callsCompleted ?? 0, sub: `${kpis?.callsPending ?? 0} pending`, icon: PhoneCall, color: 'text-blue-700 bg-blue-50' },
    { label: 'Est. Water Used', value: `${((kpis?.estimatedWaterUsageL ?? 0) / 1000).toFixed(0)} kL`, sub: 'Estimated proxy metric', icon: Droplets, color: 'text-water-700 bg-water-50' },
    { label: 'Open Actions', value: kpis?.openActionItems ?? 0, sub: 'Needs field follow-up', icon: AlertTriangle, color: 'text-amber-700 bg-amber-50' },
  ];

  return (
    <div className="space-y-8">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">System Dashboard</h1>
          <p className="text-sm text-gray-500 mt-1">
            Real-time overview of farmers, plots, voice communications, and seasonal water metrics.
          </p>
        </div>
        <div className="flex items-center space-x-3">
          <Link to="/farmers">
            <Button variant="primary" size="md">
              <UserPlus className="w-4 h-4 mr-2" />
              Register Farmer
            </Button>
          </Link>
          <Link to="/plots">
            <Button variant="secondary" size="md">
              <MapPin className="w-4 h-4 mr-2" />
              Add Plot
            </Button>
          </Link>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        {kpiCards.map((kpi, idx) => {
          const Icon = kpi.icon;
          return (
            <div key={idx} className="bg-white p-5 rounded-2xl border border-gray-200/80 shadow-sm flex flex-col justify-between">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">{kpi.label}</span>
                <div className={`p-2 rounded-xl ${kpi.color}`}>
                  <Icon className="w-4 h-4" />
                </div>
              </div>
              <div>
                <div className="text-2xl font-extrabold text-gray-900 tracking-tight">
                  {kpisLoading ? '...' : kpi.value}
                </div>
                <div className="text-xs text-gray-400 mt-1 font-medium">{kpi.sub}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Main Content Columns */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column: Recent Farmers */}
        <div className="lg:col-span-2 space-y-6">
          <Card
            title="Registered Farmers"
            subtitle="Latest registered smallholders across project villages"
            action={
              <Link to="/farmers" className="text-xs font-semibold text-forest-700 hover:text-forest-800 flex items-center gap-1">
                View all <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            }
          >
            {farmersLoading ? (
              <div className="py-8 text-center text-sm text-gray-400">Loading farmers data...</div>
            ) : !recentFarmers || recentFarmers.length === 0 ? (
              <div className="py-12 text-center">
                <Users className="w-10 h-10 text-gray-300 mx-auto mb-3" />
                <p className="text-sm font-medium text-gray-600">No farmers registered yet</p>
                <p className="text-xs text-gray-400 mt-1">Get started by registering a farmer or importing a survey CSV.</p>
                <div className="mt-4">
                  <Link to="/farmers">
                    <Button variant="primary" size="sm">Register First Farmer</Button>
                  </Link>
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                      <th className="pb-3">Farmer Code</th>
                      <th className="pb-3">Name</th>
                      <th className="pb-3">Village</th>
                      <th className="pb-3">Phone</th>
                      <th className="pb-3">Status</th>
                      <th className="pb-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {recentFarmers.slice(0, 5).map((f) => (
                      <tr key={f.id} className="hover:bg-gray-50/50">
                        <td className="py-3 font-mono text-xs font-semibold text-forest-800">{f.farmer_code}</td>
                        <td className="py-3 font-medium text-gray-900">{f.full_name}</td>
                        <td className="py-3 text-gray-600">{f.village_name}</td>
                        <td className="py-3 font-mono text-xs text-gray-500">{f.primary_phone || 'None'}</td>
                        <td className="py-3">
                          <Badge variant={f.status === 'active' ? 'success' : 'neutral'} size="sm">
                            {f.status}
                          </Badge>
                        </td>
                        <td className="py-3 text-right">
                          <Link to={`/farmers/${f.id}`} className="text-xs font-semibold text-forest-700 hover:underline">
                            Profile
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        {/* Right Column: Seasonal Lifecycle Quick Guide */}
        <div className="space-y-6">
          <Card title="Seasonal Lifecycle Stages" subtitle="End-to-end community service workflow">
            <ol className="relative border-l border-forest-200 ml-3 space-y-6 text-sm">
              <li className="mb-6 ml-6">
                <span className="absolute -left-3 flex items-center justify-center w-6 h-6 bg-forest-700 rounded-full text-white text-xs font-bold">1</span>
                <h4 className="font-semibold text-gray-900">Farmer & Plot Profiling</h4>
                <p className="text-xs text-gray-500 mt-1">Profile farmer, assign village, land area, water sources, and pump HP.</p>
              </li>
              <li className="mb-6 ml-6">
                <span className="absolute -left-3 flex items-center justify-center w-6 h-6 bg-forest-600 rounded-full text-white text-xs font-bold">2</span>
                <h4 className="font-semibold text-gray-900">Season Activation & Snapshot</h4>
                <p className="text-xs text-gray-500 mt-1">Freeze area & pump specs. Automatically schedule fortnightly voice calls.</p>
              </li>
              <li className="mb-6 ml-6">
                <span className="absolute -left-3 flex items-center justify-center w-6 h-6 bg-forest-500 rounded-full text-white text-xs font-bold">3</span>
                <h4 className="font-semibold text-gray-900">Telugu Voice Calls & Feedback</h4>
                <p className="text-xs text-gray-500 mt-1">Automated IVR calls farmers in Telugu; DTMF captures pump hours & condition.</p>
              </li>
              <li className="mb-6 ml-6">
                <span className="absolute -left-3 flex items-center justify-center w-6 h-6 bg-forest-400 rounded-full text-white text-xs font-bold">4</span>
                <h4 className="font-semibold text-gray-900">Conservation Analytics & Report</h4>
                <p className="text-xs text-gray-500 mt-1">Compare against FAO-56 requirements, assess confidence, and issue QR record.</p>
              </li>
            </ol>
          </Card>
        </div>
      </div>
    </div>
  );
};
