import { WaterUseRatioBand } from './types.js';

export interface WurEvaluation {
  ratio: number;
  band: WaterUseRatioBand;
  labelEn: string;
  labelTe: string;
  descriptionEn: string;
  descriptionTe: string;
}

/**
 * Water Use Ratio (WUR) Engine.
 * Calculates indicative water use relative to agronomic crop demand:
 *   WUR = Total Applied Irrigation Volume (m³) / Net Agronomic Crop Water Demand (m³)
 *
 * NOTE (DECISION-013 & User Directive 3):
 * WUR is strictly an indicative agronomic comparison band.
 * It is NEVER used for competitive farmer rankings, scoreboards, or leaderboards.
 */
export class WaterUseRatioEngine {
  /**
   * Evaluates Water Use Ratio into non-competitive qualitative bands.
   */
  evaluateRatio(appliedM3: number, demandM3: number): WurEvaluation {
    const validDemand = Math.max(0.1, demandM3);
    const rawRatio = appliedM3 / validDemand;
    const ratio = Math.round(rawRatio * 100) / 100;

    let band: WaterUseRatioBand;
    let labelEn: string;
    let labelTe: string;
    let descriptionEn: string;
    let descriptionTe: string;

    if (ratio < 0.85) {
      band = 'below_estimate';
      labelEn = 'Below Estimated Demand';
      labelTe = 'అంచనా వేసిన నీటి కంటే తక్కువ';
      descriptionEn = 'Reported irrigation is below calculated crop evapotranspiration demand. This may reflect deficit irrigation, high residual soil moisture, or unrecorded canal/rainfall contributions.';
      descriptionTe = 'పంటకు అవసరమైన అంచనా కంటే తక్కువ నీరు వాడారు. ఇది వర్షపు నీరు లేదా ఇతర వనరుల సమర్థ వినియోగాన్ని సూచించవచ్చు.';
    } else if (ratio <= 1.20) {
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

    return {
      ratio,
      band,
      labelEn,
      labelTe,
      descriptionEn,
      descriptionTe,
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
