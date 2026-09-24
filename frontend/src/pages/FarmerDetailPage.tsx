import React, { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '../api/client.js';
import { useAuth } from '../lib/auth.js';
import {
  ArrowLeft,
  MapPin,
  Phone,
  Calendar,
  Shield,
  Clock,
  Plus,
  Droplets,
  AlertCircle,
} from 'lucide-react';
import { Card } from '../components/ui/Card.js';
import { Button } from '../components/ui/Button.js';
import { Badge } from '../components/ui/Badge.js';
import { Modal } from '../components/ui/Modal.js';
import { Input } from '../components/ui/Input.js';

export const FarmerDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canManage = user?.role === 'ADMIN' || user?.role === 'CSP_MEMBER';

  const [activeTab, setActiveTab] = useState<'plots' | 'contacts' | 'consents' | 'history'>('plots');
  const [isAddPlotOpen, setIsAddPlotOpen] = useState(false);

  // New Plot Form State
  const [plotLabel, setPlotLabel] = useState('');
  const [surveyNumber, setSurveyNumber] = useState('');
  const [areaAcres, setAreaAcres] = useState('2.5');
  const [soilType, setSoilType] = useState('Black Cotton');
  const [tenure, setTenure] = useState<'owned' | 'leased'>('owned');
  const [waterSourceTypeId, setWaterSourceTypeId] = useState('');
  const [pumpHp, setPumpHp] = useState('5.0');
  const [dischargeLph, setDischargeLph] = useState('15000');
  const [plotError, setPlotError] = useState<string | null>(null);

  const { data: farmer, isLoading } = useQuery<any>({
    queryKey: ['farmer', id],
    queryFn: () => apiRequest<any>(`/farmers/${id}`),
  });

  const { data: waterSourceTypes } = useQuery<any[]>({
    queryKey: ['water-source-types'],
    queryFn: () => apiRequest<any[]>('/reference/water-source-types'),
  });

  const { data: history } = useQuery<any[]>({
    queryKey: ['farmer-history', id],
    queryFn: () => apiRequest<any[]>(`/farmers/${id}/history`),
    enabled: activeTab === 'history',
  });

  // Create Plot Mutation
  const createPlotMutation = useMutation({
    mutationFn: (newPlot: any) =>
      apiRequest('/plots', {
        method: 'POST',
        body: JSON.stringify(newPlot),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['farmer', id] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-kpis'] });
      setIsAddPlotOpen(false);
      setPlotLabel('');
      setSurveyNumber('');
      setPlotError(null);
    },
    onError: (err: any) => {
      setPlotError(err.message || 'Failed to create plot.');
    },
  });

  const handleAddPlotSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPlotError(null);

    if (!waterSourceTypeId) {
      setPlotError('Please select a water source.');
      return;
    }

    createPlotMutation.mutate({
      farmer_id: id,
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

  if (isLoading) {
    return <div className="py-12 text-center text-sm text-gray-500">Loading farmer profile...</div>;
  }

  if (!farmer) {
    return (
      <div className="py-12 text-center">
        <p className="text-base font-medium text-gray-700">Farmer not found</p>
        <Link to="/farmers" className="text-sm text-forest-700 hover:underline mt-2 inline-block">
          Return to Farmers Directory
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Back button */}
      <div>
        <Link to="/farmers" className="text-xs font-semibold text-forest-700 hover:text-forest-800 flex items-center gap-1.5">
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Farmers Directory
        </Link>
      </div>

      {/* Profile Header Card */}
      <div className="bg-white p-6 rounded-2xl border border-gray-200/80 shadow-sm flex flex-col md:flex-row md:items-center md:justify-between gap-6">
        <div className="flex items-start space-x-4">
          <div className="w-14 h-14 rounded-2xl bg-forest-100 flex items-center justify-center text-forest-800 font-bold text-xl shrink-0">
            {farmer.full_name?.slice(0, 2).toUpperCase()}
          </div>
          <div>
            <div className="flex items-center space-x-3">
              <h1 className="text-2xl font-bold text-gray-900">{farmer.full_name}</h1>
              <Badge variant={farmer.status === 'active' ? 'success' : 'neutral'}>
                {farmer.status}
              </Badge>
              {farmer.data_origin === 'demo' && (
                <Badge variant="demo">DEMO FARMER</Badge>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-4 mt-2 text-xs text-gray-500">
              <span className="font-mono bg-gray-100 px-2 py-0.5 rounded font-semibold text-gray-700">
                {farmer.farmer_code}
              </span>
              <span className="flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5 text-forest-700" />
                {farmer.village_name}, {farmer.mandal} ({farmer.district})
              </span>
              <span className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-gray-400" />
                Call Window: {farmer.call_window_start} - {farmer.call_window_end}
              </span>
            </div>
          </div>
        </div>

        {canManage && (
          <div className="flex items-center space-x-3">
            <Button variant="primary" size="md" onClick={() => setIsAddPlotOpen(true)}>
              <Plus className="w-4 h-4 mr-1.5" /> Add Plot
            </Button>
          </div>
        )}
      </div>

      {/* Tabs Header */}
      <div className="border-b border-gray-200 flex space-x-8 text-sm font-medium">
        <button
          onClick={() => setActiveTab('plots')}
          className={`pb-3 border-b-2 flex items-center gap-2 ${
            activeTab === 'plots'
              ? 'border-forest-700 text-forest-800 font-bold'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <MapPin className="w-4 h-4" /> Plots & Water Sources ({farmer.plots?.length || 0})
        </button>
        <button
          onClick={() => setActiveTab('contacts')}
          className={`pb-3 border-b-2 flex items-center gap-2 ${
            activeTab === 'contacts'
              ? 'border-forest-700 text-forest-800 font-bold'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <Phone className="w-4 h-4" /> Contacts ({farmer.contacts?.length || 0})
        </button>
        <button
          onClick={() => setActiveTab('consents')}
          className={`pb-3 border-b-2 flex items-center gap-2 ${
            activeTab === 'consents'
              ? 'border-forest-700 text-forest-800 font-bold'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <Shield className="w-4 h-4" /> Communication Consents ({farmer.consents?.length || 0})
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={`pb-3 border-b-2 flex items-center gap-2 ${
            activeTab === 'history'
              ? 'border-forest-700 text-forest-800 font-bold'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <Calendar className="w-4 h-4" /> Audit History
        </button>
      </div>

      {/* Tab 1: Plots & Water Sources */}
      {activeTab === 'plots' && (
        <div className="space-y-4">
          {!farmer.plots || farmer.plots.length === 0 ? (
            <Card>
              <div className="py-12 text-center">
                <MapPin className="w-10 h-10 text-gray-300 mx-auto mb-2" />
                <p className="text-sm font-medium text-gray-700">No agricultural plots registered</p>
                <p className="text-xs text-gray-400 mt-1">Add a plot with acreage and water sources to enable seasonal monitoring.</p>
                {canManage && (
                  <div className="mt-4">
                    <Button variant="primary" size="sm" onClick={() => setIsAddPlotOpen(true)}>
                      <Plus className="w-3.5 h-3.5 mr-1" /> Add First Plot
                    </Button>
                  </div>
                )}
              </div>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {farmer.plots.map((p: any) => (
                <Card key={p.id} title={p.label} subtitle={`Survey: ${p.survey_number || 'N/A'} • ${p.tenure}`}>
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4 pb-3 border-b border-gray-100 text-xs">
                      <div>
                        <span className="text-gray-400 uppercase font-semibold">Area</span>
                        <p className="text-base font-bold text-gray-900 mt-0.5">{parseFloat(p.area_acres).toFixed(2)} Acres</p>
                      </div>
                      <div>
                        <span className="text-gray-400 uppercase font-semibold">Soil Type</span>
                        <p className="text-sm font-medium text-gray-800 mt-0.5">{p.soil_type || 'Unspecified'}</p>
                      </div>
                    </div>

                    <div>
                      <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                        <Droplets className="w-3.5 h-3.5 text-water-600" /> Water Sources & Pumps
                      </h4>
                      {p.water_sources?.length > 0 ? (
                        <div className="space-y-2">
                          {p.water_sources.map((ws: any) => (
                            <div key={ws.id} className="p-3 bg-water-50/50 border border-water-100 rounded-xl text-xs flex justify-between items-center">
                              <div>
                                <p className="font-semibold text-water-900">{ws.source_name} ({ws.source_name_te})</p>
                                <p className="text-[11px] text-water-700 mt-0.5">
                                  {ws.pump_hp ? `${ws.pump_hp} HP Pump` : 'No pump'} • {ws.discharge_lph ? `${ws.discharge_lph.toLocaleString()} L/hr discharge` : 'Discharge not specified'}
                                </p>
                              </div>
                              {ws.is_primary && (
                                <Badge variant="info" size="sm">Primary</Badge>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-amber-600 italic">No water source attached to this plot.</p>
                      )}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Contacts */}
      {activeTab === 'contacts' && (
        <Card title="Registered Phone Contacts">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-xs font-semibold text-gray-400 uppercase">
                  <th className="pb-3">Type</th>
                  <th className="pb-3">Phone (E.164)</th>
                  <th className="pb-3">Status</th>
                  <th className="pb-3">Verified</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {farmer.contacts?.map((c: any) => (
                  <tr key={c.id}>
                    <td className="py-3 font-semibold uppercase text-xs text-gray-700">{c.type}</td>
                    <td className="py-3 font-mono font-bold text-gray-900">{c.phone_e164}</td>
                    <td className="py-3">
                      <Badge variant={c.is_active ? 'success' : 'neutral'} size="sm">
                        {c.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </td>
                    <td className="py-3 text-xs text-gray-500">{c.is_verified ? 'Yes' : 'No'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Tab 3: Consents */}
      {activeTab === 'consents' && (
        <Card title="Communication Consent History">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-xs font-semibold text-gray-400 uppercase">
                  <th className="pb-3">Channel</th>
                  <th className="pb-3">Status</th>
                  <th className="pb-3">Method</th>
                  <th className="pb-3">Recorded At</th>
                  <th className="pb-3">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {farmer.consents?.map((cs: any) => (
                  <tr key={cs.id}>
                    <td className="py-3 font-semibold uppercase text-xs text-gray-700">{cs.channel}</td>
                    <td className="py-3">
                      <Badge variant={cs.status === 'granted' ? 'success' : 'danger'} size="sm">
                        {cs.status}
                      </Badge>
                    </td>
                    <td className="py-3 text-xs text-gray-600">{cs.method}</td>
                    <td className="py-3 text-xs text-gray-500">{new Date(cs.recorded_at).toLocaleString()}</td>
                    <td className="py-3 text-xs text-gray-600">{cs.note || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Tab 4: Audit History */}
      {activeTab === 'history' && (
        <Card title="Farmer Audit Log">
          {!history || history.length === 0 ? (
            <p className="text-xs text-gray-400 py-4">No audit events recorded yet.</p>
          ) : (
            <div className="space-y-3">
              {history.map((h: any) => (
                <div key={h.id} className="p-3 bg-gray-50 rounded-xl border border-gray-200 text-xs flex justify-between items-start">
                  <div>
                    <span className="font-bold text-gray-900 uppercase tracking-wider">{h.action}</span>
                    <span className="text-gray-500 ml-2">by {h.user_name || 'System'}</span>
                    <div className="text-[11px] text-gray-400 mt-1 font-mono">
                      {h.after ? JSON.stringify(h.after) : ''}
                    </div>
                  </div>
                  <span className="text-[11px] text-gray-400">{new Date(h.created_at).toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* Add Plot Modal */}
      <Modal isOpen={isAddPlotOpen} onClose={() => setIsAddPlotOpen(false)} title="Add Agricultural Plot" maxWidth="lg">
        <form onSubmit={handleAddPlotSubmit} className="space-y-4">
          {plotError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-center gap-1.5">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
              <span>{plotError}</span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Plot Label *"
              value={plotLabel}
              onChange={(e) => setPlotLabel(e.target.value)}
              placeholder="e.g. North Acre / Canal Field"
              required
            />
            <Input
              label="Survey Number"
              value={surveyNumber}
              onChange={(e) => setSurveyNumber(e.target.value)}
              placeholder="e.g. SY-102/3"
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
              placeholder="e.g. Black Cotton"
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

          {/* Primary Water Source for Plot */}
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
            <p className="text-[11px] text-water-800">
              Discharge rate is critical for estimating irrigation volume from farmer-reported pump hours.
            </p>
          </div>

          <div className="flex justify-end space-x-3 pt-3">
            <Button variant="outline" type="button" onClick={() => setIsAddPlotOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" isLoading={createPlotMutation.isPending}>
              Save Plot
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
