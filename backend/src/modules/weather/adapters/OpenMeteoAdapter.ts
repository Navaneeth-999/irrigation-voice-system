import { IWeatherAdapter } from './IWeatherAdapter.js';
import { DailyWeatherData } from '../types.js';

export class OpenMeteoAdapter implements IWeatherAdapter {
  providerName: 'openmeteo' = 'openmeteo';
  private baseUrl = 'https://api.open-meteo.com/v1/forecast';
  private archiveUrl = 'https://archive-api.open-meteo.com/v1/archive';
  private timeoutMs = 8000;

  /**
   * Fetches daily weather forecast for a given geographic coordinate.
   * Parameters adhere to FAO-56 and standard meteorological observations for Andhra Pradesh.
   */
  async getForecast(lat: number, lon: number, days: number = 7): Promise<DailyWeatherData[]> {
    const url = new URL(this.baseUrl);
    url.searchParams.set('latitude', lat.toFixed(4));
    url.searchParams.set('longitude', lon.toFixed(4));
    url.searchParams.set(
      'daily',
      'temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,weather_code,et0_fao_evapotranspiration'
    );
    url.searchParams.set('forecast_days', Math.min(16, Math.max(1, days)).toString());
    url.searchParams.set('timezone', 'Asia/Kolkata');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(url.toString(), {
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'SmartIrrigationAdvisorySystem/1.0 (Irrigation Management Initiative)',
        },
      });

      if (!res.ok) {
        throw new Error(`Open-Meteo Forecast HTTP ${res.status}: ${res.statusText}`);
      }

      const data = await res.json();
      return this.transformDailyResponse(data, true);
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new Error(`WEATHER_TIMEOUT: Open-Meteo forecast request timed out after ${this.timeoutMs}ms.`);
      }
      throw new Error(`WEATHER_FETCH_FAILED: ${err.message}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Fetches observed historical weather for a given date range.
   */
  async getObserved(lat: number, lon: number, startDate: string, endDate: string): Promise<DailyWeatherData[]> {
    const url = new URL(this.archiveUrl);
    url.searchParams.set('latitude', lat.toFixed(4));
    url.searchParams.set('longitude', lon.toFixed(4));
    url.searchParams.set('start_date', startDate);
    url.searchParams.set('end_date', endDate);
    url.searchParams.set(
      'daily',
      'temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code,et0_fao_evapotranspiration'
    );
    url.searchParams.set('timezone', 'Asia/Kolkata');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(url.toString(), {
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'SmartIrrigationAdvisorySystem/1.0 (Irrigation Management Initiative)',
        },
      });

      if (!res.ok) {
        // Fall back to forecast endpoint with past_days if archive API is unavailable for recent dates
        return this.getObservedFallback(lat, lon, startDate, endDate);
      }

      const data = await res.json();
      return this.transformDailyResponse(data, false);
    } catch (err: any) {
      // Graceful fallback to forecast API past_days for recent dates (last 7-14 days)
      return this.getObservedFallback(lat, lon, startDate, endDate);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async getObservedFallback(lat: number, lon: number, startDate: string, endDate: string): Promise<DailyWeatherData[]> {
    try {
      const url = new URL(this.baseUrl);
      url.searchParams.set('latitude', lat.toFixed(4));
      url.searchParams.set('longitude', lon.toFixed(4));
      url.searchParams.set('past_days', '14');
      url.searchParams.set('forecast_days', '1');
      url.searchParams.set(
        'daily',
        'temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code,et0_fao_evapotranspiration'
      );
      url.searchParams.set('timezone', 'Asia/Kolkata');

      const res = await fetch(url.toString(), {
        headers: { 'Accept': 'application/json' },
      });

      if (!res.ok) {
        throw new Error(`Open-Meteo Fallback HTTP ${res.status}`);
      }

      const data = await res.json();
      const allDaily = this.transformDailyResponse(data, false);
      return allDaily.filter(d => d.date >= startDate && d.date <= endDate);
    } catch {
      return [];
    }
  }

  private transformDailyResponse(data: any, isForecast: boolean): DailyWeatherData[] {
    const daily = data?.daily;
    if (!daily || !Array.isArray(daily.time)) {
      return [];
    }

    const results: DailyWeatherData[] = [];
    const count = daily.time.length;

    for (let i = 0; i < count; i++) {
      results.push({
        date: daily.time[i],
        tempMaxC: daily.temperature_2m_max?.[i] != null ? Number(daily.temperature_2m_max[i]) : null,
        tempMinC: daily.temperature_2m_min?.[i] != null ? Number(daily.temperature_2m_min[i]) : null,
        precipitationSumMm: daily.precipitation_sum?.[i] != null ? Math.max(0, Number(daily.precipitation_sum[i])) : 0.0,
        precipitationProbabilityMax: daily.precipitation_probability_max?.[i] != null ? Number(daily.precipitation_probability_max[i]) : null,
        weatherCode: daily.weather_code?.[i] != null ? Number(daily.weather_code[i]) : null,
        et0FaoEvapotranspiration: daily.et0_fao_evapotranspiration?.[i] != null ? Number(daily.et0_fao_evapotranspiration[i]) : null,
        isForecast,
        isDemo: false,
        source: 'openmeteo',
      });
    }

    return results;
  }
}
