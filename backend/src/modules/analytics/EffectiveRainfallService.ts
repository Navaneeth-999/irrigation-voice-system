import { db } from '../../db/index.js';
import { EffectiveRainfallConfig } from './types.js';

/**
 * Service for computing effective rainfall (P_eff).
 * Adheres strictly to DECISION-013 & ASSUMPTIONS.md:
 * - Dynamically loads configurable parameters from `app_settings`.
 * - Never hardcoded.
 * - Flags unvalidated assumption status when parameters have not been calibrated by published local research.
 */
export class EffectiveRainfallService {
  private cachedConfig: EffectiveRainfallConfig | null = null;
  private cacheExpiry: number = 0;

  /**
   * Retrieves effective rainfall configuration from `app_settings` or falls back to documented defaults.
   */
  async getConfig(): Promise<EffectiveRainfallConfig> {
    const now = Date.now();
    if (this.cachedConfig && now < this.cacheExpiry) {
      return this.cachedConfig;
    }

    try {
      const res = await db.query(
        `SELECT value FROM app_settings WHERE key = 'effective_rainfall_method'`
      );

      if (res.rows.length > 0) {
        const val = typeof res.rows[0].value === 'string'
          ? JSON.parse(res.rows[0].value)
          : res.rows[0].value;

        this.cachedConfig = {
          minThresholdMm: Number(val.min_threshold_mm ?? val.minThresholdMm ?? 5.0),
          fraction: Number(val.fraction ?? 0.75),
          maxCapMm: Number(val.max_cap_mm ?? val.maxCapMm ?? 35.0),
          isVerified: Boolean(val.is_verified ?? val.isVerified ?? false),
          source: String(val.source ?? 'ASSUMPTIONS.md / USDA-SCS Baseline Heuristic'),
        };
      } else {
        // Documented default baseline per ASSUMPTIONS.md
        this.cachedConfig = {
          minThresholdMm: 5.0,
          fraction: 0.75,
          maxCapMm: 35.0,
          isVerified: false,
          source: 'ASSUMPTIONS.md / USDA-SCS Baseline Heuristic',
        };
      }
    } catch {
      this.cachedConfig = {
        minThresholdMm: 5.0,
        fraction: 0.75,
        maxCapMm: 35.0,
        isVerified: false,
        source: 'ASSUMPTIONS.md / Fallback',
      };
    }

    this.cacheExpiry = now + 10 * 60 * 1000; // Cache for 10 minutes
    return this.cachedConfig;
  }

  /**
   * Computes effective rainfall for standard aerobic upland crops (e.g. Maize, Chilli).
   * - Daily precipitation < minThresholdMm: 0 mm (lost to interception / canopy evaporation)
   * - Between minThresholdMm and maxCapMm: (Rain - minThresholdMm) * fraction
   * - Capped at maxCapMm (soil infiltration rate limit)
   */
  async calculateEffectiveRainfall(rainfallMm: number): Promise<{
    effectiveRainfallMm: number;
    isVerified: boolean;
    source: string;
  }> {
    if (rainfallMm <= 0) {
      const cfg = await this.getConfig();
      return { effectiveRainfallMm: 0, isVerified: cfg.isVerified ?? false, source: cfg.source ?? '' };
    }

    const cfg = await this.getConfig();

    if (rainfallMm < cfg.minThresholdMm) {
      return {
        effectiveRainfallMm: 0,
        isVerified: cfg.isVerified ?? false,
        source: cfg.source ?? '',
      };
    }

    const effective = (rainfallMm - cfg.minThresholdMm) * cfg.fraction;
    const capped = Math.min(effective, cfg.maxCapMm);

    return {
      effectiveRainfallMm: Math.round(capped * 100) / 100,
      isVerified: cfg.isVerified ?? false,
      source: cfg.source ?? '',
    };
  }

  /**
   * Computes effective rainfall for bunded paddy fields.
   * Flooded rice retains rainfall within the bund perimeter up to maximum bund overflow height.
   */
  async calculatePaddyEffectiveRainfall(
    rainfallMm: number,
    currentPondingDepthMm: number,
    bundHeightMm: number = 100
  ): Promise<{
    effectiveRainfallMm: number;
    drainageOverflowMm: number;
    isVerified: boolean;
    source: string;
  }> {
    const cfg = await this.getConfig();
    if (rainfallMm <= 0) {
      return {
        effectiveRainfallMm: 0,
        drainageOverflowMm: 0,
        isVerified: cfg.isVerified ?? false,
        source: cfg.source ?? '',
      };
    }

    // Available bund storage capacity before weir/overflow
    const availableStorage = Math.max(0, bundHeightMm - currentPondingDepthMm);
    const captured = Math.min(rainfallMm, availableStorage);
    const overflow = Math.max(0, rainfallMm - availableStorage);

    return {
      effectiveRainfallMm: Math.round(captured * 100) / 100,
      drainageOverflowMm: Math.round(overflow * 100) / 100,
      isVerified: cfg.isVerified ?? false,
      source: 'Paddy Bunded Water Balance (ASSUMPTIONS.md Section 2)',
    };
  }
}

export const effectiveRainfallService = new EffectiveRainfallService();
