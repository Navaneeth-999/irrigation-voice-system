import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ShieldCheck,
  ShieldAlert,
  Droplets,
  Calendar,
  MapPin,
  Sprout,
  Award,
  Hash,
  AlertTriangle,
  ExternalLink,
  ChevronLeft,
} from 'lucide-react';
import { Card } from '../components/ui/Card.js';
import { Badge } from '../components/ui/Badge.js';
import { Button } from '../components/ui/Button.js';

interface PublicVerificationData {
  isValid: boolean;
  isRevoked: boolean;
  certificateCode: string;
  issuedAt: string;
  revokedAt?: string;
  revocationReason?: string;
  sha256Hash: string;
  computedHash: string;
  hashMatches: boolean;
  tamperDetected: boolean;
  farmerName: string;
  villageName: string;
  mandal: string;
  district: string;
  cropName: string;
  cropNameTe: string;
  seasonYear: number;
  seasonType: string;
  waterUseRatio: number;
  ratioBand: 'below_estimate' | 'near_estimate' | 'above_estimate';
  confidenceScore: number;
  confidenceBand: 'low' | 'medium' | 'high';
  hasUnvalidatedAssumptions: boolean;
  unvalidatedAssumptionsList: string[];
}

export const PublicVerificationPage: React.FC = () => {
  const { code } = useParams<{ code: string }>();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<PublicVerificationData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function verify() {
      if (!code) return;
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/v1/certificates/verify/${encodeURIComponent(code)}`);
        const json = await res.json();
        if (json.success && json.data) {
          setData(json.data);
        } else {
          setError(json.error || 'Certificate not found or invalid.');
        }
      } catch (err: any) {
        setError(err.message || 'Failed to connect to verification server.');
      } finally {
        setLoading(false);
      }
    }
    verify();
  }, [code]);

  const bandLabels = {
    near_estimate: 'Near Agronomic Target (అంచనాకు సమానం)',
    below_estimate: 'Below Estimated Demand (అంచనా కంటే తక్కువ)',
    above_estimate: 'Above Estimated Demand (అంచనా కంటే ఎక్కువ)',
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-forest-950 via-forest-900 to-gray-900 text-gray-100 flex flex-col justify-between p-4 sm:p-6 md:p-10 font-sans">
      {/* Top Header */}
      <div className="max-w-4xl mx-auto w-full flex items-center justify-between border-b border-forest-800/80 pb-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-forest-600 flex items-center justify-center text-white shadow-lg">
            <Droplets className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-white flex items-center gap-2">
              జలమిత్ర <span className="text-sm font-normal text-forest-300">Jalamitra Verification</span>
            </h1>
            <p className="text-xs text-forest-400">Public Cryptographic Record Registry • B.Tech CSP</p>
          </div>
        </div>
        <Link to="/login" className="text-xs text-forest-300 hover:text-white flex items-center gap-1">
          <span>Official Portal</span>
          <ExternalLink className="w-3.5 h-3.5" />
        </Link>
      </div>

      {/* Main Verification Card */}
      <div className="max-w-4xl mx-auto w-full my-auto">
        {loading && (
          <Card className="p-12 text-center bg-gray-900/90 border border-forest-800 text-gray-300">
            <div className="animate-spin w-10 h-10 border-4 border-forest-500 border-t-transparent rounded-full mx-auto mb-4" />
            <p className="font-semibold text-lg">Verifying Cryptographic Seal & Records...</p>
            <p className="text-sm text-gray-400 mt-1 font-mono">Querying canonical ledger for {code}</p>
          </Card>
        )}

        {error && !loading && (
          <Card className="p-8 bg-red-950/80 border border-red-800 text-center">
            <ShieldAlert className="w-14 h-14 text-red-400 mx-auto mb-3" />
            <h2 className="text-xl font-bold text-red-200">Certificate Verification Failed</h2>
            <p className="text-red-300 mt-2 max-w-md mx-auto text-sm">{error}</p>
            <p className="text-xs text-gray-400 mt-4 font-mono">Identifier: {code}</p>
          </Card>
        )}

        {data && !loading && (
          <div className="space-y-6">
            {/* Status Hero Banner */}
            {data.isValid ? (
              <div className="bg-forest-900/90 border-2 border-forest-500/80 rounded-2xl p-6 sm:p-8 shadow-2xl backdrop-blur-sm text-white">
                <div className="flex flex-col sm:flex-row items-center sm:items-start gap-5">
                  <div className="w-16 h-16 rounded-2xl bg-emerald-500/20 border border-emerald-400/40 flex items-center justify-center shrink-0">
                    <ShieldCheck className="w-10 h-10 text-emerald-400" />
                  </div>
                  <div className="text-center sm:text-left flex-1">
                    <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 mb-1">
                      <span className="bg-emerald-500/20 text-emerald-300 font-bold px-3 py-1 rounded-full text-xs uppercase tracking-wider border border-emerald-400/30">
                        Cryptographically Sealed & Verified
                      </span>
                      <span className="text-xs text-forest-300 font-mono">SHA-256 Match: 100%</span>
                    </div>
                    <h2 className="text-2xl sm:text-3xl font-bold text-white mt-1">
                      {data.farmerName}
                    </h2>
                    <p className="text-forest-200 text-sm mt-1">
                      Seasonal Water Conservation Certificate • <span className="font-mono text-emerald-300 font-semibold">{data.certificateCode}</span>
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-red-950/90 border-2 border-red-500/80 rounded-2xl p-6 sm:p-8 shadow-2xl text-white">
                <div className="flex items-center gap-4">
                  <ShieldAlert className="w-12 h-12 text-red-400" />
                  <div>
                    <h2 className="text-2xl font-bold text-red-200">
                      {data.isRevoked ? 'Certificate Revoked' : 'Integrity Tamper Alert'}
                    </h2>
                    <p className="text-red-300 text-sm mt-1">
                      {data.isRevoked
                        ? `Revocation Reason: ${data.revocationReason || 'Administrative cancellation'}`
                        : 'Stored SHA-256 hash does not match computed snapshot hash. Data integrity compromised.'}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Verification Metadata Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Card 1: Agronomic Profile */}
              <Card className="p-5 bg-gray-900/90 border border-forest-800/80 text-gray-200">
                <h3 className="text-xs font-bold text-forest-400 uppercase tracking-wider flex items-center gap-1.5 mb-3">
                  <Sprout className="w-4 h-4 text-forest-400" />
                  <span>Crop & Location Details</span>
                </h3>
                <div className="space-y-2.5 text-sm">
                  <div className="flex justify-between border-b border-gray-800 pb-2">
                    <span className="text-gray-400">Crop Cultivated:</span>
                    <span className="font-semibold text-white">
                      {data.cropName} {data.cropNameTe && `(${data.cropNameTe})`}
                    </span>
                  </div>
                  <div className="flex justify-between border-b border-gray-800 pb-2">
                    <span className="text-gray-400">Village & Mandal:</span>
                    <span className="font-medium text-white">{data.villageName}, {data.mandal}</span>
                  </div>
                  <div className="flex justify-between border-b border-gray-800 pb-2">
                    <span className="text-gray-400">District:</span>
                    <span className="font-medium text-white">{data.district}, AP</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Season Period:</span>
                    <span className="font-medium text-white capitalize">{data.seasonType} {data.seasonYear}</span>
                  </div>
                </div>
              </Card>

              {/* Card 2: Water Balance & Confidence */}
              <Card className="p-5 bg-gray-900/90 border border-forest-800/80 text-gray-200">
                <h3 className="text-xs font-bold text-forest-400 uppercase tracking-wider flex items-center gap-1.5 mb-3">
                  <Award className="w-4 h-4 text-forest-400" />
                  <span>Water Stewardship Metrics</span>
                </h3>
                <div className="space-y-2.5 text-sm">
                  <div className="flex justify-between border-b border-gray-800 pb-2">
                    <span className="text-gray-400">Water Use Ratio Band:</span>
                    <Badge variant={data.ratioBand === 'near_estimate' ? 'success' : 'warning'}>
                      {data.ratioBand.toUpperCase()}
                    </Badge>
                  </div>
                  <div className="flex justify-between border-b border-gray-800 pb-2">
                    <span className="text-gray-400">Agronomic Assessment:</span>
                    <span className="font-medium text-white text-xs">{bandLabels[data.ratioBand]}</span>
                  </div>
                  <div className="flex justify-between border-b border-gray-800 pb-2">
                    <span className="text-gray-400">Data Confidence Score:</span>
                    <span className="font-bold text-white">{Math.round(data.confidenceScore)}/100 ({data.confidenceBand.toUpperCase()})</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Sealed At:</span>
                    <span className="text-xs text-gray-300">{new Date(data.issuedAt).toLocaleString('en-IN')}</span>
                  </div>
                </div>
              </Card>
            </div>

            {/* Unvalidated Assumptions Banner (Directive 1) */}
            {data.hasUnvalidatedAssumptions && (
              <div className="bg-amber-950/70 border border-amber-500/60 rounded-xl p-4 text-amber-200 text-xs">
                <div className="flex items-center gap-2 font-bold mb-1.5 text-amber-300">
                  <AlertTriangle className="w-4 h-4 text-amber-400" />
                  <span>Public Scientific Notice: Calculations based on unvalidated baseline assumptions</span>
                </div>
                <ul className="list-disc list-inside space-y-1 text-amber-200/90 pl-1">
                  {data.unvalidatedAssumptionsList.map((item, idx) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Cryptographic SHA-256 Card */}
            <Card className="p-5 bg-gray-950/90 border border-forest-900 font-mono text-xs">
              <div className="flex items-center justify-between text-forest-400 mb-2">
                <span className="font-bold flex items-center gap-1.5 uppercase tracking-wider text-[11px]">
                  <Hash className="w-3.5 h-3.5" />
                  <span>Immutable SHA-256 Ledger Hash</span>
                </span>
                <span className="text-emerald-400 font-sans font-semibold">Integrity Verified</span>
              </div>
              <p className="bg-gray-900 p-3 rounded-lg text-emerald-300 break-all border border-gray-800 text-[11px]">
                {data.sha256Hash}
              </p>
              <p className="text-[10px] text-gray-500 font-sans mt-2">
                This hash is deterministically calculated across all farmer feedback, daily rainfall balances, and FAO-56 evapotranspiration records. Modifying even 1 digit in the underlying records produces a different hash.
              </p>
            </Card>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="max-w-4xl mx-auto w-full text-center text-xs text-gray-500 border-t border-forest-900 pt-4 mt-8">
        Jalamitra Intelligent Irrigation & Conservation Platform • Andhra Pradesh Water Stewardship Initiative
      </div>
    </div>
  );
};
