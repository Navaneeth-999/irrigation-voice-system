import { db } from '../../db/index.js';
import { StageInfo } from './Fao56Engine.js';

export interface PaddyParams {
  puddlingWaterMm: number;
  percolationRateMmDay: number;
  targetPondingDepthMm: number;
  bundHeightMm: number;
  puddlingVerified: boolean;
  percolationVerified: boolean;
  targetDepthVerified: boolean;
  bundHeightVerified: boolean;
}

export interface PaddyDailyResult {
  das: number;
  stageName: string;
  stageNameTe: string;
  kc: number;
  kcVerified: boolean;
  et0Mm: number;
  etcMm: number;
  rainfallMm: number;
  effectiveRainfallMm: number;
  drainageOverflowMm: number;
  irrigationAppliedMm: number;
  percolationMm: number;
  pondingDepthMm: number;
  soilDepletionMm: number;
  netDemandMm: number;
  grossDemandMm: number;
  unvalidatedParams: string[];
}

/**
 * Daily Paddy / Flooded Rice Ponding Water Balance Model.
 * Implements the standard flooded field water balance:
 *   h_t = h_{t-1} + P_eff + I_t - ET_c - SP - D
 * where:
 *   h_t: Ponding depth (standing water in mm)
 *   P_eff: Rainfall captured within bunds
 *   I_t: Applied irrigation water
 *   ET_c: Crop evapotranspiration (Kc * ET0)
 *   SP: Seepage and percolation losses (mm/day)
 *   D: Drainage / surface overflow when h_t > bund_height
 * Transparently identifies and flags unvalidated agronomic parameters.
 */
export class PaddyPondingModel {
  /**
   * Fetches paddy-specific parameters from `crop_model_parameters`.
   */
  async getPaddyParams(cropId: string): Promise<PaddyParams> {
    const res = await db.query(
      `SELECT key, value_numeric, verified, source 
       FROM crop_model_parameters 
       WHERE crop_id = $1`,
      [cropId]
    );

    const paramMap = new Map<string, { value: number; verified: boolean }>();
    for (const r of res.rows) {
      paramMap.set(r.key, {
        value: Number(r.value_numeric),
        verified: Boolean(r.verified),
      });
    }

    return {
      puddlingWaterMm: paramMap.get('puddling_water_mm')?.value ?? 200,
      percolationRateMmDay: paramMap.get('percolation_rate_mm_day')?.value ?? 4.0,
      targetPondingDepthMm: paramMap.get('target_ponding_depth_mm')?.value ?? 40.0,
      bundHeightMm: paramMap.get('bund_height_mm')?.value ?? 100.0,
      puddlingVerified: paramMap.get('puddling_water_mm')?.verified ?? false,
      percolationVerified: paramMap.get('percolation_rate_mm_day')?.verified ?? false,
      targetDepthVerified: paramMap.get('target_ponding_depth_mm')?.verified ?? false,
      bundHeightVerified: paramMap.get('bund_height_mm')?.verified ?? false,
    };
  }

  /**
   * Simulates a single day's ponding balance for a paddy field.
   */
  calculateDayBalance(
    das: number,
    stage: StageInfo,
    interpolatedKc: number,
    previousDepthMm: number,
    et0Mm: number,
    rainfallMm: number,
    irrigationAppliedMm: number,
    params: PaddyParams,
    irrigationEfficiency: number = 0.80,
    efficiencyVerified: boolean = false
  ): PaddyDailyResult {
    const unvalidatedParams: string[] = [];

    if (!stage.kcVerified) {
      unvalidatedParams.push(`Paddy Kc for ${stage.name} (${stage.kcSource})`);
    }
    if (!params.percolationVerified) {
      unvalidatedParams.push(`Percolation Rate (${params.percolationRateMmDay} mm/day)`);
    }
    if (!params.puddlingVerified && das <= 20) {
      unvalidatedParams.push(`Puddling Water Requirement (${params.puddlingWaterMm} mm)`);
    }
    if (!params.targetDepthVerified) {
      unvalidatedParams.push(`Target Ponding Depth (${params.targetPondingDepthMm} mm)`);
    }
    if (!params.bundHeightVerified) {
      unvalidatedParams.push(`Paddy Bund Height & Overflow Threshold (${params.bundHeightMm} mm)`);
    }
    if (!efficiencyVerified) {
      unvalidatedParams.push(`Irrigation Efficiency (${Math.round(irrigationEfficiency * 100)}%)`);
    }

    // 1. Crop Evapotranspiration
    const etcMm = Math.round(interpolatedKc * et0Mm * 100) / 100;

    // 2. Seepage & Percolation (active whenever there is standing water or moist root zone)
    const percolationMm = params.percolationRateMmDay;

    // 3. Rainfall capture within bunds
    const availableBundStorage = Math.max(0, params.bundHeightMm - previousDepthMm);
    const effectiveRainfallMm = Math.min(rainfallMm, availableBundStorage);
    const drainageOverflowMm = Math.max(0, rainfallMm - availableBundStorage);

    // 4. Update Ponding Depth (Standing Water Balance)
    // h_t = h_{t-1} + P_eff + I_t - ET_c - SP
    const tentativeDepth = previousDepthMm + effectiveRainfallMm + irrigationAppliedMm - etcMm - percolationMm;

    let pondingDepthMm = 0;
    let soilDepletionMm = 0;

    if (tentativeDepth > params.bundHeightMm) {
      pondingDepthMm = params.bundHeightMm;
      // Excess overflows bund
    } else if (tentativeDepth >= 0) {
      pondingDepthMm = Math.round(tentativeDepth * 100) / 100;
      soilDepletionMm = 0;
    } else {
      pondingDepthMm = 0;
      soilDepletionMm = Math.round(Math.abs(tentativeDepth) * 100) / 100;
    }

    // 5. Agronomic net demand to maintain target ponding depth
    // In Land preparation (DAS 0-20), target includes initial puddling
    const target = das <= 20 ? (params.targetPondingDepthMm + params.puddlingWaterMm / 20) : params.targetPondingDepthMm;
    const netDemandMm = Math.max(0, Math.round((target - previousDepthMm + etcMm + percolationMm - effectiveRainfallMm) * 100) / 100);
    const eff = irrigationEfficiency > 0 ? irrigationEfficiency : 0.80;
    const grossDemandMm = Math.round((netDemandMm / eff) * 100) / 100;

    return {
      das,
      stageName: stage.name,
      stageNameTe: stage.nameTe,
      kc: interpolatedKc,
      kcVerified: stage.kcVerified,
      et0Mm,
      etcMm,
      rainfallMm,
      effectiveRainfallMm,
      drainageOverflowMm,
      irrigationAppliedMm,
      percolationMm,
      pondingDepthMm,
      soilDepletionMm,
      netDemandMm,
      grossDemandMm,
      unvalidatedParams,
    };
  }
}

export const paddyPondingModel = new PaddyPondingModel();
