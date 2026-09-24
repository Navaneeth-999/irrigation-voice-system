import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { apiRequest } from '../api/client.js';
import { useAuth } from '../lib/auth.js';
import { MapPin, Plus, Droplets, AlertCircle, Search } from 'lucide-react';
import { Card } from '../components/ui/Card.js';
import { Button } from '../components/ui/Button.js';
import { Badge } from '../components/ui/Badge.js';
import { Modal } from '../components/ui/Modal.js';
import { Input } from '../components/ui/Input.js';

export const PlotsPage: React.FC = () => {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canManage = user?.role === 'ADMIN' || user?.role === 'CSP_MEMBER';

  const [search, setSearch] = useState('');
  const [isAddPlotOpen, setIsAddPlotOpen] = useState(false);

  // Form State
  const [farmerId, setFarmerId] = useState('');
  const [plotLabel, setPlotLabel] = useState('');
  const [surveyNumber, setSurveyNumber] = useState('');
  const [areaAcres, setAreaAcres] = useState('2.5');
  const [soilType, setSoilType] = useState('Black Cotton');
  const [tenure, setTenure] = useState<'owned' | 'leased'>('owned');
  const [waterSourceTypeId, setWaterSourceTypeId] = useState('');
  const [pumpHp, setPumpHp] = useState('5.0');
  const [dischargeLph, setDischargeLph] = useState('15000');
  const [plotError, setPlotError] = useState<string | null>(null);

  const { data: plots, isLoading } = useQuery<any[]>({
    queryKey: ['plots'],
    queryFn: () => apiRequest<any[]>('/plots'),
  });

  const { data: farmers } = useQuery<any[]>({
    queryKey: ['farmers-list-short'],
    queryFn: () => apiRequest<any[]>('/farmers?status=active'),
  });

  const { data: waterSourceTypes } = useQuery<any[]>({
    queryKey: ['water-source-types'],
    queryFn: () => apiRequest<any[]>('/reference/water-source-types'),
  });

  const createPlotMutation = useMutation({
    mutationFn: (newPlot: any) =>
      apiRequest('/plots', {
        method: 'POST',
        body: JSON.stringify(newPlot),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plots'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-kpis'] });
      setIsAddPlotOpen(false);
      setPlotLabel('');
      setSurveyNumber('');
      setFarmerId('');
      setPlotError(null);
    },
    onError: (err: any) => {
      setPlotError(err.message || 'Failed to create plot.');
    },
  });

  const handleAddPlotSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPlotError(null);

    if (!farmerId) {
      setPlotError('Please select a farmer.');
      return;
    }
    if (!waterSourceTypeId) {
      setPlotError('Please select a water source.');
      return;
    }

    createPlotMutation.mutate({
      farmer_id: farmerId,
      label: plotLabel,
      survey_number: surveyNumber,
      area_acres: parseFloat(areaAcres),
      soil_type: soilType,
      tenure,
      water_sources: [
        {
          water_source_type_id: waterSourceTypeId,
          pump_hp: pumpHp ? parseFloat(pumpHp) : null,
          discharge_lph: dischargeLph ? parseFloat(dischargeLph) : null,
          is_primary: true,
        },
      ],
    });
  };

  const filteredPlots = plots?.filter(p => {
    if (!search) return true;
    const term = search.toLowerCase();
    return (
      p.label?.toLowerCase().includes(term) ||
      p.farmer_name?.toLowerCase().includes(term) ||
      p.survey_number?.toLowerCase().includes(term)
    );
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Agricultural Plots & Water Sources</h1>
          <p className="text-sm text-gray-500 mt-1">
            Registered land parcels, soil profiles, and water extraction specifications.
          </p>
        </div>
        {canManage && (
          <Button variant="primary" size="md" onClick={() => setIsAddPlotOpen(true)}>
            <Plus className="w-4 h-4 mr-1.5" /> Add Plot
          </Button>
        )}
      </div>

      {/* Search Bar */}
      <Card>
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-3 text-gray-400" />
          <input
            type="text"
            placeholder="Search by plot label, farmer name, or survey number..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-forest-600"
          />
        </div>
      </Card>

      {/* Plots Table */}
      <Card>
        {isLoading ? (
          <div className="py-12 text-center text-sm text-gray-500">Loading agricultural plots...</div>
        ) : !filteredPlots || filteredPlots.length === 0 ? (
          <div className="py-12 text-center">
            <MapPin className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-base font-medium text-gray-700">No plots found</p>
            <p className="text-xs text-gray-400 mt-1">Add a plot to assign water sources and start tracking irrigation.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  <th className="pb-3">Plot Label</th>
                  <th className="pb-3">Farmer</th>
                  <th className="pb-3">Area</th>
                  <th className="pb-3">Survey No.</th>
                  <th className="pb-3">Soil & Tenure</th>
                  <th className="pb-3">Water Sources & Pump Specs</th>
                  <th className="pb-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filteredPlots.map((p) => (
                  <tr key={p.id} className="hover:bg-gray-50/50">
                    <td className="py-3 font-semibold text-gray-900">{p.label}</td>
                    <td className="py-3">
                      <Link to={`/farmers/${p.farmer_id}`} className="font-medium text-forest-700 hover:underline">
                        {p.farmer_name}
                      </Link>
                    </td>
                    <td className="py-3 font-bold text-gray-900">
                      {parseFloat(p.area_acres).toFixed(2)} Ac
                    </td>
                    <td className="py-3 text-gray-500 font-mono text-xs">{p.survey_number || '-'}</td>
                    <td className="py-3 text-xs text-gray-600">
                      {p.soil_type || 'General'} • <span className="capitalize">{p.tenure}</span>
                    </td>
                    <td className="py-3">
                      <div className="space-y-1">
                        {p.water_sources?.map((ws: any) => (
                          <div key={ws.id} className="text-xs text-water-800 flex items-center gap-1.5">
                            <Droplets className="w-3 h-3 text-water-600 shrink-0" />
                            <span>
                              <strong className="text-gray-800">{ws.source_name}</strong>
                              {ws.pump_hp ? ` (${ws.pump_hp} HP)` : ''}
                              {ws.discharge_lph ? ` @ ${ws.discharge_lph.toLocaleString()} L/h` : ''}
                            </span>
                          </div>
                        ))}
                      </div>
                    </td>
                    <td className="py-3 text-right">
                      <Link to={`/farmers/${p.farmer_id}`}>
                        <Button variant="outline" size="sm">
                          Farmer Profile
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

      {/* Add Plot Modal */}
      <Modal isOpen={isAddPlotOpen} onClose={() => setIsAddPlotOpen(false)} title="Add Plot & Water Source" maxWidth="lg">
        <form onSubmit={handleAddPlotSubmit} className="space-y-4">
          {plotError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-center gap-1.5">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
              <span>{plotError}</span>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1.5">
              Farmer Owner *
            </label>
            <select
              value={farmerId}
              onChange={(e) => setFarmerId(e.target.value)}
              required
              className="w-full px-3.5 py-2 text-sm bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-forest-600"
            >
              <option value="">Select Farmer</option>
              {farmers?.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.full_name} ({f.farmer_code} - {f.village_name})
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Plot Label *"
              value={plotLabel}
              onChange={(e) => setPlotLabel(e.target.value)}
              placeholder="e.g. Canal Side Field"
              required
            />
            <Input
              label="Survey Number"
              value={surveyNumber}
              onChange={(e) => setSurveyNumber(e.target.value)}
              placeholder="e.g. SY-210/4A"
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <Input
              label="Area (Acres) *"
              type="number"
              step="0.01"
              value={areaAcres}
              onChange={(e) => setAreaAcres(e.target.value)}
              required
            />
            <Input
              label="Soil Type"
              value={soilType}
              onChange={(e) => setSoilType(e.target.value)}
              placeholder="e.g. Alluvial"
            />
            <div>
              <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1.5">
                Tenure
              </label>
              <select
                value={tenure}
                onChange={(e) => setTenure(e.target.value as 'owned' | 'leased')}
                className="w-full px-3.5 py-2 text-sm bg-white border border-gray-300 rounded-lg"
              >
                <option value="owned">Owned</option>
                <option value="leased">Leased</option>
              </select>
            </div>
          </div>

          <div className="bg-water-50/60 p-4 rounded-xl border border-water-200/80 space-y-3">
            <h4 className="text-xs font-bold text-water-900 uppercase tracking-wider flex items-center gap-1">
              <Droplets className="w-3.5 h-3.5 text-water-700" /> Primary Water Source Specification
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-gray-700 uppercase mb-1">
                  Source Type *
                </label>
                <select
                  value={waterSourceTypeId}
                  onChange={(e) => setWaterSourceTypeId(e.target.value)}
                  required
                  className="w-full px-3 py-1.5 text-xs bg-white border border-gray-300 rounded-lg"
                >
                  <option value="">Select Source</option>
                  {waterSourceTypes?.map((ws) => (
                    <option key={ws.id} value={ws.id}>
                      {ws.name} ({ws.name_te})
                    </option>
                  ))}
                </select>
              </div>

              <Input
                label="Pump HP"
                type="number"
                step="0.5"
                value={pumpHp}
                onChange={(e) => setPumpHp(e.target.value)}
                placeholder="5.0"
              />

              <Input
                label="Discharge (L/hr)"
                type="number"
                step="500"
                value={dischargeLph}
                onChange={(e) => setDischargeLph(e.target.value)}
                placeholder="15000"
              />
            </div>
          </div>

          <div className="flex justify-end space-x-3 pt-3">
            <Button variant="outline" type="button" onClick={() => setIsAddPlotOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" isLoading={createPlotMutation.isPending}>
              Create Plot
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
