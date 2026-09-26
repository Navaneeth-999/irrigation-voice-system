import { WaterUseRatioBand, ConfidenceBand, ConfidenceBreakdown } from '../analytics/types.js';

export interface ImmutableSeasonSnapshot {
  schemaVersion: string;
  seasonId: string;
  seasonCode: string;
  seasonType: string;
  seasonYear: number;
  sowingDate: string;
  actualHarvestDate: string;
  yieldQuantity: number | null;
  yieldUnit: string | null;
  areaAcres: number;
  farmer: {
    id: string;
    farmerCode: string;
    fullName: string;
    preferredLanguage: string;
    villageName: string;
    mandal: string;
    district: string;
  };
  plot: {
    id: string;
    label: string;
    areaAcres: number;
    waterSourceTypes: string[];
    irrigationMethod: string;
    typicalEfficiency: number;
  };
  crop: {
    id: string;
    name: string;
    nameTe: string;
    category: string;
    waterModel: string;
  };
  waterMetrics: {
    totalEtcMm: number;
    totalEtcM3: number;
    totalEffectiveRainMm: number;
    totalEffectiveRainM3: number;
    netIrrigationDemandMm: number;
    netIrrigationDemandM3: number;
    totalAppliedLitres: number;
    totalAppliedM3: number;
    totalAppliedMm: number;
    waterUseRatio: number;
    ratioBand: WaterUseRatioBand;
    confidenceScore: number;
    confidenceBand: ConfidenceBand;
    confidenceBreakdown: ConfidenceBreakdown;
    hasUnvalidatedAssumptions: boolean;
    unvalidatedAssumptionsList: string[];
    anomalyFlags: string[];
  };
  irrigationRecordsSummary: {
    totalLogsCount: number;
    totalHoursReported: number;
    totalEstimatedVolumeL: number;
  };
  feedbackSummary: {
    totalCyclesRecorded: number;
    rainClassesReported: string[];
  };
  snapshotGeneratedAt: string;
}

export interface CertificateRecord {
  id: string;
  certificateCode: string;
  seasonId: string;
  farmerId: string;
  plotId: string;
  cropId: string;
  waterUseRatio: number;
  waterUseRatioBand: WaterUseRatioBand;
  confidenceScore: number;
  confidenceBand: ConfidenceBand;
  estimatedWaterSavedLitres: number;
  actualHarvestDate: string;
  yieldQuantity: number | null;
  yieldUnit: string | null;
  snapshotData: ImmutableSeasonSnapshot;
  sha256Hash: string;
  pdfPath: string | null;
  verificationToken: string;
  isRevoked: boolean;
  revokedAt?: string | null;
  revocationReason?: string | null;
  revokedBy?: string | null;
  createdBy?: string | null;
  createdAt: string;
}

export interface IssueCertificateRequest {
  seasonId: string;
  actualHarvestDate: string;
  yieldQuantity?: number;
  yieldUnit?: string;
  completionNotes?: string;
  userId?: string;
}

export interface VerificationResult {
  isValid: boolean;
  isRevoked: boolean;
  certificateCode: string;
  issuedAt: string;
  revokedAt?: string | null;
  revocationReason?: string | null;
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
  ratioBand: WaterUseRatioBand;
  confidenceScore: number;
  confidenceBand: ConfidenceBand;
  hasUnvalidatedAssumptions: boolean;
  unvalidatedAssumptionsList: string[];
}
