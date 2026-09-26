import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
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
} from 'lucide-react';
import { Card } from '../components/ui/Card.js';
import { Button } from '../components/ui/Button.js';
import { Badge } from '../components/ui/Badge.js';
import { Input } from '../components/ui/Input.js';
import { Modal } from '../components/ui/Modal.js';

interface CertificateListItem {
  id: string;
  certificateCode: string;
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
  waterUseRatio: number;
  waterUseRatioBand: 'below_estimate' | 'near_estimate' | 'above_estimate';
  confidenceScore: number;
  confidenceBand: 'low' | 'medium' | 'high';
  sha256Hash: string;
  isRevoked: boolean;
  revocationReason?: string;
  actualHarvestDate: string;
  createdAt: string;
}

export const CertificatesPage: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [selectedCert, setSelectedCert] = useState<CertificateListItem | null>(null);
  const [isRevokeModalOpen, setIsRevokeModalOpen] = useState(false);
  const [revokeReason, setRevokeReason] = useState('');

  // Fetch certificates
  const { data, isLoading } = useQuery<{ success: boolean; data: CertificateListItem[]; total: number }>({
    queryKey: ['certificates'],
    queryFn: () => apiRequest<{ success: boolean; data: CertificateListItem[]; total: number }>('/certificates?limit=50'),
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
  });

  const certificates = data?.data || [];
  const filtered = certificates.filter(c =>
    c.farmerName.toLowerCase().includes(search.toLowerCase()) ||
    c.certificateCode.toLowerCase().includes(search.toLowerCase()) ||
    c.villageName.toLowerCase().includes(search.toLowerCase())
  );

  const totalCerts = certificates.length;
  const highConfidenceCount = certificates.filter(c => c.confidenceScore >= 70).length;
  const nearTargetCount = certificates.filter(c => c.waterUseRatioBand === 'near_estimate').length;

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
            Immutable seasonal water conservation certificates, verified by SHA-256 cryptographic hashes.
          </p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="p-4 bg-white border border-gray-200">
          <span className="text-xs text-gray-500 block">Total Certificates Issued</span>
          <span className="text-2xl font-bold text-gray-900">{totalCerts}</span>
          <span className="text-xs text-forest-600 block mt-1">Sealed at season completion</span>
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

      {/* Search and Table */}
      <Card className="p-4 bg-white border border-gray-200">
        <div className="flex items-center gap-3 mb-4">
          <div className="relative flex-1 max-w-md">
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

        {isLoading ? (
          <div className="py-12 text-center text-gray-500">
            <div className="animate-spin w-8 h-8 border-4 border-forest-600 border-t-transparent rounded-full mx-auto mb-2" />
            <p>Loading certificates...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center text-gray-500">
            <Award className="w-12 h-12 text-gray-300 mx-auto mb-2" />
            <p className="font-semibold">No conservation certificates found</p>
            <p className="text-xs text-gray-400 mt-1">
              Certificates are generated when active seasons are marked complete in Season Details.
            </p>
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
                {filtered.map((cert) => (
                  <tr key={cert.id} className="hover:bg-gray-50/80 transition-colors">
                    <td className="py-3 px-3 font-mono font-medium text-forest-800">
                      <div>{cert.certificateCode}</div>
                      <div className="text-[10px] text-gray-400 truncate max-w-[120px]">
                        {cert.sha256Hash.substring(0, 16)}...
                      </div>
                    </td>

                    <td className="py-3 px-3">
                      <div className="font-semibold text-gray-900">{cert.farmerName}</div>
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
                      <div className="text-[11px] text-gray-500 mt-0.5">Ratio: {cert.waterUseRatio}</div>
                    </td>

                    <td className="py-3 px-3">
                      <div className="font-semibold text-gray-900">{Math.round(cert.confidenceScore)}/100</div>
                      <div className="text-xs text-gray-500 capitalize">{cert.confidenceBand}</div>
                    </td>

                    <td className="py-3 px-3">
                      {cert.isRevoked ? (
                        <Badge variant="danger">REVOKED</Badge>
                      ) : (
                        <Badge variant="success">SEALED</Badge>
                      )}
                    </td>

                    <td className="py-3 px-3 text-right">
                      <div className="flex items-center justify-end gap-2">
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
                        {isAdmin && !cert.isRevoked && (
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
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Revoke Certificate Modal */}
      {isRevokeModalOpen && selectedCert && (
        <Modal
          isOpen={isRevokeModalOpen}
          onClose={() => setIsRevokeModalOpen(false)}
          title={`Revoke Certificate - ${selectedCert.certificateCode}`}
        >
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Revoking this certificate marks it as invalid on the public verification registry. This action is irreversible.
            </p>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Reason for Revocation *
              </label>
              <textarea
                value={revokeReason}
                onChange={(e) => setRevokeReason(e.target.value)}
                placeholder="e.g. Farmer submitted corrected irrigation logs showing severe waterlogging..."
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
    </div>
  );
};
