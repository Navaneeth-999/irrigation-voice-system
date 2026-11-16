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
  ClipboardList,
  History,
  GitCompare,
  Edit3,
  CheckCircle2,
  FileText,
  CloudRain,
  Sprout,
  Coins,
  ArrowRight,
  TrendingUp,
  Award,
  PhoneCall,
  MessageSquare,
  Download,
  Eye,
  Check,
  ExternalLink,
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

  const [activeTab, setActiveTab] = useState<'plots' | 'contacts' | 'consents' | 'history' | 'surveys' | 'certificates' | 'communications'>('plots');
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

  // Field Survey State
  const [isAddSurveyOpen, setIsAddSurveyOpen] = useState(false);
  const [isCorrectSurveyOpen, setIsCorrectSurveyOpen] = useState(false);
  const [selectedSurveyForCorrection, setSelectedSurveyForCorrection] = useState<any | null>(null);
  const [isAuditModalOpen, setIsAuditModalOpen] = useState(false);
  const [selectedSurveyForAudit, setSelectedSurveyForAudit] = useState<any | null>(null);
  const [isCompareModalOpen, setIsCompareModalOpen] = useState(false);
  const [compareSurvey1Id, setCompareSurvey1Id] = useState('');
  const [compareSurvey2Id, setCompareSurvey2Id] = useState('');

  // Survey Form fields
  const [surveyPlotId, setSurveyPlotId] = useState('');
  const [surveySeasonId, setSurveySeasonId] = useState('');
  const [surveyDate, setSurveyDate] = useState(new Date().toISOString().split('T')[0]);
  const [surveyPeriod, setSurveyPeriod] = useState<'monthly' | 'bi_weekly' | 'event_based'>('monthly');
  const [pumpDischargeLps, setPumpDischargeLps] = useState('8.0');
  const [pumpHoursPerEvent, setPumpHoursPerEvent] = useState('4.0');
  const [irrigationDepthMm, setIrrigationDepthMm] = useState('');
  const [rainfallMm, setRainfallMm] = useState('0.0');
  const [rainfallSource, setRainfallSource] = useState('rain_gauge_measured');
  const [waterAvailabilityStatus, setWaterAvailabilityStatus] = useState<'adequate' | 'moderate_shortage' | 'severe_scarcity'>('adequate');
  const [cropCondition, setCropCondition] = useState<'good' | 'average' | 'poor'>('good');
  const [yieldQuantity, setYieldQuantity] = useState('');
  const [yieldUnit, setYieldUnit] = useState('kg');
  const [salePriceInr, setSalePriceInr] = useState('');
  const [cultivationExpensesInr, setCultivationExpensesInr] = useState('');
  const [farmerRemarks, setFarmerRemarks] = useState('');
  const [surveyorName, setSurveyorName] = useState(user?.name || '');
  const [dataOrigin, setDataOrigin] = useState<'real' | 'demo'>('real');
  const [correctionReason, setCorrectionReason] = useState('');
  const [surveyError, setSurveyError] = useState<string | null>(null);

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

  // Fetch surveys for farmer
  const { data: surveysData, isLoading: isLoadingSurveys } = useQuery<any>({
    queryKey: ['surveys', id],
    queryFn: () => apiRequest<any>(`/surveys?farmerId=${id}&limit=50`),
    enabled: activeTab === 'surveys',
  });
  const surveys: any[] = (Array.isArray(surveysData) ? surveysData : surveysData?.data) || [];

  // Fetch seasons for farmer (for linking surveys)
  const { data: seasonsData } = useQuery<any>({
    queryKey: ['farmer-seasons', id],
    queryFn: () => apiRequest<any>(`/seasons?farmer_id=${id}`),
  });
  const farmerSeasons: any[] = (Array.isArray(seasonsData) ? seasonsData : seasonsData?.data) || [];

  // Fetch audit logs for selected survey
  const { data: auditLogsData, isLoading: isLoadingAuditLogs } = useQuery<any>({
    queryKey: ['survey-audit-logs', selectedSurveyForAudit?.id],
    queryFn: () => apiRequest<any>(`/surveys/${selectedSurveyForAudit?.id}/audit-logs`),
    enabled: Boolean(isAuditModalOpen && selectedSurveyForAudit?.id),
  });
  const auditLogs: any[] = (Array.isArray(auditLogsData) ? auditLogsData : auditLogsData?.data) || [];

  // Fetch comparison between two surveys
  const { data: compareResult, isLoading: isLoadingCompare } = useQuery<any>({
    queryKey: ['survey-compare', compareSurvey1Id, compareSurvey2Id],
    queryFn: () => apiRequest<any>(`/surveys/compare?id1=${compareSurvey1Id}&id2=${compareSurvey2Id}`),
    enabled: Boolean(isCompareModalOpen && compareSurvey1Id && compareSurvey2Id && compareSurvey1Id !== compareSurvey2Id),
  });

  // Fetch certificates for farmer
  const { data: certsData, isLoading: isLoadingCerts } = useQuery<any>({
    queryKey: ['farmer-certificates', id],
    queryFn: () => apiRequest<any>(`/certificates?farmerId=${id}&limit=50`),
    enabled: activeTab === 'certificates',
  });
  const certificates: any[] = (Array.isArray(certsData) ? certsData : certsData?.data) || [];

  // Fetch communications for farmer
  const { data: commsData, isLoading: isLoadingComms, refetch: refetchComms } = useQuery<any>({
    queryKey: ['farmer-communications', id],
    queryFn: () => apiRequest<any>(`/telephony/farmers/${id}/history?limit=50`),
    enabled: activeTab === 'communications',
  });
  const communications: any[] = (Array.isArray(commsData) ? commsData : commsData?.data) || [];

  // Call Details Modal
  const [selectedCallAttemptId, setSelectedCallAttemptId] = useState<string | null>(null);
  const { data: callDetailsData, isLoading: isLoadingCallDetails } = useQuery<any>({
    queryKey: ['call-attempt-details', selectedCallAttemptId],
    queryFn: async () => {
      if (!selectedCallAttemptId) return null;
      return await apiRequest<any>(`/telephony/attempts/${selectedCallAttemptId}`);
    },
    enabled: !!selectedCallAttemptId,
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

  // Create Survey Mutation
  const createSurveyMutation = useMutation({
    mutationFn: (newSurvey: any) =>
      apiRequest('/surveys', {
        method: 'POST',
        body: JSON.stringify(newSurvey),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['surveys', id] });
      queryClient.invalidateQueries({ queryKey: ['season-analytics'] });
      setIsAddSurveyOpen(false);
      resetSurveyForm();
    },
    onError: (err: any) => {
      setSurveyError(err.message || 'Failed to create field survey.');
    },
  });

  // Correct Survey Mutation
  const correctSurveyMutation = useMutation({
    mutationFn: ({ surveyId, payload }: { surveyId: string; payload: any }) =>
      apiRequest(`/surveys/${surveyId}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['surveys', id] });
      queryClient.invalidateQueries({ queryKey: ['season-analytics'] });
      setIsCorrectSurveyOpen(false);
      setSelectedSurveyForCorrection(null);
      resetSurveyForm();
    },
    onError: (err: any) => {
      setSurveyError(err.message || 'Failed to correct survey.');
    },
  });

  const resetSurveyForm = () => {
    setSurveyPlotId('');
    setSurveySeasonId('');
    setSurveyDate(new Date().toISOString().split('T')[0]);
    setSurveyPeriod('monthly');
    setPumpDischargeLps('8.0');
    setPumpHoursPerEvent('4.0');
    setIrrigationDepthMm('');
    setRainfallMm('0.0');
    setRainfallSource('rain_gauge_measured');
    setWaterAvailabilityStatus('adequate');
    setCropCondition('good');
    setYieldQuantity('');
    setYieldUnit('kg');
    setSalePriceInr('');
    setCultivationExpensesInr('');
    setFarmerRemarks('');
    setSurveyorName(user?.name || '');
    setDataOrigin('real');
    setCorrectionReason('');
    setSurveyError(null);
  };

  const openCorrectModal = (srv: any) => {
    setSelectedSurveyForCorrection(srv);
    setSurveyPlotId(srv.plotId || '');
    setSurveySeasonId(srv.seasonId || '');
    setSurveyDate(srv.surveyDate?.split('T')[0] || new Date().toISOString().split('T')[0]);
    setSurveyPeriod(srv.surveyPeriod || 'monthly');
    setPumpDischargeLps(srv.pumpDischargeLps != null ? String(srv.pumpDischargeLps) : '');
    setPumpHoursPerEvent(srv.pumpHoursPerEvent != null ? String(srv.pumpHoursPerEvent) : '');
    setIrrigationDepthMm(srv.irrigationDepthMm != null ? String(srv.irrigationDepthMm) : '');
    setRainfallMm(srv.rainfallMm != null ? String(srv.rainfallMm) : '0.0');
    setRainfallSource(srv.rainfallSource || 'rain_gauge_measured');
    setWaterAvailabilityStatus(srv.waterAvailabilityStatus || 'adequate');
    setCropCondition(srv.cropCondition || 'good');
    setYieldQuantity(srv.yieldQuantity != null ? String(srv.yieldQuantity) : '');
    setYieldUnit(srv.yieldUnit || 'kg');
    setSalePriceInr(srv.salePriceInr != null ? String(srv.salePriceInr) : '');
    setCultivationExpensesInr(srv.cultivationExpensesInr != null ? String(srv.cultivationExpensesInr) : '');
    setFarmerRemarks(srv.farmerRemarks || '');
    setSurveyorName(srv.surveyorName || user?.name || '');
    setDataOrigin(srv.dataOrigin || 'real');
    setCorrectionReason('');
    setSurveyError(null);
    setIsCorrectSurveyOpen(true);
  };

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

  const handleCreateSurveySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSurveyError(null);

    const payload: any = {
      farmerId: id,
      plotId: surveyPlotId || undefined,
      seasonId: surveySeasonId || undefined,
      surveyDate,
      surveyPeriod,
      pumpDischargeLps: pumpDischargeLps ? parseFloat(pumpDischargeLps) : undefined,
      pumpHoursPerEvent: pumpHoursPerEvent ? parseFloat(pumpHoursPerEvent) : undefined,
      irrigationDepthMm: irrigationDepthMm ? parseFloat(irrigationDepthMm) : undefined,
      rainfallMm: rainfallMm ? parseFloat(rainfallMm) : 0,
      rainfallSource,
      waterAvailabilityStatus,
      cropCondition,
      yieldQuantity: yieldQuantity ? parseFloat(yieldQuantity) : undefined,
      yieldUnit: yieldQuantity ? yieldUnit : undefined,
      salePriceInr: salePriceInr ? parseFloat(salePriceInr) : undefined,
      cultivationExpensesInr: cultivationExpensesInr ? parseFloat(cultivationExpensesInr) : undefined,
      farmerRemarks: farmerRemarks || undefined,
      surveyorName: surveyorName || undefined,
      dataOrigin,
    };

    createSurveyMutation.mutate(payload);
  };

  const handleCorrectSurveySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSurveyError(null);

    if (!correctionReason.trim()) {
      setSurveyError('A clear correction reason is required for versioned audit compliance.');
      return;
    }

    const payload: any = {
      surveyDate,
      surveyPeriod,
      pumpDischargeLps: pumpDischargeLps ? parseFloat(pumpDischargeLps) : undefined,
      pumpHoursPerEvent: pumpHoursPerEvent ? parseFloat(pumpHoursPerEvent) : undefined,
      irrigationDepthMm: irrigationDepthMm ? parseFloat(irrigationDepthMm) : undefined,
      rainfallMm: rainfallMm ? parseFloat(rainfallMm) : 0,
      rainfallSource,
      waterAvailabilityStatus,
      cropCondition,
      yieldQuantity: yieldQuantity ? parseFloat(yieldQuantity) : undefined,
      yieldUnit: yieldQuantity ? yieldUnit : undefined,
      salePriceInr: salePriceInr ? parseFloat(salePriceInr) : undefined,
      cultivationExpensesInr: cultivationExpensesInr ? parseFloat(cultivationExpensesInr) : undefined,
      farmerRemarks: farmerRemarks || undefined,
      surveyorName: surveyorName || undefined,
      dataOrigin,
      correctionReason,
    };

    correctSurveyMutation.mutate({
      surveyId: selectedSurveyForCorrection.id,
      payload,
    });
  };

  // Live calculation of applied water preview
  const numLps = parseFloat(pumpDischargeLps || '0');
  const numHours = parseFloat(pumpHoursPerEvent || '0');
  const calculatedLitres = numLps > 0 && numHours > 0 ? numLps * numHours * 3600 : null;
  const calculatedM3 = calculatedLitres ? (calculatedLitres / 1000).toFixed(1) : null;

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
              {farmer.data_origin === 'demo' ? (
                <Badge variant="demo">DEMO FARMER</Badge>
              ) : (
                <Badge variant="info">VERIFIED FIELD DATA</Badge>
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
              {farmer.certificates_count !== undefined && (
                <span className="flex items-center gap-1 font-semibold text-amber-800 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                  <Award className="w-3 h-3 text-amber-600" /> {farmer.certificates_count} Certificates
                </span>
              )}
              {farmer.communications_count !== undefined && (
                <span className="flex items-center gap-1 font-semibold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                  <Phone className="w-3 h-3 text-emerald-600" /> {farmer.communications_count} Communications
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Link to={`/simulator?farmerId=${id}`}>
            <Button variant="outline" size="md" className="border-emerald-300 text-emerald-800 hover:bg-emerald-50">
              <PhoneCall className="w-4 h-4 mr-1.5 text-emerald-600" /> Call Simulator
            </Button>
          </Link>
          {canManage && (
            <>
              <Button variant="outline" size="md" onClick={() => setIsAddPlotOpen(true)}>
                <Plus className="w-4 h-4 mr-1.5" /> Add Plot
              </Button>
              <Button variant="primary" size="md" onClick={() => { resetSurveyForm(); setIsAddSurveyOpen(true); }}>
                <ClipboardList className="w-4 h-4 mr-1.5" /> Record Survey
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Tabs Header */}
      <div className="border-b border-gray-200 flex flex-wrap gap-x-6 gap-y-2 text-sm font-medium">
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
          onClick={() => setActiveTab('surveys')}
          className={`pb-3 border-b-2 flex items-center gap-2 ${
            activeTab === 'surveys'
              ? 'border-forest-700 text-forest-800 font-bold'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <ClipboardList className="w-4 h-4" /> Field Surveys & Visits ({farmer.surveys_count ?? surveys.length})
        </button>
        <button
          onClick={() => setActiveTab('certificates')}
          className={`pb-3 border-b-2 flex items-center gap-2 ${
            activeTab === 'certificates'
              ? 'border-forest-700 text-forest-800 font-bold'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <Award className="w-4 h-4" /> Certificates ({farmer.certificates_count ?? certificates.length})
        </button>
        <button
          onClick={() => setActiveTab('communications')}
          className={`pb-3 border-b-2 flex items-center gap-2 ${
            activeTab === 'communications'
              ? 'border-forest-700 text-forest-800 font-bold'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <History className="w-4 h-4" /> Telephony & SMS ({farmer.communications_count ?? communications.length})
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
          <Shield className="w-4 h-4" /> Consents ({farmer.consents?.length || 0})
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={`pb-3 border-b-2 flex items-center gap-2 ${
            activeTab === 'history'
              ? 'border-forest-700 text-forest-800 font-bold'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <Calendar className="w-4 h-4" /> Audit Log
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

      {/* Tab: Field Surveys & Visits */}
      {activeTab === 'surveys' && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-gray-50 p-4 rounded-xl border border-gray-200">
            <div>
              <h3 className="text-sm font-bold text-gray-900">Periodic Field Visit & Ground Water Measurements</h3>
              <p className="text-xs text-gray-500 mt-0.5">
                Tracks quantitative pump hours, rainfall, and crop stage observations verified directly on-field.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {surveys.length >= 2 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setCompareSurvey1Id(surveys[1]?.id || '');
                    setCompareSurvey2Id(surveys[0]?.id || '');
                    setIsCompareModalOpen(true);
                  }}
                >
                  <GitCompare className="w-3.5 h-3.5 mr-1" /> Compare Visits
                </Button>
              )}
              {canManage && (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => {
                    resetSurveyForm();
                    setIsAddSurveyOpen(true);
                  }}
                >
                  <Plus className="w-3.5 h-3.5 mr-1" /> New Field Survey
                </Button>
              )}
            </div>
          </div>

          {isLoadingSurveys ? (
            <div className="py-12 text-center text-sm text-gray-500">Loading field surveys...</div>
          ) : surveys.length === 0 ? (
            <Card>
              <div className="py-12 text-center">
                <ClipboardList className="w-12 h-12 text-gray-300 mx-auto mb-2" />
                <p className="text-sm font-semibold text-gray-800">No field surveys recorded for this farmer</p>
                <p className="text-xs text-gray-400 mt-1 max-w-sm mx-auto">
                  Record periodic field visits with verified pump discharge, hours, and rainfall to link ground measurements to water analytics.
                </p>
                {canManage && (
                  <div className="mt-4">
                    <Button variant="primary" size="sm" onClick={() => { resetSurveyForm(); setIsAddSurveyOpen(true); }}>
                      <Plus className="w-3.5 h-3.5 mr-1" /> Record First Field Survey
                    </Button>
                  </div>
                )}
              </div>
            </Card>
          ) : (
            <div className="space-y-4">
              {surveys.map((srv: any) => (
                <div key={srv.id} className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm hover:border-gray-300 transition-all">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-gray-100">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-forest-50 border border-forest-100 flex items-center justify-center text-forest-700">
                        <ClipboardList className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="text-base font-bold text-gray-900">
                            Visit: {new Date(srv.surveyDate).toLocaleDateString(undefined, { dateStyle: 'medium' })}
                          </h4>
                          <span className="text-[11px] font-semibold text-forest-700 bg-forest-50 px-2 py-0.5 rounded border border-forest-200/60 uppercase">
                            v{srv.version || 1} {srv.isCorrection ? '(Corrected)' : ''}
                          </span>
                          {srv.dataOrigin === 'demo' ? (
                            <Badge variant="demo">DEMO DATA</Badge>
                          ) : (
                            <Badge variant="success">REAL FIELD VISIT</Badge>
                          )}
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5">
                          Period: <span className="capitalize font-medium text-gray-700">{srv.surveyPeriod}</span> • Surveyor: <span className="font-medium text-gray-700">{srv.surveyorName || 'CSP Team'}</span> • Plot: <span className="font-medium text-gray-700">{srv.plotName || 'All Plots'}</span>
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSelectedSurveyForAudit(srv);
                          setIsAuditModalOpen(true);
                        }}
                        title="View immutable audit trail"
                      >
                        <History className="w-3.5 h-3.5 mr-1" /> Audit Trail
                      </Button>
                      {canManage && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openCorrectModal(srv)}
                          title="Submit versioned correction with reason"
                        >
                          <Edit3 className="w-3.5 h-3.5 mr-1 text-forest-700" /> Correct
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Quantitative Metrics Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 py-4 border-b border-gray-100 text-xs">
                    <div className="p-3 bg-water-50/50 rounded-xl border border-water-100">
                      <span className="text-water-700 font-semibold block uppercase text-[10px]">Applied Irrigation</span>
                      <p className="text-lg font-bold text-water-900 mt-0.5">
                        {srv.appliedWaterLitres ? `${srv.appliedWaterLitres.toLocaleString()} L` : 'N/A'}
                      </p>
                      <span className="text-[11px] text-water-600 block mt-0.5">
                        {srv.appliedWaterVolumeM3 != null ? `${srv.appliedWaterVolumeM3} m³` : ''}
                      </span>
                    </div>

                    <div className="p-3 bg-gray-50 rounded-xl border border-gray-200">
                      <span className="text-gray-500 font-semibold block uppercase text-[10px]">Pump Operation</span>
                      <p className="text-lg font-bold text-gray-900 mt-0.5">
                        {srv.pumpHoursPerEvent != null ? `${srv.pumpHoursPerEvent} hrs` : 'N/A'}
                      </p>
                      <span className="text-[11px] text-gray-500 block mt-0.5">
                        Discharge: {srv.pumpDischargeLps != null ? `${srv.pumpDischargeLps} LPS` : 'N/A'}
                      </span>
                    </div>

                    <div className="p-3 bg-sky-50 rounded-xl border border-sky-100">
                      <span className="text-sky-700 font-semibold block uppercase text-[10px]">Rainfall</span>
                      <p className="text-lg font-bold text-sky-900 mt-0.5">
                        {srv.rainfallMm != null ? `${srv.rainfallMm} mm` : '0 mm'}
                      </p>
                      <span className="text-[11px] text-sky-600 block mt-0.5 capitalize">
                        {srv.rainfallSource ? srv.rainfallSource.replace('_', ' ') : 'Self-Reported'}
                      </span>
                    </div>

                    <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-100">
                      <span className="text-emerald-700 font-semibold block uppercase text-[10px]">Field Condition</span>
                      <p className="text-base font-bold text-emerald-900 mt-0.5 capitalize">
                        {srv.cropCondition || 'Good'}
                      </p>
                      <span className="text-[11px] text-emerald-700 block mt-0.5 capitalize">
                        Water: {srv.waterAvailabilityStatus ? srv.waterAvailabilityStatus.replace('_', ' ') : 'Adequate'}
                      </span>
                    </div>
                  </div>

                  {/* Remarks and Corrections Footer */}
                  <div className="pt-3 text-xs flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                    <p className="text-gray-600 italic">
                      {srv.farmerRemarks ? `“${srv.farmerRemarks}”` : 'No surveyor remarks logged.'}
                    </p>
                    {srv.isCorrection && srv.correctionReason && (
                      <span className="text-[11px] text-amber-800 bg-amber-50 px-2.5 py-1 rounded-md border border-amber-200">
                        <strong>Correction:</strong> {srv.correctionReason}
                      </span>
                    )}
                  </div>
                </div>
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

      {/* Tab 5: Certificates */}
      {activeTab === 'certificates' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-gray-800 flex items-center gap-2">
                <Award className="w-5 h-5 text-amber-600" />
                Issued Water Use Efficiency (WUR) Certificates
              </h3>
              <p className="text-xs text-gray-500 mt-0.5">
                Accredited seasonal certificates issued based on verified field surveys and water demand analytics.
              </p>
            </div>
            <Link to={`/certificates?farmerId=${id}`}>
              <Button variant="outline" size="sm" className="text-xs">
                Open in Certificates Module <ArrowRight className="w-3.5 h-3.5 ml-1" />
              </Button>
            </Link>
          </div>

          {isLoadingCerts ? (
            <Card>
              <div className="py-12 text-center text-xs text-gray-500">Loading certificate records...</div>
            </Card>
          ) : certificates.length === 0 ? (
            <Card>
              <div className="py-12 text-center max-w-lg mx-auto">
                <div className="w-12 h-12 bg-amber-50 rounded-2xl flex items-center justify-center mx-auto mb-3 text-amber-600 border border-amber-200">
                  <Award className="w-6 h-6" />
                </div>
                <h4 className="text-sm font-bold text-gray-800">No Certificates Issued for this Farmer</h4>
                <p className="text-xs text-gray-500 mt-2 leading-relaxed">
                  Water Use Ratio (WUR) accreditation certificates are issued at the conclusion of an agricultural season once verified field surveys and water demand analytics meet accreditation standards.
                </p>
                <div className="mt-5 flex justify-center gap-3">
                  <Link to={`/certificates?farmerId=${id}`}>
                    <Button variant="primary" size="sm">
                      Check Eligibility in Certificates <ArrowRight className="w-3.5 h-3.5 ml-1" />
                    </Button>
                  </Link>
                </div>
              </div>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {certificates.map((cert: any) => (
                <div
                  key={cert.id}
                  className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm space-y-4 hover:border-forest-300 transition"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-bold text-forest-900">
                          {cert.certificateCode || cert.certificate_code}
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 text-[10px] font-bold uppercase">
                          v{cert.version || 1}
                        </span>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                          (cert.status === 'revoked' || cert.isRevoked)
                            ? 'bg-rose-100 text-rose-800 border border-rose-300'
                            : cert.status === 'sealed'
                            ? 'bg-blue-100 text-blue-800 border border-blue-300'
                            : 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                        }`}>
                          {cert.status || (cert.isRevoked ? 'revoked' : 'active')}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 mt-1">
                        Season: <span className="font-semibold text-gray-800">{cert.cropName || cert.crop_name}</span> ({cert.seasonCode || cert.season_code})
                      </p>
                    </div>

                    <div className="text-right">
                      <span className="text-[10px] text-gray-400 block uppercase font-semibold">Issued Date</span>
                      <span className="text-xs font-medium text-gray-700">
                        {new Date(cert.createdAt || cert.created_at).toLocaleDateString()}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 p-3 bg-gray-50 rounded-xl border border-gray-100 text-xs">
                    <div>
                      <span className="text-gray-400 uppercase text-[10px] font-semibold block">Water Use Ratio</span>
                      <p className="font-bold text-gray-900 text-sm mt-0.5">
                        {cert.waterUseRatio !== null && cert.waterUseRatio !== undefined
                          ? Number(cert.waterUseRatio).toFixed(2)
                          : 'N/A (Zero Demand)'}
                      </p>
                      <span className="text-[10px] text-gray-500 capitalize">
                        {cert.waterUseRatioBand ? cert.waterUseRatioBand.replace(/_/g, ' ') : 'Audited'}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-400 uppercase text-[10px] font-semibold block">Data Confidence</span>
                      <p className="font-bold text-emerald-700 text-sm mt-0.5">
                        {cert.confidenceScore ? `${Math.round(cert.confidenceScore)}%` : '85%'}
                      </p>
                      <span className="text-[10px] text-gray-500 uppercase font-semibold">
                        {cert.confidenceBand || 'High'} Confidence
                      </span>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <span className="text-gray-400 uppercase text-[10px] font-semibold block">
                      SHA-256 Digital Fingerprint
                    </span>
                    <p className="font-mono text-[11px] text-gray-600 bg-gray-50 px-2.5 py-1 rounded border border-gray-200 truncate" title={cert.sha256Hash || cert.sha256_hash}>
                      {cert.sha256Hash || cert.sha256_hash || 'SHA-256 Verified'}
                    </p>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                    <Link
                      to={`/certificates?farmerId=${id}`}
                      className="text-xs text-forest-700 hover:underline font-semibold flex items-center gap-1"
                    >
                      <Eye className="w-3.5 h-3.5" /> View Details
                    </Link>

                    <a
                      href={`/api/v1/certificates/${cert.id}/pdf`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-1.5 bg-forest-600 hover:bg-forest-700 text-white rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 shadow-sm transition"
                    >
                      <Download className="w-3.5 h-3.5" /> Download PDF
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab 6: Communications */}
      {activeTab === 'communications' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-gray-800 flex items-center gap-2">
                <History className="w-5 h-5 text-forest-700" />
                Telephony Calls & SMS Advisory Log
              </h3>
              <p className="text-xs text-gray-500 mt-0.5">
                Full chronological communication history including outbound Telugu IVR calls, fallback SMS, and phone verifications.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => refetchComms()}
                className="text-xs text-forest-700 hover:underline flex items-center gap-1 font-semibold mr-2"
              >
                Refresh
              </button>
              <Link to={`/simulator?farmerId=${id}`}>
                <Button variant="primary" size="sm" className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white">
                  <PhoneCall className="w-3.5 h-3.5 mr-1" /> Open in Simulator
                </Button>
              </Link>
            </div>
          </div>

          {isLoadingComms ? (
            <Card>
              <div className="py-12 text-center text-xs text-gray-500">Loading communication records...</div>
            </Card>
          ) : communications.length === 0 ? (
            <Card>
              <div className="py-12 text-center max-w-lg mx-auto">
                <div className="w-12 h-12 bg-emerald-50 rounded-2xl flex items-center justify-center mx-auto mb-3 text-emerald-600 border border-emerald-200">
                  <Phone className="w-6 h-6" />
                </div>
                <h4 className="text-sm font-bold text-gray-800">No Communications Dispatched</h4>
                <p className="text-xs text-gray-500 mt-2 leading-relaxed">
                  No outbound voice calls or SMS advisory messages have been dispatched to this farmer yet. You can evaluate dialogue in the Call Simulator or schedule fortnightly irrigation advisories.
                </p>
                <div className="mt-5 flex justify-center gap-3">
                  <Link to={`/simulator?farmerId=${id}`}>
                    <Button variant="primary" size="sm">
                      <PhoneCall className="w-3.5 h-3.5 mr-1" /> Dispatch Simulated Call
                    </Button>
                  </Link>
                </div>
              </div>
            </Card>
          ) : (
            <Card>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 uppercase font-semibold">
                    <tr>
                      <th className="py-2.5 px-3">Timestamp</th>
                      <th className="py-2.5 px-3">Type & Channel</th>
                      <th className="py-2.5 px-3">Provider</th>
                      <th className="py-2.5 px-3">Status</th>
                      <th className="py-2.5 px-3">Duration</th>
                      <th className="py-2.5 px-3">Context / Fallback SMS</th>
                      <th className="py-2.5 px-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {communications.map((c: any) => (
                      <tr key={c.id} className="hover:bg-gray-50/80 transition">
                        <td className="py-2.5 px-3 text-gray-500 whitespace-nowrap">
                          {new Date(c.timestamp).toLocaleString()}
                        </td>
                        <td className="py-2.5 px-3">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${
                            c.channel === 'voice'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-blue-100 text-blue-800'
                          }`}>
                            {c.channel === 'voice' ? <Phone className="w-3 h-3" /> : <MessageSquare className="w-3 h-3" />}
                            {c.communication_type?.replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 uppercase text-gray-600 font-semibold text-[10px]">
                          {c.provider}
                        </td>
                        <td className="py-2.5 px-3">
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${
                            c.status === 'completed' || c.status === 'delivered'
                              ? 'bg-emerald-100 text-emerald-800'
                              : c.status === 'failed' || c.status === 'no_answer'
                              ? 'bg-rose-100 text-rose-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}>
                            {c.status}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 font-mono text-gray-600">
                          {c.duration_seconds ? `${c.duration_seconds}s` : '-'}
                        </td>
                        <td className="py-2.5 px-3 text-gray-600 max-w-xs">
                          {c.season_code && (
                            <span className="font-semibold block text-[11px] text-gray-800">
                              {c.crop_name} ({c.season_code})
                            </span>
                          )}
                          {c.fallback_sms_sent && (
                            <span className="inline-flex items-center gap-1 text-amber-800 text-[10px] font-medium bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200 mt-0.5">
                              <MessageSquare className="w-3 h-3 text-amber-600" /> Fallback SMS Sent
                            </span>
                          )}
                          {c.fallback_sms_content && !c.fallback_sms_sent && (
                            <span className="italic text-gray-500 truncate block text-[10px]">
                              {c.fallback_sms_content}
                            </span>
                          )}
                          {c.error_message && (
                            <span className="text-rose-600 text-[10px] block truncate" title={c.error_message}>
                              {c.error_message}
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          {c.channel === 'voice' ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setSelectedCallAttemptId(c.id)}
                              className="text-[11px] py-1 px-2.5"
                            >
                              <Eye className="w-3 h-3 mr-1" /> Details
                            </Button>
                          ) : (
                            <span className="text-[11px] text-gray-400 font-mono">SMS</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Call Details Modal */}
      <Modal
        isOpen={Boolean(selectedCallAttemptId)}
        onClose={() => setSelectedCallAttemptId(null)}
        title="📞 Call Attempt Details & DTMF Responses"
        maxWidth="2xl"
      >
        {isLoadingCallDetails ? (
          <div className="py-8 text-center text-gray-500 text-xs">Loading call details...</div>
        ) : !callDetailsData?.data ? (
          <div className="py-8 text-center text-gray-500 text-xs">Call record not found.</div>
        ) : (
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-gray-50 p-3 rounded-xl border border-gray-200">
              <div>
                <span className="text-gray-400 uppercase text-[10px] font-semibold">Status</span>
                <p className="font-bold text-gray-800 capitalize mt-0.5">{callDetailsData.data.status}</p>
              </div>
              <div>
                <span className="text-gray-400 uppercase text-[10px] font-semibold">Provider</span>
                <p className="font-bold text-gray-800 uppercase mt-0.5">{callDetailsData.data.provider}</p>
              </div>
              <div>
                <span className="text-gray-400 uppercase text-[10px] font-semibold">Duration</span>
                <p className="font-bold text-gray-800 mt-0.5">
                  {callDetailsData.data.duration_seconds ? `${callDetailsData.data.duration_seconds}s` : '-'}
                </p>
              </div>
              <div>
                <span className="text-gray-400 uppercase text-[10px] font-semibold">Started</span>
                <p className="font-medium text-gray-700 mt-0.5">
                  {new Date(callDetailsData.data.started_at).toLocaleTimeString()}
                </p>
              </div>
            </div>

            {callDetailsData.data.fallback_sms_content && (
              <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 space-y-1">
                <span className="font-bold text-amber-900 flex items-center gap-1.5 text-xs">
                  <MessageSquare className="w-3.5 h-3.5 text-amber-700" />
                  Fallback Telugu SMS Advisory Sent
                </span>
                <p className="text-gray-800 italic font-serif text-[11px] bg-white p-2.5 rounded border border-amber-100">
                  {callDetailsData.data.fallback_sms_content}
                </p>
              </div>
            )}

            {callDetailsData.data.error_message && (
              <div className="p-3 bg-rose-50 rounded-xl border border-rose-200 text-rose-800 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 mt-0.5" />
                <div>
                  <strong>Call Failure Error:</strong> {callDetailsData.data.error_message}
                </div>
              </div>
            )}

            <div>
              <h4 className="font-bold text-gray-800 text-xs uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                IVR Survey Responses ({callDetailsData.data.responses?.length || 0})
              </h4>
              {!callDetailsData.data.responses || callDetailsData.data.responses.length === 0 ? (
                <div className="p-4 bg-gray-50 rounded-xl text-center text-gray-400">
                  No survey responses recorded during this call.
                </div>
              ) : (
                <div className="border border-gray-200 rounded-xl overflow-hidden">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-gray-100 text-gray-600 font-semibold border-b border-gray-200">
                      <tr>
                        <th className="py-2 px-3">Step</th>
                        <th className="py-2 px-3">Question</th>
                        <th className="py-2 px-3">Key Pressed</th>
                        <th className="py-2 px-3">Interpreted Answer</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {callDetailsData.data.responses.map((resp: any) => (
                        <tr key={resp.id} className="hover:bg-gray-50">
                          <td className="py-2 px-3 font-semibold text-gray-700">Step {resp.step_number}</td>
                          <td className="py-2 px-3 max-w-xs">
                            <p className="font-medium text-gray-800">{resp.question_text_te}</p>
                            <p className="text-gray-400 italic text-[10px]">{resp.question_text_en}</p>
                          </td>
                          <td className="py-2 px-3 font-mono font-bold text-amber-700">{resp.response_digits}</td>
                          <td className="py-2 px-3 font-medium text-emerald-800">
                            {resp.interpreted_value ? JSON.stringify(resp.interpreted_value) : '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="flex justify-end pt-2 border-t border-gray-200">
              <Button variant="outline" onClick={() => setSelectedCallAttemptId(null)}>
                Close
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Modal: Add Field Survey */}
      <Modal isOpen={isAddSurveyOpen} onClose={() => setIsAddSurveyOpen(false)} title="Record Ground Field Survey" maxWidth="2xl">
        <form onSubmit={handleCreateSurveySubmit} className="space-y-4">
          {surveyError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-center gap-1.5">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
              <span>{surveyError}</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-700 uppercase mb-1">Survey Date *</label>
              <input
                type="date"
                value={surveyDate}
                onChange={(e) => setSurveyDate(e.target.value)}
                required
                className="w-full px-3 py-2 text-xs bg-white border border-gray-300 rounded-lg"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 uppercase mb-1">Period *</label>
              <select
                value={surveyPeriod}
                onChange={(e) => setSurveyPeriod(e.target.value as any)}
                className="w-full px-3 py-2 text-xs bg-white border border-gray-300 rounded-lg"
              >
                <option value="monthly">Monthly Cycle</option>
                <option value="bi_weekly">Bi-weekly / Fortnightly</option>
                <option value="event_based">Event-based Visit</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 uppercase mb-1">Data Provenance</label>
              <select
                value={dataOrigin}
                onChange={(e) => setDataOrigin(e.target.value as any)}
                className="w-full px-3 py-2 text-xs bg-white border border-gray-300 rounded-lg"
              >
                <option value="real">Real Fieldwork (Genuine)</option>
                <option value="demo">Demo / Training Fixture</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-700 uppercase mb-1">Linked Plot</label>
              <select
                value={surveyPlotId}
                onChange={(e) => setSurveyPlotId(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-white border border-gray-300 rounded-lg"
              >
                <option value="">General (Farmer-level)</option>
                {farmer.plots?.map((p: any) => (
                  <option key={p.id} value={p.id}>
                    {p.label} ({p.area_acres} Acres)
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 uppercase mb-1">Linked Season</label>
              <select
                value={surveySeasonId}
                onChange={(e) => setSurveySeasonId(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-white border border-gray-300 rounded-lg"
              >
                <option value="">None / Off-Season</option>
                {farmerSeasons?.map((s: any) => (
                  <option key={s.id} value={s.id}>
                    {s.crop_name} - {s.season_type} {s.season_year} ({s.season_code})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Quantitative Water Application */}
          <div className="bg-water-50/70 p-4 rounded-xl border border-water-200 space-y-3">
            <h4 className="text-xs font-bold text-water-900 uppercase tracking-wider flex items-center gap-1.5">
              <Droplets className="w-3.5 h-3.5 text-water-700" /> Quantitative Irrigation Water Measurements
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Input
                label="Pump Discharge (LPS)"
                type="number"
                step="0.1"
                value={pumpDischargeLps}
                onChange={(e) => setPumpDischargeLps(e.target.value)}
                placeholder="e.g. 8.5"
              />
              <Input
                label="Pump Hours per Event"
                type="number"
                step="0.5"
                value={pumpHoursPerEvent}
                onChange={(e) => setPumpHoursPerEvent(e.target.value)}
                placeholder="e.g. 4.0"
              />
              <Input
                label="Or Depth (mm)"
                type="number"
                step="1"
                value={irrigationDepthMm}
                onChange={(e) => setIrrigationDepthMm(e.target.value)}
                placeholder="e.g. 50"
              />
            </div>

            {calculatedLitres !== null && (
              <div className="p-2.5 bg-white rounded-lg border border-water-200 text-xs text-water-900 flex justify-between items-center">
                <span>Calculated Applied Water:</span>
                <span className="font-bold text-water-800">
                  {calculatedLitres.toLocaleString()} Litres ({calculatedM3} m³)
                </span>
              </div>
            )}
          </div>

          {/* Rainfall and Agronomics */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <Input
              label="Rainfall (mm)"
              type="number"
              step="0.5"
              value={rainfallMm}
              onChange={(e) => setRainfallMm(e.target.value)}
            />
            <div>
              <label className="block text-xs font-semibold text-gray-700 uppercase mb-1">Rainfall Source</label>
              <select
                value={rainfallSource}
                onChange={(e) => setRainfallSource(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-white border border-gray-300 rounded-lg"
              >
                <option value="rain_gauge_measured">Local Rain Gauge</option>
                <option value="farmer_reported">Farmer Reported</option>
                <option value="external_station">Weather Station</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 uppercase mb-1">Water Status</label>
              <select
                value={waterAvailabilityStatus}
                onChange={(e) => setWaterAvailabilityStatus(e.target.value as any)}
                className="w-full px-3 py-2 text-xs bg-white border border-gray-300 rounded-lg"
              >
                <option value="adequate">Adequate</option>
                <option value="moderate_shortage">Moderate Shortage</option>
                <option value="severe_scarcity">Severe Scarcity</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 uppercase mb-1">Crop Condition</label>
              <select
                value={cropCondition}
                onChange={(e) => setCropCondition(e.target.value as any)}
                className="w-full px-3 py-2 text-xs bg-white border border-gray-300 rounded-lg"
              >
                <option value="good">Good / Vigorous</option>
                <option value="average">Average</option>
                <option value="poor">Stressed / Poor</option>
              </select>
            </div>
          </div>

          {/* Harvest & Economics (Optional) */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 bg-gray-50 p-3 rounded-xl border border-gray-200">
            <Input
              label="Yield (Optional)"
              type="number"
              step="1"
              value={yieldQuantity}
              onChange={(e) => setYieldQuantity(e.target.value)}
              placeholder="e.g. 2500"
            />
            <div>
              <label className="block text-xs font-semibold text-gray-700 uppercase mb-1">Unit</label>
              <select
                value={yieldUnit}
                onChange={(e) => setYieldUnit(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-white border border-gray-300 rounded-lg"
              >
                <option value="kg">Kilograms (kg)</option>
                <option value="quintal">Quintals</option>
              </select>
            </div>
            <Input
              label="Sale Price (₹/unit)"
              type="number"
              value={salePriceInr}
              onChange={(e) => setSalePriceInr(e.target.value)}
              placeholder="e.g. 22"
            />
            <Input
              label="Expenses (₹ Total)"
              type="number"
              value={cultivationExpensesInr}
              onChange={(e) => setCultivationExpensesInr(e.target.value)}
              placeholder="e.g. 18000"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label="Surveyor Name / Code"
              value={surveyorName}
              onChange={(e) => setSurveyorName(e.target.value)}
              placeholder="e.g. Ramesh Reddy (CSP)"
            />
            <Input
              label="Remarks / Farmer Observations"
              value={farmerRemarks}
              onChange={(e) => setFarmerRemarks(e.target.value)}
              placeholder="e.g. Flowering stage, soil moisture adequate"
            />
          </div>

          <div className="flex justify-end space-x-3 pt-3">
            <Button variant="outline" type="button" onClick={() => setIsAddSurveyOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" isLoading={createSurveyMutation.isPending}>
              Save Field Survey
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal: Correct Field Survey (Versioned Correction) */}
      <Modal
        isOpen={isCorrectSurveyOpen}
        onClose={() => setIsCorrectSurveyOpen(false)}
        title={`Submit Versioned Survey Correction (v${(selectedSurveyForCorrection?.version || 1) + 1})`}
        maxWidth="2xl"
      >
        <form onSubmit={handleCorrectSurveySubmit} className="space-y-4">
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
            <strong>Audit Integrity Rule:</strong> Modifying a verified survey creates a new immutable version and records the change in the audit trail. A clear reason is required.
          </div>

          {surveyError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-center gap-1.5">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
              <span>{surveyError}</span>
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-red-800 uppercase mb-1">
              Correction Reason * (Mandatory for Audit Trail)
            </label>
            <input
              type="text"
              value={correctionReason}
              onChange={(e) => setCorrectionReason(e.target.value)}
              placeholder="e.g. Corrected pump hours after cross-checking farmer electricity logbook"
              required
              className="w-full px-3 py-2 text-xs bg-white border border-red-300 rounded-lg focus:ring-2 focus:ring-red-400"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label="Pump Discharge (LPS)"
              type="number"
              step="0.1"
              value={pumpDischargeLps}
              onChange={(e) => setPumpDischargeLps(e.target.value)}
            />
            <Input
              label="Pump Hours per Event"
              type="number"
              step="0.5"
              value={pumpHoursPerEvent}
              onChange={(e) => setPumpHoursPerEvent(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Input
              label="Rainfall (mm)"
              type="number"
              step="0.5"
              value={rainfallMm}
              onChange={(e) => setRainfallMm(e.target.value)}
            />
            <div>
              <label className="block text-xs font-semibold text-gray-700 uppercase mb-1">Water Status</label>
              <select
                value={waterAvailabilityStatus}
                onChange={(e) => setWaterAvailabilityStatus(e.target.value as any)}
                className="w-full px-3 py-2 text-xs bg-white border border-gray-300 rounded-lg"
              >
                <option value="adequate">Adequate</option>
                <option value="moderate_shortage">Moderate Shortage</option>
                <option value="severe_scarcity">Severe Scarcity</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 uppercase mb-1">Crop Condition</label>
              <select
                value={cropCondition}
                onChange={(e) => setCropCondition(e.target.value as any)}
                className="w-full px-3 py-2 text-xs bg-white border border-gray-300 rounded-lg"
              >
                <option value="good">Good / Vigorous</option>
                <option value="average">Average</option>
                <option value="poor">Stressed / Poor</option>
              </select>
            </div>
          </div>

          <Input
            label="Updated Remarks"
            value={farmerRemarks}
            onChange={(e) => setFarmerRemarks(e.target.value)}
          />

          <div className="flex justify-end space-x-3 pt-3">
            <Button variant="outline" type="button" onClick={() => setIsCorrectSurveyOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" isLoading={correctSurveyMutation.isPending}>
              Commit Correction as v{(selectedSurveyForCorrection?.version || 1) + 1}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal: Audit Trail */}
      <Modal
        isOpen={isAuditModalOpen}
        onClose={() => setIsAuditModalOpen(false)}
        title="Field Survey Audit Trail & Version History"
        maxWidth="xl"
      >
        <div className="space-y-4">
          <p className="text-xs text-gray-500">
            Complete cryptographic audit log of creation and versioned corrections for this survey.
          </p>

          {isLoadingAuditLogs ? (
            <div className="py-6 text-center text-xs text-gray-400">Loading audit history...</div>
          ) : auditLogs.length === 0 ? (
            <div className="py-6 text-center text-xs text-gray-400">No audit records found.</div>
          ) : (
            <div className="space-y-3">
              {auditLogs.map((log: any) => (
                <div key={log.id} className="p-3 bg-gray-50 rounded-xl border border-gray-200 text-xs">
                  <div className="flex justify-between items-center pb-2 border-b border-gray-200/60">
                    <span className="font-bold text-gray-900 uppercase tracking-wider">
                      {log.action} • Version {log.version}
                    </span>
                    <span className="text-gray-400 text-[11px]">
                      {new Date(log.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <div className="pt-2 space-y-1">
                    <p className="text-gray-600">
                      <strong>User:</strong> {log.userName || log.userId || 'System'}
                    </p>
                    {log.reason && (
                      <p className="text-amber-800 font-medium">
                        <strong>Reason:</strong> {log.reason}
                      </p>
                    )}
                    {log.changedFields && (
                      <div className="bg-white p-2 rounded border border-gray-200 mt-2 font-mono text-[10px] text-gray-600 overflow-x-auto">
                        <pre>{JSON.stringify(log.changedFields, null, 2)}</pre>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>

      {/* Modal: Compare Surveys */}
      <Modal
        isOpen={isCompareModalOpen}
        onClose={() => setIsCompareModalOpen(false)}
        title="Compare Periodic Field Visits Side-by-Side"
        maxWidth="2xl"
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-700 uppercase mb-1">Baseline Survey (Earlier)</label>
              <select
                value={compareSurvey1Id}
                onChange={(e) => setCompareSurvey1Id(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-white border border-gray-300 rounded-lg"
              >
                {surveys.map((s) => (
                  <option key={s.id} value={s.id}>
                    {new Date(s.surveyDate).toLocaleDateString()} (v{s.version}) - {s.surveyPeriod}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 uppercase mb-1">Comparison Survey (Later)</label>
              <select
                value={compareSurvey2Id}
                onChange={(e) => setCompareSurvey2Id(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-white border border-gray-300 rounded-lg"
              >
                {surveys.map((s) => (
                  <option key={s.id} value={s.id}>
                    {new Date(s.surveyDate).toLocaleDateString()} (v{s.version}) - {s.surveyPeriod}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {isLoadingCompare ? (
            <div className="py-8 text-center text-xs text-gray-500">Calculating deltas...</div>
          ) : compareResult?.data ? (
            <div className="p-4 bg-gray-50 rounded-xl border border-gray-200 space-y-4 text-xs">
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="p-3 bg-white rounded-lg border border-gray-200">
                  <span className="text-gray-500 uppercase text-[10px] font-semibold block">Water Applied Delta</span>
                  <p className="text-base font-bold text-gray-900 mt-1">
                    {compareResult.data.deltas.appliedWaterLitresDelta != null
                      ? `${compareResult.data.deltas.appliedWaterLitresDelta > 0 ? '+' : ''}${compareResult.data.deltas.appliedWaterLitresDelta.toLocaleString()} L`
                      : 'N/A'}
                  </p>
                </div>

                <div className="p-3 bg-white rounded-lg border border-gray-200">
                  <span className="text-gray-500 uppercase text-[10px] font-semibold block">Pump Hours Delta</span>
                  <p className="text-base font-bold text-gray-900 mt-1">
                    {compareResult.data.deltas.pumpHoursDelta != null
                      ? `${compareResult.data.deltas.pumpHoursDelta > 0 ? '+' : ''}${compareResult.data.deltas.pumpHoursDelta} hrs`
                      : 'N/A'}
                  </p>
                </div>

                <div className="p-3 bg-white rounded-lg border border-gray-200">
                  <span className="text-gray-500 uppercase text-[10px] font-semibold block">Rainfall Delta</span>
                  <p className="text-base font-bold text-gray-900 mt-1">
                    {compareResult.data.deltas.rainfallDelta != null
                      ? `${compareResult.data.deltas.rainfallDelta > 0 ? '+' : ''}${compareResult.data.deltas.rainfallDelta} mm`
                      : 'N/A'}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 pt-2 border-t border-gray-200">
                <div>
                  <span className="text-gray-400 font-semibold block text-[10px] uppercase">Survey 1 Condition</span>
                  <p className="font-bold text-gray-800 capitalize mt-0.5">
                    {compareResult.data.survey1.cropCondition} • {compareResult.data.survey1.waterAvailabilityStatus}
                  </p>
                </div>
                <div>
                  <span className="text-gray-400 font-semibold block text-[10px] uppercase">Survey 2 Condition</span>
                  <p className="font-bold text-gray-800 capitalize mt-0.5">
                    {compareResult.data.survey2.cropCondition} • {compareResult.data.survey2.waterAvailabilityStatus}
                  </p>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </Modal>

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