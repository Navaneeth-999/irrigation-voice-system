import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { apiRequest } from '../api/client.js';
import { useAuth } from '../lib/auth.js';
import {
  Users,
  Search,
  UserPlus,
  Upload,
  Eye,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Edit2,
  Phone,
  ShieldCheck,
  Check,
  Clock,
  Droplets,
  Sprout,
  Send,
  RotateCcw,
} from 'lucide-react';
import { Card } from '../components/ui/Card.js';
import { Button } from '../components/ui/Button.js';
import { Input } from '../components/ui/Input.js';
import { Badge } from '../components/ui/Badge.js';
import { Modal } from '../components/ui/Modal.js';
import { VillageAutocomplete, Village } from '../components/ui/VillageAutocomplete.js';

const CROPS = [
  { id: 'paddy', name: 'Paddy (వరి)' },
  { id: 'maize', name: 'Maize (మొక్కజొన్న)' },
  { id: 'cotton', name: 'Cotton (పత్తి)' },
  { id: 'chillies', name: 'Chillies (మిరప)' },
  { id: 'groundnut', name: 'Groundnut (వేరుశనగ)' },
  { id: 'sugarcane', name: 'Sugarcane (చెరకు)' },
  { id: 'bengal_gram', name: 'Bengal Gram (శనగ)' },
  { id: 'black_gram', name: 'Black Gram (మినుము)' },
  { id: 'tomato', name: 'Tomato (టమోటా)' },
  { id: 'banana', name: 'Banana (అరటి)' },
];

const WATER_SOURCES = [
  { id: 'borewell', name: 'Borewell (బోరుబావి)' },
  { id: 'canal', name: 'Canal (కాలువ)' },
  { id: 'open_well', name: 'Open Well (బావి)' },
  { id: 'tank', name: 'Tank / Pond (చెరువు)' },
  { id: 'rainfed', name: 'Rainfed (వర్షాధారం)' },
];

export const FarmersPage: React.FC = () => {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canManage = user?.role === 'ADMIN' || user?.role === 'CSP_MEMBER';

  const [search, setSearch] = useState('');
  const [villageFilter, setVillageFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // Modals state
  const [isRegisterOpen, setIsRegisterOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isVerifyModalOpen, setIsVerifyModalOpen] = useState(false);
  const [verifyingFarmer, setVerifyingFarmer] = useState<any | null>(null);

  // Register Form State
  const [fullName, setFullName] = useState('');
  const [villageId, setVillageId] = useState('');
  const [phone, setPhone] = useState('');
  const [cropType, setCropType] = useState('paddy');
  const [landArea, setLandArea] = useState('2.5');
  const [waterSource, setWaterSource] = useState('borewell');
  const [address, setAddress] = useState('');
  const [gramPanchayat, setGramPanchayat] = useState('');
  const [callWindowStart, setCallWindowStart] = useState('09:00:00');
  const [callWindowEnd, setCallWindowEnd] = useState('18:00:00');
  const [voiceConsent, setVoiceConsent] = useState(true);
  const [smsConsent, setSmsConsent] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);

  // Register OTP State
  const [regOtpSent, setRegOtpSent] = useState(false);
  const [regOtpCode, setRegOtpCode] = useState('');
  const [regOtpVerified, setRegOtpVerified] = useState(false);
  const [regOtpTimer, setRegOtpTimer] = useState(0);
  const [regDevOtp, setRegDevOtp] = useState<string | null>(null);
  const [regOtpMode, setRegOtpMode] = useState<'simulation' | 'live'>('simulation');
  const [regOtpLoading, setRegOtpLoading] = useState(false);
  const [regOtpError, setRegOtpError] = useState<string | null>(null);

  // Edit Farmer Form State
  const [editingFarmer, setEditingFarmer] = useState<any | null>(null);
  const [editFullName, setEditFullName] = useState('');
  const [editVillageId, setEditVillageId] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editCropType, setEditCropType] = useState('');
  const [editLandArea, setEditLandArea] = useState('');
  const [editWaterSource, setEditWaterSource] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editGramPanchayat, setEditGramPanchayat] = useState('');
  const [editCallWindowStart, setEditCallWindowStart] = useState('09:00:00');
  const [editCallWindowEnd, setEditCallWindowEnd] = useState('18:00:00');
  const [editFormError, setEditFormError] = useState<string | null>(null);

  // Standalone Verification Modal State
  const [vOtpSent, setVOtpSent] = useState(false);
  const [vOtpCode, setVOtpCode] = useState('');
  const [vOtpTimer, setVOtpTimer] = useState(0);
  const [vDevOtp, setVDevOtp] = useState<string | null>(null);
  const [vOtpMode, setVOtpMode] = useState<'simulation' | 'live'>('simulation');
  const [vOtpLoading, setVOtpLoading] = useState(false);
  const [vOtpError, setVOtpError] = useState<string | null>(null);

  // CSV Import State
  const [csvText, setCsvText] = useState(
    'full_name,village_name,phone,gram_panchayat\n' +
    'Ramesh Reddy,Guntur Rural,9848011223,Guntur GP\n' +
    'Siva Prasad,Tenali North,9848033445,Tenali GP'
  );
  const [importResult, setImportResult] = useState<any | null>(null);

  // Countdown timers
  useEffect(() => {
    let interval: any;
    if (regOtpTimer > 0) {
      interval = setInterval(() => setRegOtpTimer((prev) => prev - 1), 1000);
    }
    return () => clearInterval(interval);
  }, [regOtpTimer]);

  useEffect(() => {
    let interval: any;
    if (vOtpTimer > 0) {
      interval = setInterval(() => setVOtpTimer((prev) => prev - 1), 1000);
    }
    return () => clearInterval(interval);
  }, [vOtpTimer]);

  // Queries
  const { data: villages = [] } = useQuery<Village[]>({
    queryKey: ['villages'],
    queryFn: () => apiRequest<Village[]>('/reference/villages'),
  });

  const { data: farmers, isLoading, refetch } = useQuery<any[]>({
    queryKey: ['farmers', search, villageFilter, statusFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (search) params.append('search', search);
      if (villageFilter) params.append('village_id', villageFilter);
      if (statusFilter) params.append('status', statusFilter);
      return apiRequest<any[]>(`/farmers?${params.toString()}`);
    },
  });

  // Create Farmer Mutation
  const createMutation = useMutation({
    mutationFn: (newFarmer: any) =>
      apiRequest('/farmers', {
        method: 'POST',
        body: JSON.stringify(newFarmer),
      }),
    onSuccess: async (createdData: any) => {
      // If land area, crop, or water source were provided, update them via edit endpoint
      if (createdData?.data?.id && (landArea || cropType || waterSource)) {
        try {
          await apiRequest(`/farmers/${createdData.data.id}`, {
            method: 'PUT',
            body: JSON.stringify({
              crop_type: cropType,
              land_area_acres: parseFloat(landArea) || undefined,
              water_source: waterSource,
            }),
          });
        } catch (e) {
          console.warn('Initial plot setup error:', e);
        }
      }

      queryClient.invalidateQueries({ queryKey: ['farmers'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-kpis'] });
      setIsRegisterOpen(false);
      resetRegisterForm();
    },
    onError: (err: any) => {
      setFormError(err.message || 'Failed to create farmer.');
    },
  });

  // Edit Farmer Mutation
  const editMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) =>
      apiRequest(`/farmers/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['farmers'] });
      queryClient.invalidateQueries({ queryKey: ['farmer', editingFarmer?.id] });
      setIsEditOpen(false);
      setEditingFarmer(null);
    },
    onError: (err: any) => {
      setEditFormError(err.message || 'Failed to update farmer.');
    },
  });

  // Toggle Status Mutation
  const toggleStatusMutation = useMutation({
    mutationFn: ({ id, currentStatus }: { id: string; currentStatus: string }) => {
      const endpoint = currentStatus === 'active' ? `/farmers/${id}/deactivate` : `/farmers/${id}/reactivate`;
      return apiRequest(endpoint, { method: 'POST' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['farmers'] });
    },
  });

  const resetRegisterForm = () => {
    setFullName('');
    setVillageId('');
    setPhone('');
    setCropType('paddy');
    setLandArea('2.5');
    setWaterSource('borewell');
    setAddress('');
    setGramPanchayat('');
    setCallWindowStart('09:00:00');
    setCallWindowEnd('18:00:00');
    setVoiceConsent(true);
    setSmsConsent(true);
    setFormError(null);
    setRegOtpSent(false);
    setRegOtpCode('');
    setRegOtpVerified(false);
    setRegDevOtp(null);
    setRegOtpError(null);
  };

  // Open Edit Modal and pre-fill form
  const handleOpenEdit = async (farmer: any) => {
    setEditingFarmer(farmer);
    setEditFullName(farmer.full_name || '');
    setEditVillageId(farmer.village_id || '');
    setEditPhone(farmer.primary_phone_raw || farmer.primary_phone?.replace(/[^\d+]/g, '') || '');
    setEditCropType(farmer.crop_id || farmer.crop_name?.toLowerCase() || 'paddy');
    setEditLandArea(farmer.land_area_acres ? String(farmer.land_area_acres) : '1.0');
    setEditWaterSource(farmer.water_source || 'borewell');
    setEditAddress(farmer.address || '');
    setEditGramPanchayat(farmer.gram_panchayat || '');
    setEditCallWindowStart(farmer.call_window_start || '09:00:00');
    setEditCallWindowEnd(farmer.call_window_end || '18:00:00');
    setEditFormError(null);
    setIsEditOpen(true);

    // If full phone or additional plot data needed, fetch detailed farmer profile
    try {
      const full = await apiRequest<any>(`/farmers/${farmer.id}`);
      if (full?.data) {
        const d = full.data;
        if (d.primary_phone_raw) setEditPhone(d.primary_phone_raw);
        if (d.crop_id) setEditCropType(d.crop_id);
        if (d.land_area_acres) setEditLandArea(String(d.land_area_acres));
        if (d.water_source) setEditWaterSource(d.water_source);
      }
    } catch (e) {
      // Ignore background fetch error and keep existing row data
    }
  };

  // Handle Edit Submit
  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingFarmer) return;
    setEditFormError(null);

    if (!editVillageId) {
      setEditFormError('Please select a valid village.');
      return;
    }

    const payload: any = {
      full_name: editFullName,
      village_id: editVillageId,
      phone: editPhone,
      crop_type: editCropType,
      land_area_acres: parseFloat(editLandArea) || undefined,
      water_source: editWaterSource,
      address: editAddress,
      gram_panchayat: editGramPanchayat,
      call_window_start: editCallWindowStart,
      call_window_end: editCallWindowEnd,
    };

    editMutation.mutate({ id: editingFarmer.id, data: payload });
  };

  // Handle Register Send OTP
  const handleSendRegOtp = async () => {
    if (!phone || phone.length < 10) {
      setRegOtpError('Please enter a valid 10-digit phone number first.');
      return;
    }
    setRegOtpLoading(true);
    setRegOtpError(null);
    try {
      const res = await apiRequest<any>('/farmers/send-otp', {
        method: 'POST',
        body: JSON.stringify({ phone, mode: regOtpMode }),
      });
      setRegOtpSent(true);
      setRegOtpTimer(60);
      if (res.devOtp) setRegDevOtp(res.devOtp);
    } catch (err: any) {
      setRegOtpError(err.message || 'Failed to dispatch OTP.');
    } finally {
      setRegOtpLoading(false);
    }
  };

  // Handle Register Verify OTP
  const handleVerifyRegOtp = async () => {
    if (!regOtpCode || regOtpCode.length !== 6) {
      setRegOtpError('Please enter the 6-digit OTP code.');
      return;
    }
    setRegOtpLoading(true);
    setRegOtpError(null);
    try {
      await apiRequest('/farmers/verify-otp', {
        method: 'POST',
        body: JSON.stringify({ phone, otp: regOtpCode }),
      });
      setRegOtpVerified(true);
    } catch (err: any) {
      setRegOtpError(err.message || 'Invalid or expired OTP.');
    } finally {
      setRegOtpLoading(false);
    }
  };

  // Handle Register Submit
  const handleRegisterSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!villageId) {
      setFormError('Please select a village.');
      return;
    }

    createMutation.mutate({
      full_name: fullName,
      village_id: villageId,
      phone,
      address,
      gram_panchayat: gramPanchayat,
      call_window_start: callWindowStart,
      call_window_end: callWindowEnd,
      voice_consent: voiceConsent,
      sms_consent: smsConsent,
    });
  };

  // Open Standalone OTP Verify Modal
  const handleOpenVerifyModal = (farmer: any) => {
    setVerifyingFarmer(farmer);
    setVOtpSent(false);
    setVOtpCode('');
    setVDevOtp(null);
    setVOtpError(null);
    setIsVerifyModalOpen(true);
  };

  // Send OTP for standalone verification
  const handleSendVOtp = async () => {
    if (!verifyingFarmer) return;
    setVOtpLoading(true);
    setVOtpError(null);
    try {
      const res = await apiRequest<any>('/farmers/send-otp', {
        method: 'POST',
        body: JSON.stringify({
          phone: verifyingFarmer.primary_phone_raw || verifyingFarmer.primary_phone,
          farmerId: verifyingFarmer.id,
          mode: vOtpMode,
        }),
      });
      setVOtpSent(true);
      setVOtpTimer(60);
      if (res.devOtp) setVDevOtp(res.devOtp);
    } catch (err: any) {
      setVOtpError(err.message || 'Failed to send OTP.');
    } finally {
      setVOtpLoading(false);
    }
  };

  // Verify OTP for standalone verification
  const handleVerifyVOtp = async () => {
    if (!verifyingFarmer || !vOtpCode || vOtpCode.length !== 6) {
      setVOtpError('Please enter a 6-digit code.');
      return;
    }
    setVOtpLoading(true);
    setVOtpError(null);
    try {
      await apiRequest('/farmers/verify-otp', {
        method: 'POST',
        body: JSON.stringify({
          phone: verifyingFarmer.primary_phone_raw || verifyingFarmer.primary_phone,
          farmerId: verifyingFarmer.id,
          otp: vOtpCode,
        }),
      });
      queryClient.invalidateQueries({ queryKey: ['farmers'] });
      setIsVerifyModalOpen(false);
      setVerifyingFarmer(null);
    } catch (err: any) {
      setVOtpError(err.message || 'Verification failed.');
    } finally {
      setVOtpLoading(false);
    }
  };

  const parseCsvRows = (raw: string) => {
    const lines = raw.trim().split('\n').filter(l => l.trim().length > 0);
    if (lines.length < 2) return [];
    const headers = lines[0].split(',').map(h => h.trim());
    return lines.slice(1).map(line => {
      const values = line.split(',').map(v => v.trim());
      const row: Record<string, any> = {};
      headers.forEach((h, i) => {
        row[h] = values[i] || '';
      });
      return row;
    });
  };

  const handleCsvDryRun = async () => {
    const rows = parseCsvRows(csvText);
    try {
      const res = await apiRequest('/farmers/import', {
        method: 'POST',
        body: JSON.stringify({ rows, dryRun: true }),
      });
      setImportResult(res);
    } catch (err: any) {
      alert(`Import error: ${err.message}`);
    }
  };

  const handleCsvExecute = async () => {
    const rows = parseCsvRows(csvText);
    try {
      const res = await apiRequest('/farmers/import', {
        method: 'POST',
        body: JSON.stringify({ rows, dryRun: false }),
      });
      alert(`Import successful! ${res.importedCount} farmers added.`);
      setIsImportOpen(false);
      setImportResult(null);
      refetch();
    } catch (err: any) {
      alert(`Import error: ${err.message}`);
    }
  };

  const isPhoneChangedInEdit = editingFarmer && editPhone && (
    editPhone.replace(/[^\d]/g, '') !== (editingFarmer.primary_phone_raw || editingFarmer.primary_phone || '').replace(/[^\d]/g, '')
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Farmers Directory</h1>
          <p className="text-sm text-gray-500 mt-1">
            Manage smallholder farmer profiles, verified contact details, crops, and communication consents.
          </p>
        </div>
        {canManage && (
          <div className="flex items-center space-x-3">
            <Button variant="outline" size="md" onClick={() => setIsImportOpen(true)}>
              <Upload className="w-4 h-4 mr-2" />
              Import CSV
            </Button>
            <Button variant="primary" size="md" onClick={() => { resetRegisterForm(); setIsRegisterOpen(true); }}>
              <UserPlus className="w-4 h-4 mr-2" />
              Register Farmer
            </Button>
          </div>
        )}
      </div>

      {/* Filters & Search Card */}
      <Card>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="relative md:col-span-2">
            <Search className="w-4 h-4 absolute left-3 top-3 text-gray-400" />
            <input
              type="text"
              placeholder="Search by farmer name, code, village, or phone..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-sm bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-forest-600 focus:border-forest-600"
            />
          </div>

          <div>
            <select
              value={villageFilter}
              onChange={(e) => setVillageFilter(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-forest-600 focus:border-forest-600"
            >
              <option value="">All Villages</option>
              {villages?.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} ({v.mandal})
                </option>
              ))}
            </select>
          </div>

          <div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-forest-600 focus:border-forest-600"
            >
              <option value="">All Statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
        </div>
      </Card>

      {/* Farmers Table */}
      <Card>
        {isLoading ? (
          <div className="py-12 text-center text-sm text-gray-500">Loading farmers directory...</div>
        ) : !farmers || farmers.length === 0 ? (
          <div className="py-12 text-center">
            <Users className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-base font-medium text-gray-700">No farmers found</p>
            <p className="text-xs text-gray-400 mt-1">Try changing your search terms or filters.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  <th className="pb-3">Farmer Code</th>
                  <th className="pb-3">Name</th>
                  <th className="pb-3">Village & Mandal</th>
                  <th className="pb-3">Primary Phone</th>
                  <th className="pb-3">Crop & Area</th>
                  <th className="pb-3">Status</th>
                  <th className="pb-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {farmers.map((f) => (
                  <tr key={f.id} className="hover:bg-gray-50/50">
                    <td className="py-3 font-mono text-xs font-bold text-forest-800">
                      <Link to={`/farmers/${f.id}`} className="hover:underline">
                        {f.farmer_code}
                      </Link>
                    </td>
                    <td className="py-3 font-medium text-gray-900">
                      <Link to={`/farmers/${f.id}`} className="hover:underline hover:text-forest-700">
                        {f.full_name}
                      </Link>
                    </td>
                    <td className="py-3 text-gray-600">
                      {f.village_name} <span className="text-xs text-gray-400">({f.mandal})</span>
                    </td>
                    <td className="py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-gray-700">
                          {f.primary_phone || <span className="text-gray-300 italic">No phone</span>}
                        </span>
                        {f.phone_verified ? (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" /> Verified
                          </span>
                        ) : (
                          <div className="flex items-center gap-1">
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                              <AlertCircle className="w-3 h-3 text-amber-600" /> Unverified
                            </span>
                            {canManage && (
                              <button
                                onClick={() => handleOpenVerifyModal(f)}
                                className="text-[10px] text-forest-700 hover:text-forest-900 underline font-semibold ml-0.5"
                              >
                                Verify
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="py-3 text-xs text-gray-600">
                      <div className="flex items-center gap-1 font-medium text-gray-800">
                        <Sprout className="w-3.5 h-3.5 text-forest-600" />
                        <span>{f.crop_name || 'Crop pending'}</span>
                      </div>
                      <div className="text-[11px] text-gray-400 mt-0.5">
                        {f.land_area_acres ? `${f.land_area_acres} acres` : 'Area pending'} • {f.water_source || 'Water source pending'}
                      </div>
                    </td>
                    <td className="py-3">
                      <Badge variant={f.status === 'active' ? 'success' : 'neutral'} size="sm">
                        {f.status}
                      </Badge>
                    </td>
                    <td className="py-3 text-right space-x-1.5 whitespace-nowrap">
                      <Link to={`/farmers/${f.id}`}>
                        <Button variant="outline" size="sm">
                          <Eye className="w-3.5 h-3.5 mr-1" />
                          View
                        </Button>
                      </Link>
                      {canManage && (
                        <>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => handleOpenEdit(f)}
                          >
                            <Edit2 className="w-3.5 h-3.5 mr-1" />
                            Edit
                          </Button>
                          <Button
                            variant={f.status === 'active' ? 'outline' : 'secondary'}
                            size="sm"
                            onClick={() => toggleStatusMutation.mutate({ id: f.id, currentStatus: f.status })}
                          >
                            {f.status === 'active' ? 'Deactivate' : 'Reactivate'}
                          </Button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Register Farmer Modal */}
      <Modal isOpen={isRegisterOpen} onClose={() => setIsRegisterOpen(false)} title="Register New Farmer" maxWidth="lg">
        <form onSubmit={handleRegisterSubmit} className="space-y-4">
          {formError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-center gap-1.5">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
              <span>{formError}</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Full Name *"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="e.g. K. Venkateswara Rao"
              required
            />

            <div>
              <VillageAutocomplete
                label="Village *"
                value={villageId}
                onChange={(vId) => setVillageId(vId)}
                villages={villages}
                required
              />
            </div>
          </div>

          {/* Phone Number & OTP Verification Section */}
          <div className="p-4 bg-gray-50/80 rounded-xl border border-gray-200/90 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-gray-700 uppercase tracking-wider flex items-center gap-1.5">
                <Phone className="w-3.5 h-3.5 text-forest-700" />
                Phone Number & OTP Verification *
              </label>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-gray-400">Mode:</span>
                <button
                  type="button"
                  onClick={() => setRegOtpMode(regOtpMode === 'simulation' ? 'live' : 'simulation')}
                  className={`px-2 py-0.5 rounded text-[11px] font-semibold border ${
                    regOtpMode === 'live'
                      ? 'bg-amber-100 text-amber-800 border-amber-300'
                      : 'bg-blue-100 text-blue-800 border-blue-300'
                  }`}
                >
                  {regOtpMode === 'live' ? '📞 Live SMS' : '🎮 Simulation'}
                </button>
              </div>
            </div>

            <div className="flex gap-2">
              <div className="flex-1">
                <input
                  type="text"
                  value={phone}
                  onChange={(e) => {
                    setPhone(e.target.value);
                    setRegOtpVerified(false);
                    setRegOtpSent(false);
                  }}
                  placeholder="e.g. 9848022338 (10 digits)"
                  className="w-full px-3.5 py-2 text-sm bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-forest-600"
                  required
                />
              </div>
              <Button
                type="button"
                variant={regOtpVerified ? 'secondary' : 'primary'}
                size="sm"
                onClick={handleSendRegOtp}
                disabled={regOtpLoading || regOtpTimer > 0 || regOtpVerified}
              >
                {regOtpVerified ? (
                  <span className="flex items-center gap-1 text-emerald-700 font-semibold">
                    <Check className="w-3.5 h-3.5" /> Verified
                  </span>
                ) : regOtpTimer > 0 ? (
                  `Resend in ${regOtpTimer}s`
                ) : (
                  <span className="flex items-center gap-1">
                    <Send className="w-3.5 h-3.5" /> Send OTP
                  </span>
                )}
              </Button>
            </div>

            {regOtpError && (
              <div className="text-xs text-red-600 flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5" /> {regOtpError}
              </div>
            )}

            {regDevOtp && !regOtpVerified && (
              <div className="p-2 bg-emerald-50 border border-emerald-200 rounded text-xs text-emerald-800 flex items-center justify-between">
                <span>Demo OTP Code: <strong className="font-mono text-sm tracking-widest">{regDevOtp}</strong></span>
                <button
                  type="button"
                  onClick={() => setRegOtpCode(regDevOtp)}
                  className="underline text-[11px] font-semibold text-emerald-900"
                >
                  Auto-fill
                </button>
              </div>
            )}

            {regOtpSent && !regOtpVerified && (
              <div className="flex items-center gap-2 pt-1">
                <input
                  type="text"
                  maxLength={6}
                  value={regOtpCode}
                  onChange={(e) => setRegOtpCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="Enter 6-digit OTP"
                  className="w-40 px-3 py-1.5 font-mono text-sm tracking-widest text-center bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-forest-600"
                />
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={handleVerifyRegOtp}
                  isLoading={regOtpLoading}
                >
                  Verify Code
                </Button>
              </div>
            )}

            {regOtpVerified && (
              <div className="text-xs font-semibold text-emerald-700 flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                Phone number verified successfully!
              </div>
            )}
          </div>

          {/* Farm Details */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1.5">
                Crop Type *
              </label>
              <select
                value={cropType}
                onChange={(e) => setCropType(e.target.value)}
                className="w-full px-3.5 py-2 text-sm bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-forest-600"
              >
                {CROPS.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <Input
                label="Land Area (Acres) *"
                type="number"
                step="0.1"
                min="0.1"
                value={landArea}
                onChange={(e) => setLandArea(e.target.value)}
                placeholder="e.g. 2.5"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1.5">
                Water Source *
              </label>
              <select
                value={waterSource}
                onChange={(e) => setWaterSource(e.target.value)}
                className="w-full px-3.5 py-2 text-sm bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-forest-600"
              >
                {WATER_SOURCES.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Gram Panchayat"
              value={gramPanchayat}
              onChange={(e) => setGramPanchayat(e.target.value)}
              placeholder="e.g. Tenali Gram Panchayat"
            />
            <Input
              label="Address / Landmark"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="e.g. Near Ramalayam, Main Road"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Call Window Start (IST)"
              type="time"
              value={callWindowStart}
              onChange={(e) => setCallWindowStart(e.target.value)}
            />
            <Input
              label="Call Window End (IST)"
              type="time"
              value={callWindowEnd}
              onChange={(e) => setCallWindowEnd(e.target.value)}
            />
          </div>

          <div className="bg-gray-50 p-4 rounded-xl border border-gray-200/80 space-y-2">
            <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wider">Communication Consents</h4>
            <div className="flex items-center space-x-6 text-sm text-gray-700">
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={voiceConsent}
                  onChange={(e) => setVoiceConsent(e.target.checked)}
                  className="rounded text-forest-700 focus:ring-forest-600 w-4 h-4"
                />
                <span>Telugu Voice Calls Consent</span>
              </label>
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={smsConsent}
                  onChange={(e) => setSmsConsent(e.target.checked)}
                  className="rounded text-forest-700 focus:ring-forest-600 w-4 h-4"
                />
                <span>SMS Alert Consent</span>
              </label>
            </div>
            <p className="text-[11px] text-gray-400">
              Calls will strictly honor the call window and can be opted out at any time.
            </p>
          </div>

          <div className="flex justify-end space-x-3 pt-3">
            <Button variant="outline" type="button" onClick={() => setIsRegisterOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" isLoading={createMutation.isPending}>
              Register Farmer
            </Button>
          </div>
        </form>
      </Modal>

      {/* Edit Farmer Modal */}
      <Modal
        isOpen={isEditOpen}
        onClose={() => { setIsEditOpen(false); setEditingFarmer(null); }}
        title={`Edit Farmer Profile: ${editingFarmer?.farmer_code || ''}`}
        maxWidth="lg"
      >
        <form onSubmit={handleEditSubmit} className="space-y-4">
          {editFormError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-center gap-1.5">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
              <span>{editFormError}</span>
            </div>
          )}

          {isPhoneChangedInEdit && (
            <div className="p-3 bg-amber-50 border border-amber-300 rounded-lg text-xs text-amber-800 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-amber-600 mt-0.5" />
              <div>
                <strong>Notice:</strong> Changing the phone number will automatically reset the farmer's phone verification status to <strong>Unverified</strong>. An OTP re-verification will be required before automated calls can be dispatched.
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Full Name *"
              value={editFullName}
              onChange={(e) => setEditFullName(e.target.value)}
              placeholder="e.g. K. Venkateswara Rao"
              required
            />

            <div>
              <VillageAutocomplete
                label="Village *"
                value={editVillageId}
                onChange={(vId) => setEditVillageId(vId)}
                villages={villages}
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Primary Phone Number *"
              value={editPhone}
              onChange={(e) => setEditPhone(e.target.value)}
              placeholder="e.g. 9848022338"
              required
            />
            <Input
              label="Gram Panchayat"
              value={editGramPanchayat}
              onChange={(e) => setEditGramPanchayat(e.target.value)}
              placeholder="e.g. Tenali Gram Panchayat"
            />
          </div>

          {/* Farm Specs */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1.5">
                Crop Type
              </label>
              <select
                value={editCropType}
                onChange={(e) => setEditCropType(e.target.value)}
                className="w-full px-3.5 py-2 text-sm bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-forest-600"
              >
                {CROPS.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <Input
                label="Land Area (Acres)"
                type="number"
                step="0.1"
                min="0.1"
                value={editLandArea}
                onChange={(e) => setEditLandArea(e.target.value)}
                placeholder="e.g. 2.5"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1.5">
                Water Source
              </label>
              <select
                value={editWaterSource}
                onChange={(e) => setEditWaterSource(e.target.value)}
                className="w-full px-3.5 py-2 text-sm bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-forest-600"
              >
                {WATER_SOURCES.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <Input
            label="Address / Landmark"
            value={editAddress}
            onChange={(e) => setEditAddress(e.target.value)}
            placeholder="e.g. Near Ramalayam, Main Road"
          />

          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Call Window Start (IST)"
              type="time"
              value={editCallWindowStart}
              onChange={(e) => setEditCallWindowStart(e.target.value)}
            />
            <Input
              label="Call Window End (IST)"
              type="time"
              value={editCallWindowEnd}
              onChange={(e) => setEditCallWindowEnd(e.target.value)}
            />
          </div>

          <div className="flex justify-end space-x-3 pt-3">
            <Button
              variant="outline"
              type="button"
              onClick={() => { setIsEditOpen(false); setEditingFarmer(null); }}
            >
              Cancel
            </Button>
            <Button variant="primary" type="submit" isLoading={editMutation.isPending}>
              Save Changes
            </Button>
          </div>
        </form>
      </Modal>

      {/* Standalone OTP Verification Modal */}
      <Modal
        isOpen={isVerifyModalOpen}
        onClose={() => { setIsVerifyModalOpen(false); setVerifyingFarmer(null); }}
        title="Verify Farmer Phone Number"
        maxWidth="md"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Verify the phone number for <strong>{verifyingFarmer?.full_name}</strong> (<span className="font-mono">{verifyingFarmer?.primary_phone}</span>).
          </p>

          <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200">
            <span className="text-xs font-semibold text-gray-700">Delivery Channel:</span>
            <button
              type="button"
              onClick={() => setVOtpMode(vOtpMode === 'simulation' ? 'live' : 'simulation')}
              className={`px-2.5 py-1 rounded text-xs font-semibold border ${
                vOtpMode === 'live'
                  ? 'bg-amber-100 text-amber-800 border-amber-300'
                  : 'bg-blue-100 text-blue-800 border-blue-300'
              }`}
            >
              {vOtpMode === 'live' ? '📞 Live SMS (Twilio)' : '🎮 Simulation Mode'}
            </button>
          </div>

          {vOtpError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-center gap-1.5">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
              <span>{vOtpError}</span>
            </div>
          )}

          {vDevOtp && (
            <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-800 flex items-center justify-between">
              <span>Demo OTP: <strong className="font-mono text-base tracking-widest">{vDevOtp}</strong></span>
              <button
                type="button"
                onClick={() => setVOtpCode(vDevOtp)}
                className="underline text-[11px] font-bold text-emerald-900"
              >
                Auto-fill
              </button>
            </div>
          )}

          {!vOtpSent ? (
            <Button
              variant="primary"
              className="w-full"
              onClick={handleSendVOtp}
              isLoading={vOtpLoading}
            >
              <Send className="w-4 h-4 mr-1.5" />
              Send 6-Digit OTP Code
            </Button>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1.5">
                  Enter 6-Digit OTP Code
                </label>
                <input
                  type="text"
                  maxLength={6}
                  value={vOtpCode}
                  onChange={(e) => setVOtpCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="------"
                  className="w-full px-4 py-2 text-center font-mono text-xl tracking-widest bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-forest-600"
                />
              </div>

              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  disabled={vOtpTimer > 0 || vOtpLoading}
                  onClick={handleSendVOtp}
                  className="text-xs text-forest-700 hover:text-forest-800 font-semibold disabled:text-gray-400"
                >
                  {vOtpTimer > 0 ? `Resend OTP in ${vOtpTimer}s` : 'Resend OTP'}
                </button>
                <Button
                  variant="primary"
                  onClick={handleVerifyVOtp}
                  isLoading={vOtpLoading}
                  disabled={vOtpCode.length !== 6}
                >
                  Confirm & Verify
                </Button>
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* CSV Bulk Import Modal */}
      <Modal isOpen={isImportOpen} onClose={() => setIsImportOpen(false)} title="Bulk Import Farmers (CSV)" maxWidth="xl">
        <div className="space-y-4">
          <p className="text-xs text-gray-500">
            Paste CSV data containing <code className="bg-gray-100 px-1 py-0.5 rounded font-mono">full_name,village_name,phone,gram_panchayat</code>.
            Validation will run on every row before import.
          </p>

          <textarea
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            rows={5}
            className="w-full p-3 font-mono text-xs bg-gray-50 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-forest-600"
          />

          <div className="flex items-center space-x-3">
            <Button variant="secondary" size="sm" onClick={handleCsvDryRun}>
              Run Dry-Run Preview
            </Button>
          </div>

          {importResult && (
            <div className="bg-gray-50 p-4 rounded-xl border border-gray-200 text-xs space-y-3">
              <div className="flex items-center space-x-4 font-semibold">
                <span className="text-emerald-700 flex items-center gap-1">
                  <CheckCircle2 className="w-4 h-4" /> {importResult.validCount} Valid Rows
                </span>
                {importResult.errorCount > 0 && (
                  <span className="text-red-600 flex items-center gap-1">
                    <XCircle className="w-4 h-4" /> {importResult.errorCount} Errors Detected
                  </span>
                )}
              </div>

              {importResult.errors?.length > 0 && (
                <div className="bg-red-50 p-2.5 rounded-lg border border-red-200 text-red-700 space-y-1">
                  {importResult.errors.map((err: any, idx: number) => (
                    <div key={idx}>Row {err.row}: {err.message}</div>
                  ))}
                </div>
              )}

              {importResult.preview?.length > 0 && (
                <div className="space-y-1">
                  <span className="font-semibold text-gray-700">Preview:</span>
                  <div className="max-h-32 overflow-y-auto divide-y divide-gray-200 border rounded-lg bg-white p-2">
                    {importResult.preview.map((p: any, idx: number) => (
                      <div key={idx} className="py-1 flex justify-between">
                        <span className="font-medium text-gray-900">{p.full_name} ({p.village_name})</span>
                        <span className="font-mono text-gray-500">{p.phone}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {importResult.validCount > 0 && (
                <div className="pt-2 flex justify-end">
                  <Button variant="primary" size="sm" onClick={handleCsvExecute}>
                    Confirm & Import {importResult.validCount} Farmers
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
};
