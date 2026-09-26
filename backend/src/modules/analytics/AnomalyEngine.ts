import { db } from '../../db/index.js';
import { AnomalyEvaluationResult } from './types.js';

/**
 * Anomaly Detection Engine for Irrigation & Agronomic Records.
 * 
 * NOTE (DECISION-013 & User Directive 4):
 * Evaluates pump hours over the FULL 14-DAY FORTNIGHT REPORTING PERIOD (up to 336 hours physical max),
 * never a naive daily average.
 */
export class AnomalyEngine {
  /**
   * Maximum physically possible pump running hours in a 14-day fortnight (14 * 24 = 336 hrs).
   */
  public static readonly FORTNIGHT_PHYSICAL_MAX_HOURS = 336;

  /**
   * Operational plausibility ceiling considering typical 3-phase agricultural power rationing
   * (typically 7-9 hours/day in AP) and continuous motor thermal shutdown limits (~20 hrs/day = 280 hrs).
   */
  public static readonly FORTNIGHT_OPERATIONAL_CEILING_HOURS = 280;

  /**
   * Evaluates reported fortnightly pump hours against physical and electrical plausibility ceilings.
   */
  evaluatePumpHoursAnomaly(
    pumpHours: number,
    cycleDays: number = 14
  ): AnomalyEvaluationResult {
    const physicalMax = cycleDays * 24;
    const operationalMax = Math.round(cycleDays * 20);

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
    rainfallMm: number
  ): AnomalyEvaluationResult {
    // If rainfall > 50 mm (IMD heavy rain) and farmer reports high irrigation (> 40 mm / ~10 hours pump run)
    if (rainfallMm >= 50.0 && appliedMm >= 40.0) {
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
  async scanSeasonAnomalies(seasonId: string): Promise<string[]> {
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
      const hourCheck = this.evaluatePumpHoursAnomaly(hours, 14);
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
       WHERE season_id = $1 AND rainfall_mm >= 50 AND irrigation_applied_mm >= 40
       LIMIT 3`,
      [seasonId]
    );

    for (const b of balanceRes.rows) {
      const rainCheck = this.evaluateRainIrrigationConflict(
        Number(b.irrigation_applied_mm),
        Number(b.rainfall_mm)
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
