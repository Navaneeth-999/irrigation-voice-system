import { IWeatherAdapter } from './IWeatherAdapter.js';
import { DailyWeatherData } from '../types.js';

export class MockWeatherAdapter implements IWeatherAdapter {
  providerName: 'mock' = 'mock';

  /**
   * Deterministic mock forecast generator for Andhra Pradesh agricultural regions.
   * Produces realistic daily temperatures (30-38 C), humidity, and occasional rainfall.
   */
  async getForecast(lat: number, lon: number, days: number = 7): Promise<DailyWeatherData[]> {
    const results: DailyWeatherData[] = [];
    const today = new Date();

    for (let i = 0; i < days; i++) {
      const target = new Date(today);
      target.setDate(today.getDate() + i);
      const dateStr = target.toISOString().split('T')[0];

      // Pseudo-random deterministic variation based on lat, lon, and day offset
      const seed = Math.abs(Math.sin((lat * 100 + lon * 10 + i) * 1.5));
      const tempMax = Number((32.0 + seed * 6.5).toFixed(1)); // 32.0 - 38.5 C
      const tempMin = Number((22.0 + seed * 4.0).toFixed(1)); // 22.0 - 26.0 C

      // Give day 2 or 3 some rain in some coordinate patterns for alert testing
      let precipMm = 0.0;
      let precipProb = Math.round(seed * 40); // 0 - 40%
      let weatherCode = 1; // Mainly clear

      if (i === 1 && seed > 0.6) {
        precipMm = Number((5.0 + seed * 10).toFixed(1));
        precipProb = 75;
        weatherCode = 61; // Slight rain
      } else if (i === 2 && seed > 0.8) {
        precipMm = Number((20.0 + seed * 15).toFixed(1));
        precipProb = 85;
        weatherCode = 95; // Thunderstorm
      }

      const et0 = Number((4.5 + seed * 1.5).toFixed(2)); // FAO-56 Reference ET

      results.push({
        date: dateStr,
        tempMaxC: tempMax,
        tempMinC: tempMin,
        precipitationSumMm: precipMm,
        precipitationProbabilityMax: precipProb,
        weatherCode,
        et0FaoEvapotranspiration: et0,
        isForecast: true,
        isDemo: true,
        source: 'mock',
      });
    }

    return results;
  }

  /**
   * Deterministic mock observed historical weather for past dates.
   */
  async getObserved(lat: number, lon: number, startDate: string, endDate: string): Promise<DailyWeatherData[]> {
    const results: DailyWeatherData[] = [];
    const start = new Date(startDate);
    const end = new Date(endDate);

    const curr = new Date(start);
    let dayIndex = 0;
    while (curr <= end) {
      const dateStr = curr.toISOString().split('T')[0];
      const seed = Math.abs(Math.sin((lat * 50 + lon * 5 + dayIndex) * 1.2));
      const tempMax = Number((31.0 + seed * 5.0).toFixed(1));
      const tempMin = Number((21.0 + seed * 4.0).toFixed(1));
      const precipMm = seed > 0.75 ? Number((4.0 + seed * 8).toFixed(1)) : 0.0;

      results.push({
        date: dateStr,
        tempMaxC: tempMax,
        tempMinC: tempMin,
        precipitationSumMm: precipMm,
        precipitationProbabilityMax: null,
        weatherCode: precipMm > 0 ? 61 : 0,
        et0FaoEvapotranspiration: Number((4.2 + seed * 1.2).toFixed(2)),
        isForecast: false,
        isDemo: true,
        source: 'mock',
      });

      curr.setDate(curr.getDate() + 1);
      dayIndex++;
    }

    return results;
  }
}
