import React, { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '../api/client.js';
import { useAuth } from '../lib/auth.js';
import {
  Calendar,
  ChevronLeft,
  Droplets,
  Sprout,
  Activity,
  Layers,
  CheckCircle2,
  Clock,
  PhoneCall,
  AlertTriangle,
  RefreshCw,
  Plus,
  Play,
  FileText,
} from 'lucide-react';
import { Card } from '../components/ui/Card.js';
import { Button } from '../components/ui/Button.js';
import { Badge } from '../components/ui/Badge.js';
import { Modal } from '../components/ui/Modal.js';
import { Input } from '../components/ui/Input.js';

export const SeasonDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canManage = user?.role === 'ADMIN' || user?.role === 'CSP_MEMBER';

  const [activeTab, setActiveTab] = useState<'timeline' | 'irrigation' | 'feedback'>('timeline');

  // Modals state
  const [isIrrigationModalOpen, setIsIrrigationModalOpen] = useState(false);
  const [isProgressModalOpen, setIsProgressModalOpen] = useState(false);
  const [isFeedbackModalOpen, setIsFeedbackModalOpen] = useState(false);
  const [isCompleteModalOpen, setIsCompleteModalOpen] = useState(false);

  // Irrigation Form State
  const [irrStart, setIrrStart] = useState(new Date().toISOString().split('T')[0]);
  const [irrEnd, setIrrEnd] = useState(new Date().toISOString().split('T')[0]);
  const [pumpHours, setPumpHours] = useState('4.0');
  const [eventCount, setEventCount] = useState(1);
  const [irrNotes, setIrrNotes] = useState('');

  // Crop Progress Form State
  const [progressDate, setProgressDate] = useState(new Date().toISOString().split('T')[0]);
  const [cropCondition, setCropCondition] = useState<'good' | 'average' | 'poor'>('good');
  const [reportedStageId, setReportedStageId] = useState('');
  const [progressNotes, setProgressNotes] = useState('');

  // Feedback Form State
  const [fbCycle, setFbCycle] = useState(1);
  const [fbRainfall, setFbRainfall] = useState<'none' | 'light' | 'moderate' | 'heavy'>('none');
  const [fbIrrigated, setFbIrrigated] = useState(true);
  const [fbPumpHours, setFbPumpHours] = useState('5.0');
  const [fbCropCondition, setFbCropCondition] = useState<'good' | 'average' | 'poor'>('good');
  const [fbWaterProblem, setFbWaterProblem] = useState<'none' | 'shortage' | 'pump_power' | 'source_unavailable'>('none');
  const [fbCropProblem, setFbCropProblem] = useState<'none' | 'pest_disease' | 'yellowing_drying' | 'other'>('none');
  const [fbCallback, setFbCallback] = useState(false);

  // Complete Season Form State
  const [actualHarvestDate, setActualHarvestDate] = useState(new Date().toISOString().split('T')[0]);
  const [yieldValue, setYieldValue] = useState('45.0');
  const [yieldUnit, setYieldUnit] = useState<'quintal' | 'kg' | 'tonne'>('quintal');
  const [harvestNotes, setHarvestNotes] = useState('');

  // Queries
  const { data: season, isLoading: isSeasonLoading } = useQuery<any>({
    queryKey: ['season', id],
    queryFn: () => apiRequest<any>(`/seasons/${id}`),
    enabled: Boolean(id),
  });

  const { data: timelineData, isLoading: isTimelineLoading } = useQuery<any>({
    queryKey: ['season-timeline', id],
    queryFn: () => apiRequest<any>(`/seasons/${id}/timeline`),
    enabled: Boolean(id),
  });

  const { data: irrigationRecords } = useQuery<any[]>({
    queryKey: ['season-irrigation', id],
    queryFn: () => apiRequest<any[]>(`/irrigation?season_id=${id}`),
    enabled: Boolean(id),
  });

  const { data: feedbackRecords } = useQuery<any[]>({
    queryKey: ['season-feedback', id],
    queryFn: () => apiRequest<any[]>(`/feedback?season_id=${id}`),
    enabled: Boolean(id),
  });

  const { data: cropStages } = useQuery<any[]>({
    queryKey: ['crop-stages', season?.crop_id],
    queryFn: () => (season?.crop_id ? apiRequest<any[]>(`/reference/crops/${season.crop_id}/stages`) : Promise.resolve([])),
    enabled: Boolean(season?.crop_id),
  });

  // Calculate live preview for irrigation
  const avgDischarge = season?.water_sources_snapshot?.[0]?.discharge_lph_snapshot || 25000;
  const areaAcres = parseFloat(season?.area_acres_snapshot || '1.0');
  const previewVolumeL = Math.round(parseFloat(pumpHours || '0') * avgDischarge);
  const previewDepthMm = areaAcres > 0 ? (previewVolumeL / (areaAcres * 4046.86)).toFixed(2) : '0';

  // Mutations
  const refreshDraftMutation = useMutation({
    mutationFn: () => apiRequest(`/seasons/${id}/refresh-draft`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['season', id] });
      alert('Draft snapshot successfully refreshed from plot.');
    },
    onError: (err: any) => alert(err.message),
  });

  const activateMutation = useMutation({
    mutationFn: () => apiRequest(`/seasons/${id}/activate`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['season', id] });
      queryClient.invalidateQueries({ queryKey: ['season-timeline', id] });
    },
    onError: (err: any) => alert(err.message),
  });

  const logIrrigationMutation = useMutation({
    mutationFn: (payload: any) =>
      apiRequest('/irrigation', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['season-irrigation', id] });
      queryClient.invalidateQueries({ queryKey: ['season-timeline', id] });
      setIsIrrigationModalOpen(false);
    },
    onError: (err: any) => alert(err.message),
  });

  const logProgressMutation = useMutation({
    mutationFn: (payload: any) =>
      apiRequest('/crop-progress', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['season-timeline', id] });
      setIsProgressModalOpen(false);
    },
    onError: (err: any) => alert(err.message),
  });

  const logFeedbackMutation = useMutation({
    mutationFn: (payload: any) =>
      apiRequest('/feedback', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['season', id] });
      queryClient.invalidateQueries({ queryKey: ['season-feedback', id] });
      queryClient.invalidateQueries({ queryKey: ['season-irrigation', id] });
      queryClient.invalidateQueries({ queryKey: ['season-timeline', id] });
      setIsFeedbackModalOpen(false);
    },
    onError: (err: any) => alert(err.message),
  });

  const completeSeasonMutation = useMutation({
    mutationFn: (payload: any) =>
      apiRequest(`/seasons/${id}/complete`, {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['season', id] });
      queryClient.invalidateQueries({ queryKey: ['season-timeline', id] });
      setIsCompleteModalOpen(false);
    },
    onError: (err: any) => alert(err.message),
  });

  if (isSeasonLoading) {
    return <div className="p-12 text-center text-gray-500">Loading season profile...</div>;
  }

  if (!season) {
    return (
      <div className="p-12 text-center text-gray-500">
        <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto mb-2" />
        <p className="font-semibold">Season not found</p>
        <Link to="/seasons" className="text-forest-600 underline text-sm mt-2 block">
          Back to Seasons
        </Link>
      </div>
    );
  }

  const isDraft = season.status === 'draft';
  const isCompleted = season.status === 'completed';

  return (
    <div className="space-y-6">
      {/* Top Breadcrumb & Back */}
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link to="/seasons" className="hover:text-forest-700 flex items-center gap-1 font-medium">
          <ChevronLeft className="w-4 h-4" />
          <span>Seasons (పంట కాలాలు)</span>
        </Link>
        <span>/</span>
        <span className="font-mono text-gray-900">{season.season_code}</span>
      </div>

      {/* Hero Header Card */}
      <Card className="p-6 bg-white border border-gray-200">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-gray-100 pb-5">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900 font-mono">{season.season_code}</h1>
              <Badge
                variant={
                  season.status === 'active'
                    ? 'success'
                    : season.status === 'monitoring'
                    ? 'info'
                    : season.status === 'draft'
                    ? 'warning'
                    : 'neutral'
                }
              >
                {season.status.toUpperCase()}
              </Badge>
            </div>

            <p className="text-base text-gray-700 mt-1 flex items-center gap-2">
              <Sprout className="w-4 h-4 text-forest-600" />
              <span className="font-semibold">{season.crop_name}</span>
              {season.crop_name_te && <span className="text-forest-600 font-medium">({season.crop_name_te})</span>}
              <span className="text-gray-400">•</span>
              <span className="text-gray-600">{season.variety || 'Standard Variety'}</span>
              <span className="text-gray-400">•</span>
              <span className="capitalize">{season.season_type} {season.season_year}</span>
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center gap-2">
            {isDraft && canManage && (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => refreshDraftMutation.mutate()}
                  disabled={refreshDraftMutation.isPending}
                  className="flex items-center gap-1.5"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Refresh Draft Snapshot</span>
                </Button>

                <Button
                  size="sm"
                  onClick={() => {
                    if (confirm('Activate this season now? Snapshots will be permanently frozen.')) {
                      activateMutation.mutate();
                    }
                  }}
                  disabled={activateMutation.isPending}
                  className="flex items-center gap-1.5"
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>Activate Season (ప్రారంభించు)</span>
                </Button>
              </>
            )}

            {!isDraft && !isCompleted && canManage && (
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setIsIrrigationModalOpen(true)}
                  className="flex items-center gap-1.5"
                >
                  <Droplets className="w-3.5 h-3.5 text-water-600" />
                  <span>Log Irrigation (సేద్యం)</span>
                </Button>

                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setIsProgressModalOpen(true)}
                  className="flex items-center gap-1.5"
                >
                  <Sprout className="w-3.5 h-3.5 text-forest-600" />
                  <span>Record Stage (పంట దశ)</span>
                </Button>

                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setIsFeedbackModalOpen(true)}
                  className="flex items-center gap-1.5"
                >
                  <PhoneCall className="w-3.5 h-3.5 text-amber-600" />
                  <span>Simulate Voice Feedback</span>
                </Button>

                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => setIsCompleteModalOpen(true)}
                  className="flex items-center gap-1.5"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Complete Season (కోత/పూర్తి)</span>
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Farmer & Plot Details Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-5 text-sm">
          <div>
            <span className="text-xs text-gray-400 block">Farmer (రైతు)</span>
            <Link to={`/farmers/${season.farmer_id}`} className="font-medium text-forest-700 hover:underline">
              {season.farmer_name}
            </Link>
            <span className="text-xs text-gray-500 block">{season.village_name}, {season.mandal}</span>
          </div>

          <div>
            <span className="text-xs text-gray-400 block">Plot Label (పొలం)</span>
            <span className="font-medium text-gray-900">{season.plot_label}</span>
            <span className="text-xs text-gray-500 block">Survey #{season.plot_survey_number || 'N/A'}</span>
          </div>

          <div>
            <span className="text-xs text-gray-400 block">Sowing & Harvest</span>
            <span className="font-medium text-gray-900">{season.sowing_date}</span>
            <span className="text-xs text-gray-500 block">Exp: {season.expected_harvest_date}</span>
          </div>

          <div>
            <span className="text-xs text-gray-400 block">Irrigation Method</span>
            <span className="font-medium text-gray-900">{season.irrigation_method_name}</span>
            <span className="text-xs text-forest-600 font-semibold block">
              {Math.round(season.typical_efficiency * 100)}% Eff Baseline
            </span>
          </div>
        </div>
      </Card>

      {/* Snapshot Preserved Banner */}
      <Card className={`p-4 border-l-4 ${isDraft ? 'border-l-amber-500 bg-amber-50/40' : 'border-l-emerald-600 bg-emerald-50/40'}`}>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-xl ${isDraft ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-gray-900">
                  {isDraft ? 'Draft Plot Snapshot (రిఫ్రెష్ చేయదగిన స్నాప్‌షాట్)' : 'Frozen Agricultural Snapshot (శాశ్వతంగా స్తంభింపజేయబడిన స్నాప్‌షాట్)'}
                </h3>
                <Badge variant={isDraft ? 'warning' : 'success'} size="sm">
                  {isDraft ? 'Mutable in Draft' : 'Permanently Frozen'}
                </Badge>
              </div>
              <p className="text-xs text-gray-600 mt-0.5">
                Snapshot Area: <strong className="font-bold text-forest-800">{season.area_acres_snapshot} Acres</strong>
                {season.water_sources_snapshot?.length > 0 && (
                  <span>
                    {' '}| Source: <strong>{season.water_sources_snapshot[0].source_name}</strong>
                    {season.water_sources_snapshot[0].pump_hp_snapshot && (
                      <span> ({season.water_sources_snapshot[0].pump_hp_snapshot} HP Pump, {season.water_sources_snapshot[0].discharge_lph_snapshot?.toLocaleString()} L/hr)</span>
                    )}
                  </span>
                )}
              </p>
            </div>
          </div>
          {isDraft && (
            <span className="text-xs text-amber-700 italic hidden sm:block">
              Editable while in draft. Frozen forever once activated.
            </span>
          )}
        </div>
      </Card>

      {/* Tab Navigation */}
      <div className="flex border-b border-gray-200">
        <button
          onClick={() => setActiveTab('timeline')}
          className={`py-3 px-6 text-sm font-medium border-b-2 flex items-center gap-2 transition-colors ${
            activeTab === 'timeline'
              ? 'border-forest-600 text-forest-700 font-semibold'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <Activity className="w-4 h-4" />
          <span>Timeline & Milestones (కాలక్రమం)</span>
          <span className="bg-gray-100 text-gray-600 text-xs px-2 py-0.5 rounded-full font-mono">
            {timelineData?.events?.length || 0}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('irrigation')}
          className={`py-3 px-6 text-sm font-medium border-b-2 flex items-center gap-2 transition-colors ${
            activeTab === 'irrigation'
              ? 'border-forest-600 text-forest-700 font-semibold'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <Droplets className="w-4 h-4" />
          <span>Irrigation Logs (సేద్యం రికార్డులు)</span>
          <span className="bg-gray-100 text-gray-600 text-xs px-2 py-0.5 rounded-full font-mono">
            {irrigationRecords?.length || 0}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('feedback')}
          className={`py-3 px-6 text-sm font-medium border-b-2 flex items-center gap-2 transition-colors ${
            activeTab === 'feedback'
              ? 'border-forest-600 text-forest-700 font-semibold'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <PhoneCall className="w-4 h-4" />
          <span>Voice Feedback Cycles (కాల్ ఫీడ్‌బ్యాక్)</span>
          <span className="bg-gray-100 text-gray-600 text-xs px-2 py-0.5 rounded-full font-mono">
            {feedbackRecords?.length || 0}
          </span>
        </button>
      </div>

      {/* Tab 1: Interactive Timeline */}
      {activeTab === 'timeline' && (
        <Card className="p-6">
          <h2 className="text-base font-bold text-gray-900 mb-6 flex items-center gap-2">
            <Activity className="w-5 h-5 text-forest-600" />
            <span>Chronological Season Activity Timeline</span>
          </h2>

          {isTimelineLoading ? (
            <p className="text-sm text-gray-500">Loading timeline events...</p>
          ) : !timelineData?.events || timelineData.events.length === 0 ? (
            <div className="text-center py-8 text-gray-400">
              <Calendar className="w-10 h-10 mx-auto text-gray-300 mb-2" />
              <p>No activity recorded yet for this season.</p>
            </div>
          ) : (
            <div className="relative border-l-2 border-forest-200 ml-4 space-y-6">
              {timelineData.events.map((event: any, idx: number) => {
                let badgeVariant = 'default';
                let Icon = Activity;
                if (event.type === 'sowing') {
                  badgeVariant = 'success';
                  Icon = Sprout;
                } else if (event.type === 'irrigation') {
                  badgeVariant = 'info';
                  Icon = Droplets;
                } else if (event.type === 'feedback') {
                  badgeVariant = 'warning';
                  Icon = PhoneCall;
                } else if (event.type === 'progress') {
                  badgeVariant = 'success';
                  Icon = Sprout;
                } else if (event.type === 'harvest') {
                  badgeVariant = 'default';
                  Icon = CheckCircle2;
                }

                return (
                  <div key={idx} className="relative pl-6">
                    {/* Node Dot */}
                    <div className="absolute -left-[9px] top-1 w-4 h-4 rounded-full bg-white border-2 border-forest-600 shadow-sm flex items-center justify-center" />

                    <div className="bg-white p-4 rounded-xl border border-gray-200/80 shadow-sm hover:border-forest-300 transition-colors">
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                        <div className="flex items-center gap-2">
                          <Icon className="w-4 h-4 text-forest-600" />
                          <h4 className="font-semibold text-gray-900 text-sm">{event.title}</h4>
                        </div>
                        <span className="text-xs text-gray-400 font-mono">{event.date}</span>
                      </div>
                      <p className="text-xs text-gray-600">{event.description}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}

      {/* Tab 2: Irrigation Records */}
      {activeTab === 'irrigation' && (
        <Card className="overflow-hidden">
          <div className="p-4 bg-gray-50 border-b border-gray-200 flex justify-between items-center">
            <h3 className="text-sm font-bold text-gray-900">Irrigation Event Records</h3>
            {canManage && !isCompleted && (
              <Button size="sm" onClick={() => setIsIrrigationModalOpen(true)} className="flex items-center gap-1.5">
                <Plus className="w-3.5 h-3.5" />
                <span>Log Irrigation</span>
              </Button>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-100/60 text-gray-500 font-semibold border-b border-gray-200">
                <tr>
                  <th className="py-2.5 px-4">Period</th>
                  <th className="py-2.5 px-4">Pump Hours</th>
                  <th className="py-2.5 px-4">Estimated Volume (L)</th>
                  <th className="py-2.5 px-4">Estimated Depth (mm)</th>
                  <th className="py-2.5 px-4">Measurement Type</th>
                  <th className="py-2.5 px-4">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {irrigationRecords?.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-gray-400">
                      No irrigation records logged yet.
                    </td>
                  </tr>
                ) : (
                  irrigationRecords?.map((ir) => (
                    <tr key={ir.id} className="hover:bg-gray-50/80">
                      <td className="py-3 px-4 font-mono text-xs">
                        {ir.period_start} to {ir.period_end}
                      </td>
                      <td className="py-3 px-4 font-semibold text-gray-900">
                        {ir.raw_value} {ir.raw_unit} ({ir.event_count}x)
                      </td>
                      <td className="py-3 px-4 text-water-700 font-bold">
                        {parseFloat(ir.estimated_volume_l).toLocaleString()} L
                      </td>
                      <td className="py-3 px-4 text-gray-700">
                        {ir.estimated_depth_mm ? `${parseFloat(ir.estimated_depth_mm).toFixed(2)} mm` : 'N/A'}
                      </td>
                      <td className="py-3 px-4">
                        <Badge variant="warning" size="sm">
                          Estimated (అంచనా)
                        </Badge>
                      </td>
                      <td className="py-3 px-4 text-xs text-gray-500 capitalize">{ir.source}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Tab 3: Feedback History */}
      {activeTab === 'feedback' && (
        <Card className="overflow-hidden">
          <div className="p-4 bg-gray-50 border-b border-gray-200 flex justify-between items-center">
            <h3 className="text-sm font-bold text-gray-900">Farmer Weekly Voice Feedback Log</h3>
            {canManage && !isCompleted && (
              <Button size="sm" onClick={() => setIsFeedbackModalOpen(true)} className="flex items-center gap-1.5">
                <Plus className="w-3.5 h-3.5" />
                <span>Simulate Call Feedback</span>
              </Button>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-100/60 text-gray-500 font-semibold border-b border-gray-200">
                <tr>
                  <th className="py-2.5 px-4">Cycle</th>
                  <th className="py-2.5 px-4">Period</th>
                  <th className="py-2.5 px-4">Rainfall</th>
                  <th className="py-2.5 px-4">Irrigation Reported</th>
                  <th className="py-2.5 px-4">Crop Condition</th>
                  <th className="py-2.5 px-4">Problems Reported</th>
                  <th className="py-2.5 px-4">Callback</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {feedbackRecords?.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-gray-400">
                      No feedback cycles recorded yet.
                    </td>
                  </tr>
                ) : (
                  feedbackRecords?.map((fb) => (
                    <tr key={fb.id} className="hover:bg-gray-50/80">
                      <td className="py-3 px-4 font-bold text-forest-700 font-mono">Cycle {fb.cycle_number}</td>
                      <td className="py-3 px-4 text-xs font-mono">
                        {fb.period_start} → {fb.period_end}
                      </td>
                      <td className="py-3 px-4 capitalize">{fb.rainfall_class}</td>
                      <td className="py-3 px-4">
                        {fb.irrigated ? (
                          <span className="text-water-700 font-medium font-mono">Yes ({fb.pump_hours} hrs)</span>
                        ) : (
                          <span className="text-gray-400">No</span>
                        )}
                      </td>
                      <td className="py-3 px-4 capitalize font-medium">{fb.crop_condition}</td>
                      <td className="py-3 px-4 text-xs">
                        {fb.water_problem !== 'none' && (
                          <span className="text-red-600 block font-semibold">Water: {fb.water_problem}</span>
                        )}
                        {fb.crop_problem !== 'none' && (
                          <span className="text-amber-700 block">Crop: {fb.crop_problem}</span>
                        )}
                        {fb.water_problem === 'none' && fb.crop_problem === 'none' && (
                          <span className="text-emerald-600">None reported</span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        {fb.callback_requested ? (
                          <Badge variant="danger" size="sm">
                            Requested
                          </Badge>
                        ) : (
                          <span className="text-gray-400 text-xs">No</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Modal: Log Manual Irrigation */}
      <Modal isOpen={isIrrigationModalOpen} onClose={() => setIsIrrigationModalOpen(false)} title="Log Irrigation Event (సేద్యం నమోదు)">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            logIrrigationMutation.mutate({
              season_id: id,
              period_start: irrStart,
              period_end: irrEnd,
              event_count: Number(eventCount),
              raw_value: parseFloat(pumpHours),
              raw_unit: 'pump_hours',
              source: 'admin_entry',
              notes: irrNotes || null,
            });
          }}
          className="space-y-4"
        >
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Start Date *</label>
              <input
                type="date"
                value={irrStart}
                onChange={(e) => setIrrStart(e.target.value)}
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">End Date *</label>
              <input
                type="date"
                value={irrEnd}
                onChange={(e) => setIrrEnd(e.target.value)}
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Pump Running Hours *</label>
              <input
                type="number"
                step="0.5"
                min="0.1"
                value={pumpHours}
                onChange={(e) => setPumpHours(e.target.value)}
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Number of Events</label>
              <input
                type="number"
                min="1"
                value={eventCount}
                onChange={(e) => setEventCount(Number(e.target.value))}
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
            </div>
          </div>

          {/* Real-time Calculation Preview */}
          <div className="p-3 bg-water-50 rounded-lg border border-water-200 text-xs space-y-1">
            <div className="font-semibold text-water-900 flex items-center gap-1">
              <Droplets className="w-3.5 h-3.5 text-water-600" />
              <span>Hydrologic Volume Calculation (అంచనా లెక్కింపు):</span>
            </div>
            <p className="text-water-800">
              Est. Volume: <strong className="font-bold">{previewVolumeL.toLocaleString()} Litres</strong> ({pumpHours} hrs × {avgDischarge.toLocaleString()} L/hr)
            </p>
            <p className="text-water-800">
              Est. Depth: <strong className="font-bold">{previewDepthMm} mm</strong> on {areaAcres} acres
            </p>
            <p className="text-water-600 text-[11px] italic">
              Provenance: farmer_reported / pump_hours_x_discharge. Labeled strictly as 'estimated'.
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Notes (ఐచ్ఛికం)</label>
            <input
              type="text"
              value={irrNotes}
              onChange={(e) => setIrrNotes(e.target.value)}
              placeholder="e.g. Canal water supplemented with borewell"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
          </div>

          <div className="flex justify-end gap-3 pt-3 border-t border-gray-100">
            <Button type="button" variant="outline" onClick={() => setIsIrrigationModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={logIrrigationMutation.isPending}>
              {logIrrigationMutation.isPending ? 'Logging...' : 'Save Irrigation Record'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal: Record Crop Stage */}
      <Modal isOpen={isProgressModalOpen} onClose={() => setIsProgressModalOpen(false)} title="Record Crop Progress (పంట దశ పరిశీలన)">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            logProgressMutation.mutate({
              season_id: id,
              observed_on: progressDate,
              condition: cropCondition,
              reported_stage_id: reportedStageId || null,
              source: 'field_visit',
              notes: progressNotes || null,
            });
          }}
          className="space-y-4"
        >
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Observation Date *</label>
            <input
              type="date"
              value={progressDate}
              onChange={(e) => setProgressDate(e.target.value)}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Crop Stage (పంట దశ)</label>
            <select
              value={reportedStageId}
              onChange={(e) => setReportedStageId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
            >
              <option value="">-- Auto-calculate from Sowing Date (సిఫార్సు) --</option>
              {cropStages?.map((s) => (
                <option key={s.id} value={s.id}>
                  Stage {s.stage_order}: {s.name} ({s.name_te || ''}) - DAS {s.start_das}-{s.end_das}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Observed Condition *</label>
            <div className="grid grid-cols-3 gap-2">
              {(['good', 'average', 'poor'] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCropCondition(c)}
                  className={`py-2 px-3 text-xs font-semibold rounded-lg capitalize border ${
                    cropCondition === c
                      ? c === 'good'
                        ? 'bg-emerald-100 border-emerald-500 text-emerald-800'
                        : c === 'average'
                        ? 'bg-amber-100 border-amber-500 text-amber-800'
                        : 'bg-red-100 border-red-500 text-red-800'
                      : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Field Observation Notes</label>
            <input
              type="text"
              value={progressNotes}
              onChange={(e) => setProgressNotes(e.target.value)}
              placeholder="e.g. Healthy tillers, uniform stand"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
          </div>

          <div className="flex justify-end gap-3 pt-3 border-t border-gray-100">
            <Button type="button" variant="outline" onClick={() => setIsProgressModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={logProgressMutation.isPending}>
              {logProgressMutation.isPending ? 'Saving...' : 'Save Observation'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal: Simulate Farmer Voice Feedback */}
      <Modal isOpen={isFeedbackModalOpen} onClose={() => setIsFeedbackModalOpen(false)} title="Simulate Farmer Call Feedback (వాయిస్ కాల్ ఫీడ్‌బ్యాక్)">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const start = new Date(season.sowing_date);
            start.setDate(start.getDate() + (fbCycle - 1) * 7);
            const end = new Date(start);
            end.setDate(end.getDate() + 7);

            logFeedbackMutation.mutate({
              season_id: id,
              cycle_number: Number(fbCycle),
              period_start: start.toISOString().split('T')[0],
              period_end: end.toISOString().split('T')[0],
              rainfall_class: fbRainfall,
              irrigated: fbIrrigated,
              irrigation_count: fbIrrigated ? 1 : 0,
              pump_hours: fbIrrigated ? parseFloat(fbPumpHours) : 0,
              crop_condition: fbCropCondition,
              stage_confirmed: true,
              water_problem: fbWaterProblem,
              crop_problem: fbCropProblem,
              callback_requested: fbCallback,
              source: 'ivr',
              is_simulated: true,
            });
          }}
          className="space-y-4"
        >
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Cycle Number *</label>
              <input
                type="number"
                min="1"
                max="30"
                value={fbCycle}
                onChange={(e) => setFbCycle(Number(e.target.value))}
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Rainfall Experienced *</label>
              <select
                value={fbRainfall}
                onChange={(e: any) => setFbRainfall(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
              >
                <option value="none">None (వర్షం లేదు)</option>
                <option value="light">Light (చిరుజల్లు)</option>
                <option value="moderate">Moderate (మోస్తరు)</option>
                <option value="heavy">Heavy (భారీ వర్షం)</option>
              </select>
            </div>
          </div>

          <div className="p-3 bg-gray-50 rounded-lg border border-gray-200 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-gray-800">Did the farmer irrigate this week? (నీరు పెట్టారా?)</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setFbIrrigated(true)}
                  className={`px-3 py-1 text-xs font-semibold rounded-md ${
                    fbIrrigated ? 'bg-forest-600 text-white' : 'bg-gray-200 text-gray-700'
                  }`}
                >
                  Yes
                </button>
                <button
                  type="button"
                  onClick={() => setFbIrrigated(false)}
                  className={`px-3 py-1 text-xs font-semibold rounded-md ${
                    !fbIrrigated ? 'bg-forest-600 text-white' : 'bg-gray-200 text-gray-700'
                  }`}
                >
                  No
                </button>
              </div>
            </div>

            {fbIrrigated && (
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Hours Pump Ran (మోటార్ నడిపిన గంటలు)</label>
                <input
                  type="number"
                  step="0.5"
                  min="0.5"
                  value={fbPumpHours}
                  onChange={(e) => setFbPumpHours(e.target.value)}
                  required
                  className="w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm"
                />
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Water Problem (నీటి సమస్య)</label>
              <select
                value={fbWaterProblem}
                onChange={(e: any) => setFbWaterProblem(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
              >
                <option value="none">None (సమస్య లేదు)</option>
                <option value="shortage">Water Shortage (కొరత)</option>
                <option value="pump_power">Pump / Power Issue (విద్యుత్/మోటార్)</option>
                <option value="source_unavailable">Source Unavailable (మూలం లభ్యం లేదు)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Crop Problem (పంట సమస్య)</label>
              <select
                value={fbCropProblem}
                onChange={(e: any) => setFbCropProblem(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
              >
                <option value="none">None (ఆరోగ్యంగా ఉంది)</option>
                <option value="pest_disease">Pest / Disease (తెగులు)</option>
                <option value="yellowing_drying">Yellowing / Drying (పసుపు రంగు)</option>
                <option value="other">Other (ఇతర)</option>
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="callbackReq"
              checked={fbCallback}
              onChange={(e) => setFbCallback(e.target.checked)}
              className="w-4 h-4 text-forest-600 rounded"
            />
            <label htmlFor="callbackReq" className="text-xs font-medium text-gray-700">
              Farmer requested volunteer callback (ఫీల్డ్ వాలంటీర్ ఫోన్ కోరారు)
            </label>
          </div>

          <div className="flex justify-end gap-3 pt-3 border-t border-gray-100">
            <Button type="button" variant="outline" onClick={() => setIsFeedbackModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={logFeedbackMutation.isPending}>
              {logFeedbackMutation.isPending ? 'Simulating...' : 'Submit Cycle Feedback'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal: Complete Season */}
      <Modal isOpen={isCompleteModalOpen} onClose={() => setIsCompleteModalOpen(false)} title="Complete Crop Season (పంట కోత / ముగింపు)">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            completeSeasonMutation.mutate({
              actual_harvest_date: actualHarvestDate,
              yield_value: parseFloat(yieldValue),
              yield_unit: yieldUnit,
              harvest_notes: harvestNotes || null,
            });
          }}
          className="space-y-4"
        >
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Actual Harvest Date (కోత పూర్తయిన తేదీ) *</label>
            <input
              type="date"
              value={actualHarvestDate}
              onChange={(e) => setActualHarvestDate(e.target.value)}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Harvested Yield (దిగుబడి) *</label>
              <input
                type="number"
                step="0.1"
                min="0.1"
                value={yieldValue}
                onChange={(e) => setYieldValue(e.target.value)}
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Yield Unit *</label>
              <select
                value={yieldUnit}
                onChange={(e: any) => setYieldUnit(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
              >
                <option value="quintal">Quintals (క్వింటాళ్లు)</option>
                <option value="kg">Kilograms (కిలోలు)</option>
                <option value="tonne">Tonnes (టన్నులు)</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Harvest Summary Notes</label>
            <input
              type="text"
              value={harvestNotes}
              onChange={(e) => setHarvestNotes(e.target.value)}
              placeholder="e.g. Excellent grain quality, moderate water conservation achieved"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
          </div>

          <div className="flex justify-end gap-3 pt-3 border-t border-gray-100">
            <Button type="button" variant="outline" onClick={() => setIsCompleteModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={completeSeasonMutation.isPending}>
              {completeSeasonMutation.isPending ? 'Finalizing...' : 'Finalize & Complete Season'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
