export interface VolumeCalculationInput {
  rawValue: number;
  rawUnit: 'pump_hours' | 'drip_hours' | 'depth_mm' | 'litres';
  areaAcres: number;
  dischargeLph?: number | null; // Litres per hour from pump snapshot
  calculationMethod?: string;
}

export interface VolumeCalculationResult {
  estimatedVolumeL: number;
  estimatedDepthMm: number;
  calculationMethod: 'pump_hours_x_discharge' | 'depth_x_area' | 'direct_litres' | 'manual_estimate';
  measurementType: 'estimated';
}

const LITRES_PER_ACRE_MM = 4046.86; // 1 mm depth over 1 acre = 4,046.86 Litres

export function calculateIrrigationVolume(input: VolumeCalculationInput): VolumeCalculationResult {
  const { rawValue, rawUnit, areaAcres, dischargeLph } = input;

  let estimatedVolumeL = 0;
  let method: 'pump_hours_x_discharge' | 'depth_x_area' | 'direct_litres' | 'manual_estimate' = 'manual_estimate';

  if (rawUnit === 'pump_hours' || rawUnit === 'drip_hours') {
    const rate = dischargeLph && dischargeLph > 0 ? dischargeLph : 12000; // fallback standard 5HP discharge ~12,000 L/h
    estimatedVolumeL = rawValue * rate;
    method = 'pump_hours_x_discharge';
  } else if (rawUnit === 'depth_mm') {
    estimatedVolumeL = rawValue * areaAcres * LITRES_PER_ACRE_MM;
    method = 'depth_x_area';
  } else if (rawUnit === 'litres') {
    estimatedVolumeL = rawValue;
    method = 'direct_litres';
  }

  const estimatedDepthMm = areaAcres > 0
    ? Number((estimatedVolumeL / (areaAcres * LITRES_PER_ACRE_MM)).toFixed(2))
    : 0;

  return {
    estimatedVolumeL: Number(estimatedVolumeL.toFixed(2)),
    estimatedDepthMm,
    calculationMethod: method,
    measurementType: 'estimated', // Mandatory: Never label 'measured' in MVP
  };
}
