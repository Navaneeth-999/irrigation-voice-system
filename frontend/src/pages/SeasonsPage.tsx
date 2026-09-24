import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { apiRequest } from '../api/client.js';
import { useAuth } from '../lib/auth.js';
import {
  Calendar,
  Plus,
  Search,
  Sprout,
  CheckCircle2,
  Clock,
  Activity,
  Layers,
  Info,
  ChevronRight,
} from 'lucide-react';
import { Card } from '../components/ui/Card.js';
import { Button } from '../components/ui/Button.js';
import { Badge } from '../components/ui/Badge.js';
import { Modal } from '../components/ui/Modal.js';
import { Input } from '../components/ui/Input.js';

export const SeasonsPage: React.FC = () => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canManage = user?.role === 'ADMIN' || user?.role === 'CSP_MEMBER';

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  // Form State for New Season
  const [farmerId, setFarmerId] = useState('');
  const [plotId, setPlotId] = useState('');
  const [cropId, setCropId] = useState('');
  const [seasonType, setSeasonType] = useState<'kharif' | 'rabi' | 'summer'>('kharif');
  const [seasonYear, setSeasonYear] = useState<number>(2026);
  const [sowingDate, setSowingDate] = useState('2026-06-15');
  const [expectedHarvestDate, setExpectedHarvestDate] = useState('2026-10-25');
  const [irrigationMethodTypeId, setIrrigationMethodTypeId] = useState('');
  const [variety, setVariety] = useState('BPT-5204 (Samba Mahsuri)');
  const [formError, setFormError] = useState<string | null>(null);

  // Queries
  const { data: seasons, isLoading } = useQuery<any[]>({
    queryKey: ['seasons', statusFilter],
    queryFn: () => {
      const url = statusFilter === 'all' ? '/seasons' : `/seasons?status=${statusFilter}`;
      return apiRequest<any[]>(url);
    },
  });

  const { data: farmers } = useQuery<any[]>({
    queryKey: ['farmers-active'],
    queryFn: () => apiRequest<any[]>('/farmers?status=active'),
  });

  const { data: farmerPlots } = useQuery<any[]>({
    queryKey: ['plots-for-farmer', farmerId],
    queryFn: () => (farmerId ? apiRequest<any[]>(`/plots?farmer_id=${farmerId}`) : Promise.resolve([])),
    enabled: Boolean(farmerId),
  });

  const { data: crops } = useQuery<any[]>({
    queryKey: ['crops'],
    queryFn: () => apiRequest<any[]>('/reference/crops'),
  });

  const { data: irrigationMethods } = useQuery<any[]>({
    queryKey: ['irrigation-methods'],
    queryFn: () => apiRequest<any[]>('/reference/irrigation-methods'),
  });

  // Selected plot preview details
  const selectedPlot = farmerPlots?.find((p) => p.id === plotId);

  // Mutations
  const createSeasonMutation = useMutation({
    mutationFn: (payload: any) =>
      apiRequest('/seasons', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['seasons'] });
      setIsCreateOpen(false);
      resetForm();
      navigate(`/seasons/${data.id}`);
    },
    onError: (err: any) => {
      setFormError(err.message || 'Failed to create season.');
    },
  });

  const activateMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest(`/seasons/${id}/activate`, {
        method: 'POST',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['seasons'] });
    },
    onError: (err: any) => {
      alert(`Activation failed: ${err.message}`);
    },
  });

  const resetForm = () => {
    setFarmerId('');
    setPlotId('');
    setCropId('');
    setFormError(null);
  };

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!farmerId || !plotId || !cropId || !irrigationMethodTypeId) {
      setFormError('Please fill all mandatory fields (Farmer, Plot, Crop, Irrigation Method).');
      return;
    }

    createSeasonMutation.mutate({
      farmer_id: farmerId,
      plot_id: plotId,
      crop_id: cropId,
      season_type: seasonType,
      season_year: Number(seasonYear),
      sowing_date: sowingDate,
      expected_harvest_date: expectedHarvestDate,
      irrigation_method_type_id: irrigationMethodTypeId,
      variety: variety || null,
      data_origin: 'real',
    });
  };

  const filteredSeasons = seasons?.filter((s) => {
    const q = search.toLowerCase();
    return (
      s.season_code?.toLowerCase().includes(q) ||
      s.farmer_name?.toLowerCase().includes(q) ||
      s.crop_name?.toLowerCase().includes(q) ||
      s.village_name?.toLowerCase().includes(q)
    );
  });

  // Status Counts
  const counts = {
    total: seasons?.length || 0,
    draft: seasons?.filter((s) => s.status === 'draft').length || 0,
    active: seasons?.filter((s) => s.status === 'active').length || 0,
    monitoring: seasons?.filter((s) => s.status === 'monitoring').length || 0,
    completed: seasons?.filter((s) => s.status === 'completed').length || 0,
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'draft':
        return <Badge variant="warning">Draft (డ్రాఫ్ట్)</Badge>;
      case 'active':
        return <Badge variant="success">Active (ప్రారంభం)</Badge>;
      case 'monitoring':
        return <Badge variant="info">Monitoring (పర్యవేక్షణ)</Badge>;
      case 'completed':
        return <Badge variant="neutral">Completed (పూర్తయింది)</Badge>;
      case 'cancelled':
        return <Badge variant="danger">Cancelled</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Calendar className="w-7 h-7 text-forest-600" />
            <span>Crop Seasons (పంట కాలాలు)</span>
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Track crop cycles, preserve immutable plot snapshots, and manage season lifecycles.
          </p>
        </div>

        {canManage && (
          <Button onClick={() => setIsCreateOpen(true)} className="flex items-center gap-2 shadow-sm">
            <Plus className="w-4 h-4" />
            <span>New Crop Season (కొత్త పంట కాలం)</span>
          </Button>
        )}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-4 border-l-4 border-l-amber-500 bg-amber-50/30">
          <div className="flex justify-between items-center">
            <div>
              <p className="text-xs font-medium text-amber-700 uppercase">Draft Seasons</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{counts.draft}</p>
            </div>
            <Clock className="w-8 h-8 text-amber-400" />
          </div>
        </Card>

        <Card className="p-4 border-l-4 border-l-emerald-600 bg-emerald-50/30">
          <div className="flex justify-between items-center">
            <div>
              <p className="text-xs font-medium text-emerald-700 uppercase">Active</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{counts.active}</p>
            </div>
            <Sprout className="w-8 h-8 text-emerald-400" />
          </div>
        </Card>

        <Card className="p-4 border-l-4 border-l-water-600 bg-water-50/30">
          <div className="flex justify-between items-center">
            <div>
              <p className="text-xs font-medium text-water-700 uppercase">In Monitoring</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{counts.monitoring}</p>
            </div>
            <Activity className="w-8 h-8 text-water-400" />
          </div>
        </Card>

        <Card className="p-4 border-l-4 border-l-purple-600 bg-purple-50/30">
          <div className="flex justify-between items-center">
            <div>
              <p className="text-xs font-medium text-purple-700 uppercase">Completed</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{counts.completed}</p>
            </div>
            <CheckCircle2 className="w-8 h-8 text-purple-400" />
          </div>
        </Card>
      </div>

      {/* Filter and Search Bar */}
      <Card className="p-4">
        <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
          <div className="relative w-full sm:w-80">
            <Search className="w-4 h-4 absolute left-3 top-3 text-gray-400" />
            <input
              type="text"
              placeholder="Search farmer, code, village..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-forest-500"
            />
          </div>

          {/* Status Tabs */}
          <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto p-1 bg-gray-100 rounded-lg">
            {['all', 'draft', 'active', 'monitoring', 'completed'].map((st) => (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md capitalize transition-colors ${
                  statusFilter === st ? 'bg-white text-gray-900 shadow-sm font-semibold' : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {st}
              </button>
            ))}
          </div>
        </div>
      </Card>

      {/* Seasons Table */}
      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-gray-500">Loading seasons data...</div>
        ) : filteredSeasons?.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            <Calendar className="w-12 h-12 mx-auto text-gray-300 mb-3" />
            <p className="font-semibold text-gray-700">No crop seasons found</p>
            <p className="text-xs text-gray-400 mt-1">Try changing filters or register a new season.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-gray-500 font-semibold border-b border-gray-200">
                <tr>
                  <th className="py-3 px-4">Season Code</th>
                  <th className="py-3 px-4">Farmer & Village</th>
                  <th className="py-3 px-4">Crop</th>
                  <th className="py-3 px-4">Plot & Snapshot</th>
                  <th className="py-3 px-4">Sowing Date</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredSeasons?.map((season) => (
                  <tr key={season.id} className="hover:bg-gray-50/80 transition-colors">
                    <td className="py-3 px-4 font-mono font-medium text-forest-700">
                      <Link to={`/seasons/${season.id}`} className="hover:underline">
                        {season.season_code}
                      </Link>
                      <div className="text-xs text-gray-400 capitalize">
                        {season.season_type} {season.season_year}
                      </div>
                    </td>

                    <td className="py-3 px-4">
                      <div className="font-medium text-gray-900">{season.farmer_name}</div>
                      <div className="text-xs text-gray-500">{season.village_name}</div>
                    </td>

                    <td className="py-3 px-4">
                      <div className="font-medium text-gray-900 flex items-center gap-1.5">
                        <Sprout className="w-3.5 h-3.5 text-forest-600" />
                        <span>{season.crop_name}</span>
                        {season.crop_name_te && (
                          <span className="text-xs text-forest-600 font-medium">({season.crop_name_te})</span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500">{season.variety || 'Standard Variety'}</div>
                    </td>

                    <td className="py-3 px-4">
                      <div className="text-gray-900 font-medium">{season.plot_label}</div>
                      <div className="text-xs text-forest-600 font-semibold flex items-center gap-1">
                        <Layers className="w-3 h-3" />
                        <span>{season.area_acres_snapshot} Acres (Snapshot)</span>
                      </div>
                    </td>

                    <td className="py-3 px-4 text-gray-600">
                      <div>{season.sowing_date}</div>
                      <div className="text-xs text-gray-400">Harv: {season.expected_harvest_date}</div>
                    </td>

                    <td className="py-3 px-4">{getStatusBadge(season.status)}</td>

                    <td className="py-3 px-4 text-right space-x-2">
                      {season.status === 'draft' && canManage && (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            if (confirm('Activate this season now? Plot snapshot will be permanently frozen.')) {
                              activateMutation.mutate(season.id);
                            }
                          }}
                          disabled={activateMutation.isPending}
                        >
                          Activate
                        </Button>
                      )}

                      <Link to={`/seasons/${season.id}`}>
                        <Button size="sm" variant="outline">
                          <span>Details</span>
                          <ChevronRight className="w-3.5 h-3.5 ml-1" />
                        </Button>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* New Season Creation Modal */}
      <Modal isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} title="Register New Crop Season (కొత్త పంట కాలం)">
        <form onSubmit={handleCreateSubmit} className="space-y-4">
          {formError && (
            <div className="p-3 bg-red-50 text-red-700 text-xs rounded-lg border border-red-200">
              {formError}
            </div>
          )}

          {/* 1. Farmer Selection */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Select Farmer (రైతు ఎంపిక) *</label>
            <select
              value={farmerId}
              onChange={(e) => {
                setFarmerId(e.target.value);
                setPlotId('');
              }}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-forest-500"
            >
              <option value="">-- Choose Active Farmer --</option>
              {farmers?.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.full_name} ({f.farmer_code}) - {f.village_name}
                </option>
              ))}
            </select>
          </div>

          {/* 2. Plot Selection */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Select Plot (పొలం ఎంపిక) *</label>
            <select
              value={plotId}
              onChange={(e) => setPlotId(e.target.value)}
              required
              disabled={!farmerId}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-forest-500 disabled:bg-gray-100"
            >
              <option value="">-- Choose Plot --</option>
              {farmerPlots?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label} ({p.area_acres} Acres) - Soil: {p.soil_type || 'General'}
                </option>
              ))}
            </select>
            {!farmerId && <p className="text-[11px] text-gray-400 mt-1">Select a farmer first to load plots.</p>}
          </div>

          {/* Snapshot Info Box if plot selected */}
          {selectedPlot && (
            <div className="p-3 bg-emerald-50 rounded-lg border border-emerald-200 text-xs space-y-1">
              <div className="font-semibold text-emerald-900 flex items-center gap-1.5">
                <Info className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span>Plot Snapshot Preview (శాశ్వత స్నాప్‌షాట్ వివరాలు):</span>
              </div>
              <p className="text-emerald-800">
                Area: <strong className="font-bold">{selectedPlot.area_acres} Acres</strong> | Soil:{' '}
                {selectedPlot.soil_type || 'Loam'}
              </p>
              <p className="text-emerald-700 text-[11px]">
                Upon activation, this area and pump discharge rate are permanently frozen for calculation integrity.
              </p>
            </div>
          )}

          {/* 3. Crop Selection */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Crop (పంట) *</label>
              <select
                value={cropId}
                onChange={(e) => setCropId(e.target.value)}
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-forest-500"
              >
                <option value="">-- Choose Crop --</option>
                {crops?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} {c.name_te ? `(${c.name_te})` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Irrigation Method (సేద్యం పద్ధతి) *</label>
              <select
                value={irrigationMethodTypeId}
                onChange={(e) => setIrrigationMethodTypeId(e.target.value)}
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-forest-500"
              >
                <option value="">-- Method --</option>
                {irrigationMethods?.map((im) => (
                  <option key={im.id} value={im.id}>
                    {im.name} ({Math.round(im.typical_efficiency * 100)}% eff)
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* 4. Season Type & Year */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Season Period *</label>
              <select
                value={seasonType}
                onChange={(e: any) => setSeasonType(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-forest-500"
              >
                <option value="kharif">Kharif (ఖరీఫ్ - Monsoon)</option>
                <option value="rabi">Rabi (రబీ - Winter)</option>
                <option value="summer">Summer (ఎండకాలం / జైద్)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Crop Variety (రకం)</label>
              <input
                type="text"
                value={variety}
                onChange={(e) => setVariety(e.target.value)}
                placeholder="e.g. BPT-5204"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-forest-500"
              />
            </div>
          </div>

          {/* 5. Sowing & Harvest Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Sowing Date (విత్తిన తేదీ) *</label>
              <input
                type="date"
                value={sowingDate}
                onChange={(e) => setSowingDate(e.target.value)}
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-forest-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Expected Harvest (కోత తేదీ) *</label>
              <input
                type="date"
                value={expectedHarvestDate}
                onChange={(e) => setExpectedHarvestDate(e.target.value)}
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-forest-500"
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-3 border-t border-gray-100">
            <Button type="button" variant="outline" onClick={() => setIsCreateOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={createSeasonMutation.isPending}>
              {createSeasonMutation.isPending ? 'Saving...' : 'Create Draft Season'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
