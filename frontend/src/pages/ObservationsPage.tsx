import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '../api/client.js';
import { useAuth } from '../lib/auth.js';
import {
  Camera,
  Search,
  Filter,
  Plus,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  MapPin,
  Calendar,
  User,
  Info,
  CheckCircle2,
  XCircle,
  FileText,
  Trash2,
  Edit2,
  Droplets,
  Layers,
  HelpCircle,
} from 'lucide-react';
import { Card } from '../components/ui/Card.js';
import { Button } from '../components/ui/Button.js';
import { Badge } from '../components/ui/Badge.js';
import { Input } from '../components/ui/Input.js';
import { Modal } from '../components/ui/Modal.js';

export type ObservationCategory =
  | 'farmer_interview'
  | 'irrigation_source'
  | 'water_scarcity'
  | 'canal_infrastructure';

export type ConsentMethod =
  | 'written_form'
  | 'audio_recorded'
  | 'verbal_panchayat_witness'
  | 'not_applicable';

export interface FieldObservation {
  id: string;
  villageId: string;
  villageName: string;
  mandal: string;
  district: string;
  farmerId?: string | null;
  farmerName?: string | null;
  farmerCode?: string | null;
  plotId?: string | null;
  observationDate: string;
  category: ObservationCategory;
  title: string;
  caption: string;
  photoStorageKey: string;
  photoUrl: string;
  fileSizeBytes: number;
  mimeType: string;
  surveyorName: string | null;
  consentVerified: boolean;
  consentMethod: ConsentMethod | null;
  consentNotes: string | null;
  consentWithdrawn: boolean;
  consentWithdrawnAt: string | null;
  consentWithdrawnReason: string | null;
  isPublished: boolean;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SurveySummary {
  respondentCount: {
    distinctFarmers: number;
    distinctVillages: number;
    feedbackCyclesRecorded: number;
    totalCallAttempts: number;
    scheduledCallsCount: number;
  };
  irrigationSources: {
    totalPlotsSampled: number;
    breakdown: Array<{
      sourceType: string;
      count: number;
      percentage: number;
    }>;
  };
  waterChallenges: {
    totalResponsesWithWaterStatus: number;
    shortageCount: number;
    shortagePercentage: number | null;
    adequateCount: number;
    adequatePercentage: number | null;
  };
  cropConditions: {
    totalResponsesWithCondition: number;
    normalCount: number;
    stressCount: number;
    pestOrDiseaseCount: number;
  };
  fieldObservations: {
    totalObservationsCount: number;
    withVerifiedConsentCount: number;
    byCategory: {
      farmer_interview: number;
      irrigation_source: number;
      water_scarcity: number;
      canal_infrastructure: number;
    };
  };
  calculatedAt: string;
}

interface Village {
  id: string;
  name: string;
  mandal: string;
  district: string;
}

export const ObservationsPage: React.FC = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const canUpload = user?.role === 'ADMIN' || user?.role === 'CSP_MEMBER';
  const isAdmin = user?.role === 'ADMIN';

  // Filters & State
  const [selectedCategory, setSelectedCategory] = useState<ObservationCategory | 'all'>('all');
  const [selectedVillageId, setSelectedVillageId] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [onlyConsent, setOnlyConsent] = useState<boolean>(false);

  // Modals
  const [selectedObservation, setSelectedObservation] = useState<FieldObservation | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState<boolean>(false);
  const [isUploadOpen, setIsUploadOpen] = useState<boolean>(false);
  const [isEditOpen, setIsEditOpen] = useState<boolean>(false);
  const [isWithdrawOpen, setIsWithdrawOpen] = useState<boolean>(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState<boolean>(false);
  const [activeItem, setActiveItem] = useState<FieldObservation | null>(null);

  // Form States
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    villageId: '',
    farmerId: '',
    plotId: '',
    observationDate: new Date().toISOString().split('T')[0],
    category: 'farmer_interview' as ObservationCategory,
    title: '',
    caption: '',
    surveyorName: user?.name || '',
    consentVerified: true,
    consentMethod: 'verbal_panchayat_witness' as ConsentMethod,
    consentNotes: '',
  });

  const [editFormData, setEditFormData] = useState({
    title: '',
    caption: '',
    category: 'farmer_interview' as ObservationCategory,
    observationDate: '',
    surveyorName: '',
    consentVerified: true,
    consentMethod: 'verbal_panchayat_witness' as ConsentMethod,
    consentNotes: '',
  });

  const [withdrawReason, setWithdrawReason] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  // Queries
  const { data: summaryData, isLoading: isSummaryLoading } = useQuery<{ success: boolean; data: SurveySummary }>({
    queryKey: ['survey-summary'],
    queryFn: () => apiRequest('/observations/survey-summary'),
  });

  const { data: villagesData } = useQuery<any>({
    queryKey: ['reference-villages'],
    queryFn: () => apiRequest('/reference/villages'),
  });

  const villages: Village[] = Array.isArray(villagesData) ? villagesData : villagesData?.data || [];
  const summary = summaryData?.data;

  // Query farmers in the currently selected village for association
  const { data: villageFarmersData } = useQuery<any>({
    queryKey: ['village-farmers', formData.villageId],
    queryFn: () => apiRequest(`/farmers?village_id=${formData.villageId}`),
    enabled: !!formData.villageId,
  });

  const villageFarmers: any[] = Array.isArray(villageFarmersData)
    ? villageFarmersData
    : villageFarmersData?.data || [];

  const selectedFarmer = villageFarmers.find((f: any) => f.id === formData.farmerId);

  const {
    data: observationsResponse,
    isLoading: isObsLoading,
    error: obsError,
  } = useQuery<{
    success: boolean;
    data: FieldObservation[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }>({
    queryKey: ['observations', selectedCategory, selectedVillageId, searchQuery, onlyConsent],
    queryFn: () => {
      const params = new URLSearchParams();
      if (selectedCategory !== 'all') params.set('category', selectedCategory);
      if (selectedVillageId !== 'all') params.set('villageId', selectedVillageId);
      if (searchQuery.trim()) params.set('search', searchQuery.trim());
      if (onlyConsent) params.set('onlyWithConsent', 'true');
      return apiRequest(`/observations?${params.toString()}`);
    },
  });

  const observations = observationsResponse?.data || [];

  // Mutations
  const uploadMutation = useMutation({
    mutationFn: async (payload: { file: File; body: typeof formData }) => {
      const fd = new FormData();
      fd.append('photo', payload.file);
      fd.append('villageId', payload.body.villageId);
      if (payload.body.farmerId) fd.append('farmerId', payload.body.farmerId);
      if (payload.body.plotId) fd.append('plotId', payload.body.plotId);
      fd.append('observationDate', payload.body.observationDate);
      fd.append('category', payload.body.category);
      fd.append('title', payload.body.title);
      fd.append('caption', payload.body.caption);
      if (payload.body.surveyorName) fd.append('surveyorName', payload.body.surveyorName);
      fd.append('consentVerified', String(payload.body.consentVerified));
      fd.append('consentMethod', payload.body.consentMethod);
      if (payload.body.consentNotes) fd.append('consentNotes', payload.body.consentNotes);

      return apiRequest('/observations', {
        method: 'POST',
        body: fd,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['observations'] });
      queryClient.invalidateQueries({ queryKey: ['survey-summary'] });
      setIsUploadOpen(false);
      resetUploadForm();
    },
    onError: (err: any) => {
      setActionError(err.message || 'Failed to upload observation');
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (payload: { id: string; body: typeof editFormData }) => {
      return apiRequest(`/observations/${payload.id}`, {
        method: 'PUT',
        body: JSON.stringify(payload.body),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['observations'] });
      queryClient.invalidateQueries({ queryKey: ['survey-summary'] });
      setIsEditOpen(false);
      setActiveItem(null);
    },
    onError: (err: any) => {
      setActionError(err.message || 'Failed to update observation');
    },
  });

  const withdrawConsentMutation = useMutation({
    mutationFn: async (payload: { id: string; reason: string }) => {
      return apiRequest(`/observations/${payload.id}/withdraw-consent`, {
        method: 'POST',
        body: JSON.stringify({ reason: payload.reason }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['observations'] });
      queryClient.invalidateQueries({ queryKey: ['survey-summary'] });
      setIsWithdrawOpen(false);
      setActiveItem(null);
      setWithdrawReason('');
    },
    onError: (err: any) => {
      setActionError(err.message || 'Failed to withdraw consent');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest(`/observations/${id}`, {
        method: 'DELETE',
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['observations'] });
      queryClient.invalidateQueries({ queryKey: ['survey-summary'] });
      setIsDeleteOpen(false);
      setActiveItem(null);
    },
    onError: (err: any) => {
      setActionError(err.message || 'Failed to delete observation');
    },
  });

  const resetUploadForm = () => {
    setUploadFile(null);
    setUploadPreview(null);
    setFormData({
      villageId: villages[0]?.id || '',
      farmerId: '',
      plotId: '',
      observationDate: new Date().toISOString().split('T')[0],
      category: 'farmer_interview',
      title: '',
      caption: '',
      surveyorName: user?.name || '',
      consentVerified: true,
      consentMethod: 'verbal_panchayat_witness',
      consentNotes: '',
    });
    setActionError(null);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (file.size > 5 * 1024 * 1024) {
        setActionError('Selected file exceeds maximum allowed size of 5 MB.');
        return;
      }
      setUploadFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setUploadPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
      setActionError(null);
    }
  };

  const openEditModal = (obs: FieldObservation) => {
    setActiveItem(obs);
    setEditFormData({
      title: obs.title,
      caption: obs.caption,
      category: obs.category,
      observationDate: obs.observationDate,
      surveyorName: obs.surveyorName || '',
      consentVerified: obs.consentVerified,
      consentMethod: obs.consentMethod || 'not_applicable',
      consentNotes: obs.consentNotes || '',
    });
    setActionError(null);
    setIsEditOpen(true);
  };

  const openWithdrawModal = (obs: FieldObservation) => {
    setActiveItem(obs);
    setWithdrawReason('');
    setActionError(null);
    setIsWithdrawOpen(true);
  };

  const openDeleteModal = (obs: FieldObservation) => {
    setActiveItem(obs);
    setActionError(null);
    setIsDeleteOpen(true);
  };

  const getCategoryBadge = (category: ObservationCategory) => {
    switch (category) {
      case 'farmer_interview':
        return <Badge variant="demo">Farmer Interview</Badge>;
      case 'irrigation_source':
        return <Badge variant="info">Irrigation Source</Badge>;
      case 'water_scarcity':
        return <Badge variant="warning">Water Scarcity</Badge>;
      case 'canal_infrastructure':
        return <Badge variant="success">Canal Infra</Badge>;
      default:
        return <Badge variant="neutral">{category}</Badge>;
    }
  };

  const getCategoryTitle = (cat: string) => {
    switch (cat) {
      case 'farmer_interview':
        return 'Farmer Interviews & Surveys';
      case 'irrigation_source':
        return 'Irrigation Wells & Sources';
      case 'water_scarcity':
        return 'Water Scarcity Observations';
      case 'canal_infrastructure':
        return 'Canal & Distribution Infra';
      default:
        return 'Field Documentation';
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-gray-200">
        <div>
          <div className="flex items-center space-x-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">
              Community Ground Truth
            </span>
            <span className="text-xs text-gray-400">|</span>
            <span className="text-xs text-gray-500 font-medium">గ్రామ సర్వే & క్షేత్ర పరిశీలనలు</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mt-1 flex items-center gap-2">
            <Camera className="w-6 h-6 text-emerald-600" />
            Community Survey & Field Observations Gallery
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Authentic, verified photographic evidence and ground observations from farmer interviews, canal channels, and well infrastructure across project mandals.
          </p>
        </div>

        {canUpload && (
          <Button
            onClick={() => {
              resetUploadForm();
              if (villages.length > 0) {
                setFormData((prev) => ({ ...prev, villageId: villages[0].id }));
              }
              setIsUploadOpen(true);
            }}
            className="flex items-center space-x-2 shrink-0 bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            <Plus className="w-4 h-4" />
            <span>Upload Observation</span>
          </Button>
        )}
      </div>

      {/* Trust & Integrity Notice */}
      <div className="bg-amber-50/60 border border-amber-200 rounded-xl p-4 text-xs text-amber-900 flex items-start space-x-3">
        <ShieldCheck className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
        <div className="leading-relaxed">
          <span className="font-semibold text-amber-950">Ethical Field Data & Privacy Protocol: </span>
          All records represent genuine ground visits. Generative AI imagery or stock photography is strictly prohibited.
          Photographs capturing identifiable participants require explicit informed consent. Consent may be withdrawn at any time, which immediately suppresses image streaming across all village scopes.
        </div>
      </div>

      {/* Community Survey Findings Summary */}
      <Card className="p-5 border-emerald-100 bg-gradient-to-br from-white to-emerald-50/30 shadow-sm">
        <div className="flex items-center justify-between mb-4 pb-2 border-b border-gray-100">
          <div className="flex items-center space-x-2">
            <FileText className="w-5 h-5 text-emerald-700" />
            <h2 className="text-base font-bold text-gray-900">Community Survey Findings (Actual Database Metrics)</h2>
          </div>
          {summary && (
            <span className="text-[11px] text-gray-500">
              Aggregated: {new Date(summary.calculatedAt).toLocaleDateString()}
            </span>
          )}
        </div>

        {isSummaryLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 animate-pulse">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-20 bg-gray-100 rounded-xl" />
            ))}
          </div>
        ) : summary ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Farmers & Villages */}
            <div className="bg-white p-4 rounded-xl border border-gray-200/80 shadow-xs">
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-emerald-600" />
                Sampled Farmers
              </div>
              <div className="text-2xl font-black text-gray-900 mt-1">
                {summary.respondentCount.distinctFarmers}
                <span className="text-xs font-normal text-gray-500 ml-1.5">farmers</span>
              </div>
              <div className="text-xs text-gray-500 mt-1">
                Across <span className="font-semibold text-gray-700">{summary.respondentCount.distinctVillages}</span> villages
                ({summary.respondentCount.feedbackCyclesRecorded} survey cycles)
              </div>
            </div>

            {/* Reported Water Shortage */}
            <div className="bg-white p-4 rounded-xl border border-gray-200/80 shadow-xs">
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                Water Shortage Rate
              </div>
              <div className="text-2xl font-black text-amber-700 mt-1">
                {summary.waterChallenges.shortagePercentage !== null
                  ? `${summary.waterChallenges.shortagePercentage}%`
                  : 'N/A'}
              </div>
              <div className="text-xs text-gray-500 mt-1">
                {summary.waterChallenges.shortageCount} of {summary.waterChallenges.totalResponsesWithWaterStatus} survey respondents reported seasonal shortage
              </div>
            </div>

            {/* Primary Irrigation Sources */}
            <div className="bg-white p-4 rounded-xl border border-gray-200/80 shadow-xs">
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
                <Droplets className="w-3.5 h-3.5 text-water-600" />
                Plot Water Sources
              </div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {summary.irrigationSources.breakdown.slice(0, 3).map((item) => (
                  <span
                    key={item.sourceType}
                    className="text-xs font-medium bg-water-50 text-water-800 border border-water-200/70 px-2 py-0.5 rounded-md"
                  >
                    {item.sourceType}: <span className="font-bold">{item.count}</span>
                  </span>
                ))}
              </div>
              <div className="text-xs text-gray-500 mt-1">
                Total {summary.irrigationSources.totalPlotsSampled} plots cataloged
              </div>
            </div>

            {/* Field Photos & Consent */}
            <div className="bg-white p-4 rounded-xl border border-gray-200/80 shadow-xs">
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
                <Camera className="w-3.5 h-3.5 text-purple-600" />
                Field Photos Documented
              </div>
              <div className="text-2xl font-black text-gray-900 mt-1">
                {summary.fieldObservations.totalObservationsCount}
                <span className="text-xs font-normal text-gray-500 ml-1.5">photographs</span>
              </div>
              <div className="text-xs text-gray-500 mt-1">
                <span className="font-semibold text-emerald-700">{summary.fieldObservations.withVerifiedConsentCount}</span> with verified participant consent
              </div>
            </div>
          </div>
        ) : null}
      </Card>

      {/* Filter Tabs & Search Controls */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        {/* Category Filter Pills */}
        <div className="flex flex-wrap items-center gap-1.5 bg-gray-100 p-1 rounded-xl">
          {[
            { id: 'all', label: 'All Observations' },
            { id: 'farmer_interview', label: 'Farmer Interviews' },
            { id: 'irrigation_source', label: 'Irrigation Sources' },
            { id: 'water_scarcity', label: 'Water Scarcity' },
            { id: 'canal_infrastructure', label: 'Canal Infrastructure' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setSelectedCategory(tab.id as ObservationCategory | 'all')}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                selectedCategory === tab.id
                  ? 'bg-white text-gray-900 shadow-xs font-bold'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200/60'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Search & Village Filter Bar */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Village Filter */}
          <div className="w-48">
            <select
              value={selectedVillageId}
              onChange={(e) => setSelectedVillageId(e.target.value)}
              className="w-full text-xs rounded-lg border-gray-300 shadow-xs focus:border-emerald-500 focus:ring-emerald-500 py-2 px-2.5 bg-white"
            >
              <option value="all">All Villages</option>
              {villages.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} ({v.mandal})
                </option>
              ))}
            </select>
          </div>

          {/* Search Box */}
          <div className="relative w-64">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Search title, notes, surveyor..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-gray-300 shadow-xs focus:border-emerald-500 focus:ring-emerald-500 bg-white"
            />
          </div>

          {/* Consent Checkbox */}
          <label className="flex items-center space-x-1.5 text-xs text-gray-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={onlyConsent}
              onChange={(e) => setOnlyConsent(e.target.checked)}
              className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
            />
            <span>Verified Consent Only</span>
          </label>
        </div>
      </div>

      {/* Gallery Grid */}
      {isObsLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-pulse">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-72 bg-gray-100 rounded-2xl" />
          ))}
        </div>
      ) : obsError ? (
        <div className="p-8 text-center text-red-600 bg-red-50 rounded-2xl border border-red-200">
          <AlertTriangle className="w-8 h-8 mx-auto mb-2 text-red-500" />
          <p className="font-semibold text-sm">Error loading field observations</p>
          <p className="text-xs mt-1 text-red-500">{(obsError as any)?.message}</p>
        </div>
      ) : observations.length === 0 ? (
        <div className="p-12 text-center bg-white rounded-2xl border border-gray-200 shadow-xs">
          <div className="w-14 h-14 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-3 text-emerald-600">
            <Camera className="w-7 h-7" />
          </div>
          <h3 className="text-base font-bold text-gray-900">
            No Field Photographs Found
          </h3>
          <p className="text-xs text-gray-500 mt-1 max-w-md mx-auto">
            {selectedCategory !== 'all' || selectedVillageId !== 'all' || searchQuery
              ? 'No field observations match the selected category, village, or search criteria. Try loosening filters.'
              : 'No field observations have been recorded yet. Certified field survey officers (CSP Members) and Administrators can upload genuine photo documentation.'}
          </p>
          {canUpload && (
            <div className="mt-4">
              <Button
                onClick={() => {
                  resetUploadForm();
                  if (villages.length > 0) {
                    setFormData((prev) => ({ ...prev, villageId: villages[0].id }));
                  }
                  setIsUploadOpen(true);
                }}
                className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs px-4 py-2"
              >
                Upload First Field Observation
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {observations.map((obs) => {
            const isOwner = user?.id === obs.createdBy;
            const canManage = isAdmin || isOwner;

            return (
              <Card
                key={obs.id}
                className="overflow-hidden flex flex-col justify-between border-gray-200/90 hover:shadow-md transition-shadow group"
              >
                <div>
                  {/* Photo Thumbnail Container */}
                  <div
                    className="relative w-full h-52 bg-gray-900 overflow-hidden cursor-pointer"
                    onClick={() => {
                      setSelectedObservation(obs);
                      setIsDetailOpen(true);
                    }}
                  >
                    {obs.consentWithdrawn ? (
                      <div className="w-full h-full flex flex-col items-center justify-center bg-gray-900 text-white p-4 text-center">
                        <ShieldAlert className="w-8 h-8 text-red-400 mb-1" />
                        <span className="text-xs font-semibold text-red-200">Consent Withdrawn</span>
                        <span className="text-[10px] text-gray-400 mt-1">Photo streaming disabled</span>
                      </div>
                    ) : (
                      <img
                        src={`/api/v1/observations/${obs.id}/photo`}
                        alt={obs.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        onError={(e) => {
                          const target = e.target as HTMLImageElement;
                          target.style.display = 'none';
                          const parent = target.parentElement;
                          if (parent) {
                            parent.classList.add('flex', 'items-center', 'justify-center', 'bg-gray-800');
                            const fallback = document.createElement('div');
                            fallback.className = 'text-center p-4 text-gray-400 text-xs';
                            fallback.innerHTML = '<span class="block font-semibold">Protected Observation</span><span class="text-[10px] text-gray-500">Access Restricted</span>';
                            parent.appendChild(fallback);
                          }
                        }}
                      />
                    )}

                    {/* Category pill on image */}
                    <div className="absolute top-2 left-2 z-10">
                      {getCategoryBadge(obs.category)}
                    </div>

                    {/* Consent status badge */}
                    <div className="absolute top-2 right-2 z-10">
                      {obs.consentWithdrawn ? (
                        <span className="inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-600 text-white shadow-xs">
                          Withdrawn
                        </span>
                      ) : obs.consentVerified ? (
                        <span className="inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-600 text-white shadow-xs">
                          <CheckCircle2 className="w-3 h-3 mr-1" />
                          Consent Verified
                        </span>
                      ) : (
                        <span className="inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500 text-white shadow-xs">
                          Pending Consent
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Metadata Content */}
                  <div className="p-4 space-y-2">
                    <div className="flex items-center justify-between text-xs text-gray-500">
                      <span className="flex items-center text-gray-700 font-medium">
                        <MapPin className="w-3.5 h-3.5 mr-1 text-emerald-600" />
                        {obs.villageName}, {obs.mandal}
                      </span>
                      <span className="flex items-center text-gray-500">
                        <Calendar className="w-3.5 h-3.5 mr-1 text-gray-400" />
                        {obs.observationDate}
                      </span>
                    </div>

                    <h3
                      onClick={() => {
                        setSelectedObservation(obs);
                        setIsDetailOpen(true);
                      }}
                      className="font-bold text-gray-900 text-sm hover:text-emerald-700 cursor-pointer line-clamp-1"
                    >
                      {obs.title}
                    </h3>

                    <p className="text-xs text-gray-600 line-clamp-2 leading-relaxed">
                      {obs.caption}
                    </p>

                    {obs.farmerName && (
                      <div className="text-[11px] text-emerald-800 bg-emerald-50/70 px-2 py-1 rounded border border-emerald-200/60 flex items-center justify-between">
                        <span className="flex items-center gap-1 font-semibold truncate">
                          <User className="w-3 h-3 text-emerald-600 shrink-0" />
                          {obs.farmerName} ({obs.farmerCode || 'No Code'})
                        </span>
                        <span className="text-[9px] uppercase tracking-wider text-emerald-700 bg-emerald-100/80 px-1.5 py-0.5 rounded font-bold">
                          Farmer
                        </span>
                      </div>
                    )}

                    {obs.surveyorName && (
                      <div className="text-[11px] text-gray-500 pt-1 flex items-center">
                        <span className="font-semibold mr-1 text-gray-600">Surveyor:</span>
                        <span>{obs.surveyorName}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Card Actions */}
                <div className="px-4 py-3 bg-gray-50/80 border-t border-gray-100 flex items-center justify-between text-xs">
                  <button
                    onClick={() => {
                      setSelectedObservation(obs);
                      setIsDetailOpen(true);
                    }}
                    className="text-emerald-700 hover:text-emerald-900 font-semibold"
                  >
                    View Details
                  </button>

                  {canManage && (
                    <div className="flex items-center space-x-2">
                      <button
                        title="Edit Observation Metadata"
                        onClick={() => openEditModal(obs)}
                        className="p-1 text-gray-500 hover:text-gray-800 rounded hover:bg-gray-200"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>

                      {!obs.consentWithdrawn && (
                        <button
                          title="Withdraw Participant Consent"
                          onClick={() => openWithdrawModal(obs)}
                          className="p-1 text-amber-600 hover:text-amber-800 rounded hover:bg-amber-100"
                        >
                          <ShieldAlert className="w-3.5 h-3.5" />
                        </button>
                      )}

                      <button
                        title="Delete Observation"
                        onClick={() => openDeleteModal(obs)}
                        className="p-1 text-red-500 hover:text-red-700 rounded hover:bg-red-100"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Observation Detail Modal */}
      {selectedObservation && (
        <Modal
          isOpen={isDetailOpen}
          onClose={() => {
            setIsDetailOpen(false);
            setSelectedObservation(null);
          }}
          title={selectedObservation.title}
          maxWidth="2xl"
        >
          <div className="space-y-4">
            {/* Full Photo */}
            <div className="w-full h-72 sm:h-96 bg-gray-950 rounded-xl overflow-hidden flex items-center justify-center relative">
              {selectedObservation.consentWithdrawn ? (
                <div className="text-center p-6 text-white">
                  <ShieldAlert className="w-12 h-12 text-red-400 mx-auto mb-2" />
                  <p className="font-bold text-sm text-red-200">Consent Withdrawn for this Participant Photograph</p>
                  <p className="text-xs text-gray-400 mt-1 max-w-sm">
                    In compliance with the project consent policy, this photograph is blocked from display.
                  </p>
                </div>
              ) : (
                <img
                  src={`/api/v1/observations/${selectedObservation.id}/photo`}
                  alt={selectedObservation.title}
                  className="w-full h-full object-contain"
                />
              )}
            </div>

            {/* Badges & Scoping Info */}
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-gray-100">
              <div className="flex items-center space-x-2">
                {getCategoryBadge(selectedObservation.category)}
                <span className="text-xs font-semibold text-gray-700">
                  {selectedObservation.villageName}, {selectedObservation.mandal} ({selectedObservation.district})
                </span>
              </div>
              <span className="text-xs text-gray-500 flex items-center">
                <Calendar className="w-3.5 h-3.5 mr-1 text-gray-400" />
                Date: {selectedObservation.observationDate}
              </span>
            </div>

            {/* Farmer Association Details if linked */}
            {selectedObservation.farmerName && (
              <div className="p-3 bg-emerald-50/80 rounded-xl border border-emerald-200/80 flex items-center justify-between text-xs">
                <div className="flex items-center space-x-2.5">
                  <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700">
                    <User className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="font-bold text-emerald-950">{selectedObservation.farmerName}</span>
                    <span className="text-gray-500 ml-2">Code: {selectedObservation.farmerCode || 'N/A'}</span>
                    <div className="text-[11px] text-emerald-800">
                      Linked Field Observation Participant
                    </div>
                  </div>
                </div>
                <Badge variant="success" size="sm">
                  Associated Farmer
                </Badge>
              </div>
            )}

            {/* Field Notes / Caption */}
            <div>
              <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wide">
                Field Observations & Findings
              </h4>
              <p className="text-xs text-gray-800 mt-1 whitespace-pre-wrap leading-relaxed bg-gray-50 p-3 rounded-lg border border-gray-200">
                {selectedObservation.caption}
              </p>
            </div>

            {/* Consent & Audit Details */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 text-xs">
              <div className="bg-emerald-50/50 p-3 rounded-lg border border-emerald-100">
                <div className="font-bold text-emerald-900 mb-1 flex items-center">
                  <ShieldCheck className="w-4 h-4 mr-1 text-emerald-600" />
                  Consent & Verification
                </div>
                <div>Status: <span className="font-semibold">{selectedObservation.consentWithdrawn ? 'Withdrawn' : selectedObservation.consentVerified ? 'Verified' : 'Pending'}</span></div>
                <div>Method: <span className="font-semibold">{selectedObservation.consentMethod || 'N/A'}</span></div>
                {selectedObservation.consentNotes && (
                  <div className="mt-1 text-gray-600">Notes: {selectedObservation.consentNotes}</div>
                )}
                {selectedObservation.consentWithdrawn && (
                  <div className="mt-1 text-red-600 font-medium">
                    Withdrawal Reason: {selectedObservation.consentWithdrawnReason}
                  </div>
                )}
              </div>

              <div className="bg-gray-50 p-3 rounded-lg border border-gray-200">
                <div className="font-bold text-gray-800 mb-1 flex items-center">
                  <Info className="w-4 h-4 mr-1 text-gray-500" />
                  Metadata & Audit Trail
                </div>
                <div>Surveyor: <span className="font-semibold">{selectedObservation.surveyorName || 'Not recorded'}</span></div>
                <div>Recorded By: <span className="font-semibold">{selectedObservation.createdByName || 'System'}</span></div>
                <div>Uploaded: <span className="font-semibold">{new Date(selectedObservation.createdAt).toLocaleDateString()}</span></div>
                <div>File size: <span className="font-semibold">{Math.round(selectedObservation.fileSizeBytes / 1024)} KB</span> ({selectedObservation.mimeType})</div>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <Button
                variant="outline"
                onClick={() => {
                  setIsDetailOpen(false);
                  setSelectedObservation(null);
                }}
              >
                Close
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Upload Observation Modal */}
      <Modal
        isOpen={isUploadOpen}
        onClose={() => {
          setIsUploadOpen(false);
          resetUploadForm();
        }}
        title="Upload Genuine Field Observation"
        maxWidth="lg"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!uploadFile) {
              setActionError('Please select a photo file to upload.');
              return;
            }
            if (!formData.villageId) {
              setActionError('Please select a target village.');
              return;
            }
            if (!formData.title.trim()) {
              setActionError('Please enter an observation title.');
              return;
            }
            if (!formData.caption.trim()) {
              setActionError('Please enter observation notes/caption.');
              return;
            }
            if (formData.category === 'farmer_interview' && !formData.consentVerified) {
              setActionError('Farmer interview photographs require verified informed consent.');
              return;
            }

            uploadMutation.mutate({
              file: uploadFile,
              body: formData,
            });
          }}
          className="space-y-4 text-xs"
        >
          {actionError && (
            <div className="p-3 bg-red-50 text-red-700 rounded-lg border border-red-200">
              {actionError}
            </div>
          )}

          {/* Photo File Picker & Preview */}
          <div>
            <label className="block font-bold text-gray-700 mb-1">
              Field Photograph (JPEG, PNG, WebP — Max 5MB) *
            </label>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleFileChange}
              className="w-full text-xs text-gray-500 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100 cursor-pointer"
            />
            {uploadPreview && (
              <div className="mt-2 w-full h-40 bg-gray-100 rounded-lg overflow-hidden border border-gray-200">
                <img
                  src={uploadPreview}
                  alt="Upload preview"
                  className="w-full h-full object-contain"
                />
              </div>
            )}
            <p className="text-[11px] text-gray-500 mt-1">
              Note: EXIF metadata is scrubbed automatically on upload. Files are stored under a randomized key in private storage.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Village Selector */}
            <div>
              <label className="block font-bold text-gray-700 mb-1">Village *</label>
              <select
                value={formData.villageId}
                onChange={(e) => setFormData({ ...formData, villageId: e.target.value, farmerId: '', plotId: '' })}
                className="w-full text-xs rounded-lg border-gray-300 shadow-xs focus:border-emerald-500 focus:ring-emerald-500 bg-white"
                required
              >
                <option value="">Select Village</option>
                {villages.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} ({v.mandal})
                  </option>
                ))}
              </select>
            </div>

            {/* Category Selector */}
            <div>
              <label className="block font-bold text-gray-700 mb-1">Category *</label>
              <select
                value={formData.category}
                onChange={(e) =>
                  setFormData({ ...formData, category: e.target.value as ObservationCategory })
                }
                className="w-full text-xs rounded-lg border-gray-300 shadow-xs focus:border-emerald-500 focus:ring-emerald-500 bg-white"
              >
                <option value="farmer_interview">Farmer Interview / Survey</option>
                <option value="irrigation_source">Irrigation Well / Source</option>
                <option value="water_scarcity">Water Scarcity Observation</option>
                <option value="canal_infrastructure">Canal / Distribution Infra</option>
              </select>
            </div>
          </div>

          {/* Farmer Association Selector */}
          <div>
            <label className="block font-bold text-gray-700 mb-1">
              Associated Farmer (Optional)
            </label>
            <select
              value={formData.farmerId}
              onChange={(e) => setFormData({ ...formData, farmerId: e.target.value })}
              disabled={!formData.villageId}
              className="w-full text-xs rounded-lg border-gray-300 shadow-xs focus:border-emerald-500 focus:ring-emerald-500 bg-white disabled:bg-gray-100 disabled:text-gray-400"
            >
              <option value="">
                {formData.villageId
                  ? villageFarmers.length > 0
                    ? 'Select Farmer (Optional)'
                    : 'No registered farmers in this village'
                  : 'Select a Village First'}
              </option>
              {villageFarmers.map((f: any) => (
                <option key={f.id} value={f.id}>
                  {f.farmer_code || f.farmerCode} — {f.name} ({f.phone_number || f.phone})
                </option>
              ))}
            </select>
          </div>

          {/* Selected Farmer Preview Card */}
          {selectedFarmer && (
            <div className="p-3 bg-emerald-50/70 rounded-xl border border-emerald-200 text-xs">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-bold text-emerald-950 flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5 text-emerald-700" />
                    {selectedFarmer.name}
                    <span className="text-[11px] font-normal text-gray-500">
                      ({selectedFarmer.farmer_code || selectedFarmer.farmerCode})
                    </span>
                  </div>
                  <div className="text-[11px] text-gray-600 mt-0.5">
                    Phone: <span className="font-medium text-gray-800">{selectedFarmer.phone_number || selectedFarmer.phone}</span>
                    {selectedFarmer.total_area_acres && ` • Area: ${selectedFarmer.total_area_acres} acres`}
                  </div>
                </div>
                <Badge variant={selectedFarmer.data_origin === 'real' ? 'success' : 'demo'} size="sm">
                  {selectedFarmer.data_origin === 'real' ? 'Real Field Farmer' : 'Demo Fixture'}
                </Badge>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Observation Date */}
            <div>
              <label className="block font-bold text-gray-700 mb-1">Observation Date *</label>
              <input
                type="date"
                value={formData.observationDate}
                onChange={(e) => setFormData({ ...formData, observationDate: e.target.value })}
                className="w-full text-xs rounded-lg border-gray-300 shadow-xs focus:border-emerald-500 focus:ring-emerald-500"
                required
              />
            </div>

            {/* Surveyor Name */}
            <div>
              <label className="block font-bold text-gray-700 mb-1">Surveyor / CSP Member</label>
              <input
                type="text"
                placeholder="e.g. Ramesh Reddy (CSP)"
                value={formData.surveyorName}
                onChange={(e) => setFormData({ ...formData, surveyorName: e.target.value })}
                className="w-full text-xs rounded-lg border-gray-300 shadow-xs focus:border-emerald-500 focus:ring-emerald-500"
              />
            </div>
          </div>

          {/* Title */}
          <div>
            <label className="block font-bold text-gray-700 mb-1">Title *</label>
            <input
              type="text"
              placeholder="e.g. Borewell Discharge Rate Inspection - Plot 4B"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              className="w-full text-xs rounded-lg border-gray-300 shadow-xs focus:border-emerald-500 focus:ring-emerald-500"
              required
            />
          </div>

          {/* Caption */}
          <div>
            <label className="block font-bold text-gray-700 mb-1">Detailed Caption & Ground Findings *</label>
            <textarea
              rows={3}
              placeholder="Document observed water availability, crop condition, farmer remarks, canal maintenance..."
              value={formData.caption}
              onChange={(e) => setFormData({ ...formData, caption: e.target.value })}
              className="w-full text-xs rounded-lg border-gray-300 shadow-xs focus:border-emerald-500 focus:ring-emerald-500"
              required
            />
          </div>

          {/* Participant Consent Section */}
          <div className="p-3 bg-gray-50 rounded-xl border border-gray-200 space-y-2">
            <div className="font-bold text-gray-800 flex items-center">
              <ShieldCheck className="w-4 h-4 mr-1 text-emerald-600" />
              Informed Participant Consent Verification
            </div>

            <label className="flex items-center space-x-2 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.consentVerified}
                onChange={(e) => setFormData({ ...formData, consentVerified: e.target.checked })}
                className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
              />
              <span className="font-medium text-gray-700">
                Participant has provided explicit informed consent for photographic documentation
              </span>
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <div>
                <label className="block text-[11px] font-semibold text-gray-600 mb-0.5">
                  Consent Method
                </label>
                <select
                  value={formData.consentMethod}
                  onChange={(e) =>
                    setFormData({ ...formData, consentMethod: e.target.value as ConsentMethod })
                  }
                  className="w-full text-xs rounded-lg border-gray-300 bg-white"
                >
                  <option value="verbal_panchayat_witness">Verbal / Panchayat Witness Consent</option>
                  <option value="written_form">Written Consent Form</option>
                  <option value="audio_recorded">Audio Recorded Consent</option>
                  <option value="not_applicable">Not Applicable (Infrastructure Only)</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-gray-600 mb-0.5">
                  Consent Notes
                </label>
                <input
                  type="text"
                  placeholder="e.g. Audio consent confirmed via IVR survey"
                  value={formData.consentNotes}
                  onChange={(e) => setFormData({ ...formData, consentNotes: e.target.value })}
                  className="w-full text-xs rounded-lg border-gray-300"
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end space-x-2 pt-2 border-t border-gray-100">
            <Button
              variant="outline"
              type="button"
              onClick={() => {
                setIsUploadOpen(false);
                resetUploadForm();
              }}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={uploadMutation.isPending}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {uploadMutation.isPending ? 'Uploading...' : 'Save Observation'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Edit Observation Metadata Modal */}
      {activeItem && (
        <Modal
          isOpen={isEditOpen}
          onClose={() => {
            setIsEditOpen(false);
            setActiveItem(null);
          }}
          title="Edit Field Observation Metadata"
          maxWidth="md"
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!editFormData.title.trim()) {
                setActionError('Title is required');
                return;
              }
              if (!editFormData.caption.trim()) {
                setActionError('Caption is required');
                return;
              }

              updateMutation.mutate({
                id: activeItem.id,
                body: editFormData,
              });
            }}
            className="space-y-3 text-xs"
          >
            {actionError && (
              <div className="p-3 bg-red-50 text-red-700 rounded-lg border border-red-200">
                {actionError}
              </div>
            )}

            <div>
              <label className="block font-bold text-gray-700 mb-1">Title</label>
              <input
                type="text"
                value={editFormData.title}
                onChange={(e) => setEditFormData({ ...editFormData, title: e.target.value })}
                className="w-full text-xs rounded-lg border-gray-300"
                required
              />
            </div>

            <div>
              <label className="block font-bold text-gray-700 mb-1">Caption / Notes</label>
              <textarea
                rows={3}
                value={editFormData.caption}
                onChange={(e) => setEditFormData({ ...editFormData, caption: e.target.value })}
                className="w-full text-xs rounded-lg border-gray-300"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-bold text-gray-700 mb-1">Category</label>
                <select
                  value={editFormData.category}
                  onChange={(e) =>
                    setEditFormData({
                      ...editFormData,
                      category: e.target.value as ObservationCategory,
                    })
                  }
                  className="w-full text-xs rounded-lg border-gray-300 bg-white"
                >
                  <option value="farmer_interview">Farmer Interview</option>
                  <option value="irrigation_source">Irrigation Source</option>
                  <option value="water_scarcity">Water Scarcity</option>
                  <option value="canal_infrastructure">Canal Infra</option>
                </select>
              </div>

              <div>
                <label className="block font-bold text-gray-700 mb-1">Date</label>
                <input
                  type="date"
                  value={editFormData.observationDate}
                  onChange={(e) =>
                    setEditFormData({ ...editFormData, observationDate: e.target.value })
                  }
                  className="w-full text-xs rounded-lg border-gray-300"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block font-bold text-gray-700 mb-1">Surveyor Name</label>
              <input
                type="text"
                value={editFormData.surveyorName}
                onChange={(e) =>
                  setEditFormData({ ...editFormData, surveyorName: e.target.value })
                }
                className="w-full text-xs rounded-lg border-gray-300"
              />
            </div>

            <div className="flex justify-end space-x-2 pt-2 border-t border-gray-100">
              <Button
                variant="outline"
                type="button"
                onClick={() => {
                  setIsEditOpen(false);
                  setActiveItem(null);
                }}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={updateMutation.isPending}
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                {updateMutation.isPending ? 'Updating...' : 'Save Changes'}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* Withdraw Consent Modal */}
      {activeItem && (
        <Modal
          isOpen={isWithdrawOpen}
          onClose={() => {
            setIsWithdrawOpen(false);
            setActiveItem(null);
          }}
          title="Withdraw Participant Consent"
          maxWidth="sm"
        >
          <div className="space-y-3 text-xs">
            <p className="text-gray-600 leading-relaxed">
              Withdrawing consent immediately revokes photo streaming for this observation across all user scopes.
              The observation metadata will be retained for audit consistency, but the photograph will be withheld from display.
            </p>

            {actionError && (
              <div className="p-3 bg-red-50 text-red-700 rounded-lg border border-red-200">
                {actionError}
              </div>
            )}

            <div>
              <label className="block font-bold text-gray-700 mb-1">
                Reason for Withdrawal *
              </label>
              <textarea
                rows={3}
                placeholder="e.g. Participant requested deletion of image during follow-up visit"
                value={withdrawReason}
                onChange={(e) => setWithdrawReason(e.target.value)}
                className="w-full text-xs rounded-lg border-gray-300"
                required
              />
            </div>

            <div className="flex justify-end space-x-2 pt-2">
              <Button
                variant="outline"
                onClick={() => {
                  setIsWithdrawOpen(false);
                  setActiveItem(null);
                }}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                disabled={withdrawConsentMutation.isPending || !withdrawReason.trim()}
                onClick={() => {
                  withdrawConsentMutation.mutate({
                    id: activeItem.id,
                    reason: withdrawReason.trim(),
                  });
                }}
              >
                {withdrawConsentMutation.isPending ? 'Processing...' : 'Confirm Withdrawal'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Delete Confirmation Modal */}
      {activeItem && (
        <Modal
          isOpen={isDeleteOpen}
          onClose={() => {
            setIsDeleteOpen(false);
            setActiveItem(null);
          }}
          title="Delete Field Observation"
          maxWidth="sm"
        >
          <div className="space-y-3 text-xs">
            <p className="text-gray-600 leading-relaxed">
              Are you sure you want to permanently delete this observation record and its stored photograph?
              This action cannot be undone.
            </p>

            <div className="p-2.5 bg-gray-50 rounded-lg border border-gray-200 font-medium text-gray-800">
              {activeItem.title} ({activeItem.villageName})
            </div>

            {actionError && (
              <div className="p-3 bg-red-50 text-red-700 rounded-lg border border-red-200">
                {actionError}
              </div>
            )}

            <div className="flex justify-end space-x-2 pt-2">
              <Button
                variant="outline"
                onClick={() => {
                  setIsDeleteOpen(false);
                  setActiveItem(null);
                }}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                disabled={deleteMutation.isPending}
                onClick={() => {
                  deleteMutation.mutate(activeItem.id);
                }}
              >
                {deleteMutation.isPending ? 'Deleting...' : 'Delete Permanently'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default ObservationsPage;
