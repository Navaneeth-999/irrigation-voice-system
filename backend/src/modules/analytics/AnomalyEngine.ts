import { db } from '../../db/index.js';
import { AnomalyEvaluationResult } from './types.js';

export interface AnomalyThresholdsConfig {
  physicalMaxHours: number;        // default 336
  operationalCeilingHours: number; // default 280
  rainConflictRainMm: number;      // default 50.0
  rainConflictIrrigationMm: number;// default 40.0
  isVerified: boolean;             // default false
  source: string;                  // 'AP DISCOM rural 3-phase roster & motor thermal limit'
}

/**
 * Anomaly Detection Engine for Irrigation & Agronomic Records.
 * 
 * NOTE (DECISION-013 & User Directives):
 * - Evaluates pump hours over the FULL 14-DAY FORTNIGHT REPORTING PERIOD (up to 336 hours physical max).
 * - The 280-hour operational ceiling and rain conflict thresholds are dynamically loaded from
 *   `app_settings` (`anomaly_detection_thresholds`) and flagged as unvalidated assumptions.
 */
export class AnomalyEngine {
  /**
   * Maximum physically possible pump running hours in a 14-day fortnight (14 * 24 = 336 hrs).
   */
  public static readonly FORTNIGHT_PHYSICAL_MAX_HOURS = 336;

  /**
   * Operational plausibility ceiling baseline considering typical 3-phase agricultural power rationing
   * (~20 hrs/day = 280 hrs).
   */
  public static readonly FORTNIGHT_OPERATIONAL_CEILING_HOURS = 280;

  private cachedConfig: AnomalyThresholdsConfig | null = null;
  private cacheExpiry: number = 0;

  /**
   * Retrieves anomaly thresholds configuration from `app_settings` or fallback baseline.
   */
  async getThresholdsConfig(): Promise<AnomalyThresholdsConfig> {
    const now = Date.now();
    if (this.cachedConfig && now < this.cacheExpiry) {
      return this.cachedConfig;
    }

    try {
      const res = await db.query(
        `SELECT value FROM app_settings WHERE key = 'anomaly_detection_thresholds'`
      );

      if (res.rows.length > 0) {
        const val = typeof res.rows[0].value === 'string'
          ? JSON.parse(res.rows[0].value)
          : res.rows[0].value;

        this.cachedConfig = {
          physicalMaxHours: Number(val.physical_max_hours ?? 336),
          operationalCeilingHours: Number(val.operational_ceiling_hours ?? val.operationalCeiling ?? 280),
          rainConflictRainMm: Number(val.rain_conflict_rain_mm ?? 50.0),
          rainConflictIrrigationMm: Number(val.rain_conflict_irrigation_mm ?? 40.0),
          isVerified: Boolean(val.is_verified ?? val.isVerified ?? false),
          source: String(val.source ?? 'ASSUMPTIONS.md / AP Rural Feeder Operational Limit'),
        };
      } else {
        this.cachedConfig = {
          physicalMaxHours: 336,
          operationalCeilingHours: 280,
          rainConflictRainMm: 50.0,
          rainConflictIrrigationMm: 40.0,
          isVerified: false,
          source: 'ASSUMPTIONS.md / AP Rural Feeder Operational Limit',
        };
      }
    } catch {
      this.cachedConfig = {
        physicalMaxHours: 336,
        operationalCeilingHours: 280,
        rainConflictRainMm: 50.0,
        rainConflictIrrigationMm: 40.0,
        isVerified: false,
        source: 'ASSUMPTIONS.md / Fallback',
      };
    }

    this.cacheExpiry = now + 60_000;
    return this.cachedConfig;
  }

  /**
   * Clears in-memory cached configuration to force reload from app_settings.
   */
  clearCache(): void {
    this.cachedConfig = null;
    this.cacheExpiry = 0;
  }

  /**
   * Evaluates reported fortnightly pump hours against physical and electrical plausibility ceilings.
   */
  evaluatePumpHoursAnomaly(
    pumpHours: number,
    cycleDays: number = 14,
    customConfig?: AnomalyThresholdsConfig
  ): AnomalyEvaluationResult {
    const config = customConfig || this.cachedConfig;
    const physicalMax = cycleDays * 24;
    const operationalMax = config?.operationalCeilingHours ?? Math.round(cycleDays * 20);

    if (pumpHours > physicalMax) {
      return {
        hasAnomaly: true,
        anomalyType: 'IMPLAUSIBLE_PUMP_HOURS',
        severity: 'critical',
        description: `Reported ${pumpHours} pump hours exceeds the total physical hours in a ${cycleDays}-day period (${physicalMax} hours max).`,
        suggestedAction: 'Contact farmer to verify whether digits represented minutes or cumulative season hours instead of fortnightly total.',
        actionItemType: 'anomaly_review',
      };
    }

    if (pumpHours > operationalMax) {
      return {
        hasAnomaly: true,
        anomalyType: 'IMPLAUSIBLE_PUMP_HOURS',
        severity: 'warning',
        description: `Reported ${pumpHours} pump hours exceeds realistic rural power availability and motor thermal capacity (${operationalMax} hours ceiling for ${cycleDays} days).`,
        suggestedAction: 'Verify pump logbook with village agricultural volunteer.',
        actionItemType: 'anomaly_review',
      };
    }

    return { hasAnomaly: false };
  }

  /**
   * Evaluates conflict between heavy rainfall and reported heavy irrigation.
   */
  evaluateRainIrrigationConflict(
    appliedMm: number,
    rainfallMm: number,
    customConfig?: AnomalyThresholdsConfig
  ): AnomalyEvaluationResult {
    const config = customConfig || this.cachedConfig;
    const minRain = config?.rainConflictRainMm ?? 50.0;
    const minIrr = config?.rainConflictIrrigationMm ?? 40.0;

    if (rainfallMm >= minRain && appliedMm >= minIrr) {
      return {
        hasAnomaly: true,
        anomalyType: 'RAIN_IRRIGATION_CONFLICT',
        severity: 'warning',
        description: `Significant irrigation (${appliedMm} mm) reported during a cycle with heavy rainfall (${rainfallMm} mm). High probability of waterlogging.`,
        suggestedAction: 'Check field drainage status and confirm whether irrigation took place before or after downpour.',
        actionItemType: 'waterlogging_check',
      };
    }

    return { hasAnomaly: false };
  }

  /**
   * Scans a season's records and registers any detected anomalies in `action_items`.
   */
  async scanSeasonAnomalies(
    seasonId: string,
    customConfig?: AnomalyThresholdsConfig
  ): Promise<string[]> {
    const config = customConfig || await this.getThresholdsConfig();
    const anomalyFlags: string[] = [];

    // 1. Fetch all feedback records for the season
    const feedbackRes = await db.query(
      `SELECT ff.id, ff.cycle_number, ff.pump_hours, ff.rainfall_class, ff.irrigation_count,
              ff.created_at, f.village_id
       FROM farmer_feedback ff
       JOIN seasons s ON s.id = ff.season_id
       JOIN farmers f ON f.id = s.farmer_id
       WHERE ff.season_id = $1
       ORDER BY ff.cycle_number ASC`,
      [seasonId]
    );

    for (const fb of feedbackRes.rows) {
      const hours = Number(fb.pump_hours || 0);

      // Check Rule 1: Implausible hours over the 14-day cycle
      const hourCheck = this.evaluatePumpHoursAnomaly(hours, 14, config);
      if (hourCheck.hasAnomaly) {
        anomalyFlags.push(`${hourCheck.anomalyType}_CYCLE_${fb.cycle_number}`);

        // Insert or deduplicate action item
        await this.recordActionItem(
          seasonId,
          (hourCheck.severity || 'warning') as any,
          `Cycle ${fb.cycle_number}: ${hourCheck.description}`,
          hourCheck.suggestedAction || 'Verify with farmer'
        );
      }
    }

    // 2. Fetch daily water balance records to check rain conflict
    const balanceRes = await db.query(
      `SELECT record_date, rainfall_mm, irrigation_applied_mm
       FROM season_daily_water_balance
       WHERE season_id = $1 AND rainfall_mm >= $2 AND irrigation_applied_mm >= $3
       LIMIT 3`,
      [seasonId, config.rainConflictRainMm, config.rainConflictIrrigationMm]
    );

    for (const b of balanceRes.rows) {
      const rainCheck = this.evaluateRainIrrigationConflict(
        Number(b.irrigation_applied_mm),
        Number(b.rainfall_mm),
        config
      );
      if (rainCheck.hasAnomaly) {
        const flag = `RAIN_CONFLICT_${b.record_date}`;
        if (!anomalyFlags.includes(flag)) {
          anomalyFlags.push(flag);
          await this.recordActionItem(
            seasonId,
            'warning',
            `Date ${b.record_date}: ${rainCheck.description}`,
            rainCheck.suggestedAction || 'Check drainage'
          );
        }
      }
    }

    return anomalyFlags;
  }

  private async recordActionItem(
    seasonId: string,
    priority: 'low' | 'medium' | 'high' | 'critical',
    description: string,
    suggestedAction: string
  ): Promise<void> {
    const seasonRes = await db.query(
      `SELECT farmer_id FROM seasons WHERE id = $1`,
      [seasonId]
    );
    if (seasonRes.rows.length === 0) return;
    const farmerId = seasonRes.rows[0].farmer_id;

    const note = `${description} Suggested Action: ${suggestedAction}`;

    await db.query(
      `INSERT INTO action_items (
        source, farmer_id, season_id, type, priority, referral_note, status
      )
      VALUES ('anomaly', $1, $2, 'suspicious_data', $3, $4, 'open')
      ON CONFLICT DO NOTHING`,
      [farmerId, seasonId, priority, note]
    );
  }
}

export const anomalyEngine = new AnomalyEngine();
