import React, { useState, useEffect } from 'react';
import { apiRequest } from '../api/client.js';
import { Card } from '../components/ui/Card.js';
import { Badge } from '../components/ui/Badge.js';
import { Button } from '../components/ui/Button.js';
import { Modal } from '../components/ui/Modal.js';
import { Input } from '../components/ui/Input.js';
import { useAuth } from '../lib/auth.js';
import {
  CloudSun,
  CloudRain,
  Sun,
  Zap,
  ThermometerSun,
  RefreshCw,
  Send,
  AlertTriangle,
  Radio,
  Clock,
  CheckCircle,
  XCircle,
  ShieldAlert,
} from 'lucide-react';

interface Village {
  id: string;
  name: string;
  mandal: string;
  district: string;
  latitude: number;
  longitude: number;
  is_demo: boolean;
}

interface DailyWeather {
  date: string;
  tempMaxC: number | null;
  tempMinC: number | null;
  precipitationSumMm: number;
  precipitationProbabilityMax: number | null;
  weatherCode: number | null;
  et0FaoEvapotranspiration: number | null;
  isForecast: boolean;
  isDemo: boolean;
  source: 'openmeteo' | 'mock' | 'manual';
}

interface WeatherAlert {
  id: string;
  village_id: string;
  village_name: string;
  alert_type: string;
  severity: 'advisory' | 'warning' | 'critical';
  target_date: string;
  headline_en: string;
  headline_te: string;
  message_en: string;
  message_te: string;
  suggested_action_en?: string;
  suggested_action_te?: string;
  source: 'system' | 'manual';
  created_at: string;
}

interface CommLog {
  id: string;
  farmer_name: string;
  farmer_phone: string;
  village_name?: string;
  channel: string;
  purpose: string;
  message_body: string;
  status: 'queued' | 'sent' | 'delivered' | 'failed' | 'blocked';
  error_reason?: string;
  is_simulated: boolean;
  created_at: string;
}

export const WeatherAlertsPage: React.FC = () => {
  const { user } = useAuth();
  const [villages, setVillages] = useState<Village[]>([]);
  const [selectedVillageId, setSelectedVillageId] = useState<string>('');
  const [forecastData, setForecastData] = useState<DailyWeather[]>([]);
  const [weatherMeta, setWeatherMeta] = useState<{ source?: string; isDemo?: boolean; cachedAt?: string }>({});
  const [alerts, setAlerts] = useState<WeatherAlert[]>([]);
  const [commLogs, setCommLogs] = useState<CommLog[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Manual Advisory Modal State
  const [isAdvisoryModalOpen, setIsAdvisoryModalOpen] = useState<boolean>(false);
  const [advisoryForm, setAdvisoryForm] = useState({
    headlineEn: '',
    headlineTe: '',
    messageEn: '',
    messageTe: '',
    suggestedActionEn: '',
    suggestedActionTe: '',
    severity: 'advisory' as 'advisory' | 'warning' | 'critical',
    notifyFarmers: true,
  });
  const [isSubmittingAdvisory, setIsSubmittingAdvisory] = useState<boolean>(false);

  // 1. Initial Load of Villages
  useEffect(() => {
    async function loadVillages() {
      try {
        const res = await apiRequest<{ villages: Village[] } | Village[]>('/reference/villages');
        const list = Array.isArray(res) ? res : res.villages || [];
        setVillages(list);
        if (list.length > 0) {
          setSelectedVillageId(list[0].id);
        }
      } catch (err: any) {
        setError(err.message || 'Failed to load villages');
      }
    }
    loadVillages();
  }, []);

  // 2. Fetch Village Weather & Alerts
  useEffect(() => {
    if (!selectedVillageId) return;

    async function loadVillageData() {
      setIsLoading(true);
      setError(null);
      try {
        const weatherRes = await apiRequest<{
          forecast: DailyWeather[];
          source: string;
          isDemo: boolean;
          cachedAt: string;
        }>(`/weather/villages/${selectedVillageId}`);

        setForecastData(weatherRes.forecast || []);
        setWeatherMeta({
          source: weatherRes.source,
          isDemo: weatherRes.isDemo,
          cachedAt: weatherRes.cachedAt,
        });

        const alertsRes = await apiRequest<WeatherAlert[]>(`/weather/alerts?villageId=${selectedVillageId}`);
        setAlerts(alertsRes || []);

        const logsRes = await apiRequest<{ logs: CommLog[] }>('/communication/logs?limit=15');
        setCommLogs(logsRes.logs || []);
      } catch (err: any) {
        setError(err.message || 'Failed to load weather data');
      } finally {
        setIsLoading(false);
      }
    }

    loadVillageData();
  }, [selectedVillageId]);

  // Force Refresh Weather
  const handleRefresh = async () => {
    if (!selectedVillageId) return;
    setIsRefreshing(true);
    try {
      const weatherRes = await apiRequest<{
        forecast: DailyWeather[];
        source: string;
        isDemo: boolean;
        cachedAt: string;
      }>(`/weather/villages/${selectedVillageId}/refresh`, { method: 'POST' });

      setForecastData(weatherRes.forecast || []);
      setWeatherMeta({
        source: weatherRes.source,
        isDemo: weatherRes.isDemo,
        cachedAt: weatherRes.cachedAt,
      });

      const alertsRes = await apiRequest<WeatherAlert[]>(`/weather/alerts?villageId=${selectedVillageId}`);
      setAlerts(alertsRes || []);

      const logsRes = await apiRequest<{ logs: CommLog[] }>('/communication/logs?limit=15');
      setCommLogs(logsRes.logs || []);
    } catch (err: any) {
      setError(err.message || 'Refresh failed');
    } finally {
      setIsRefreshing(false);
    }
  };

  // Submit Manual Advisory
  const handlePublishAdvisory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedVillageId) return;
    setIsSubmittingAdvisory(true);
    try {
      await apiRequest('/weather/alerts/manual', {
        method: 'POST',
        body: JSON.stringify({
          villageId: selectedVillageId,
          ...advisoryForm,
        }),
      });

      setIsAdvisoryModalOpen(false);
      setAdvisoryForm({
        headlineEn: '',
        headlineTe: '',
        messageEn: '',
        messageTe: '',
        suggestedActionEn: '',
        suggestedActionTe: '',
        severity: 'advisory',
        notifyFarmers: true,
      });

      // Reload alerts and logs
      const alertsRes = await apiRequest<WeatherAlert[]>(`/weather/alerts?villageId=${selectedVillageId}`);
      setAlerts(alertsRes || []);

      const logsRes = await apiRequest<{ logs: CommLog[] }>('/communication/logs?limit=15');
      setCommLogs(logsRes.logs || []);
    } catch (err: any) {
      alert(`Failed to publish advisory: ${err.message}`);
    } finally {
      setIsSubmittingAdvisory(false);
    }
  };

  const getWeatherIcon = (code: number | null, rainMm: number) => {
    if (code && [95, 96, 99].includes(code)) {
      return <Zap className="w-8 h-8 text-amber-500 animate-pulse" />;
    }
    if (rainMm >= 2.5 || (code && code >= 50 && code <= 69)) {
      return <CloudRain className="w-8 h-8 text-blue-500" />;
    }
    if (code && code <= 1) {
      return <Sun className="w-8 h-8 text-amber-500" />;
    }
    return <CloudSun className="w-8 h-8 text-slate-500" />;
  };

  const getDayName = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-IN', { weekday: 'short', month: 'short', day: 'numeric' });
  };

  return (
    <div className="space-y-6">
      {/* Header and Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight flex items-center gap-2">
            <CloudSun className="w-7 h-7 text-forest-700" />
            వాతావరణ సమాచారం & హెచ్చరికలు
            <span className="text-sm font-normal text-gray-500">(Weather & Advisory Alerts)</span>
          </h1>
          <p className="text-xs text-gray-500 mt-1">
            Open-Meteo forecasts, IMD rule-based alerts, composite deduplication, and automated SMS fan-out.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <select
            value={selectedVillageId}
            onChange={(e) => setSelectedVillageId(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-xl text-sm font-medium bg-white shadow-sm focus:ring-2 focus:ring-forest-500 focus:outline-none"
          >
            {villages.map((v) => (
              <option key={v.id} value={v.id}>
                📍 {v.name} ({v.mandal})
              </option>
            ))}
          </select>

          <Button
            variant="outline"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="flex items-center gap-1.5 text-xs"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>

          {(user?.role === 'ADMIN' || user?.role === 'CSP_MEMBER') && (
            <Button
              variant="primary"
              onClick={() => setIsAdvisoryModalOpen(true)}
              className="flex items-center gap-1.5 text-xs"
            >
              <Send className="w-3.5 h-3.5" />
              Publish Advisory
            </Button>
          )}
        </div>
      </div>

      {/* Provider & Freshness Status Banner */}
      <div className="bg-white border border-gray-200 rounded-xl p-3 shadow-xs flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="text-gray-500">Data Source:</span>
          {weatherMeta.source === 'openmeteo' ? (
            <span className="inline-flex items-center gap-1 font-semibold text-forest-700 bg-forest-50 px-2 py-0.5 rounded border border-forest-200">
              <Radio className="w-3 h-3 text-forest-600 animate-pulse" />
              Open-Meteo Live API (Modelled)
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
              ⚠️ Mock Engine (DEMO)
            </span>
          )}
        </div>

        {weatherMeta.cachedAt && (
          <div className="flex items-center gap-1 text-gray-400">
            <Clock className="w-3.5 h-3.5" />
            <span>Updated: {new Date(weatherMeta.cachedAt).toLocaleTimeString('en-IN')}</span>
          </div>
        )}
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 text-xs p-3 rounded-xl border border-red-200 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* 7-Day Forecast Grid */}
      <div>
        <h2 className="text-sm font-bold text-gray-800 uppercase tracking-wider mb-3">
          7-Day Forecast & Evapotranspiration
        </h2>

        {isLoading ? (
          <div className="p-12 text-center text-gray-400 text-sm">Loading weather data...</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-3">
            {forecastData.map((day) => {
              const hasAlertPotential =
                day.precipitationSumMm >= 2.5 ||
                (day.tempMaxC != null && day.tempMaxC >= 40.0) ||
                (day.weatherCode != null && [95, 96, 99].includes(day.weatherCode));

              return (
                <div
                  key={day.date}
                  className={`bg-white rounded-2xl p-3.5 border transition-all ${
                    hasAlertPotential
                      ? 'border-amber-400 shadow-sm bg-amber-50/20'
                      : 'border-gray-200 hover:border-forest-300'
                  }`}
                >
                  <p className="text-xs font-semibold text-gray-600 truncate">{getDayName(day.date)}</p>
                  <div className="my-2.5 flex justify-center">
                    {getWeatherIcon(day.weatherCode, day.precipitationSumMm)}
                  </div>

                  <div className="space-y-1 text-center">
                    <p className="text-base font-bold text-gray-900">
                      {day.tempMaxC != null ? `${day.tempMaxC}°` : '--'}
                      <span className="text-xs font-normal text-gray-400 ml-1">
                        {day.tempMinC != null ? `${day.tempMinC}°` : ''}
                      </span>
                    </p>

                    <div className="flex items-center justify-center gap-1 text-[11px] font-medium text-blue-600">
                      <CloudRain className="w-3 h-3" />
                      <span>{day.precipitationSumMm} mm</span>
                      {day.precipitationProbabilityMax != null && (
                        <span className="text-gray-400">({day.precipitationProbabilityMax}%)</span>
                      )}
                    </div>

                    {day.et0FaoEvapotranspiration != null && (
                      <p className="text-[10px] text-gray-500">
                        ET₀: <span className="font-semibold">{day.et0FaoEvapotranspiration}</span> mm/d
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Active Alerts & Advisories */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-gray-800 uppercase tracking-wider flex items-center gap-1.5">
              <ShieldAlert className="w-4 h-4 text-amber-600" />
              Active Village Alerts ({alerts.length})
            </h2>
            <Badge variant="warning">Deduplicated</Badge>
          </div>

          <div className="space-y-3">
            {alerts.length === 0 ? (
              <Card>
                <div className="py-8 text-center text-gray-400 text-xs">
                  No active weather alerts or warnings currently for this village.
                </div>
              </Card>
            ) : (
              alerts.map((a) => (
                <div
                  key={a.id}
                  className="bg-white rounded-xl p-4 border border-gray-200 shadow-xs space-y-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <Badge
                        variant={
                          a.severity === 'critical'
                            ? 'danger'
                            : a.severity === 'warning'
                            ? 'warning'
                            : 'info'
                        }
                      >
                        {a.severity.toUpperCase()}
                      </Badge>
                      <h3 className="text-sm font-bold text-gray-900 mt-1">{a.headline_en}</h3>
                      <p className="text-xs font-semibold text-forest-800">{a.headline_te}</p>
                    </div>
                    <span className="text-[10px] text-gray-400 shrink-0">
                      {new Date(a.created_at).toLocaleDateString('en-IN')}
                    </span>
                  </div>

                  <p className="text-xs text-gray-600">{a.message_en}</p>
                  <p className="text-xs text-gray-600 font-medium">{a.message_te}</p>

                  {(a.suggested_action_en || a.suggested_action_te) && (
                    <div className="bg-forest-50/60 border border-forest-100 rounded-lg p-2.5 text-xs text-forest-900 mt-2">
                      <span className="font-bold">సూచన / Advisory:</span>{' '}
                      {a.suggested_action_te || a.suggested_action_en}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Communication Audit Trail */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-gray-800 uppercase tracking-wider flex items-center gap-1.5">
              <Radio className="w-4 h-4 text-forest-600" />
              Communication Audit Trail
            </h2>
            <span className="text-xs text-gray-400">Append-Only Logs</span>
          </div>

          <Card>
            <div className="overflow-x-auto max-h-[380px] overflow-y-auto">
              <table className="w-full text-left text-xs text-gray-600">
                <thead className="bg-gray-50 text-[11px] font-semibold text-gray-500 border-b border-gray-200 sticky top-0">
                  <tr>
                    <th className="py-2.5 px-3">Farmer</th>
                    <th className="py-2.5 px-3">Purpose</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {commLogs.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-6 text-center text-gray-400">
                        No outbound messages logged yet.
                      </td>
                    </tr>
                  ) : (
                    commLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-gray-50/50">
                        <td className="py-2.5 px-3 font-medium text-gray-900">
                          {log.farmer_name || log.farmer_phone}
                          <span className="block text-[10px] text-gray-400">{log.farmer_phone}</span>
                        </td>
                        <td className="py-2.5 px-3">
                          <span className="capitalize">{log.purpose.replace('_', ' ')}</span>
                          {log.is_simulated && (
                            <span className="ml-1 text-[9px] bg-amber-100 text-amber-700 px-1 py-0.2 rounded font-bold">
                              SIM
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3">
                          {log.status === 'sent' || log.status === 'delivered' ? (
                            <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                              <CheckCircle className="w-3 h-3 text-emerald-600" /> Sent
                            </span>
                          ) : log.status === 'blocked' ? (
                            <span className="inline-flex items-center gap-1 text-amber-700 font-semibold" title={log.error_reason}>
                              <XCircle className="w-3 h-3 text-amber-600" /> Blocked ({log.error_reason})
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-red-600 font-semibold" title={log.error_reason}>
                              <XCircle className="w-3 h-3 text-red-500" /> Failed
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-gray-400 whitespace-nowrap">
                          {new Date(log.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </div>

      {/* Manual Advisory Modal */}
      <Modal
        isOpen={isAdvisoryModalOpen}
        onClose={() => setIsAdvisoryModalOpen(false)}
        title="ప్రభుత్వ / వ్యవసాయ అధికారి సూచన (Publish Advisory)"
      >
        <form onSubmit={handlePublishAdvisory} className="space-y-4 text-xs">
          <p className="text-gray-500">
            Publish an official bilingual advisory to farmers in {villages.find(v => v.id === selectedVillageId)?.name}.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label="Headline (English)"
              required
              value={advisoryForm.headlineEn}
              onChange={(e) => setAdvisoryForm({ ...advisoryForm, headlineEn: e.target.value })}
              placeholder="e.g. Canal Water Release Alert"
            />
            <Input
              label="Headline (Telugu - తెలుగు)"
              required
              value={advisoryForm.headlineTe}
              onChange={(e) => setAdvisoryForm({ ...advisoryForm, headlineTe: e.target.value })}
              placeholder="ఉదా: కాలువ నీటి విడుదల హెచ్చరిక"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Message (English)</label>
              <textarea
                required
                rows={3}
                value={advisoryForm.messageEn}
                onChange={(e) => setAdvisoryForm({ ...advisoryForm, messageEn: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-xl text-xs focus:ring-2 focus:ring-forest-500 focus:outline-none"
                placeholder="Water rotation starts tomorrow morning..."
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Message (Telugu - తెలుగు)</label>
              <textarea
                required
                rows={3}
                value={advisoryForm.messageTe}
                onChange={(e) => setAdvisoryForm({ ...advisoryForm, messageTe: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-xl text-xs focus:ring-2 focus:ring-forest-500 focus:outline-none"
                placeholder="రేపు ఉదయం కాలువ నీరు అందుబాటులోకి రానుంది..."
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label="Action Recommendation (English)"
              value={advisoryForm.suggestedActionEn}
              onChange={(e) => setAdvisoryForm({ ...advisoryForm, suggestedActionEn: e.target.value })}
              placeholder="Clean field channels"
            />
            <Input
              label="Action Recommendation (Telugu - తెలుగు)"
              value={advisoryForm.suggestedActionTe}
              onChange={(e) => setAdvisoryForm({ ...advisoryForm, suggestedActionTe: e.target.value })}
              placeholder="మురుగు కాలువలు సిద్ధం చేసుకోండి"
            />
          </div>

          <div className="flex items-center gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Severity Level</label>
              <select
                value={advisoryForm.severity}
                onChange={(e) => setAdvisoryForm({ ...advisoryForm, severity: e.target.value as any })}
                className="px-3 py-2 border border-gray-300 rounded-xl text-xs bg-white focus:ring-2 focus:ring-forest-500 focus:outline-none"
              >
                <option value="advisory">Advisory (సలహా)</option>
                <option value="warning">Warning (హెచ్చరిక)</option>
                <option value="critical">Critical (తీవ్రమైన)</option>
              </select>
            </div>

            <div className="flex items-center gap-2 pt-4">
              <input
                type="checkbox"
                id="notifyFarmers"
                checked={advisoryForm.notifyFarmers}
                onChange={(e) => setAdvisoryForm({ ...advisoryForm, notifyFarmers: e.target.checked })}
                className="w-4 h-4 text-forest-600 rounded border-gray-300 focus:ring-forest-500"
              />
              <label htmlFor="notifyFarmers" className="text-xs text-gray-700 font-medium">
                Broadcast SMS to registered village farmers
              </label>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-gray-100">
            <Button variant="secondary" type="button" onClick={() => setIsAdvisoryModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={isSubmittingAdvisory}>
              {isSubmittingAdvisory ? 'Publishing...' : 'Publish Advisory'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
