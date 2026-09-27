import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ShieldCheck,
  ShieldAlert,
  Droplets,
  Calendar,
  MapPin,
  Sprout,
  Hash,
  ExternalLink,
  Award,
} from 'lucide-react';
import { Card } from '../components/ui/Card.js';
import { Badge } from '../components/ui/Badge.js';

interface PublicVerificationData {
  certificateNumber: string;
  season: string;
  crop: string;
  village: string;
  issueDate: string;
  status: 'valid' | 'revoked';
  isValid: boolean;
  isRevoked: boolean;
  revocationReason?: string | null;
  sha256Validated: boolean;
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
          setError(json.error || 'Certificate record not found or invalid.');
        }
      } catch (err: any) {
        setError(err.message || 'Failed to connect to verification registry.');
      } finally {
        setLoading(false);
      }
    }
    verify();
  }, [code]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-forest-950 via-forest-900 to-gray-900 text-gray-100 flex flex-col justify-between p-4 sm:p-6 md:p-10 font-sans">
      {/* Top Header */}
      <div className="max-w-3xl mx-auto w-full flex items-center justify-between border-b border-forest-800/80 pb-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-forest-600 flex items-center justify-center text-white shadow-lg">
            <Droplets className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-white flex items-center gap-2">
              జలమిత్ర <span className="text-sm font-normal text-forest-300">Public Verification</span>
            </h1>
            <p className="text-xs text-forest-400">Official Conservation Certificate Registry • B.Tech CSP</p>
          </div>
        </div>
        <Link to="/login" className="text-xs text-forest-300 hover:text-white flex items-center gap-1">
          <span>CSP Portal</span>
          <ExternalLink className="w-3.5 h-3.5" />
        </Link>
      </div>

      {/* Main Verification Card */}
      <div className="max-w-2xl mx-auto w-full my-auto">
        {loading && (
          <Card className="p-12 text-center bg-gray-900/90 border border-forest-800 text-gray-300 shadow-2xl">
            <div className="animate-spin w-10 h-10 border-4 border-forest-500 border-t-transparent rounded-full mx-auto mb-4" />
            <p className="font-semibold text-lg">Verifying Certificate Authenticity...</p>
            <p className="text-sm text-gray-400 mt-1 font-mono">Querying record registry for {code}</p>
          </Card>
        )}

        {error && !loading && (
          <Card className="p-8 bg-red-950/80 border border-red-800 text-center shadow-2xl">
            <ShieldAlert className="w-14 h-14 text-red-400 mx-auto mb-3" />
            <h2 className="text-xl font-bold text-red-200">Certificate Verification Failed</h2>
            <p className="text-red-300 mt-2 max-w-md mx-auto text-sm">{error}</p>
            <p className="text-xs text-gray-400 mt-4 font-mono">Certificate Identifier: {code}</p>
          </Card>
        )}

        {data && !loading && (
          <div className="space-y-6">
            {/* Status Hero Card */}
            {data.isValid ? (
              <div className="bg-forest-900/90 border-2 border-forest-500/80 rounded-2xl p-6 sm:p-8 shadow-2xl backdrop-blur-sm text-white">
                <div className="flex flex-col sm:flex-row items-center sm:items-start gap-5">
                  <div className="w-16 h-16 rounded-2xl bg-emerald-500/20 border border-emerald-400/40 flex items-center justify-center shrink-0">
                    <ShieldCheck className="w-10 h-10 text-emerald-400" />
                  </div>
                  <div className="text-center sm:text-left flex-1">
                    <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 mb-1">
                      <span className="bg-emerald-500/20 text-emerald-300 font-bold px-3 py-1 rounded-full text-xs uppercase tracking-wider border border-emerald-400/30">
                        Authenticated & Valid
                      </span>
                      {data.sha256Validated && (
                        <span className="text-xs text-emerald-300 font-mono bg-forest-950/50 px-2 py-0.5 rounded border border-emerald-500/30">
                          SHA-256 Validated
                        </span>
                      )}
                    </div>
                    <h2 className="text-2xl sm:text-3xl font-bold text-white mt-1 font-mono">
                      {data.certificateNumber}
                    </h2>
                    <p className="text-forest-200 text-sm mt-1">
                      Official Seasonal Water Conservation Certificate
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
                      {data.isRevoked ? 'Certificate Revoked' : 'Certificate Invalid / Tampered'}
                    </h2>
                    <p className="text-red-300 text-sm mt-1">
                      {data.isRevoked
                        ? `Revocation Reason: ${data.revocationReason || 'Administrative cancellation'}`
                        : 'Stored cryptographic hash does not match computed snapshot hash.'}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Exactly Limited Field Verification Card (User Directive 3) */}
            <Card className="p-6 bg-gray-900/90 border border-forest-800/80 text-gray-200 shadow-xl">
              <h3 className="text-xs font-bold text-forest-400 uppercase tracking-wider flex items-center gap-1.5 mb-4 border-b border-gray-800 pb-2">
                <Award className="w-4 h-4 text-forest-400" />
                <span>Verified Public Certificate Details</span>
              </h3>

              <div className="space-y-3.5 text-sm">
                <div className="flex items-center justify-between border-b border-gray-800/80 pb-2.5">
                  <span className="text-gray-400 flex items-center gap-2">
                    <Hash className="w-4 h-4 text-gray-500" />
                    <span>Certificate Number:</span>
                  </span>
                  <span className="font-mono font-bold text-white tracking-wide">
                    {data.certificateNumber}
                  </span>
                </div>

                <div className="flex items-center justify-between border-b border-gray-800/80 pb-2.5">
                  <span className="text-gray-400 flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-gray-500" />
                    <span>Season:</span>
                  </span>
                  <span className="font-semibold text-white">
                    {data.season}
                  </span>
                </div>

                <div className="flex items-center justify-between border-b border-gray-800/80 pb-2.5">
                  <span className="text-gray-400 flex items-center gap-2">
                    <Sprout className="w-4 h-4 text-gray-500" />
                    <span>Crop:</span>
                  </span>
                  <span className="font-semibold text-white">
                    {data.crop}
                  </span>
                </div>

                <div className="flex items-center justify-between border-b border-gray-800/80 pb-2.5">
                  <span className="text-gray-400 flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-gray-500" />
                    <span>Village:</span>
                  </span>
                  <span className="font-semibold text-white">
                    {data.village}
                  </span>
                </div>

                <div className="flex items-center justify-between border-b border-gray-800/80 pb-2.5">
                  <span className="text-gray-400 flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-gray-500" />
                    <span>Issue Date:</span>
                  </span>
                  <span className="font-medium text-gray-200">
                    {data.issueDate}
                  </span>
                </div>

                <div className="flex items-center justify-between pt-1">
                  <span className="text-gray-400">Status:</span>
                  <Badge variant={data.status === 'valid' ? 'success' : 'danger'}>
                    {data.status.toUpperCase()}
                  </Badge>
                </div>
              </div>
            </Card>

            <p className="text-center text-xs text-gray-400">
              In accordance with privacy and agricultural land data protection policies, sensitive farmer and parcel details are withheld from the public registry.
            </p>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="max-w-3xl mx-auto w-full text-center text-xs text-gray-500 border-t border-forest-900 pt-4 mt-8">
        Jalamitra Intelligent Irrigation & Conservation Platform • Andhra Pradesh Water Stewardship Initiative
      </div>
    </div>
  );
};
