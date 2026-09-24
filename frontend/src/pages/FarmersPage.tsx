import React, { useState } from 'react';
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
  Filter,
} from 'lucide-react';
import { Card } from '../components/ui/Card.js';
import { Button } from '../components/ui/Button.js';
import { Input } from '../components/ui/Input.js';
import { Badge } from '../components/ui/Badge.js';
import { Modal } from '../components/ui/Modal.js';

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

  // Form State
  const [fullName, setFullName] = useState('');
  const [villageId, setVillageId] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [gramPanchayat, setGramPanchayat] = useState('');
  const [callWindowStart, setCallWindowStart] = useState('09:00:00');
  const [callWindowEnd, setCallWindowEnd] = useState('18:00:00');
  const [voiceConsent, setVoiceConsent] = useState(true);
  const [smsConsent, setSmsConsent] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);

  // CSV Import State
  const [csvText, setCsvText] = useState(
    'full_name,village_name,phone,gram_panchayat\n' +
    'Ramesh Reddy,Guntur Rural,9848011223,Guntur GP\n' +
    'Siva Prasad,Tenali North,9848033445,Tenali GP'
  );
  const [importResult, setImportResult] = useState<any | null>(null);

  // Queries
  const { data: villages } = useQuery<any[]>({
    queryKey: ['villages'],
    queryFn: () => apiRequest<any[]>('/reference/villages'),
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['farmers'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-kpis'] });
      setIsRegisterOpen(false);
      resetForm();
    },
    onError: (err: any) => {
      setFormError(err.message || 'Failed to create farmer.');
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

  const resetForm = () => {
    setFullName('');
    setVillageId('');
    setPhone('');
    setAddress('');
    setGramPanchayat('');
    setCallWindowStart('09:00:00');
    setCallWindowEnd('18:00:00');
    setVoiceConsent(true);
    setSmsConsent(true);
    setFormError(null);
  };

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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Farmer Directory</h1>
          <p className="text-sm text-gray-500 mt-1">
            Manage smallholder farmer profiles, verified contact details, and communication consents.
          </p>
        </div>
        {canManage && (
          <div className="flex items-center space-x-3">
            <Button variant="outline" size="md" onClick={() => setIsImportOpen(true)}>
              <Upload className="w-4 h-4 mr-2" />
              Import CSV
            </Button>
            <Button variant="primary" size="md" onClick={() => setIsRegisterOpen(true)}>
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
                  <th className="pb-3">Plots</th>
                  <th className="pb-3">Status</th>
                  <th className="pb-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {farmers.map((f) => (
                  <tr key={f.id} className="hover:bg-gray-50/50">
                    <td className="py-3 font-mono text-xs font-bold text-forest-800">{f.farmer_code}</td>
                    <td className="py-3 font-medium text-gray-900">{f.full_name}</td>
                    <td className="py-3 text-gray-600">
                      {f.village_name} <span className="text-xs text-gray-400">({f.mandal})</span>
                    </td>
                    <td className="py-3 font-mono text-xs text-gray-600">
                      {f.primary_phone || <span className="text-gray-300 italic">No phone</span>}
                    </td>
                    <td className="py-3 text-gray-600">{f.active_plots_count} plots</td>
                    <td className="py-3">
                      <Badge variant={f.status === 'active' ? 'success' : 'neutral'} size="sm">
                        {f.status}
                      </Badge>
                    </td>
                    <td className="py-3 text-right space-x-2">
                      <Link to={`/farmers/${f.id}`}>
                        <Button variant="outline" size="sm">
                          <Eye className="w-3.5 h-3.5 mr-1" />
                          View
                        </Button>
                      </Link>
                      {canManage && (
                        <Button
                          variant={f.status === 'active' ? 'outline' : 'secondary'}
                          size="sm"
                          onClick={() => toggleStatusMutation.mutate({ id: f.id, currentStatus: f.status })}
                        >
                          {f.status === 'active' ? 'Deactivate' : 'Reactivate'}
                        </Button>
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
              <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1.5">
                Village *
              </label>
              <select
                value={villageId}
                onChange={(e) => setVillageId(e.target.value)}
                required
                className="w-full px-3.5 py-2 text-sm bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-forest-600"
              >
                <option value="">Select Village</option>
                {villages?.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} ({v.mandal}, {v.district})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Phone Number (10 digits) *"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="e.g. 9848022338"
              required
            />
            <Input
              label="Gram Panchayat"
              value={gramPanchayat}
              onChange={(e) => setGramPanchayat(e.target.value)}
              placeholder="e.g. Tenali Gram Panchayat"
            />
          </div>

          <Input
            label="Address / Landmark"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="e.g. Near Ramalayam, Main Road"
          />

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
