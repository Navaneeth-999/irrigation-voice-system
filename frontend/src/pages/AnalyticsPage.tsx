import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams, Link } from 'react-router-dom';
import { apiRequest } from '../api/client.js';
import { Card } from '../components/ui/Card.js';
import { Badge } from '../components/ui/Badge.js';
import { Button } from '../components/ui/Button.js';
import {
  Droplets,
  Sprout,
  AlertTriangle,
  CloudRain,
  ShieldCheck,
  RefreshCw,
  Info,
  Calendar,
  Layers,
  ArrowRight,
} from 'lucide-react';
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from 'recharts';

export const AnalyticsPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();

  // 1. Fetch all seasons for selector
  const { data: seasonsData, isLoading: isLoadingSeasons } = useQuery<{ data: any[] }>({
    queryKey: ['seasons-list'],
    queryFn: () => apiRequest<{ data: any[] }>('/seasons?limit=50'),
  });

  const seasons = seasonsData?.data || [];
  const selectedSeasonId = searchParams.get('seasonId') || (seasons.length > 0 ? seasons[0].id : '');

  // 2. Fetch analytics payload for selected season
  const { data: analyticsData, isLoading: isLoadingAnalytics, error } = useQuery<{
    success: boolean;
    data: {
      metrics: any;
      dailyRecords: any[];
      actionItems: any[];
    };
  }>({
    queryKey: ['season-analytics', selectedSeasonId],
    queryFn: () => apiRequest(`/analytics/seasons/${selectedSeasonId}`),
    enabled: Boolean(selectedSeasonId),
  });

  // 3. Recalculate mutation
  const recalculateMutation = useMutation({
    mutationFn: () => apiRequest(`/analytics/seasons/${selectedSeasonId}/recalculate`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['season-analytics', selectedSeasonId] });
      alert('Season analytics successfully recalculated.');
    },
    onError: (err: any) => alert(err.message),
  });

  const analytics = analyticsData?.data;
  const metrics = analytics?.metrics;
  const dailyRecords = analytics?.dailyRecords || [];
  const actionItems = analytics?.actionItems || [];

  // Selected season metadata
  const currentSeason = seasons.find((s) => s.id === selectedSeasonId);

  // Format chart data (Cumulative vs Daily)
  let cumulativeDemandM3 = 0;
  let cumulativeAppliedM3 = 0;
  let cumulativeRainM3 = 0;
  const areaAcres = parseFloat(currentSeason?.area_acres_snapshot || '1.0');

  const chartData = dailyRecords.map((d: any) => {
    const dailyDemandM3 = (parseFloat(d.etc_mm || 0) * areaAcres * 4.04686);
    const dailyAppliedM3 = (parseFloat(d.irrigation_applied_litres || 0) / 1000);
    const dailyRainM3 = (parseFloat(d.effective_rainfall_mm || 0) * areaAcres * 4.04686);

    cumulativeDemandM3 += dailyDemandM3;
    cumulativeAppliedM3 += dailyAppliedM3;
    cumulativeRainM3 += dailyRainM3;

    return {
      date: d.record_date?.split('T')?.[0]?.slice(5) || `D${d.das}`,
      das: d.das,
      stage: d.crop_stage_name,
      etcMm: parseFloat(d.etc_mm || 0),
      rainMm: parseFloat(d.rainfall_mm || 0),
      effRainMm: parseFloat(d.effective_rainfall_mm || 0),
      appliedMm: parseFloat(d.irrigation_applied_mm || 0),
      pondingDepthMm: parseFloat(d.ponding_depth_mm || 0),
      dailyDemandM3: Math.round(dailyDemandM3),
      dailyAppliedM3: Math.round(dailyAppliedM3),
      cumDemandM3: Math.round(cumulativeDemandM3),
      cumAppliedM3: Math.round(cumulativeAppliedM3),
      cumRainM3: Math.round(cumulativeRainM3),
    };
  });

  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight flex items-center gap-2">
            <span>Water Analytics & FAO-56 Engine</span>
            <span className="text-sm font-normal text-gray-500">(నీటి లెక్కలు & పంట సమతుల్యత)</span>
          </h1>
          <p className="text-xs text-gray-500 mt-1">
            Standard FAO-56 dual-crop coefficient modeling, rice ponding water balance, and non-competitive water use ratio.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <select
            value={selectedSeasonId}
            onChange={(e) => setSearchParams({ seasonId: e.target.value })}
            className="text-xs bg-white border border-gray-300 rounded-lg px-3 py-2 font-medium text-gray-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-water-500"
          >
            {seasons.map((s) => (
              <option key={s.id} value={s.id}>
                {s.season_code} - {s.crop_name} ({s.farmer_name})
              </option>
            ))}
          </select>

          <Button
            size="sm"
            variant="secondary"
            onClick={() => recalculateMutation.mutate()}
            disabled={recalculateMutation.isPending || !selectedSeasonId}
            className="flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${recalculateMutation.isPending ? 'animate-spin' : ''}`} />
            <span>Recalculate (తిరిగి లెక్కించు)</span>
          </Button>
        </div>
      </div>

      {/* DIRECTIVE 1: Prominent Unvalidated Assumptions Alert Banner */}
      {metrics?.has_unvalidated_assumptions && (
        <div className="bg-amber-50 border-l-4 border-amber-500 p-4 rounded-r-xl shadow-sm">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
            <div className="space-y-1.5">
              <h4 className="text-sm font-bold text-amber-900 flex items-center gap-2">
                <span>Based on Unvalidated Assumptions</span>
                <span className="text-xs font-normal text-amber-700">(ధృవీకరించబడని అంచనాల ఆధారంగా)</span>
              </h4>
              <p className="text-xs text-amber-800 leading-relaxed">
                Some crop coefficients (Kc), paddy percolation rates, or effective rainfall parameters used in these
                calculations are provisional baseline engineering heuristics. They have not yet been calibrated against
                certified published agricultural research for this specific micro-region.
              </p>
              {metrics.unvalidated_assumptions_list?.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {metrics.unvalidated_assumptions_list.map((item: string, idx: number) => (
                    <span
                      key={idx}
                      className="inline-flex items-center text-[10px] font-semibold bg-amber-100 text-amber-800 px-2 py-0.5 rounded-md border border-amber-300"
                    >
                      {item}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Top Metric Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* DIRECTIVE 3: Non-Competitive Water Use Ratio (WUR) Band */}
        <Card className="border-t-4 border-t-water-600">
          <div className="p-4 space-y-2">
            <div className="flex items-center justify-between text-xs text-gray-500">
              <span className="font-semibold uppercase tracking-wider">Water Use Ratio</span>
              <Droplets className="w-4 h-4 text-water-600" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-black text-gray-900">
                {metrics?.water_use_ratio != null ? metrics.water_use_ratio : '—'}
              </span>
              <span className="text-xs text-gray-500 font-medium">Applied / Demand</span>
            </div>
            <div>
              {metrics?.ratio_band === 'near_estimate' && (
                <Badge variant="success">Near Agronomic Target</Badge>
              )}
              {metrics?.ratio_band === 'below_estimate' && (
                <Badge variant="warning">Below Estimated Demand</Badge>
              )}
              {metrics?.ratio_band === 'above_estimate' && (
                <Badge variant="info">Above Estimated Demand</Badge>
              )}
            </div>
            <p className="text-[11px] text-gray-500 leading-tight">
              Indicative comparison against FAO-56 crop demand. No competitive farmer rankings.
            </p>
          </div>
        </Card>

        {/* Total Applied Water Volume */}
        <Card className="border-t-4 border-t-emerald-600">
          <div className="p-4 space-y-2">
            <div className="flex items-center justify-between text-xs text-gray-500">
              <span className="font-semibold uppercase tracking-wider">Total Water Applied</span>
              <Layers className="w-4 h-4 text-emerald-600" />
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-black text-gray-900">
                {metrics?.total_applied_m3 != null ? Number(metrics.total_applied_m3).toLocaleString() : '0'}
              </span>
              <span className="text-xs text-gray-500 font-medium">m³ ({metrics?.total_applied_litres ? (Number(metrics.total_applied_litres) / 100000).toFixed(1) + ' Lakh L' : '0 L'})</span>
            </div>
            <div className="text-xs text-gray-600 flex items-center justify-between pt-1">
              <span>Applied Depth:</span>
              <span className="font-bold">{metrics?.total_applied_mm || 0} mm</span>
            </div>
          </div>
        </Card>

        {/* Net Crop Water Requirement (ETc - Peff) */}
        <Card className="border-t-4 border-t-indigo-600">
          <div className="p-4 space-y-2">
            <div className="flex items-center justify-between text-xs text-gray-500">
              <span className="font-semibold uppercase tracking-wider">Net Crop Requirement</span>
              <Sprout className="w-4 h-4 text-indigo-600" />
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-black text-gray-900">
                {metrics?.net_irrigation_demand_m3 != null ? Number(metrics.net_irrigation_demand_m3).toLocaleString() : '0'}
              </span>
              <span className="text-xs text-gray-500 font-medium">m³ net</span>
            </div>
            <div className="text-xs text-gray-600 flex items-center justify-between pt-1">
              <span>Gross (with eff.):</span>
              <span className="font-bold">{metrics?.gross_irrigation_demand_m3 || 0} m³</span>
            </div>
          </div>
        </Card>

        {/* Data Confidence Score */}
        <Card className="border-t-4 border-t-purple-600">
          <div className="p-4 space-y-2">
            <div className="flex items-center justify-between text-xs text-gray-500">
              <span className="font-semibold uppercase tracking-wider">Data Confidence</span>
              <ShieldCheck className="w-4 h-4 text-purple-600" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-black text-gray-900">
                {metrics?.confidence_score != null ? metrics.confidence_score : 0}%
              </span>
              <Badge variant={metrics?.confidence_band === 'high' ? 'success' : metrics?.confidence_band === 'medium' ? 'warning' : 'danger'}>
                {metrics?.confidence_band?.toUpperCase() || 'LOW'}
              </Badge>
            </div>
            <div className="text-[11px] text-gray-500 flex items-center justify-between">
              <span>Certificate Eligible:</span>
              <span className={`font-bold ${metrics?.confidence_breakdown?.certificateEligible ? 'text-emerald-600' : 'text-gray-400'}`}>
                {metrics?.confidence_breakdown?.certificateEligible ? 'YES (≥70%)' : 'NO (<70%)'}
              </span>
            </div>
          </div>
        </Card>
      </div>

      {/* Main Analytics Visualizations */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Cumulative Water Balance Chart */}
        <Card className="lg:col-span-2 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-gray-900">Cumulative Seasonal Water Balance</h3>
              <p className="text-xs text-gray-500">Net FAO-56 crop demand vs. actual applied irrigation volume over DAS</p>
            </div>
            <div className="text-xs font-semibold px-2.5 py-1 bg-gray-100 rounded-md text-gray-600">
              Area: {areaAcres} Acres
            </div>
          </div>

          <div className="h-72 w-full pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis unit=" m³" tick={{ fontSize: 11 }} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#fff', borderRadius: '8px', fontSize: '12px', border: '1px solid #E5E7EB' }}
                />
                <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                <Line
                  type="monotone"
                  dataKey="cumDemandM3"
                  name="Crop Demand (ETc) [m³]"
                  stroke="#4F46E5"
                  strokeWidth={2.5}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="cumAppliedM3"
                  name="Applied Irrigation [m³]"
                  stroke="#0284C7"
                  strokeWidth={2.5}
                  dot={{ r: 3 }}
                />
                <Bar
                  dataKey="cumRainM3"
                  name="Effective Rain [m³]"
                  fill="#10B981"
                  opacity={0.4}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Right 1 Col: Data Confidence Breakdown */}
        <Card className="p-5 space-y-4">
          <div>
            <h3 className="text-base font-bold text-gray-900">Confidence Scoring Breakdown</h3>
            <p className="text-xs text-gray-500">4-dimension empirical integrity assessment (ASSUMPTIONS.md Section 5)</p>
          </div>

          <div className="space-y-3.5 pt-1">
            {/* Dimension 1: Response Coverage (40%) */}
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="font-medium text-gray-700">Response Coverage</span>
                <span className="font-bold text-gray-900">{metrics?.confidence_breakdown?.responseCoverage || 0} / 40 pts</span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-2">
                <div
                  className="bg-water-600 h-2 rounded-full"
                  style={{ width: `${((metrics?.confidence_breakdown?.responseCoverage || 0) / 40) * 100}%` }}
                />
              </div>
            </div>

            {/* Dimension 2: Data Completeness (30%) */}
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="font-medium text-gray-700">Data Completeness</span>
                <span className="font-bold text-gray-900">{metrics?.confidence_breakdown?.dataCompleteness || 0} / 30 pts</span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-2">
                <div
                  className="bg-indigo-600 h-2 rounded-full"
                  style={{ width: `${((metrics?.confidence_breakdown?.dataCompleteness || 0) / 30) * 100}%` }}
                />
              </div>
            </div>

            {/* Dimension 3: Field Evidence (15%) */}
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="font-medium text-gray-700">Field Evidence Verification</span>
                <span className="font-bold text-gray-900">{metrics?.confidence_breakdown?.fieldEvidence || 0} / 15 pts</span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-2">
                <div
                  className="bg-emerald-600 h-2 rounded-full"
                  style={{ width: `${((metrics?.confidence_breakdown?.fieldEvidence || 0) / 15) * 100}%` }}
                />
              </div>
            </div>

            {/* Dimension 4: Anomaly Consistency (15%) */}
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="font-medium text-gray-700">Consistency (No Anomalies)</span>
                <span className="font-bold text-gray-900">{metrics?.confidence_breakdown?.anomalyConsistency || 0} / 15 pts</span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-2">
                <div
                  className="bg-purple-600 h-2 rounded-full"
                  style={{ width: `${((metrics?.confidence_breakdown?.anomalyConsistency || 0) / 15) * 100}%` }}
                />
              </div>
            </div>
          </div>

          <div className="pt-3 border-t border-gray-100 flex items-center justify-between text-xs">
            <span className="text-gray-500">Season Details</span>
            <Link
              to={`/seasons/${selectedSeasonId}`}
              className="text-forest-600 hover:text-forest-700 font-bold flex items-center gap-1"
            >
              <span>View Season</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </Card>
      </div>

      {/* DIRECTIVE 4: Anomaly & Review Section */}
      {actionItems.length > 0 && (
        <Card className="p-5 space-y-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600" />
            <h3 className="text-base font-bold text-gray-900">Agronomic Anomaly Flags & Review Items</h3>
          </div>
          <p className="text-xs text-gray-500">
            Automated anomaly detection scans evaluating physical pump hours (&gt;336 hrs/fortnight) and rain-irrigation conflicts.
          </p>
          <div className="divide-y divide-gray-100">
            {actionItems.map((item: any) => (
              <div key={item.id} className="py-2.5 flex items-center justify-between text-xs">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Badge variant={item.priority === 'critical' ? 'danger' : 'warning'}>
                      {item.type || 'ANOMALY'}
                    </Badge>
                    <span className="font-semibold text-gray-800">{item.referral_note}</span>
                  </div>
                  <div className="text-[11px] text-gray-400">
                    Logged: {new Date(item.created_at).toLocaleDateString()}
                  </div>
                </div>
                <Badge variant={item.status === 'open' ? 'warning' : 'success'}>
                  {item.status.toUpperCase()}
                </Badge>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
};
