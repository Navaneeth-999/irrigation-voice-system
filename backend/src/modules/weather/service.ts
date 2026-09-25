import { db } from '../../db/index.js';
import { IWeatherAdapter } from './adapters/IWeatherAdapter.js';
import { OpenMeteoAdapter } from './adapters/OpenMeteoAdapter.js';
import { MockWeatherAdapter } from './adapters/MockWeatherAdapter.js';
import { DailyWeatherData, WeatherForecastResult } from './types.js';
import { alertEngine } from './AlertEngine.js';

export class WeatherService {
  private adapter: IWeatherAdapter;

  constructor(customAdapter?: IWeatherAdapter) {
    if (customAdapter) {
      this.adapter = customAdapter;
    } else {
      const provider = process.env.WEATHER_PROVIDER || 'openmeteo';
      if (provider === 'mock') {
        this.adapter = new MockWeatherAdapter();
      } else {
        this.adapter = new OpenMeteoAdapter();
      }
    }
  }

  getAdapterName(): 'openmeteo' | 'mock' {
    return this.adapter.providerName;
  }

  /**
   * Retrieves weather for a village, reading from the DB cache if within TTL (default 6h / 360m),
   * or fetching fresh data from the configured weather provider and evaluating alert rules.
   */
  async getVillageWeather(villageId: string, forceRefresh: boolean = false): Promise<WeatherForecastResult> {
    const villageRes = await db.query(
      `SELECT id, name, latitude, longitude, is_demo FROM villages WHERE id = $1`,
      [villageId]
    );

    if (villageRes.rows.length === 0) {
      throw new Error(`Village with ID ${villageId} not found`);
    }

    const village = villageRes.rows[0];
    const lat = Number(village.latitude || 16.3067);
    const lon = Number(village.longitude || 80.4365);
    const ttlMinutes = parseInt(process.env.WEATHER_CACHE_TTL_MINUTES || '360', 10);

    // 1. Check existing cached records in weather_records
    if (!forceRefresh) {
      const cachedRes = await db.query(
        `SELECT * FROM weather_records
         WHERE village_id = $1
           AND fetched_at >= NOW() - ($2 || ' minutes')::interval
         ORDER BY record_date ASC`,
        [villageId, ttlMinutes]
      );

      const cachedRows = cachedRes.rows;
      const forecastRows = cachedRows.filter(r => r.is_forecast && new Date(r.record_date) >= new Date(new Date().toDateString()));

      // If we have at least 3 days of valid cached forecast data, return it
      if (forecastRows.length >= 3) {
        const forecast: DailyWeatherData[] = cachedRows
          .filter(r => r.is_forecast)
          .map(this.mapDbRowToDaily);

        const observed: DailyWeatherData[] = cachedRows
          .filter(r => !r.is_forecast)
          .map(this.mapDbRowToDaily);

        return {
          villageId,
          villageName: village.name,
          latitude: lat,
          longitude: lon,
          source: cachedRows[0].source as 'openmeteo' | 'mock',
          isDemo: cachedRows[0].is_demo,
          forecast,
          observed,
          cachedAt: cachedRows[0].fetched_at.toISOString(),
          isStale: false,
        };
      }
    }

    // 2. Fetch fresh weather from adapter
    const today = new Date();
    const past7 = new Date();
    past7.setDate(today.getDate() - 7);
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);

    const past7Str = past7.toISOString().split('T')[0];
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    let forecastData: DailyWeatherData[] = [];
    let observedData: DailyWeatherData[] = [];

    try {
      forecastData = await this.adapter.getForecast(lat, lon, 7);
      observedData = await this.adapter.getObserved(lat, lon, past7Str, yesterdayStr);
    } catch (err: any) {
      // If live open-meteo fails due to network/offline, fallback gracefully to mock adapter
      if (this.adapter.providerName === 'openmeteo') {
        console.warn(`[WeatherService] Open-Meteo failed: ${err.message}. Falling back to mock adapter.`);
        const mock = new MockWeatherAdapter();
        forecastData = await mock.getForecast(lat, lon, 7);
        observedData = await mock.getObserved(lat, lon, past7Str, yesterdayStr);
      } else {
        throw err;
      }
    }

    // 3. Upsert records into weather_records
    const allRecords = [...observedData, ...forecastData];
    for (const item of allRecords) {
      await db.query(
        `INSERT INTO weather_records (
          village_id, record_date, temp_max_c, temp_min_c,
          precipitation_sum_mm, precipitation_probability_max,
          weather_code, et0_fao_evapotranspiration, source,
          is_forecast, is_demo, fetched_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP)
        ON CONFLICT (village_id, record_date, is_forecast)
        DO UPDATE SET
          temp_max_c = EXCLUDED.temp_max_c,
          temp_min_c = EXCLUDED.temp_min_c,
          precipitation_sum_mm = EXCLUDED.precipitation_sum_mm,
          precipitation_probability_max = EXCLUDED.precipitation_probability_max,
          weather_code = EXCLUDED.weather_code,
          et0_fao_evapotranspiration = EXCLUDED.et0_fao_evapotranspiration,
          source = EXCLUDED.source,
          is_demo = EXCLUDED.is_demo,
          fetched_at = CURRENT_TIMESTAMP`,
        [
          villageId,
          item.date,
          item.tempMaxC,
          item.tempMinC,
          item.precipitationSumMm,
          item.precipitationProbabilityMax,
          item.weatherCode,
          item.et0FaoEvapotranspiration,
          item.source,
          item.isForecast,
          item.isDemo || village.is_demo,
        ]
      );
    }

    // 4. Automatically trigger AlertEngine evaluation
    await alertEngine.evaluateForecast(villageId, forecastData);

    return {
      villageId,
      villageName: village.name,
      latitude: lat,
      longitude: lon,
      source: forecastData[0]?.source || 'openmeteo',
      isDemo: forecastData[0]?.isDemo || village.is_demo,
      forecast: forecastData,
      observed: observedData,
      cachedAt: new Date().toISOString(),
      isStale: false,
    };
  }

  /**
   * Refreshes weather for all villages having active crop seasons.
   */
  async refreshAllActiveVillages(): Promise<{ processedVillages: number }> {
    const villagesRes = await db.query(
      `SELECT DISTINCT v.id
       FROM villages v
       JOIN farmers f ON f.village_id = v.id
       JOIN plots p ON p.farmer_id = f.id
       JOIN seasons s ON s.plot_id = p.id
       WHERE s.status = 'active'`
    );

    let count = 0;
    for (const row of villagesRes.rows) {
      try {
        await this.getVillageWeather(row.id, true);
        count++;
      } catch (err: any) {
        console.error(`Failed to refresh weather for village ${row.id}:`, err.message);
      }
    }

    return { processedVillages: count };
  }

  private mapDbRowToDaily(r: any): DailyWeatherData {
    return {
      date: typeof r.record_date === 'string' ? r.record_date : r.record_date.toISOString().split('T')[0],
      tempMaxC: r.temp_max_c != null ? Number(r.temp_max_c) : null,
      tempMinC: r.temp_min_c != null ? Number(r.temp_min_c) : null,
      precipitationSumMm: Number(r.precipitation_sum_mm || 0),
      precipitationProbabilityMax: r.precipitation_probability_max != null ? Number(r.precipitation_probability_max) : null,
      weatherCode: r.weather_code != null ? Number(r.weather_code) : null,
      et0FaoEvapotranspiration: r.et0_fao_evapotranspiration != null ? Number(r.et0_fao_evapotranspiration) : null,
      isForecast: r.is_forecast,
      isDemo: r.is_demo,
      source: r.source,
    };
  }
}

export const weatherService = new WeatherService();
