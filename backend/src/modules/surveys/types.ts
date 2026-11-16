export type SurveyPeriod = 'weekly' | 'fortnightly' | 'monthly' | 'seasonal_summary';
export type RainfallSource = 'farmer_reported' | 'rain_gauge_measured' | 'external_station' | 'unavailable';
export type WaterAvailabilityStatus = 'adequate' | 'moderate_shortage' | 'severe_scarcity';
export type CropCondition = 'good' | 'average' | 'poor';
export type CropYieldUnit = 'kg' | 'quintal' | 'tonne';
export type MeasurementSource = 'fieldwork_measured' | 'farmer_reported' | 'external_station' | 'estimated' | 'unavailable';
export type DataOrigin = 'real' | 'demo';

export interface FieldSurvey {
  id: string;
  farmerId: string;
  farmerName?: string;
  farmerCode?: string;
  villageId: string;
  villageName?: string;
  mandal?: string;
  district?: string;
  plotId?: string | null;
  plotName?: string | null;
  seasonId?: string | null;
  seasonName?: string | null;
  seasonCode?: string | null;
  surveyDate: string; // YYYY-MM-DD
  surveyPeriod: string;
  cropId?: string | null;
  cropName?: string | null;
  cropStageId?: string | null;
  cropStageName?: string | null;
  areaAcres?: number | null;
  soilType?: string | null;
  waterSourceTypeId?: string | null;
  waterSourceName?: string | null;
  irrigationMethodTypeId?: string | null;
  irrigationMethodName?: string | null;
  irrigationFrequencyDays?: number | null;
  irrigationDurationHours?: number | null;
  pumpDischargeLps?: number | null;
  pumpHoursPerEvent?: number | null;
  irrigationDepthMm?: number | null;
  appliedWaterVolumeM3?: number | null;
  appliedWaterLitres?: number | null;
  rainfallMm?: number | null;
  rainfallSource: RainfallSource;
  waterAvailabilityStatus: WaterAvailabilityStatus;
  cropCondition: CropCondition;
  cropYieldQuantity?: number | null;
  cropYieldUnit?: CropYieldUnit | null;
  cropSalePricePerUnit?: number | null;
  cultivationExpensesInr?: number | null;
  farmerRemarks?: string | null;
  surveyorName?: string | null;
  measurementSource: MeasurementSource;
  dataOrigin: DataOrigin;
  version: number;
  isCorrection: boolean;
  correctedSurveyId?: string | null;
  correctionReason?: string | null;
  createdBy?: string | null;
  createdByName?: string | null;
  updatedBy?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSurveyDTO {
  farmerId: string;
  villageId?: string;
  plotId?: string | null;
  seasonId?: string | null;
  surveyDate: string;
  surveyPeriod?: string;
  cropId?: string | null;
  cropStageId?: string | null;
  areaAcres?: number | null;
  soilType?: string | null;
  waterSourceTypeId?: string | null;
  irrigationMethodTypeId?: string | null;
  irrigationFrequencyDays?: number | null;
  irrigationDurationHours?: number | null;
  pumpDischargeLps?: number | null;
  pumpHoursPerEvent?: number | null;
  irrigationDepthMm?: number | null;
  appliedWaterVolumeM3?: number | null;
  appliedWaterLitres?: number | null;
  rainfallMm?: number | null;
  rainfallSource?: RainfallSource;
  waterAvailabilityStatus?: WaterAvailabilityStatus;
  cropCondition?: CropCondition;
  cropYieldQuantity?: number | null;
  cropYieldUnit?: CropYieldUnit | null;
  cropSalePricePerUnit?: number | null;
  cultivationExpensesInr?: number | null;
  farmerRemarks?: string | null;
  surveyorName?: string | null;
  measurementSource?: MeasurementSource;
  dataOrigin?: DataOrigin;
}

export interface UpdateSurveyDTO {
  surveyDate?: string;
  surveyPeriod?: string;
  cropId?: string | null;
  cropStageId?: string | null;
  areaAcres?: number | null;
  soilType?: string | null;
  waterSourceTypeId?: string | null;
  irrigationMethodTypeId?: string | null;
  irrigationFrequencyDays?: number | null;
  irrigationDurationHours?: number | null;
  pumpDischargeLps?: number | null;
  pumpHoursPerEvent?: number | null;
  irrigationDepthMm?: number | null;
  appliedWaterVolumeM3?: number | null;
  appliedWaterLitres?: number | null;
  rainfallMm?: number | null;
  rainfallSource?: RainfallSource;
  waterAvailabilityStatus?: WaterAvailabilityStatus;
  cropCondition?: CropCondition;
  cropYieldQuantity?: number | null;
  cropYieldUnit?: CropYieldUnit | null;
  cropSalePricePerUnit?: number | null;
  cultivationExpensesInr?: number | null;
  farmerRemarks?: string | null;
  surveyorName?: string | null;
  measurementSource?: MeasurementSource;
  correctionReason: string; // Mandatory for audit
}

export interface SurveyAuditLog {
  id: string;
  surveyId: string;
  action: 'create' | 'update' | 'correction';
  changedBy?: string | null;
  changedByName?: string | null;
  reason?: string | null;
  previousData?: any;
  newData?: any;
  createdAt: string;
}

export interface SurveyComparison {
  survey1: FieldSurvey;
  survey2: FieldSurvey;
  deltas: {
    appliedWaterVolumeM3: number | null;
    appliedWaterLitres: number | null;
    irrigationDurationHours: number | null;
    pumpDischargeLps: number | null;
    irrigationDepthMm: number | null;
    rainfallMm: number | null;
    yieldQuantityNormalizedKg: number | null;
    cultivationExpensesInr: number | null;
    cropConditionChanged: boolean;
    waterStatusChanged: boolean;
  };
}
