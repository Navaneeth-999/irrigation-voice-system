import React, { useState, useEffect } from 'react';
import { Card } from '../components/ui/Card.js';
import { Badge } from '../components/ui/Badge.js';
import { Button } from '../components/ui/Button.js';
import { Input } from '../components/ui/Input.js';
import { useAuth } from '../lib/auth.js';
import { apiRequest } from '../api/client.js';
import {
  Settings,
  PhoneCall,
  CloudRain,
  ShieldCheck,
  Award,
  Sliders,
  CheckCircle,
  AlertCircle,
  Clock,
  Layers,
} from 'lucide-react';

interface SettingItem {
  key: string;
  value: any;
  description: string;
  updated_at?: string;
}

export const SettingsPage: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  const [settings, setSettings] = useState<SettingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Form states: Certificate Eligibility Thresholds
  const [minCycleCoveragePct, setMinCycleCoveragePct] = useState<number>(50);
  const [minConfidenceScore, setMinConfidenceScore] = useState<number>(50);
  const [minConfidenceBand, setMinConfidenceBand] = useState<string>('medium');

  // Form states: Telephony & Call Schedule
  const [callMaxRetries, setCallMaxRetries] = useState<number>(3);
  const [callScheduleIntervalDays, setCallScheduleIntervalDays] = useState<number>(14);
  const [callWindowStart, setCallWindowStart] = useState<string>('09:00:00');
  const [callWindowEnd, setCallWindowEnd] = useState<string>('18:00:00');

  // Form states: Effective Rainfall
  const [rainFraction, setRainFraction] = useState<number>(0.75);
  const [rainMinThresholdMm, setRainMinThresholdMm] = useState<number>(5);
  const [rainMaxCapMm, setRainMaxCapMm] = useState<number>(35);

  // Form states: Data Confidence Weights
  const [weightCoverage, setWeightCoverage] = useState<number>(0.4);
  const [weightCompleteness, setWeightCompleteness] = useState<number>(0.3);
  const [weightFieldEvidence, setWeightFieldEvidence] = useState<number>(0.15);
  const [weightConsistency, setWeightConsistency] = useState<number>(0.15);

  // Form states: WUR Bands
  const [wurLowerEdge, setWurLowerEdge] = useState<number>(0.8);
  const [wurUpperEdge, setWurUpperEdge] = useState<number>(1.3);

  const fetchSettings = async () => {
    try {
      setLoading(true);
      const res = await apiRequest<{ success: boolean; data: SettingItem[] }>('/settings');
      const items = res.data || [];
      setSettings(items);

      for (const s of items) {
        if (s.key === 'certificate_min_cycle_coverage_pct') setMinCycleCoveragePct(Number(s.value));
        if (s.key === 'certificate_min_confidence_score') setMinConfidenceScore(Number(s.value));
        if (s.key === 'certificate_min_confidence_band') setMinConfidenceBand(String(s.value));

        if (s.key === 'call_max_retries') setCallMaxRetries(Number(s.value));
        if (s.key === 'call_schedule_interval_days') setCallScheduleIntervalDays(Number(s.value));
        if (s.key === 'call_window_default_start') setCallWindowStart(String(s.value));
        if (s.key === 'call_window_default_end') setCallWindowEnd(String(s.value));

        if (s.key === 'effective_rainfall_method' && typeof s.value === 'object') {
          if (s.value.fraction !== undefined) setRainFraction(Number(s.value.fraction));
          if (s.value.min_threshold_mm !== undefined) setRainMinThresholdMm(Number(s.value.min_threshold_mm));
          if (s.value.max_cap_mm !== undefined) setRainMaxCapMm(Number(s.value.max_cap_mm));
        }

        if (s.key === 'confidence_weights' && typeof s.value === 'object') {
          if (s.value.coverage !== undefined) setWeightCoverage(Number(s.value.coverage));
          if (s.value.completeness !== undefined) setWeightCompleteness(Number(s.value.completeness));
          if (s.value.field_evidence !== undefined) setWeightFieldEvidence(Number(s.value.field_evidence));
          if (s.value.consistency !== undefined) setWeightConsistency(Number(s.value.consistency));
        }

        if (s.key === 'wur_band_thresholds' && typeof s.value === 'object') {
          if (s.value.lower_band_edge !== undefined) setWurLowerEdge(Number(s.value.lower_band_edge));
          if (s.value.upper_band_edge !== undefined) setWurUpperEdge(Number(s.value.upper_band_edge));
        }
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to load system settings');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  const handleSaveSetting = async (key: string, value: any) => {
    if (!isAdmin) return;
    try {
      setSavingKey(key);
      setErrorMessage(null);
      setSaveSuccess(null);

      await apiRequest(`/settings/${key}`, {
        method: 'PUT',
        body: JSON.stringify({ value }),
      });

      setSaveSuccess(key);
      setTimeout(() => setSaveSuccess(null), 3500);
      await fetchSettings();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to save setting');
    } finally {
      setSavingKey(null);
    }
  };

  const handleSaveEligibilityThresholds = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    try {
      setSavingKey('eligibility_all');
      setErrorMessage(null);
      setSaveSuccess(null);

      await handleSaveSetting('certificate_min_cycle_coverage_pct', Number(minCycleCoveragePct));
      await handleSaveSetting('certificate_min_confidence_score', Number(minConfidenceScore));
      await handleSaveSetting('certificate_min_confidence_band', minConfidenceBand);

      setSaveSuccess('eligibility_all');
      setTimeout(() => setSaveSuccess(null), 3500);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to save eligibility thresholds');
    } finally {
      setSavingKey(null);
    }
  };

  const handleSaveTelephonySettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    try {
      setSavingKey('telephony_all');
      setErrorMessage(null);

      await handleSaveSetting('call_max_retries', Number(callMaxRetries));
      await handleSaveSetting('call_schedule_interval_days', Number(callScheduleIntervalDays));
      await handleSaveSetting('call_window_default_start', callWindowStart);
      await handleSaveSetting('call_window_default_end', callWindowEnd);

      setSaveSuccess('telephony_all');
      setTimeout(() => setSaveSuccess(null), 3500);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to save telephony parameters');
    } finally {
      setSavingKey(null);
    }
  };

  const handleSaveRainfallSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    try {
      setSavingKey('rainfall_all');
      setErrorMessage(null);

      const val = {
        fraction: Number(rainFraction),
        min_threshold_mm: Number(rainMinThresholdMm),
        max_cap_mm: Number(rainMaxCapMm),
      };
      await handleSaveSetting('effective_rainfall_method', val);

      setSaveSuccess('rainfall_all');
      setTimeout(() => setSaveSuccess(null), 3500);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to save rainfall parameters');
    } finally {
      setSavingKey(null);
    }
  };

  const handleSaveConfidenceWeights = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    const sum = weightCoverage + weightCompleteness + weightFieldEvidence + weightConsistency;
    if (Math.abs(sum - 1.0) > 0.01) {
      setErrorMessage(`Confidence weights must sum to 1.00 (current sum: ${sum.toFixed(2)})`);
      return;
    }
    try {
      setSavingKey('weights_all');
      setErrorMessage(null);

      const val = {
        coverage: Number(weightCoverage),
        completeness: Number(weightCompleteness),
        field_evidence: Number(weightFieldEvidence),
        consistency: Number(weightConsistency),
      };
      await handleSaveSetting('confidence_weights', val);

      setSaveSuccess('weights_all');
      setTimeout(() => setSaveSuccess(null), 3500);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to save confidence weights');
    } finally {
      setSavingKey(null);
    }
  };

  const handleSaveWurBands = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    try {
      setSavingKey('wur_all');
      setErrorMessage(null);

      const val = {
        lower_band_edge: Number(wurLowerEdge),
        upper_band_edge: Number(wurUpperEdge),
        source: 'District Water Audit Baseline',
        is_verified: false,
      };
      await handleSaveSetting('wur_band_thresholds', val);

      setSaveSuccess('wur_all');
      setTimeout(() => setSaveSuccess(null), 3500);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to save WUR bands');
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">System Settings & Thresholds</h1>
          <p className="text-sm text-gray-500 mt-1">
            Configure runtime thresholds, telephony parameters, FAO-56 rainfall logic, and Certificate eligibility criteria.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin ? (
            <Badge variant="success">ADMIN ACCESS ENABLED</Badge>
          ) : (
            <Badge variant="neutral">READ-ONLY MODE</Badge>
          )}
        </div>
      </div>

      {errorMessage && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 font-medium flex items-center space-x-2">
          <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {saveSuccess && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-sm text-emerald-800 font-medium flex items-center space-x-2">
          <CheckCircle className="w-5 h-5 text-emerald-600 shrink-0" />
          <span>Configuration saved successfully. Audit log recorded and changes applied to runtime.</span>
        </div>
      )}

      {/* Grid: Grouped Settings Forms */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Card 1: Certificate Eligibility Thresholds */}
        <Card>
          <div className="p-6 space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <div className="flex items-center space-x-2.5">
                <div className="p-2 bg-emerald-50 text-emerald-700 rounded-lg">
                  <Award className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-gray-900">Certificate Eligibility</h2>
                  <p className="text-xs text-gray-500">Minimum thresholds to qualify for accreditation</p>
                </div>
              </div>
              <Badge variant="info">Rule Engine</Badge>
            </div>

            <form onSubmit={handleSaveEligibilityThresholds} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold text-gray-700 mb-1">
                  Min Cycle Coverage (%)
                </label>
                <Input
                  type="number"
                  min="1"
                  max="100"
                  value={minCycleCoveragePct}
                  disabled={!isAdmin || loading}
                  onChange={(e) => setMinCycleCoveragePct(Number(e.target.value))}
                />
                <p className="text-2xs text-gray-400 mt-1">Percent of fortnightly monitoring calls answered</p>
              </div>

              <div>
                <label className="block font-semibold text-gray-700 mb-1">
                  Min Data Confidence Score (0–100)
                </label>
                <Input
                  type="number"
                  min="0"
                  max="100"
                  value={minConfidenceScore}
                  disabled={!isAdmin || loading}
                  onChange={(e) => setMinConfidenceScore(Number(e.target.value))}
                />
                <p className="text-2xs text-gray-400 mt-1">Weighted composite score (coverage, completeness, consistency)</p>
              </div>

              <div>
                <label className="block font-semibold text-gray-700 mb-1">
                  Min Confidence Band
                </label>
                <select
                  value={minConfidenceBand}
                  disabled={!isAdmin || loading}
                  onChange={(e) => setMinConfidenceBand(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-white border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:bg-gray-100"
                >
                  <option value="medium">Medium (or High)</option>
                  <option value="high">High Only</option>
                </select>
                <p className="text-2xs text-gray-400 mt-1">Low confidence seasons generate an unaccredited summary report</p>
              </div>

              {isAdmin && (
                <div className="pt-2">
                  <Button type="submit" disabled={savingKey === 'eligibility_all' || loading} size="sm">
                    {savingKey === 'eligibility_all' ? 'Saving...' : 'Save Certificate Thresholds'}
                  </Button>
                </div>
              )}
            </form>
          </div>
        </Card>

        {/* Card 2: Telephony & Call Schedule */}
        <Card>
          <div className="p-6 space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <div className="flex items-center space-x-2.5">
                <div className="p-2 bg-blue-50 text-blue-700 rounded-lg">
                  <PhoneCall className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-gray-900">Telephony & Call Limits</h2>
                  <p className="text-xs text-gray-500">IVR retry policy & permitted call window (IST)</p>
                </div>
              </div>
              <Badge variant="neutral">Twilio & IVR</Badge>
            </div>

            <form onSubmit={handleSaveTelephonySettings} className="space-y-3.5 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-gray-700 mb-1">Max Retries per Cycle</label>
                  <Input
                    type="number"
                    min="1"
                    max="10"
                    value={callMaxRetries}
                    disabled={!isAdmin || loading}
                    onChange={(e) => setCallMaxRetries(Number(e.target.value))}
                  />
                </div>
                <div>
                  <label className="block font-semibold text-gray-700 mb-1">Interval (Days)</label>
                  <Input
                    type="number"
                    min="1"
                    max="30"
                    value={callScheduleIntervalDays}
                    disabled={!isAdmin || loading}
                    onChange={(e) => setCallScheduleIntervalDays(Number(e.target.value))}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-gray-700 mb-1">Call Window Start</label>
                  <Input
                    type="time"
                    value={callWindowStart}
                    disabled={!isAdmin || loading}
                    onChange={(e) => setCallWindowStart(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block font-semibold text-gray-700 mb-1">Call Window End</label>
                  <Input
                    type="time"
                    value={callWindowEnd}
                    disabled={!isAdmin || loading}
                    onChange={(e) => setCallWindowEnd(e.target.value)}
                  />
                </div>
              </div>

              <p className="text-2xs text-gray-400">Calls are restricted between these hours to respect farmer availability.</p>

              {isAdmin && (
                <div className="pt-2">
                  <Button type="submit" disabled={savingKey === 'telephony_all' || loading} size="sm">
                    {savingKey === 'telephony_all' ? 'Saving...' : 'Save Telephony Rules'}
                  </Button>
                </div>
              )}
            </form>
          </div>
        </Card>

        {/* Card 3: Effective Rainfall Parameters */}
        <Card>
          <div className="p-6 space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <div className="flex items-center space-x-2.5">
                <div className="p-2 bg-indigo-50 text-indigo-700 rounded-lg">
                  <CloudRain className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-gray-900">Effective Rainfall (FAO-56)</h2>
                  <p className="text-xs text-gray-500">USDA-SCS empirical parameters for net demand</p>
                </div>
              </div>
              <Badge variant="neutral">Agronomic</Badge>
            </div>

            <form onSubmit={handleSaveRainfallSettings} className="space-y-3.5 text-xs">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold text-gray-700 mb-1">Fraction (0–1)</label>
                  <Input
                    type="number"
                    step="0.05"
                    min="0"
                    max="1"
                    value={rainFraction}
                    disabled={!isAdmin || loading}
                    onChange={(e) => setRainFraction(Number(e.target.value))}
                  />
                </div>
                <div>
                  <label className="block font-semibold text-gray-700 mb-1">Min Threshold (mm)</label>
                  <Input
                    type="number"
                    min="0"
                    max="50"
                    value={rainMinThresholdMm}
                    disabled={!isAdmin || loading}
                    onChange={(e) => setRainMinThresholdMm(Number(e.target.value))}
                  />
                </div>
                <div>
                  <label className="block font-semibold text-gray-700 mb-1">Max Daily Cap (mm)</label>
                  <Input
                    type="number"
                    min="10"
                    max="200"
                    value={rainMaxCapMm}
                    disabled={!isAdmin || loading}
                    onChange={(e) => setRainMaxCapMm(Number(e.target.value))}
                  />
                </div>
              </div>

              <p className="text-2xs text-gray-400">
                Rainfall below the minimum threshold evaporates without soil infiltration; rainfall above the cap creates runoff.
              </p>

              {isAdmin && (
                <div className="pt-2">
                  <Button type="submit" disabled={savingKey === 'rainfall_all' || loading} size="sm">
                    {savingKey === 'rainfall_all' ? 'Saving...' : 'Save Rainfall Parameters'}
                  </Button>
                </div>
              )}
            </form>
          </div>
        </Card>

        {/* Card 4: Data Confidence Weights */}
        <Card>
          <div className="p-6 space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <div className="flex items-center space-x-2.5">
                <div className="p-2 bg-amber-50 text-amber-700 rounded-lg">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-gray-900">Confidence Weights</h2>
                  <p className="text-xs text-gray-500">Weighting factors (must sum to 1.00)</p>
                </div>
              </div>
              <Badge variant="neutral">Scoring</Badge>
            </div>

            <form onSubmit={handleSaveConfidenceWeights} className="space-y-3.5 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-gray-700 mb-1">Cycle Coverage (40%)</label>
                  <Input
                    type="number"
                    step="0.05"
                    min="0"
                    max="1"
                    value={weightCoverage}
                    disabled={!isAdmin || loading}
                    onChange={(e) => setWeightCoverage(Number(e.target.value))}
                  />
                </div>
                <div>
                  <label className="block font-semibold text-gray-700 mb-1">Completeness (30%)</label>
                  <Input
                    type="number"
                    step="0.05"
                    min="0"
                    max="1"
                    value={weightCompleteness}
                    disabled={!isAdmin || loading}
                    onChange={(e) => setWeightCompleteness(Number(e.target.value))}
                  />
                </div>
                <div>
                  <label className="block font-semibold text-gray-700 mb-1">Field Evidence (15%)</label>
                  <Input
                    type="number"
                    step="0.05"
                    min="0"
                    max="1"
                    value={weightFieldEvidence}
                    disabled={!isAdmin || loading}
                    onChange={(e) => setWeightFieldEvidence(Number(e.target.value))}
                  />
                </div>
                <div>
                  <label className="block font-semibold text-gray-700 mb-1">Consistency (15%)</label>
                  <Input
                    type="number"
                    step="0.05"
                    min="0"
                    max="1"
                    value={weightConsistency}
                    disabled={!isAdmin || loading}
                    onChange={(e) => setWeightConsistency(Number(e.target.value))}
                  />
                </div>
              </div>

              {isAdmin && (
                <div className="pt-2">
                  <Button type="submit" disabled={savingKey === 'weights_all' || loading} size="sm">
                    {savingKey === 'weights_all' ? 'Saving...' : 'Save Confidence Weights'}
                  </Button>
                </div>
              )}
            </form>
          </div>
        </Card>
      </div>

      {/* Primary Section: All Runtime System Parameters */}
      <Card>
        <div className="p-6 space-y-4">
          <div className="flex items-center justify-between border-b pb-3">
            <div>
              <h2 className="text-base font-bold text-gray-900">Runtime Application Settings Table</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Direct view of all active key-value pairs stored in PostgreSQL (`app_settings`).
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={fetchSettings} disabled={loading}>
              Refresh Settings
            </Button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-50 text-gray-500 uppercase font-semibold border-b">
                <tr>
                  <th className="py-2.5 px-3">Setting Key</th>
                  <th className="py-2.5 px-3">Description</th>
                  <th className="py-2.5 px-3">Current Value</th>
                  <th className="py-2.5 px-3">Category</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {settings.map((item) => (
                  <tr key={item.key} className="hover:bg-gray-50/60">
                    <td className="py-3 px-3 font-mono font-medium text-forest-800">
                      {item.key}
                    </td>
                    <td className="py-3 px-3 text-gray-600 max-w-xs">
                      {item.description}
                    </td>
                    <td className="py-3 px-3 font-mono text-gray-900 bg-gray-50/50 rounded text-2xs">
                      {typeof item.value === 'object' ? JSON.stringify(item.value) : String(item.value)}
                    </td>
                    <td className="py-3 px-3">
                      {item.key.startsWith('certificate_min') ? (
                        <Badge variant="info">Eligibility Gate</Badge>
                      ) : item.key.startsWith('call_') ? (
                        <Badge variant="neutral">Telephony</Badge>
                      ) : (
                        <Badge variant="success">Engine</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Card>
    </div>
  );
};
