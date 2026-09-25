import { DailyWeatherData } from '../types.js';

export interface IWeatherAdapter {
  providerName: 'openmeteo' | 'mock';
  getForecast(lat: number, lon: number, days?: number): Promise<DailyWeatherData[]>;
  getObserved(lat: number, lon: number, startDate: string, endDate: string): Promise<DailyWeatherData[]>;
}
