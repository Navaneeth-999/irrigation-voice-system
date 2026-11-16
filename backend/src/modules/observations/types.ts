export type ObservationCategory =
  | 'farmer_interview'
  | 'irrigation_source'
  | 'water_scarcity'
  | 'canal_infrastructure';

export type ConsentMethod =
  | 'written_form'
  | 'audio_recorded'
  | 'verbal_panchayat_witness'
  | 'not_applicable';

export interface FieldObservation {
  id: string;
  villageId: string;
  villageName?: string;
  mandal?: string;
  district?: string;
  farmerId?: string | null;
  farmerName?: string | null;
  farmerCode?: string | null;
  plotId?: string | null;
  observationDate: string; // YYYY-MM-DD
  category: ObservationCategory;
  title: string;
  caption: string;
  photoStorageKey: string;
  photoUrl: string; // Authorized endpoint URL
  fileSizeBytes: number;
  mimeType: string;
  surveyorName?: string | null;
  consentVerified: boolean;
  consentMethod?: ConsentMethod | null;
  consentNotes?: string | null;
  consentWithdrawn: boolean;
  consentWithdrawnAt?: string | null;
  consentWithdrawnReason?: string | null;
  isPublished: boolean;
  createdBy?: string | null;
  createdByName?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateObservationDTO {
  villageId: string;
  farmerId?: string | null;
  plotId?: string | null;
  observationDate: string;
  category: ObservationCategory;
  title: string;
  caption: string;
  surveyorName?: string;
  consentVerified?: boolean;
  consentMethod?: ConsentMethod;
  consentNotes?: string;
  isPublished?: boolean;
}

export interface UpdateObservationDTO {
  title?: string;
  caption?: string;
  category?: ObservationCategory;
  farmerId?: string | null;
  plotId?: string | null;
  observationDate?: string;
  surveyorName?: string;
  consentVerified?: boolean;
  consentMethod?: ConsentMethod;
  consentNotes?: string;
  isPublished?: boolean;
}

export interface WithdrawConsentDTO {
  reason: string;
}

export interface WaterSourceStat {
  sourceType: string;
  count: number;
  percentage: number;
}

export interface SurveySummary {
  respondentCount: {
    distinctFarmers: number;
    distinctVillages: number;
    genuineFarmersCount: number;
    demoFarmersCount: number;
    feedbackCyclesRecorded: number;
    totalCallAttempts: number;
    scheduledCallsCount: number;
  };
  irrigationSources: {
    totalPlotsSampled: number;
    breakdown: WaterSourceStat[];
  };
  waterChallenges: {
    totalResponsesWithWaterStatus: number; // Denominator
    shortageCount: number;
    shortagePercentage: number | null; // null if denominator is 0
    adequateCount: number;
    adequatePercentage: number | null;
  };
  cropConditions: {
    totalResponsesWithCondition: number;
    normalCount: number;
    stressCount: number;
    pestOrDiseaseCount: number;
  };
  fieldObservations: {
    totalObservationsCount: number;
    withVerifiedConsentCount: number;
    byCategory: Record<ObservationCategory, number>;
  };
  calculatedAt: string;
}
