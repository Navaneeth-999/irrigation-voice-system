export interface DailyWeatherData {
  date: string; // YYYY-MM-DD
  tempMaxC: number | null;
  tempMinC: number | null;
  precipitationSumMm: number;
  precipitationProbabilityMax: number | null; // 0-100%
  weatherCode: number | null; // WMO code
  et0FaoEvapotranspiration: number | null; // mm/day
  isForecast: boolean;
  isDemo: boolean;
  source: 'openmeteo' | 'mock' | 'manual';
}

export interface WeatherForecastResult {
  villageId: string;
  villageName: string;
  latitude: number;
  longitude: number;
  source: 'openmeteo' | 'mock' | 'manual';
  isDemo: boolean;
  forecast: DailyWeatherData[];
  observed: DailyWeatherData[];
  cachedAt?: string;
  isStale?: boolean;
}

export interface AlertRuleConfig {
  id: string;
  ruleCode: string;
  name: string;
  description?: string;
  alertType: 'rain_expected' | 'heavy_rain' | 'thunderstorm' | 'high_temperature' | 'dry_spell' | 'custom_advisory';
  severity: 'advisory' | 'warning' | 'critical';
  thresholdConfig: Record<string, any>;
  cooldownHours: number;
  isActive: boolean;
}

export interface WeatherAlertPayload {
  villageId: string;
  ruleId?: string;
  alertType: string;
  severity: 'advisory' | 'warning' | 'critical';
  targetDate: string; // YYYY-MM-DD
  headlineEn: string;
  headlineTe: string;
  messageEn: string;
  messageTe: string;
  suggestedActionEn?: string;
  suggestedActionTe?: string;
  source: 'system' | 'manual';
  validUntil: Date;
  createdBy?: string;
}
