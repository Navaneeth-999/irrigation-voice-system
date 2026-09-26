import crypto from 'crypto';
import { db } from '../../db/index.js';
import { ImmutableSeasonSnapshot } from './types.js';

export class SnapshotService {
  /**
   * Constructs the full, canonical immutable snapshot for a season at harvest completion.
   */
  async buildSeasonSnapshot(
    seasonId: string,
    actualHarvestDate: string,
    yieldQuantity?: number,
    yieldUnit?: string
  ): Promise<ImmutableSeasonSnapshot> {
    // 1. Fetch Season, Farmer, Village, Plot, and Crop details
    const seasonRes = await db.query(
      `SELECT s.id as season_id, s.season_code, s.season_type, s.season_year,
              s.sowing_date, s.area_acres_snapshot,
              f.id as farmer_id, f.farmer_code, f.full_name as farmer_name, f.preferred_language,
              v.name as village_name, v.mandal, v.district,
              p.id as plot_id, p.label as plot_label, p.area_acres as plot_area,
              c.id as crop_id, c.name as crop_name, c.name_te as crop_name_te, c.category as crop_category, c.water_model,
              imt.name as imt_name, imt.typical_efficiency
       FROM seasons s
       JOIN farmers f ON f.id = s.farmer_id
       JOIN villages v ON v.id = f.village_id
       JOIN plots p ON p.id = s.plot_id
       JOIN crops c ON c.id = s.crop_id
       LEFT JOIN irrigation_method_types imt ON imt.id = s.irrigation_method_type_id
       WHERE s.id = $1`,
      [seasonId]
    );

    if (seasonRes.rows.length === 0) {
      throw new Error(`Season with ID ${seasonId} not found`);
    }

    const row = seasonRes.rows[0];

    // 2. Fetch Water Metrics
    const metricsRes = await db.query(
      `SELECT * FROM season_water_metrics WHERE season_id = $1`,
      [seasonId]
    );

    if (metricsRes.rows.length === 0) {
      throw new Error(`Water metrics for season ${seasonId} must be calculated before generating certificate snapshot`);
    }

    const m = metricsRes.rows[0];

    // 3. Summarize Irrigation Records
    const irrRes = await db.query(
      `SELECT COUNT(*)::int as count,
              COALESCE(SUM(raw_value), 0)::float as total_hours,
              COALESCE(SUM(estimated_volume_l), 0)::float as total_volume
       FROM irrigation_records
       WHERE season_id = $1`,
      [seasonId]
    );
    const irrSummary = irrRes.rows[0];

    // 4. Summarize Farmer Feedback Records
    const fbRes = await db.query(
      `SELECT COUNT(*)::int as count,
              array_agg(DISTINCT rainfall_class) as rain_classes
       FROM farmer_feedback
       WHERE season_id = $1`,
      [seasonId]
    );
    const fbSummary = fbRes.rows[0];

    const snapshot: ImmutableSeasonSnapshot = {
      schemaVersion: '1.0.0',
      seasonId: row.season_id,
      seasonCode: row.season_code,
      seasonType: row.season_type,
      seasonYear: row.season_year,
      sowingDate: row.sowing_date instanceof Date ? row.sowing_date.toISOString().split('T')[0] : String(row.sowing_date).split('T')[0],
      actualHarvestDate: actualHarvestDate,
      yieldQuantity: yieldQuantity !== undefined ? Number(yieldQuantity) : null,
      yieldUnit: yieldUnit || null,
      areaAcres: Number(row.area_acres_snapshot || row.plot_area),
      farmer: {
        id: row.farmer_id,
        farmerCode: row.farmer_code,
        fullName: row.farmer_name,
        preferredLanguage: row.preferred_language || 'te',
        villageName: row.village_name,
        mandal: row.mandal,
        district: row.district,
      },
      plot: {
        id: row.plot_id,
        label: row.plot_label,
        areaAcres: Number(row.plot_area),
        waterSourceTypes: ['Borewell / Ground Water'],
        irrigationMethod: row.imt_name || 'Flood Irrigation',
        typicalEfficiency: Number(row.typical_efficiency || 0.75),
      },
      crop: {
        id: row.crop_id,
        name: row.crop_name,
        nameTe: row.crop_name_te,
        category: row.crop_category,
        waterModel: row.water_model,
      },
      waterMetrics: {
        totalEtcMm: Number(m.total_etc_mm),
        totalEtcM3: Number(m.total_etc_m3),
        totalEffectiveRainMm: Number(m.total_effective_rain_mm),
        totalEffectiveRainM3: Number(m.total_effective_rain_m3),
        netIrrigationDemandMm: Number(m.net_irrigation_demand_mm),
        netIrrigationDemandM3: Number(m.net_irrigation_demand_m3),
        totalAppliedLitres: Number(m.total_applied_litres),
        totalAppliedM3: Number(m.total_applied_m3),
        totalAppliedMm: Number(m.total_applied_mm),
        waterUseRatio: Number(m.water_use_ratio),
        ratioBand: m.ratio_band,
        confidenceScore: Number(m.confidence_score),
        confidenceBand: m.confidence_band,
        confidenceBreakdown: typeof m.confidence_breakdown === 'string'
          ? JSON.parse(m.confidence_breakdown)
          : m.confidence_breakdown,
        hasUnvalidatedAssumptions: Boolean(m.has_unvalidated_assumptions),
        unvalidatedAssumptionsList: Array.isArray(m.unvalidated_assumptions_list)
          ? m.unvalidated_assumptions_list
          : [],
        anomalyFlags: Array.isArray(m.anomaly_flags) ? m.anomaly_flags : [],
      },
      irrigationRecordsSummary: {
        totalLogsCount: irrSummary.count || 0,
        totalHoursReported: irrSummary.total_hours || 0,
        totalEstimatedVolumeL: irrSummary.total_volume || 0,
      },
      feedbackSummary: {
        totalCyclesRecorded: fbSummary.count || 0,
        rainClassesReported: (fbSummary.rain_classes || []).filter(Boolean),
      },
      snapshotGeneratedAt: new Date().toISOString(),
    };

    return snapshot;
  }

  /**
   * Deterministically stringifies an object by sorting all object keys recursively.
   */
  canonicalizeJson(obj: any): string {
    if (obj === null || typeof obj !== 'object') {
      return JSON.stringify(obj);
    }

    if (Array.isArray(obj)) {
      return '[' + obj.map(item => this.canonicalizeJson(item)).join(',') + ']';
    }

    const sortedKeys = Object.keys(obj).sort();
    const parts = sortedKeys.map(key => {
      return JSON.stringify(key) + ':' + this.canonicalizeJson(obj[key]);
    });

    return '{' + parts.join(',') + '}';
  }

  /**
   * Computes the SHA-256 cryptographic hash of a snapshot.
   */
  computeSha256(snapshot: any): string {
    const canonical = this.canonicalizeJson(snapshot);
    return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
  }

  /**
   * Verifies whether a given snapshot matches its stored SHA-256 hash.
   */
  verifyIntegrity(snapshot: any, expectedHash: string): boolean {
    const calculated = this.computeSha256(snapshot);
    return calculated === expectedHash;
  }
}

export const snapshotService = new SnapshotService();
