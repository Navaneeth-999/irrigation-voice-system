import { db, withTransaction } from '../../db/index.js';
import { fao56Engine } from './Fao56Engine.js';
import { paddyPondingModel } from './PaddyPondingModel.js';
import { effectiveRainfallService } from './EffectiveRainfallService.js';
import { waterUseRatioEngine } from './WaterUseRatioEngine.js';
import { anomalyEngine } from './AnomalyEngine.js';
import { dataConfidenceService } from './DataConfidenceService.js';
import { SeasonWaterMetrics, DailyWaterBalanceRecord } from './types.js';

export class AnalyticsService {
  /**
   * Computes daily water balance records for a season across a date range.
   */
  async computeSeasonDailyBalance(
    seasonId: string,
    fromDate?: string,
    toDate?: string
  ): Promise<DailyWaterBalanceRecord[]> {
    // 1. Fetch Season and Crop details
    const seasonRes = await db.query(
      `SELECT s.id, s.sowing_date, s.expected_harvest_date, s.area_acres_snapshot,
              s.crop_id, f.village_id, s.irrigation_method_type_id,
              c.name as crop_name, c.water_model,
              imt.typical_efficiency, imt.efficiency_verified
       FROM seasons s
       JOIN farmers f ON f.id = s.farmer_id
       JOIN crops c ON c.id = s.crop_id
       LEFT JOIN irrigation_method_types imt ON imt.id = s.irrigation_method_type_id
       WHERE s.id = $1`,
      [seasonId]
    );

    if (seasonRes.rows.length === 0) {
      throw new Error(`Season with ID ${seasonId} not found`);
    }

    const season = seasonRes.rows[0];
    const sowingDate = new Date(season.sowing_date);
    const harvestDate = new Date(season.expected_harvest_date);
    const areaAcres = Number(season.area_acres_snapshot || 1.0);
    const isPaddy = season.water_model === 'paddy_ponding';
    const irrigationEfficiency = Number(season.typical_efficiency || 0.75);
    const efficiencyVerified = Boolean(season.efficiency_verified);

    // 2. Fetch stages and paddy parameters
    const stages = await fao56Engine.getCropStages(season.crop_id);
    const paddyParams = isPaddy ? await paddyPondingModel.getPaddyParams(season.crop_id) : null;

    // 3. Determine simulation dates
    const start = fromDate ? new Date(fromDate) : sowingDate;
    const end = toDate ? new Date(toDate) : new Date(); // up to today by default
    if (end > harvestDate) end.setTime(harvestDate.getTime());

    // 4. Fetch weather records for this village over the date range
    const weatherRes = await db.query(
      `SELECT record_date, precipitation_sum_mm, et0_fao_evapotranspiration
       FROM weather_records
       WHERE village_id = $1 AND record_date >= $2 AND record_date <= $3
       ORDER BY record_date ASC`,
      [season.village_id, start.toISOString().split('T')[0], end.toISOString().split('T')[0]]
    );

    const weatherMap = new Map<string, { rainMm: number; et0Mm: number }>();
    for (const w of weatherRes.rows) {
      const dStr = typeof w.record_date === 'string' ? w.record_date.split('T')[0] : new Date(w.record_date).toISOString().split('T')[0];
      weatherMap.set(dStr, {
        rainMm: Number(w.precipitation_sum_mm || 0),
        et0Mm: Number(w.et0_fao_evapotranspiration || 4.5), // fallback ET0 baseline
      });
    }

    // 5. Fetch irrigation records for this season
    const irrigationRes = await db.query(
      `SELECT period_start, period_end, estimated_volume_l, estimated_depth_mm
       FROM irrigation_records
       WHERE season_id = $1 AND period_start >= $2 AND period_start <= $3
       ORDER BY period_start ASC`,
      [seasonId, start.toISOString().split('T')[0], end.toISOString().split('T')[0]]
    );

    const irrigationMap = new Map<string, { litres: number; mm: number }>();
    for (const irr of irrigationRes.rows) {
      const dStr = typeof irr.period_start === 'string' ? irr.period_start.split('T')[0] : new Date(irr.period_start).toISOString().split('T')[0];
      const existing = irrigationMap.get(dStr) || { litres: 0, mm: 0 };
      existing.litres += Number(irr.estimated_volume_l || 0);
      existing.mm += Number(irr.estimated_depth_mm || 0);
      irrigationMap.set(dStr, existing);
    }

    // 6. Day-by-day simulation loop
    const results: DailyWaterBalanceRecord[] = [];
    let previousPondingDepth = isPaddy ? (paddyParams?.targetPondingDepthMm ?? 40.0) : 0;
    const curDate = new Date(start);

    while (curDate <= end) {
      const dateStr = curDate.toISOString().split('T')[0];
      const das = Math.max(0, Math.floor((curDate.getTime() - sowingDate.getTime()) / (1000 * 60 * 60 * 24)));

      const weather = weatherMap.get(dateStr) || { rainMm: 0, et0Mm: 4.5 };
      const irrigation = irrigationMap.get(dateStr) || { litres: 0, mm: 0 };

      let dailyRecord: DailyWaterBalanceRecord;

      if (isPaddy && paddyParams) {
        const { stage, interpolatedKc } = fao56Engine.resolveStage(das, stages);
        const paddyRes = paddyPondingModel.calculateDayBalance(
          das,
          stage,
          interpolatedKc,
          previousPondingDepth,
          weather.et0Mm,
          weather.rainMm,
          irrigation.mm,
          paddyParams,
          irrigationEfficiency,
          efficiencyVerified
        );

        previousPondingDepth = paddyRes.pondingDepthMm;

        dailyRecord = {
          seasonId,
          recordDate: dateStr,
          das,
          cropStageName: paddyRes.stageName,
          stageKc: paddyRes.kc,
          kcVerified: paddyRes.kcVerified,
          et0Mm: weather.et0Mm,
          etcMm: paddyRes.etcMm,
          rainfallMm: weather.rainMm,
          effectiveRainfallMm: paddyRes.effectiveRainfallMm,
          irrigationAppliedMm: irrigation.mm,
          irrigationAppliedLitres: irrigation.litres,
          percolationMm: paddyRes.percolationMm,
          drainageOverflowMm: paddyRes.drainageOverflowMm,
          pondingDepthMm: paddyRes.pondingDepthMm,
          soilMoistureDepletionMm: paddyRes.soilDepletionMm,
          assumptionsUnvalidated: paddyRes.unvalidatedParams.length > 0,
          unvalidatedParams: paddyRes.unvalidatedParams,
        };
      } else {
        // Standard FAO-56 Crop
        const effRain = await effectiveRainfallService.calculateEffectiveRainfall(weather.rainMm);
        const faoRes = fao56Engine.calculateDailyWaterDemand(
          das,
          stages,
          weather.et0Mm,
          effRain.effectiveRainfallMm,
          irrigationEfficiency,
          efficiencyVerified
        );

        if (!effRain.isVerified) {
          faoRes.unvalidatedParams.push(`Effective Rainfall Method (${effRain.source})`);
        }

        dailyRecord = {
          seasonId,
          recordDate: dateStr,
          das,
          cropStageName: faoRes.stageName,
          stageKc: faoRes.kc,
          kcVerified: faoRes.kcVerified,
          et0Mm: weather.et0Mm,
          etcMm: faoRes.etcMm,
          rainfallMm: weather.rainMm,
          effectiveRainfallMm: effRain.effectiveRainfallMm,
          irrigationAppliedMm: irrigation.mm,
          irrigationAppliedLitres: irrigation.litres,
          percolationMm: 0,
          drainageOverflowMm: 0,
          pondingDepthMm: 0,
          soilMoistureDepletionMm: 0,
          assumptionsUnvalidated: faoRes.unvalidatedParams.length > 0,
          unvalidatedParams: faoRes.unvalidatedParams,
        };
      }

      // Upsert into season_daily_water_balance
      await db.query(
        `INSERT INTO season_daily_water_balance (
          season_id, record_date, das, crop_stage_name, stage_kc, kc_verified,
          et0_mm, etc_mm, rainfall_mm, effective_rainfall_mm,
          irrigation_applied_mm, irrigation_applied_litres, percolation_mm,
          drainage_overflow_mm, ponding_depth_mm, soil_moisture_depletion_mm,
          assumptions_unvalidated, unvalidated_params, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, CURRENT_TIMESTAMP)
        ON CONFLICT (season_id, record_date) DO UPDATE SET
          das = EXCLUDED.das,
          crop_stage_name = EXCLUDED.crop_stage_name,
          stage_kc = EXCLUDED.stage_kc,
          kc_verified = EXCLUDED.kc_verified,
          et0_mm = EXCLUDED.et0_mm,
          etc_mm = EXCLUDED.etc_mm,
          rainfall_mm = EXCLUDED.rainfall_mm,
          effective_rainfall_mm = EXCLUDED.effective_rainfall_mm,
          irrigation_applied_mm = EXCLUDED.irrigation_applied_mm,
          irrigation_applied_litres = EXCLUDED.irrigation_applied_litres,
          percolation_mm = EXCLUDED.percolation_mm,
          drainage_overflow_mm = EXCLUDED.drainage_overflow_mm,
          ponding_depth_mm = EXCLUDED.ponding_depth_mm,
          soil_moisture_depletion_mm = EXCLUDED.soil_moisture_depletion_mm,
          assumptions_unvalidated = EXCLUDED.assumptions_unvalidated,
          unvalidated_params = EXCLUDED.unvalidated_params,
          updated_at = CURRENT_TIMESTAMP`,
        [
          dailyRecord.seasonId,
          dailyRecord.recordDate,
          dailyRecord.das,
          dailyRecord.cropStageName,
          dailyRecord.stageKc,
          dailyRecord.kcVerified,
          dailyRecord.et0Mm,
          dailyRecord.etcMm,
          dailyRecord.rainfallMm,
          dailyRecord.effectiveRainfallMm,
          dailyRecord.irrigationAppliedMm,
          dailyRecord.irrigationAppliedLitres,
          dailyRecord.percolationMm,
          dailyRecord.drainageOverflowMm,
          dailyRecord.pondingDepthMm,
          dailyRecord.soilMoistureDepletionMm,
          dailyRecord.assumptionsUnvalidated,
          dailyRecord.unvalidatedParams,
        ]
      );

      results.push(dailyRecord);
      curDate.setDate(curDate.getDate() + 1);
    }

    return results;
  }

  /**
   * Recalculates cumulative seasonal water metrics, WUR band, and data confidence.
   */
  async recalculateSeasonWaterMetrics(seasonId: string): Promise<SeasonWaterMetrics> {
    const seasonRes = await db.query(
      `SELECT area_acres_snapshot, irrigation_method_type_id
       FROM seasons WHERE id = $1`,
      [seasonId]
    );

    if (seasonRes.rows.length === 0) {
      throw new Error(`Season ${seasonId} not found`);
    }

    const areaAcres = Number(seasonRes.rows[0].area_acres_snapshot || 1.0);

    // 1. Aggregate from daily water balance
    const aggRes = await db.query(
      `SELECT 
         COALESCE(SUM(etc_mm), 0) as total_etc_mm,
         COALESCE(SUM(effective_rainfall_mm), 0) as total_effective_rain_mm,
         COALESCE(SUM(irrigation_applied_mm), 0) as total_applied_mm,
         COALESCE(SUM(irrigation_applied_litres), 0) as total_applied_litres,
         BOOL_OR(assumptions_unvalidated) as has_unvalidated
       FROM season_daily_water_balance
       WHERE season_id = $1`,
      [seasonId]
    );

    const agg = aggRes.rows[0];
    const totalEtcMm = Math.round(Number(agg.total_etc_mm) * 100) / 100;
    const totalEffectiveRainMm = Math.round(Number(agg.total_effective_rain_mm) * 100) / 100;
    const totalAppliedMm = Math.round(Number(agg.total_applied_mm) * 100) / 100;
    const totalAppliedLitres = Math.round(Number(agg.total_applied_litres));

    // Volume conversions
    const totalEtcM3 = waterUseRatioEngine.mmToCubicMeters(totalEtcMm, areaAcres);
    const totalEffectiveRainM3 = waterUseRatioEngine.mmToCubicMeters(totalEffectiveRainMm, areaAcres);
    const netIrrigationDemandMm = Math.max(0, Math.round((totalEtcMm - totalEffectiveRainMm) * 100) / 100);
    const netIrrigationDemandM3 = waterUseRatioEngine.mmToCubicMeters(netIrrigationDemandMm, areaAcres);
    const grossIrrigationDemandM3 = Math.round((netIrrigationDemandM3 / 0.75) * 100) / 100;
    const totalAppliedM3 = waterUseRatioEngine.litresToCubicMeters(totalAppliedLitres);

    // 2. Evaluate WUR Non-Competitive Band
    const wurConfig = await waterUseRatioEngine.getThresholdsConfig();
    const wurEval = waterUseRatioEngine.evaluateRatio(totalAppliedM3, netIrrigationDemandM3, wurConfig);

    // 3. Scan for Anomalies
    const anomalyConfig = await anomalyEngine.getThresholdsConfig();
    const anomalyFlags = await anomalyEngine.scanSeasonAnomalies(seasonId, anomalyConfig);

    // 4. Compute Data Confidence Score
    const confidence = await dataConfidenceService.computeConfidenceScore(seasonId);

    // 5. Aggregate Unvalidated Parameter Names
    const unvalidatedParamsRes = await db.query(
      `SELECT DISTINCT unnest(unvalidated_params) as param 
       FROM season_daily_water_balance 
       WHERE season_id = $1 AND assumptions_unvalidated = true`,
      [seasonId]
    );
    const unvalidatedList = unvalidatedParamsRes.rows.map(r => r.param);

    if (wurEval.unvalidatedAssumption && !unvalidatedList.includes(wurEval.unvalidatedAssumption)) {
      unvalidatedList.push(wurEval.unvalidatedAssumption);
    }
    if (anomalyConfig && !anomalyConfig.isVerified) {
      const anomalyAssumption = `Fortnightly operational pump ceiling (${anomalyConfig.operationalCeilingHours}h) based on unverified rural power roster (${anomalyConfig.source})`;
      if (!unvalidatedList.includes(anomalyAssumption)) {
        unvalidatedList.push(anomalyAssumption);
      }
    }

    const metricsRecord: SeasonWaterMetrics = {
      seasonId,
      totalEtcMm,
      totalEtcM3,
      totalEffectiveRainMm,
      totalEffectiveRainM3,
      netIrrigationDemandMm,
      netIrrigationDemandM3,
      grossIrrigationDemandM3,
      totalAppliedLitres,
      totalAppliedM3,
      totalAppliedMm,
      waterUseRatio: wurEval.ratio,
      ratioBand: wurEval.band,
      confidenceScore: confidence.totalScore,
      confidenceBand: confidence.band,
      confidenceBreakdown: confidence,
      hasUnvalidatedAssumptions: unvalidatedList.length > 0 || Boolean(agg.has_unvalidated),
      unvalidatedAssumptionsList: unvalidatedList,
      anomalyFlags,
      calculatedAt: new Date().toISOString(),
    };

    // Upsert into season_water_metrics
    await db.query(
      `INSERT INTO season_water_metrics (
        season_id, total_etc_mm, total_etc_m3, total_effective_rain_mm, total_effective_rain_m3,
        net_irrigation_demand_mm, net_irrigation_demand_m3, gross_irrigation_demand_m3,
        total_applied_litres, total_applied_m3, total_applied_mm,
        water_use_ratio, ratio_band, confidence_score, confidence_band,
        confidence_breakdown, has_unvalidated_assumptions, unvalidated_assumptions_list,
        anomaly_flags, calculated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, CURRENT_TIMESTAMP)
      ON CONFLICT (season_id) DO UPDATE SET
        total_etc_mm = EXCLUDED.total_etc_mm,
        total_etc_m3 = EXCLUDED.total_etc_m3,
        total_effective_rain_mm = EXCLUDED.total_effective_rain_mm,
        total_effective_rain_m3 = EXCLUDED.total_effective_rain_m3,
        net_irrigation_demand_mm = EXCLUDED.net_irrigation_demand_mm,
        net_irrigation_demand_m3 = EXCLUDED.net_irrigation_demand_m3,
        gross_irrigation_demand_m3 = EXCLUDED.gross_irrigation_demand_m3,
        total_applied_litres = EXCLUDED.total_applied_litres,
        total_applied_m3 = EXCLUDED.total_applied_m3,
        total_applied_mm = EXCLUDED.total_applied_mm,
        water_use_ratio = EXCLUDED.water_use_ratio,
        ratio_band = EXCLUDED.ratio_band,
        confidence_score = EXCLUDED.confidence_score,
        confidence_band = EXCLUDED.confidence_band,
        confidence_breakdown = EXCLUDED.confidence_breakdown,
        has_unvalidated_assumptions = EXCLUDED.has_unvalidated_assumptions,
        unvalidated_assumptions_list = EXCLUDED.unvalidated_assumptions_list,
        anomaly_flags = EXCLUDED.anomaly_flags,
        calculated_at = CURRENT_TIMESTAMP`,
      [
        seasonId,
        totalEtcMm,
        totalEtcM3,
        totalEffectiveRainMm,
        totalEffectiveRainM3,
        netIrrigationDemandMm,
        netIrrigationDemandM3,
        grossIrrigationDemandM3,
        totalAppliedLitres,
        totalAppliedM3,
        totalAppliedMm,
        wurEval.ratio,
        wurEval.band,
        confidence.totalScore,
        confidence.band,
        JSON.stringify(confidence),
        metricsRecord.hasUnvalidatedAssumptions,
        unvalidatedList,
        anomalyFlags,
      ]
    );

    return metricsRecord;
  }

  /**
   * Retrieves full seasonal analytics payload for frontend charts and dashboards.
   */
  async getSeasonAnalytics(seasonId: string): Promise<any> {
    // Check if metrics already calculated
    let metricsRes = await db.query(
      `SELECT * FROM season_water_metrics WHERE season_id = $1`,
      [seasonId]
    );

    if (metricsRes.rows.length === 0) {
      // Run initial computation
      await this.computeSeasonDailyBalance(seasonId);
      await this.recalculateSeasonWaterMetrics(seasonId);
      metricsRes = await db.query(
        `SELECT * FROM season_water_metrics WHERE season_id = $1`,
        [seasonId]
      );
    }

    const metrics = metricsRes.rows[0];

    // Fetch daily records for timeline/charting
    const dailyRes = await db.query(
      `SELECT record_date, das, crop_stage_name, stage_kc, et0_mm, etc_mm,
              rainfall_mm, effective_rainfall_mm, irrigation_applied_mm,
              irrigation_applied_litres, ponding_depth_mm, drainage_overflow_mm
       FROM season_daily_water_balance
       WHERE season_id = $1
       ORDER BY record_date ASC`,
      [seasonId]
    );

    // Fetch associated action items
    const actionsRes = await db.query(
      `SELECT id, source, type, priority, referral_note, status, created_at
       FROM action_items
       WHERE season_id = $1
       ORDER BY created_at DESC`,
      [seasonId]
    );

    return {
      metrics: {
        ...metrics,
        confidence_breakdown: typeof metrics.confidence_breakdown === 'string'
          ? JSON.parse(metrics.confidence_breakdown)
          : metrics.confidence_breakdown,
      },
      dailyRecords: dailyRes.rows,
      actionItems: actionsRes.rows,
    };
  }

  /**
   * Worker processor using FOR UPDATE SKIP LOCKED to process queued analytics jobs safely.
   */
  async processAnalyticsQueue(limit: number = 5): Promise<number> {
    let processedCount = 0;
    let dueJobs: any[] = [];

    // 1. Transactionally lock pending queue items
    await withTransaction(async (tx) => {
      const queueRes = await tx.query(
        `SELECT id, season_id, job_type, target_date
         FROM analytics_processing_queue
         WHERE status = 'pending' AND attempts < 3
         ORDER BY created_at ASC
         LIMIT $1
         FOR UPDATE SKIP LOCKED`,
        [limit]
      );
      dueJobs = queueRes.rows;

      for (const job of dueJobs) {
        await tx.query(
          `UPDATE analytics_processing_queue
           SET status = 'in_progress', attempts = attempts + 1, updated_at = NOW()
           WHERE id = $1`,
          [job.id]
        );
      }
    });

    // 2. Process jobs outside transaction to allow independent db queries
    for (const job of dueJobs) {
      try {
        if (job.job_type === 'daily_et_calc') {
          const dStr = typeof job.target_date === 'string'
            ? job.target_date.split('T')[0]
            : new Date(job.target_date).toISOString().split('T')[0];
          await this.computeSeasonDailyBalance(job.season_id, dStr, dStr);
        } else if (job.job_type === 'water_balance_summary' || job.job_type === 'anomaly_scan') {
          await this.recalculateSeasonWaterMetrics(job.season_id);
        }

        await db.query(
          `UPDATE analytics_processing_queue
           SET status = 'completed', updated_at = NOW()
           WHERE id = $1`,
          [job.id]
        );
        processedCount++;
      } catch (err: any) {
        await db.query(
          `UPDATE analytics_processing_queue
           SET status = 'failed', error_message = $2, updated_at = NOW()
           WHERE id = $1`,
          [job.id, err.message]
        );
      }
    }

    return processedCount;
  }
}

export const analyticsService = new AnalyticsService();
