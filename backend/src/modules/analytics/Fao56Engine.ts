import { db } from '../../db/index.js';

export interface StageInfo {
  id: string;
  stageOrder: number;
  name: string;
  nameTe: string;
  startDas: number;
  endDas: number;
  kc: number;
  kcSource: string;
  kcVerified: boolean;
}

export interface Fao56DailyResult {
  das: number;
  stageName: string;
  stageNameTe: string;
  kc: number;
  kcVerified: boolean;
  et0Mm: number;
  etcMm: number;
  effectiveRainMm: number;
  netDemandMm: number;
  grossDemandMm: number;
  unvalidatedParams: string[];
}

/**
 * FAO-56 Dual / Single Crop Evapotranspiration Calculation Engine.
 * Calculates daily crop water demand (ETc = Kc * ET0) across phenological crop stages.
 * Transparently tracks verification provenance and unvalidated assumptions.
 */
export class Fao56Engine {
  /**
   * Fetches stages for a crop ordered chronologically by stage_order.
   */
  async getCropStages(cropId: string): Promise<StageInfo[]> {
    const res = await db.query(
      `SELECT id, stage_order as "stageOrder", name, name_te as "nameTe", 
              start_das as "startDas", end_das as "endDas", kc, 
              kc_source as "kcSource", kc_verified as "kcVerified"
       FROM crop_stages
       WHERE crop_id = $1
       ORDER BY stage_order ASC`,
      [cropId]
    );

    return res.rows.map(r => ({
      ...r,
      kc: Number(r.kc),
      stageOrder: Number(r.stageOrder),
      startDas: Number(r.startDas),
      endDas: Number(r.endDas),
      kcVerified: Boolean(r.kcVerified),
    }));
  }

  /**
   * Resolves the active stage and daily Kc for a specific Day After Sowing (DAS).
   * Supports linear interpolation between stage midpoints per FAO-56 standards.
   */
  resolveStage(das: number, stages: StageInfo[]): {
    stage: StageInfo;
    interpolatedKc: number;
  } {
    if (!stages || stages.length === 0) {
      throw new Error('No crop stages defined for this crop');
    }

    // Clamp DAS within crop life cycle
    const clampedDas = Math.max(0, das);

    // Find current stage interval
    let currentStage = stages.find(s => clampedDas >= s.startDas && clampedDas <= s.endDas);
    if (!currentStage) {
      // If DAS exceeds all stages, use the final stage
      currentStage = stages[stages.length - 1];
    }

    // For standard FAO-56 stepwise / linear interpolation
    // If within development or late season, interpolate towards next stage
    let interpolatedKc = currentStage.kc;

    const stageIdx = stages.findIndex(s => s.id === currentStage!.id);
    if (stageIdx >= 0 && stageIdx < stages.length - 1) {
      const nextStage = stages[stageIdx + 1];
      const stageSpan = currentStage.endDas - currentStage.startDas;
      if (stageSpan > 0 && clampedDas >= currentStage.startDas) {
        const progress = (clampedDas - currentStage.startDas) / stageSpan;
        // Linear progression during development/ripening
        if (currentStage.name.toLowerCase().includes('development') || currentStage.name.toLowerCase().includes('vegetative')) {
          interpolatedKc = currentStage.kc + progress * (nextStage.kc - currentStage.kc);
        } else if (currentStage.name.toLowerCase().includes('late') || currentStage.name.toLowerCase().includes('ripening')) {
          interpolatedKc = currentStage.kc - progress * (currentStage.kc - nextStage.kc);
        }
      }
    }

    return {
      stage: currentStage,
      interpolatedKc: Math.round(interpolatedKc * 100) / 100,
    };
  }

  /**
   * Calculates daily FAO-56 evapotranspiration metrics for an aerobic crop.
   */
  calculateDailyWaterDemand(
    das: number,
    stages: StageInfo[],
    et0Mm: number,
    effectiveRainMm: number,
    irrigationEfficiency: number = 0.75,
    efficiencyVerified: boolean = false
  ): Fao56DailyResult {
    const { stage, interpolatedKc } = this.resolveStage(das, stages);
    const etcMm = Math.round(interpolatedKc * et0Mm * 100) / 100;
    const netDemandMm = Math.max(0, Math.round((etcMm - effectiveRainMm) * 100) / 100);
    const eff = irrigationEfficiency > 0 ? irrigationEfficiency : 0.75;
    const grossDemandMm = Math.round((netDemandMm / eff) * 100) / 100;

    const unvalidatedParams: string[] = [];
    if (!stage.kcVerified) {
      unvalidatedParams.push(`Kc for ${stage.name} (${stage.kcSource})`);
    }
    if (!efficiencyVerified) {
      unvalidatedParams.push(`Irrigation Efficiency (${Math.round(eff * 100)}%)`);
    }

    return {
      das,
      stageName: stage.name,
      stageNameTe: stage.nameTe,
      kc: interpolatedKc,
      kcVerified: stage.kcVerified,
      et0Mm,
      etcMm,
      effectiveRainMm,
      netDemandMm,
      grossDemandMm,
      unvalidatedParams,
    };
  }
}

export const fao56Engine = new Fao56Engine();
