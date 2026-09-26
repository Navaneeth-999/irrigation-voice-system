import { db } from '../../db/index.js';
import { WaterUseRatioBand } from './types.js';

export interface WurThresholdsConfig {
  lowerBandEdge: number; // default 0.85
  upperBandEdge: number; // default 1.25
  isVerified: boolean;   // default false
  source: string;        // 'FAO-56 Irrigation Management Heuristic'
}

export interface WurEvaluation {
  ratio: number;
  band: WaterUseRatioBand;
  labelEn: string;
  labelTe: string;
  descriptionEn: string;
  descriptionTe: string;
  thresholdsConfig: WurThresholdsConfig;
  unvalidatedAssumption?: string;
}

/**
 * Water Use Ratio (WUR) Engine.
 * Calculates indicative water use relative to agronomic crop demand:
 *   WUR = Total Applied Irrigation Volume (m³) / Net Agronomic Crop Water Demand (m³)
 *
 * NOTE (DECISION-013 & User Directives):
 * - WUR is strictly an indicative agronomic comparison band.
 * - It is NEVER used for competitive farmer rankings, scoreboards, or leaderboards.
 * - Band edges (0.85/1.25) are loaded dynamically from `app_settings` (`wur_band_thresholds`)
 *   and flagged as unvalidated assumptions unless verified by local field calibration.
 */
export class WaterUseRatioEngine {
  private cachedConfig: WurThresholdsConfig | null = null;
  private cacheExpiry: number = 0;

  /**
   * Retrieves WUR band thresholds from `app_settings` or documented default baseline.
   */
  async getThresholdsConfig(): Promise<WurThresholdsConfig> {
    const now = Date.now();
    if (this.cachedConfig && now < this.cacheExpiry) {
      return this.cachedConfig;
    }

    try {
      const res = await db.query(
        `SELECT value FROM app_settings WHERE key = 'wur_band_thresholds'`
      );

      if (res.rows.length > 0) {
        const val = typeof res.rows[0].value === 'string'
          ? JSON.parse(res.rows[0].value)
          : res.rows[0].value;

        this.cachedConfig = {
          lowerBandEdge: Number(val.lower_band_edge ?? val.lowerBandEdge ?? 0.85),
          upperBandEdge: Number(val.upper_band_edge ?? val.upperBandEdge ?? 1.25),
          isVerified: Boolean(val.is_verified ?? val.isVerified ?? false),
          source: String(val.source ?? 'ASSUMPTIONS.md / FAO-56 Indicative Band Heuristic'),
        };
      } else {
        this.cachedConfig = {
          lowerBandEdge: 0.85,
          upperBandEdge: 1.25,
          isVerified: false,
          source: 'ASSUMPTIONS.md / FAO-56 Indicative Band Heuristic',
        };
      }
    } catch {
      this.cachedConfig = {
        lowerBandEdge: 0.85,
        upperBandEdge: 1.25,
        isVerified: false,
        source: 'ASSUMPTIONS.md / Fallback',
      };
    }

    this.cacheExpiry = now + 60_000; // 1 min cache
    return this.cachedConfig;
  }

  /**
   * Clears the in-memory cached configuration to force reload from app_settings.
   */
  clearCache(): void {
    this.cachedConfig = null;
    this.cacheExpiry = 0;
  }

  /**
   * Evaluates Water Use Ratio into non-competitive qualitative bands.
   */
  evaluateRatio(
    appliedM3: number,
    demandM3: number,
    customConfig?: WurThresholdsConfig
  ): WurEvaluation {
    const config = customConfig || this.cachedConfig || {
      lowerBandEdge: 0.85,
      upperBandEdge: 1.25,
      isVerified: false,
      source: 'ASSUMPTIONS.md / Default Baseline',
    };

    const validDemand = Math.max(0.1, demandM3);
    const rawRatio = appliedM3 / validDemand;
    const ratio = Math.round(rawRatio * 100) / 100;

    let band: WaterUseRatioBand;
    let labelEn: string;
    let labelTe: string;
    let descriptionEn: string;
    let descriptionTe: string;

    if (ratio < config.lowerBandEdge) {
      band = 'below_estimate';
      labelEn = 'Below Estimated Demand';
      labelTe = 'అంచనా వేసిన నీటి కంటే తక్కువ';
      descriptionEn = 'Reported irrigation is below calculated crop evapotranspiration demand. This may reflect deficit irrigation, high residual soil moisture, or unrecorded canal/rainfall contributions.';
      descriptionTe = 'పంటకు అవసరమైన అంచనా కంటే తక్కువ నీరు వాడారు. ఇది వర్షపు నీరు లేదా ఇతర వనరుల సమర్థ వినియోగాన్ని సూచించవచ్చు.';
    } else if (ratio <= config.upperBandEdge) {
      band = 'near_estimate';
      labelEn = 'Near Agronomic Target';
      labelTe = 'అంచనా వేసిన అవసరానికి సమానం';
      descriptionEn = 'Reported irrigation closely matches scientific FAO-56 crop water requirements and local weather conditions.';
      descriptionTe = 'పంట నీటి అవసరాలకు తగినట్లుగా శాస్త్రీయంగా నీటిపారుదల జరిగింది.';
    } else {
      band = 'above_estimate';
      labelEn = 'Above Estimated Demand';
      labelTe = 'అంచనా వేసిన నీటి కంటే ఎక్కువ';
      descriptionEn = 'Reported irrigation exceeds estimated agronomic crop demand. May indicate conveyance losses, field over-irrigation, or high soil percolation.';
      descriptionTe = 'పంట అంచనా అవసరం కంటే ఎక్కువ నీరు వాడారు. మురుగు నీటి నష్టాలు లేదా ఎక్కువ పారుదల జరిగి ఉండవచ్చు.';
    }

    let unvalidatedAssumption: string | undefined;
    if (!config.isVerified) {
      unvalidatedAssumption = `Water Use Ratio qualitative bands (${config.lowerBandEdge} / ${config.upperBandEdge}) based on uncalibrated heuristic (${config.source})`;
    }

    return {
      ratio,
      band,
      labelEn,
      labelTe,
      descriptionEn,
      descriptionTe,
      thresholdsConfig: config,
      unvalidatedAssumption,
    };
  }

  /**
   * Helper: Converts depth (mm) over area (acres) to volume (m³).
   * 1 acre = 4,046.86 m²
   * 1 mm depth over 1 m² = 1 Litre = 0.001 m³
   * 1 mm depth over 1 acre = 4.04686 m³ = 4,046.86 Litres
   */
  mmToCubicMeters(depthMm: number, areaAcres: number): number {
    return Math.round(depthMm * areaAcres * 4.04686 * 100) / 100;
  }

  /**
   * Helper: Converts volume (Litres) to cubic meters (m³).
   */
  litresToCubicMeters(litres: number): number {
    return Math.round((litres / 1000) * 100) / 100;
  }

  /**
   * Helper: Converts volume (Litres) over area (acres) to depth (mm).
   */
  litresToMmDepth(litres: number, areaAcres: number): number {
    if (areaAcres <= 0) return 0;
    return Math.round((litres / (areaAcres * 4046.86)) * 100) / 100;
  }
}

export const waterUseRatioEngine = new WaterUseRatioEngine();
