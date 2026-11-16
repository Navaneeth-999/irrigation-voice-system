import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { apiRequest } from '../api/client.js';
import { useAuth } from '../lib/auth.js';
import {
  Award,
  Download,
  ExternalLink,
  ShieldCheck,
  ShieldAlert,
  Search,
  Calendar,
  AlertTriangle,
  Hash,
  XCircle,
  CheckCircle2,
  Eye,
  RefreshCw,
  Lock,
  History,
  User,
  ArrowRight,
  Filter,
} from 'lucide-react';
import { Card } from '../components/ui/Card.js';
import { Button } from '../components/ui/Button.js';
import { Badge } from '../components/ui/Badge.js';
import { Input } from '../components/ui/Input.js';
import { Modal } from '../components/ui/Modal.js';
import { APP_NAME, APP_NAME_TE } from '../config/branding.js';

interface CertificateListItem {
  id: string;
  certificateCode: string;
  version?: number;
  seasonId: string;
  farmerId: string;
  farmerName: string;
  farmerCode: string;
  villageName: string;
  cropName: string;
  cropNameTe?: string;
  seasonCode: string;
  seasonYear: number;
  seasonType: string;
  status?: 'active' | 'sealed' | 'revoked';
  waterUseRatio: number | null;
  waterUseRatioBand: 'below_estimate' | 'near_estimate' | 'above_estimate';
  confidenceScore: number;
  confidenceBand: 'low' | 'medium' | 'high';
  sha256Hash: string;
  isRevoked: boolean;
  revocationReason?: string;
  sealedAt?: string;
  sealedReason?: string;
  actualHarvestDate: string;
  createdAt: string;
}

export const CertificatesPage: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const farmerIdParam = searchParams.get('farmerId') || '';
  const [selectedFarmerId, setSelectedFarmerId] = useState<string>(farmerIdParam);
  const [search, setSearch] = useState('');
  const [selectedCert, setSelectedCert] = useState<CertificateListItem | null>(null);
  const [isRevokeModalOpen, setIsRevokeModalOpen] = useState(false);
  const [revokeReason, setRevokeReason] = useState('');

  // Seal Certificate Modal State
  const [isSealModalOpen, setIsSealModalOpen] = useState(false);
  const [sealReason, setSealReason] = useState('');
  const [selectedCertForSeal, setSelectedCertForSeal] = useState<CertificateListItem | null>(null);

  // Status History Modal State
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [selectedCertForHistory, setSelectedCertForHistory] = useState<CertificateListItem | null>(null);

  const [previewCert, setPreviewCert] = useState<CertificateListItem | null>(null);
  const [isPreviewModalOpen, setIsPreviewModalOpen] = useState(false);
  const [regenerateSuccess, setRegenerateSuccess] = useState<string | null>(null);

  // Sync selectedFarmerId with searchParams
  useEffect(() => {
    if (farmerIdParam) {
      setSelectedFarmerId(farmerIdParam);
    }
  }, [farmerIdParam]);

  // Fetch authorized farmers list for dropdown filter
  const { data: farmersData } = useQuery<any>({
    queryKey: ['authorized-farmers'],
    queryFn: () => apiRequest<any>('/farmers?limit=200'),
  });
  const farmers: any[] = (Array.isArray(farmersData) ? farmersData : farmersData?.data) || [];

  // Fetch certificates (filtered by farmerId if selected)
  const certsQueryUrl = selectedFarmerId
    ? `/certificates?farmerId=${selectedFarmerId}&limit=50`
    : '/certificates?limit=50';

  const { data, isLoading } = useQuery<{ success: boolean; data: CertificateListItem[]; total: number }>({
    queryKey: ['certificates', selectedFarmerId],
    queryFn: () => apiRequest<{ success: boolean; data: CertificateListItem[]; total: number }>(certsQueryUrl),
  });

  // Fetch history for selected certificate
  const { data: historyData, isLoading: isLoadingHistory } = useQuery<any>({
    queryKey: ['certificate-history', selectedCertForHistory?.id],
    queryFn: () => apiRequest<any>(`/certificates/${selectedCertForHistory?.id}/history`),
    enabled: Boolean(isHistoryModalOpen && selectedCertForHistory?.id),
  });
  const statusHistory: any[] = (Array.isArray(historyData) ? historyData : historyData?.data) || [];

  const regenerateMutation = useMutation({
    mutationFn: (certId: string) =>
      apiRequest<{ success: boolean; data: any }>(`/certificates/${certId}/regenerate`, {
        method: 'POST',
      }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['certificates'] });
      setRegenerateSuccess(`Certificate PDF regenerated as v${res.data?.version || 2} successfully!`);
      if (previewCert && previewCert.id === res.data?.id) {
        setPreviewCert(res.data);
      }
      setTimeout(() => setRegenerateSuccess(null), 4000);
    },
  });

  const sealMutation = useMutation({
    mutationFn: ({ certId, reason }: { certId: string; reason: string }) =>
      apiRequest(`/certificates/${certId}/seal`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['certificates'] });
      setIsSealModalOpen(false);
      setSealReason('');
      setSelectedCertForSeal(null);
    },
    onError: (err: any) => {
      alert(err.message || 'Failed to seal certificate.');
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (certId: string) =>
      apiRequest(`/certificates/${certId}/revoke`, {
        method: 'POST',
        body: JSON.stringify({ reason: revokeReason }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['certificates'] });
      setIsRevokeModalOpen(false);
      setRevokeReason('');
      setSelectedCert(null);
    },
    onError: (err: any) => {
      alert(err.message || 'Failed to revoke certificate.');
    },
  });

  const certificates: any[] = (Array.isArray(data) ? data : (data as any)?.data) || [];
  const filtered: any[] = certificates.filter((c: any) =>
    (c.farmerName || '').toLowerCase().includes(search.toLowerCase()) ||
    (c.certificateCode || '').toLowerCase().includes(search.toLowerCase()) ||
    (c.villageName || '').toLowerCase().includes(search.toLowerCase())
  );

  const selectedFarmer = farmers.find((f: any) => f.id === selectedFarmerId);

  const totalCerts = certificates.length;
  const highConfidenceCount = certificates.filter((c: any) => c.confidenceScore >= 70).length;
  const nearTargetCount = certificates.filter((c: any) => c.waterUseRatioBand === 'near_estimate').length;

  const handleFarmerFilterChange = (id: string) => {
    setSelectedFarmerId(id);
    if (id) {
      setSearchParams({ farmerId: id });
    } else {
      setSearchParams({});
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Award className="w-7 h-7 text-forest-600" />
            <span>Conservation Certificates (నీటి పరిరక్షణ ధృవీకరణ పత్రాలు)</span>
          </h1>
          <p className="text-sm text-gray-600 mt-1">
            Official seasonal water conservation certificates, with lifecycle management (Active, Sealed, Revoked) and cryptographic SHA-256 integrity.
          </p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="p-4 bg-white border border-gray-200">
          <span className="text-xs text-gray-500 block">Total Certificates Issued</span>
          <span className="text-2xl font-bold text-gray-900">{totalCerts}</span>
          <span className="text-xs text-forest-600 block mt-1">Managed across seasons</span>
        </Card>

        <Card className="p-4 bg-white border border-gray-200">
          <span className="text-xs text-gray-500 block">High Data Confidence (≥70%)</span>
          <span className="text-2xl font-bold text-emerald-700">
            {totalCerts > 0 ? `${Math.round((highConfidenceCount / totalCerts) * 100)}%` : '0%'}
          </span>
          <span className="text-xs text-gray-500 block mt-1">{highConfidenceCount} certificates eligible</span>
        </Card>

        <Card className="p-4 bg-white border border-gray-200">
          <span className="text-xs text-gray-500 block">Near Agronomic Target Band</span>
          <span className="text-2xl font-bold text-water-700">
            {totalCerts > 0 ? `${Math.round((nearTargetCount / totalCerts) * 100)}%` : '0%'}
          </span>
          <span className="text-xs text-gray-500 block mt-1">{nearTargetCount} within target WUR</span>
        </Card>
      </div>

      {/* Search and Farmer Filter */}
      <Card className="p-4 bg-white border border-gray-200">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 mb-4">
          {/* Farmer Selector */}
          <div className="flex-1 max-w-sm">
            <label className="block text-[11px] font-semibold text-gray-500 uppercase mb-1 flex items-center gap-1">
              <Filter className="w-3 h-3 text-forest-700" /> Filter by Authorized Farmer
            </label>
            <select
              value={selectedFarmerId}
              onChange={(e) => handleFarmerFilterChange(e.target.value)}
              className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-forest-500"
            >
              <option value="">All Permitted Farmers ({farmers.length})</option>
              {farmers.map((f: any) => (
                <option key={f.id} value={f.id}>
                  {f.full_name} ({f.farmer_code}) - {f.village_name}
                </option>
              ))}
            </select>
          </div>

          {/* Text Search */}
          <div className="flex-1 max-w-md pt-0 sm:pt-4">
            <div className="relative">
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-3" />
              <input
                type="text"
                placeholder="Search by farmer name, village, or certificate code..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-forest-500"
              />
            </div>
          </div>

          {selectedFarmerId && (
            <div className="pt-0 sm:pt-4">
              <Button variant="outline" size="sm" onClick={() => handleFarmerFilterChange('')}>
                Clear Filter
              </Button>
            </div>
          )}
        </div>

        {/* Selected Farmer Info / Incomplete State */}
        {selectedFarmer && (
          <div className="mb-4 p-3 bg-forest-50/70 border border-forest-200 rounded-xl flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-forest-100 flex items-center justify-center font-bold text-forest-800 text-sm">
                {selectedFarmer.full_name?.slice(0, 2).toUpperCase()}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-forest-950 text-sm">{selectedFarmer.full_name}</span>
                  <span className="font-mono text-xs bg-white px-2 py-0.5 rounded border border-forest-200 text-forest-800">
                    {selectedFarmer.farmer_code}
                  </span>
                  <Badge variant={selectedFarmer.status === 'active' ? 'success' : 'neutral'}>
                    {selectedFarmer.status}
                  </Badge>
                </div>
                <p className="text-xs text-forest-800 mt-0.5">
                  Village: {selectedFarmer.village_name} • Phone: {selectedFarmer.primary_phone || 'N/A'}
                </p>
              </div>
            </div>
            <Link
              to={`/farmers/${selectedFarmer.id}`}
              className="text-xs font-semibold text-forest-700 hover:text-forest-800 hover:underline flex items-center gap-1"
            >
              <span>Open Farmer Profile</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        )}

        {isLoading ? (
          <div className="py-12 text-center text-gray-500">
            <div className="animate-spin w-8 h-8 border-4 border-forest-600 border-t-transparent rounded-full mx-auto mb-2" />
            <p>Loading certificates...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center text-gray-500">
            <Award className="w-12 h-12 text-gray-300 mx-auto mb-2" />
            {selectedFarmer ? (
              <div className="space-y-2 max-w-md mx-auto">
                <p className="font-semibold text-gray-800 text-base">
                  No certificates have been issued for {selectedFarmer.full_name} yet.
                </p>
                <p className="text-xs text-gray-500 leading-relaxed">
                  Conservation certificates require a completed seasonal monitoring cycle (minimum 50% call coverage, verified irrigation records, and data confidence score &ge; 50). To issue a certificate, navigate to this farmer&apos;s completed season in the Season Management workflow.
                </p>
                <div className="pt-2">
                  <Link
                    to={`/farmers/${selectedFarmer.id}`}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-forest-50 text-forest-700 border border-forest-200 rounded-lg text-xs font-semibold hover:bg-forest-100"
                  >
                    <User className="w-3.5 h-3.5" /> View Farmer Seasons in Profile
                  </Link>
                </div>
              </div>
            ) : (
              <div>
                <p className="font-semibold">No conservation certificates found</p>
                <p className="text-xs text-gray-400 mt-1">
                  Certificates are generated when eligible active seasons are marked complete in Season Management.
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-gray-600 text-xs uppercase border-b border-gray-200">
                <tr>
                  <th className="py-3 px-3">Certificate Code</th>
                  <th className="py-3 px-3">Farmer & Village</th>
                  <th className="py-3 px-3">Crop & Season</th>
                  <th className="py-3 px-3">WUR Band</th>
                  <th className="py-3 px-3">Data Confidence</th>
                  <th className="py-3 px-3">Status</th>
                  <th className="py-3 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {filtered.map((cert: any) => {
                  const isRevoked = cert.isRevoked || cert.status === 'revoked';
                  const isSealed = cert.status === 'sealed';

                  return (
                    <tr key={cert.id} className="hover:bg-gray-50/80 transition-colors">
                      <td className="py-3 px-3 font-mono font-medium text-forest-800">
                        <div className="flex items-center gap-1.5">
                          <span>{cert.certificateCode}</span>
                          <span className="text-[10px] font-semibold text-emerald-800 bg-emerald-100 px-1.5 py-0.5 rounded">
                            v{cert.version || 1}
                          </span>
                        </div>
                        <div className="text-[10px] text-gray-400 truncate max-w-[120px]">
                          {cert.sha256Hash?.substring(0, 16)}...
                        </div>
                      </td>

                      <td className="py-3 px-3">
                        <Link
                          to={`/farmers/${cert.farmerId}`}
                          className="font-semibold text-gray-900 hover:text-forest-700 hover:underline block"
                          title="Open Farmer Profile"
                        >
                          {cert.farmerName}
                        </Link>
                        <div className="text-xs text-gray-500">{cert.villageName}</div>
                      </td>

                      <td className="py-3 px-3">
                        <div className="text-gray-900">{cert.cropName}</div>
                        <div className="text-xs text-gray-500 capitalize">{cert.seasonType} {cert.seasonYear}</div>
                      </td>

                      <td className="py-3 px-3">
                        <Badge variant={cert.waterUseRatioBand === 'near_estimate' ? 'success' : 'warning'}>
                          {cert.waterUseRatioBand.toUpperCase()}
                        </Badge>
                        <div className="text-[11px] text-gray-500 mt-0.5">Ratio: {cert.waterUseRatio != null ? cert.waterUseRatio : 'N/A'}</div>
                      </td>

                      <td className="py-3 px-3">
                        <div className="font-semibold text-gray-900">{Math.round(cert.confidenceScore)}/100</div>
                        <div className="text-xs text-gray-500 capitalize">{cert.confidenceBand}</div>
                      </td>

                      <td className="py-3 px-3">
                        {isRevoked ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-red-100 text-red-800 border border-red-200">
                            <XCircle className="w-3 h-3" /> REVOKED
                          </span>
                        ) : isSealed ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-purple-100 text-purple-800 border border-purple-200" title={`Sealed: ${cert.sealedReason || 'Official accreditation sealed'}`}>
                            <Lock className="w-3 h-3" /> SEALED
                          </span>
                        ) : (
                          <Badge variant="success">ACTIVE</Badge>
                        )}
                      </td>

                      <td className="py-3 px-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* Status History */}
                          <button
                            onClick={() => {
                              setSelectedCertForHistory(cert);
                              setIsHistoryModalOpen(true);
                            }}
                            className="p-1.5 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                            title="View Certificate Status History"
                          >
                            <History className="w-4 h-4" />
                          </button>

                          {/* Preview Certificate */}
                          <button
                            onClick={() => {
                              setPreviewCert(cert);
                              setIsPreviewModalOpen(true);
                            }}
                            className="p-1.5 text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors"
                            title="Preview Certificate (On-screen)"
                          >
                            <Eye className="w-4 h-4" />
                          </button>

                          {/* Regenerate PDF (Admin Only) */}
                          {isAdmin && !isRevoked && (
                            <button
                              onClick={() => {
                                if (window.confirm(`Regenerate PDF for certificate ${cert.certificateCode}? This updates the PDF layout with active fonts while preserving certificate code and issue date.`)) {
                                  regenerateMutation.mutate(cert.id);
                                }
                              }}
                              disabled={regenerateMutation.isPending}
                              className="p-1.5 text-amber-700 hover:bg-amber-50 rounded-lg transition-colors"
                              title="Regenerate Certificate PDF (Preserves data, increments version)"
                            >
                              <RefreshCw className={`w-4 h-4 ${regenerateMutation.isPending ? 'animate-spin' : ''}`} />
                            </button>
                          )}

                          {/* Seal Certificate (Admin Only, if Active) */}
                          {isAdmin && !isRevoked && !isSealed && (
                            <button
                              onClick={() => {
                                setSelectedCertForSeal(cert);
                                setSealReason('');
                                setIsSealModalOpen(true);
                              }}
                              className="p-1.5 text-purple-700 hover:bg-purple-50 rounded-lg transition-colors"
                              title="Seal Certificate (Admin Only - Freezes edits)"
                            >
                              <Lock className="w-4 h-4" />
                            </button>
                          )}

                          {/* Download PDF */}
                          <a
                            href={`/api/v1/certificates/${cert.id}/pdf`}
                            target="_blank"
                            rel="noreferrer"
                            className="p-1.5 text-forest-700 hover:bg-forest-50 rounded-lg transition-colors"
                            title="Download PDF Certificate"
                          >
                            <Download className="w-4 h-4" />
                          </a>

                          {/* Public Verification */}
                          <Link
                            to={`/verify/${cert.certificateCode}`}
                            target="_blank"
                            className="p-1.5 text-blue-700 hover:bg-blue-50 rounded-lg transition-colors"
                            title="Open Public Verification Link"
                          >
                            <ExternalLink className="w-4 h-4" />
                          </Link>

                          {/* Revoke (Admin Only) */}
                          {isAdmin && !isRevoked && (
                            <button
                              onClick={() => {
                                setSelectedCert(cert);
                                setIsRevokeModalOpen(true);
                              }}
                              className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                              title="Revoke Certificate"
                            >
                              <XCircle className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Seal Certificate Modal */}
      {isSealModalOpen && selectedCertForSeal && (
        <Modal
          isOpen={isSealModalOpen}
          onClose={() => setIsSealModalOpen(false)}
          title={`Seal Certificate - ${selectedCertForSeal.certificateCode}`}
        >
          <div className="space-y-4">
            <div className="p-3 bg-purple-50 border border-purple-200 rounded-lg text-xs text-purple-900">
              <strong>Official Accreditation Action:</strong> Sealing this certificate locks all seasonal water metrics, confirms accreditation verification, and freezes future revisions.
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Reason / Accreditation Note *
              </label>
              <textarea
                value={sealReason}
                onChange={(e) => setSealReason(e.target.value)}
                placeholder="e.g. Field verification complete; water savings criteria verified and approved by CSP agronomist."
                className="w-full p-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:outline-none"
                rows={3}
                required
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setIsSealModalOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={() =>
                  sealMutation.mutate({
                    certId: selectedCertForSeal.id,
                    reason: sealReason,
                  })
                }
                disabled={!sealReason.trim() || sealMutation.isPending}
              >
                {sealMutation.isPending ? 'Sealing...' : 'Confirm & Seal Certificate'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Revoke Certificate Modal */}
      {isRevokeModalOpen && selectedCert && (
        <Modal
          isOpen={isRevokeModalOpen}
          onClose={() => setIsRevokeModalOpen(false)}
          title={`Revoke Certificate - ${selectedCert.certificateCode}`}
        >
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Revoking this certificate marks it as invalid on the public verification registry. This action is recorded in the status audit log.
            </p>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Reason for Revocation *
              </label>
              <textarea
                value={revokeReason}
                onChange={(e) => setRevokeReason(e.target.value)}
                placeholder="e.g. Field audit found discrepancy in reported pump discharge rates..."
                className="w-full p-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:outline-none"
                rows={3}
                required
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setIsRevokeModalOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={() => revokeMutation.mutate(selectedCert.id)}
                disabled={!revokeReason.trim() || revokeMutation.isPending}
              >
                {revokeMutation.isPending ? 'Revoking...' : 'Confirm Revocation'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Status History Modal */}
      {isHistoryModalOpen && selectedCertForHistory && (
        <Modal
          isOpen={isHistoryModalOpen}
          onClose={() => setIsHistoryModalOpen(false)}
          title={`Certificate Status History - ${selectedCertForHistory.certificateCode}`}
          maxWidth="lg"
        >
          <div className="space-y-4">
            <p className="text-xs text-gray-500">
              Audit log of all lifecycle transitions (issuance, sealing, revocation) for this certificate.
            </p>

            {isLoadingHistory ? (
              <div className="py-6 text-center text-xs text-gray-400">Loading history...</div>
            ) : statusHistory.length === 0 ? (
              <div className="py-6 text-center text-xs text-gray-400">No status transitions recorded.</div>
            ) : (
              <div className="space-y-3">
                {statusHistory.map((item: any) => (
                  <div key={item.id} className="p-3 bg-gray-50 rounded-xl border border-gray-200 text-xs">
                    <div className="flex justify-between items-center pb-1 border-b border-gray-200">
                      <div className="flex items-center gap-2">
                        <span className="font-bold uppercase text-gray-800">
                          {item.oldStatus ? `${item.oldStatus} ➔ ${item.newStatus}` : item.newStatus}
                        </span>
                        <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded bg-white border border-gray-300 text-gray-700">
                          {item.newStatus}
                        </span>
                      </div>
                      <span className="text-[11px] text-gray-400">
                        {new Date(item.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <div className="pt-2 text-gray-600 space-y-1">
                      <p>
                        <strong>User:</strong> {item.userName || item.userId || 'System'}
                      </p>
                      {item.reason && (
                        <p className="text-gray-800 font-medium">
                          <strong>Reason:</strong> {item.reason}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* Preview Certificate Modal */}
      {isPreviewModalOpen && previewCert && (
        <Modal
          isOpen={isPreviewModalOpen}
          onClose={() => setIsPreviewModalOpen(false)}
          title={`Certificate Preview - ${previewCert.certificateCode} (v${previewCert.version || 1})`}
        >
          <div className="space-y-4 max-h-[80vh] overflow-y-auto pr-1">
            {regenerateSuccess && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm rounded-lg flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{regenerateSuccess}</span>
              </div>
            )}

            {/* Certificate On-Screen Card Preview */}
            <div className="border-4 border-double border-emerald-700 bg-gradient-to-b from-stone-50 to-white p-6 rounded-xl shadow-inner relative text-gray-800">
              {/* Header */}
              <div className="text-center pb-4 border-b border-emerald-300">
                <div className="text-xs uppercase tracking-widest text-emerald-900 font-bold">
                  {APP_NAME_TE} • {APP_NAME}
                </div>
                <h2 className="text-xl font-serif font-bold text-emerald-950 mt-1">
                  నీటి పరిరక్షణ ప్రశంసా పత్రం
                </h2>
                <div className="text-xs font-semibold text-emerald-800 uppercase tracking-wide">
                  Commendation of Seasonal Water Conservation
                </div>
                <div className="mt-2 inline-flex items-center gap-2 bg-emerald-100 text-emerald-900 px-3 py-1 rounded-full text-xs font-mono font-bold">
                  <span>{previewCert.certificateCode}</span>
                  <span className="text-[10px] bg-emerald-800 text-white px-1.5 py-0.5 rounded">
                    Active Version: v{previewCert.version || 1}
                  </span>
                </div>
              </div>

              {/* Status Banner */}
              <div className="my-3 text-center">
                {previewCert.isRevoked ? (
                  <span className="inline-block px-3 py-1 bg-red-100 text-red-800 text-xs font-bold rounded-full border border-red-300">
                    ⚠️ రద్దు చేయబడింది / REVOKED: {previewCert.revocationReason || 'Invalidated'}
                  </span>
                ) : previewCert.status === 'sealed' ? (
                  <span className="inline-block px-3 py-1 bg-purple-100 text-purple-900 text-xs font-bold rounded-full border border-purple-300">
                    🔒 ధృవీకరించబడింది & సీల్ చేయబడింది / SEALED & ACCREDITED
                  </span>
                ) : (
                  <span className="inline-block px-3 py-1 bg-emerald-100 text-emerald-800 text-xs font-bold rounded-full border border-emerald-300">
                    ✓ ప్రాథమికంగా జారీ చేయబడింది / ACTIVE (ISSUED)
                  </span>
                )}
              </div>

              {/* Details Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs mt-4">
                {/* Farmer & Field Details */}
                <div className="p-3 bg-white/80 rounded-lg border border-gray-200 space-y-1.5">
                  <div className="flex items-center justify-between border-b border-gray-100 pb-1">
                    <h4 className="font-bold text-emerald-900">
                      రైతు & పొలం వివరాలు (Farmer & Field Details)
                    </h4>
                    <Link
                      to={`/farmers/${previewCert.farmerId}`}
                      className="text-[11px] text-forest-700 hover:underline font-semibold flex items-center gap-1"
                    >
                      <User className="w-3 h-3" /> Profile
                    </Link>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500 font-medium">రైతు పేరు / Farmer Name:</span>
                    <Link to={`/farmers/${previewCert.farmerId}`} className="font-semibold text-forest-800 hover:underline">
                      {previewCert.farmerName}
                    </Link>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500 font-medium">గ్రామం / Village:</span>
                    <span className="font-semibold text-gray-900">{previewCert.villageName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500 font-medium">పంట / Crop:</span>
                    <span className="font-semibold text-gray-900">
                      {previewCert.cropName} {previewCert.cropNameTe ? `(${previewCert.cropNameTe})` : ''}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500 font-medium">సాగు కాలం / Season:</span>
                    <span className="font-semibold text-gray-900 capitalize">
                      {previewCert.seasonType} {previewCert.seasonYear}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500 font-medium">పంట కోత తేదీ / Harvest Date:</span>
                    <span className="font-semibold text-gray-900">{previewCert.actualHarvestDate}</span>
                  </div>
                </div>

                {/* Water & Performance Metrics */}
                <div className="p-3 bg-white/80 rounded-lg border border-gray-200 space-y-1.5">
                  <h4 className="font-bold text-emerald-900 border-b border-gray-100 pb-1">
                    నీటి లెక్కలు & పనితీరు (Water Use & Metrics)
                  </h4>
                  <div className="flex justify-between">
                    <span className="text-gray-500 font-medium">నీటి నిష్పత్తి / WUR:</span>
                    <span className="font-bold text-gray-900">
                      {previewCert.waterUseRatio != null ? previewCert.waterUseRatio : 'N/A'} ({previewCert.waterUseRatioBand.replace('_', ' ').toUpperCase()})
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500 font-medium">డేటా విశ్వసనీయత / Confidence:</span>
                    <span className="font-bold text-emerald-800">
                      {Math.round(previewCert.confidenceScore)}/100 ({previewCert.confidenceBand.toUpperCase()})
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500 font-medium">జారీ తేదీ / Issue Date:</span>
                    <span className="font-semibold text-gray-900">{previewCert.createdAt.split('T')[0]}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500 font-medium">పత్రం వెర్షన్ / Version:</span>
                    <span className="font-mono font-bold text-emerald-800">v{previewCert.version || 1}</span>
                  </div>
                </div>
              </div>

              {/* SHA-256 Digest */}
              <div className="mt-4 p-2 bg-gray-50 rounded border border-gray-200 text-[11px]">
                <div className="text-gray-500 font-bold">క్రిప్టోగ్రాఫిక్ సీల్ / Cryptographic SHA-256 Digest:</div>
                <div className="font-mono text-gray-800 break-all">{previewCert.sha256Hash}</div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-gray-100">
              <div className="flex items-center gap-2">
                {isAdmin && !previewCert.isRevoked && (
                  <Button
                    variant="secondary"
                    onClick={() => regenerateMutation.mutate(previewCert.id)}
                    disabled={regenerateMutation.isPending}
                    className="flex items-center gap-1.5"
                  >
                    <RefreshCw className={`w-4 h-4 ${regenerateMutation.isPending ? 'animate-spin' : ''}`} />
                    <span>{regenerateMutation.isPending ? 'Regenerating...' : 'Regenerate Certificate'}</span>
                  </Button>
                )}
                <Link
                  to={`/farmers/${previewCert.farmerId}`}
                  className="inline-flex items-center gap-1.5 px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-lg text-xs font-semibold transition"
                >
                  <User className="w-3.5 h-3.5" /> Farmer Profile
                </Link>
              </div>

              <div className="flex items-center gap-2">
                <a
                  href={`/api/v1/certificates/${previewCert.id}/pdf`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-sm font-semibold transition-colors"
                >
                  <Download className="w-4 h-4" />
                  <span>Download PDF (v{previewCert.version || 1})</span>
                </a>
                <Button variant="secondary" onClick={() => setIsPreviewModalOpen(false)}>
                  Close
                </Button>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};