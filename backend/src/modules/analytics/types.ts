export interface DailyWaterBalanceRecord {
  id?: string;
  seasonId: string;
  recordDate: string; // YYYY-MM-DD
  das: number; // Days after sowing
  cropStageName: string;
  stageKc: number;
  kcVerified: boolean;
  et0Mm: number;
  etcMm: number;
  rainfallMm: number;
  effectiveRainfallMm: number;
  irrigationAppliedMm: number;
  irrigationAppliedLitres: number;
  percolationMm: number;
  drainageOverflowMm: number;
  pondingDepthMm: number;
  soilMoistureDepletionMm: number;
  assumptionsUnvalidated: boolean;
  unvalidatedParams: string[];
}

export type WaterUseRatioBand = 'below_estimate' | 'near_estimate' | 'above_estimate';

export type ConfidenceBand = 'low' | 'medium' | 'high';

export interface ConfidenceBreakdown {
  responseCoverage: number; // 0-40
  dataCompleteness: number; // 0-30
  fieldEvidence: number;    // 0-15
  anomalyConsistency: number; // 0-15
  totalScore: number;       // 0-100
  band: ConfidenceBand;
  certificateEligible: boolean; // >= 70
}

export interface SeasonWaterMetrics {
  seasonId: string;
  totalEtcMm: number;
  totalEtcM3: number;
  totalEffectiveRainMm: number;
  totalEffectiveRainM3: number;
  netIrrigationDemandMm: number;
  netIrrigationDemandM3: number;
  grossIrrigationDemandM3: number;
  grossRecommendedM3: number;
  grossRecommendedLitres: number;
  totalAppliedLitres: number;
  totalAppliedM3: number;
  totalAppliedMm: number;
  waterSavedM3: number;
  waterSavedLitres: number;
  waterSavedPercentage: number | null;
  waterProductivityKgPerM3: number | null;
  netProfitInr: number | null;
  waterUseRatio: number | null;
  ratioBand: WaterUseRatioBand;
  confidenceScore: number;
  confidenceBand: ConfidenceBand;
  confidenceBreakdown: ConfidenceBreakdown;
  hasUnvalidatedAssumptions: boolean;
  unvalidatedAssumptionsList: string[];
  anomalyFlags: string[];
  calculatedAt: string;
}

export interface EffectiveRainfallConfig {
  minThresholdMm: number; // default 5.0
  fraction: number;       // default 0.75
  maxCapMm: number;       // default 35.0
  isVerified?: boolean;   // default false unless locally calibrated
  source?: string;
}

export interface AnomalyEvaluationResult {
  hasAnomaly: boolean;
  anomalyType?: 'IMPLAUSIBLE_PUMP_HOURS' | 'RAIN_IRRIGATION_CONFLICT' | 'CRITICAL_STAGE_WATER_STRESS';
  severity?: 'warning' | 'critical';
  description?: string;
  suggestedAction?: string;
  actionItemType?: string;
}
