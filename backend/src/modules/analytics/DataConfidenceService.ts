import { db } from '../../db/index.js';
import { ConfidenceBreakdown, ConfidenceBand } from './types.js';

/**
 * Data Confidence Scoring Service.
 * Evaluates the empirical integrity and trustworthiness of a season's data
 * across 4 weighted dimensions defined in ASSUMPTIONS.md Section 5:
 *   1. Response Coverage (40%)
 *   2. Completeness of Key Fields (30%)
 *   3. Field Evidence Verification (15%)
 *   4. Anomaly Consistency (15%)
 * Minimum threshold for Conservation Certificate issuance is 70%.
 */
export class DataConfidenceService {
  /**
   * Evaluates the data confidence score for an active or completed season.
   */
  async computeConfidenceScore(seasonId: string): Promise<ConfidenceBreakdown> {
    // 1. Fetch season timeline and feedback
    const seasonRes = await db.query(
      `SELECT sowing_date, expected_harvest_date, status, created_at
       FROM seasons WHERE id = $1`,
      [seasonId]
    );

    if (seasonRes.rows.length === 0) {
      throw new Error(`Season ${seasonId} not found`);
    }

    const season = seasonRes.rows[0];
    const sowingDate = new Date(season.sowing_date);
    const now = new Date();
    const daysElapsed = Math.max(1, Math.floor((now.getTime() - sowingDate.getTime()) / (1000 * 60 * 60 * 24)));
    const cyclesDue = Math.max(1, Math.min(10, Math.floor(daysElapsed / 14)));

    // 2. Fetch completed feedback records
    const feedbackRes = await db.query(
      `SELECT id, cycle_number, pump_hours, rainfall_class, irrigation_count, source
       FROM farmer_feedback
       WHERE season_id = $1`,
      [seasonId]
    );
    const feedbackRows = feedbackRes.rows;
    const completedCycles = feedbackRows.length;

    // Dimension 1: Response Coverage (Weight: 40%)
    const coverageRatio = Math.min(1.0, completedCycles / cyclesDue);
    const responseCoverage = Math.round(coverageRatio * 40 * 10) / 10;

    // Dimension 2: Data Completeness (Weight: 30%)
    let completeCount = 0;
    for (const fb of feedbackRows) {
      if (
        fb.pump_hours != null &&
        fb.rainfall_class != null &&
        fb.irrigation_count != null
      ) {
        completeCount++;
      }
    }
    const completenessRatio = completedCycles > 0 ? (completeCount / completedCycles) : 0;
    const dataCompleteness = Math.round(completenessRatio * 30 * 10) / 10;

    // Dimension 3: Field Evidence Verification (Weight: 15%)
    // Check if any cycle came from an in-person manual visit or ground verification
    const fieldVerifiedRes = await db.query(
      `SELECT COUNT(*)::int as count 
       FROM action_items 
       WHERE season_id = $1 AND status = 'resolved'`,
      [seasonId]
    );
    const hasFieldVisit = feedbackRows.some(fb => fb.source === 'manual') || fieldVerifiedRes.rows[0].count > 0;
    const fieldEvidence = hasFieldVisit ? 15 : 7.5; // Baseline telephone credit = 7.5/15; field visit = 15/15

    // Dimension 4: Anomaly Consistency (Weight: 15%)
    const anomalyRes = await db.query(
      `SELECT COUNT(*)::int as count 
       FROM action_items 
       WHERE season_id = $1 AND source = 'anomaly' AND status = 'open'`,
      [seasonId]
    );
    const openAnomalies = anomalyRes.rows[0].count;
    const anomalyPenalty = Math.min(15, openAnomalies * 5);
    const anomalyConsistency = Math.max(0, 15 - anomalyPenalty);

    // Total Score (0 - 100)
    const totalScore = Math.min(100, Math.round(responseCoverage + dataCompleteness + fieldEvidence + anomalyConsistency));

    let band: ConfidenceBand;
    if (totalScore >= 80) {
      band = 'high';
    } else if (totalScore >= 60) {
      band = 'medium';
    } else {
      band = 'low';
    }

    return {
      responseCoverage,
      dataCompleteness,
      fieldEvidence,
      anomalyConsistency,
      totalScore,
      band,
      certificateEligible: totalScore >= 70,
    };
  }
}

export const dataConfidenceService = new DataConfidenceService();
