import { db } from '../../db/index.js';
import { DailyWeatherData } from './types.js';
import { notificationService } from '../communication/NotificationService.js';

export interface CreateAdvisoryInput {
  villageId: string;
  headlineEn: string;
  headlineTe: string;
  messageEn: string;
  messageTe: string;
  suggestedActionEn?: string;
  suggestedActionTe?: string;
  severity?: 'advisory' | 'warning' | 'critical';
  validHours?: number;
  notifyFarmers?: boolean;
  userId?: string;
}

export class AlertEngine {
  /**
   * Evaluates the latest 7-day weather forecast against all active meteorological rules.
   * Employs composite deduplication keys (`${village_id}:${rule_code}:${target_date}`)
   * to guarantee alerts are never created or sent redundantly on the same target date.
   */
  async evaluateForecast(villageId: string, forecast: DailyWeatherData[]): Promise<any[]> {
    if (!forecast || forecast.length === 0) return [];

    // 1. Get village metadata
    const villageRes = await db.query(
      `SELECT id, name FROM villages WHERE id = $1`,
      [villageId]
    );
    if (villageRes.rows.length === 0) return [];
    const village = villageRes.rows[0];

    // 2. Fetch active rules
    const rulesRes = await db.query(
      `SELECT * FROM alert_rules WHERE is_active = true`
    );
    const rules = rulesRes.rows;

    // 3. Fetch past observed rainfall for dry spell evaluation
    const pastObservedRes = await db.query(
      `SELECT record_date, precipitation_sum_mm 
       FROM weather_records 
       WHERE village_id = $1 AND is_forecast = false 
       ORDER BY record_date DESC 
       LIMIT 14`,
      [villageId]
    );
    const pastObserved = pastObservedRes.rows;

    const generatedAlerts: any[] = [];

    for (const rule of rules) {
      const config = typeof rule.threshold_config === 'string' 
        ? JSON.parse(rule.threshold_config) 
        : rule.threshold_config;

      let triggeredDay: DailyWeatherData | null = null;
      let alertContent: {
        headlineEn: string;
        headlineTe: string;
        messageEn: string;
        messageTe: string;
        suggestedActionEn: string;
        suggestedActionTe: string;
      } | null = null;

      switch (rule.rule_code) {
        case 'RULE_RAIN_EXPECTED': {
          const lookaheadDays = config.lookahead_days || 2;
          const minProb = config.min_probability || 60;
          const minRain = config.min_rain_mm || 2.5;

          for (let i = 0; i < Math.min(lookaheadDays, forecast.length); i++) {
            const day = forecast[i];
            if (
              (day.precipitationProbabilityMax ?? 0) >= minProb &&
              day.precipitationSumMm >= minRain
            ) {
              triggeredDay = day;
              alertContent = {
                headlineEn: `Rain Expected in ${village.name}: ${day.precipitationSumMm}mm`,
                headlineTe: `${village.name} లో వర్షం సూచన: ${day.precipitationSumMm} మి.మీ`,
                messageEn: `Light to moderate rain is expected on ${day.date} (${day.precipitationProbabilityMax}% probability, ${day.precipitationSumMm}mm). Plan your irrigation accordingly.`,
                messageTe: `${day.date} న వర్షం పడే అవకాశం ఉంది (${day.precipitationProbabilityMax}% సంభావ్యత, ${day.precipitationSumMm} మి.మీ). నీటిపారుదల వాయిదా వేయండి.`,
                suggestedActionEn: 'Postpone irrigation to conserve water and prevent waterlogging.',
                suggestedActionTe: 'నీరు వృధా కాకుండా, పంట ముంపు గురికాకుండా నీటిపారుదల వాయిదా వేయండి.',
              };
              break;
            }
          }
          break;
        }

        case 'RULE_HEAVY_RAIN': {
          const minRain = config.min_rain_mm || 64.5;
          const lookaheadDays = config.lookahead_days || 2;

          for (let i = 0; i < Math.min(lookaheadDays, forecast.length); i++) {
            const day = forecast[i];
            if (day.precipitationSumMm >= minRain) {
              triggeredDay = day;
              alertContent = {
                headlineEn: `Heavy Rainfall Warning for ${village.name}: ${day.precipitationSumMm}mm`,
                headlineTe: `${village.name} కు భారీ వర్ష హెచ్చరిక: ${day.precipitationSumMm} మి.మీ`,
                messageEn: `Warning: Severe precipitation (${day.precipitationSumMm}mm) forecast on ${day.date}. Risk of waterlogging and crop damage.`,
                messageTe: `హెచ్చరిక: ${day.date} న భారీ వర్షం (${day.precipitationSumMm} మి.మీ) కురిసే అవకాశం ఉంది. పంట ముంపు ప్రమాదం ఉంది.`,
                suggestedActionEn: 'Halt all irrigation immediately. Ensure field drainage channels are completely clear.',
                suggestedActionTe: 'నీటిపారుదల వెంటనే నిలిపివేయండి. పొలంలో నీరు నిలవకుండా మురుగు కాల్వలు తెరవండి.',
              };
              break;
            }
          }
          break;
        }

        case 'RULE_THUNDERSTORM': {
          const codes = config.weather_codes || [95, 96, 99];
          const lookaheadDays = config.lookahead_days || 2;

          for (let i = 0; i < Math.min(lookaheadDays, forecast.length); i++) {
            const day = forecast[i];
            if (day.weatherCode != null && codes.includes(day.weatherCode)) {
              triggeredDay = day;
              alertContent = {
                headlineEn: `Thunderstorm Advisory for ${village.name}`,
                headlineTe: `${village.name} కు ఉరుములు మెరుపులతో కూడిన వర్ష సూచన`,
                messageEn: `Thunderstorm activity with strong winds forecast for ${day.date}.`,
                messageTe: `${day.date} న ఉరుములు, మెరుపులు, ఈదురు గాలులతో కూడిన వర్షం పడే అవకాశం ఉంది.`,
                suggestedActionEn: 'Stay clear of power lines and electrical pumps. Postpone foliar pesticide sprays.',
                suggestedActionTe: 'విద్యుత్ మోటార్లు, స్తంభాల వద్ద జాగ్రత్తగా ఉండండి. పిచికారీ పనులు వాయిదా వేయండి.',
              };
              break;
            }
          }
          break;
        }

        case 'RULE_HIGH_TEMP': {
          const tempThreshold = config.temp_max_threshold_c || 40.0;
          const lookaheadDays = config.lookahead_days || 2;

          for (let i = 0; i < Math.min(lookaheadDays, forecast.length); i++) {
            const day = forecast[i];
            if (day.tempMaxC != null && day.tempMaxC >= tempThreshold) {
              triggeredDay = day;
              alertContent = {
                headlineEn: `High Temperature Alert for ${village.name}: ${day.tempMaxC}°C`,
                headlineTe: `${village.name} కు అధిక ఉష్ణోగ్రత హెచ్చరిక: ${day.tempMaxC}°C`,
                messageEn: `Intense heat condition (${day.tempMaxC}°C) predicted on ${day.date}. Evapotranspiration will peak.`,
                messageTe: `${day.date} న అధిక ఎండలు (${day.tempMaxC}°C) నమోదయ్యే అవకాశం ఉంది. తేమ త్వరగా ఆరిపోతుంది.`,
                suggestedActionEn: 'Irrigate only during early morning or evening hours to avoid heavy evaporation losses.',
                suggestedActionTe: 'భాష్పీభవనం తగ్గించడానికి ఉదయం 8 గంటల లోపు లేదా సాయంత్రం 5 గంటల తర్వాత మాత్రమే నీరు పెట్టండి.',
              };
              break;
            }
          }
          break;
        }

        case 'RULE_DRY_SPELL': {
          const lookback = config.dry_days_lookback || 14;
          const maxForecast = config.max_forecast_rain_mm || 2.5;

          // Check if past observed days are dry (< 2.5mm)
          const dryPastDays = pastObserved.filter(
            (p: any) => Number(p.precipitation_sum_mm) < 2.5
          ).length;

          // Forecast 7-day total rain
          const forecastSum = forecast.slice(0, 7).reduce(
            (acc, curr) => acc + curr.precipitationSumMm,
            0
          );

          if (dryPastDays >= lookback && forecastSum < maxForecast) {
            triggeredDay = forecast[0] || { date: new Date().toISOString().split('T')[0] } as any;
            alertContent = {
              headlineEn: `Dry Spell Advisory for ${village.name}`,
              headlineTe: `${village.name} కు దీర్ఘకాలిక వర్షాభావ హెచ్చరిక`,
              messageEn: `Extended dry spell observed (14+ dry days) with little to no rainfall expected in the coming week.`,
              messageTe: `గత 14 రోజులుగా వర్షం లేకపోవడం మరియు రాబోయే వారం కూడా వర్షాలు లేకపోవడం గమనించబడింది.`,
              suggestedActionEn: 'Implement soil mulching and practice deficit / alternate furrow irrigation to preserve rootzone moisture.',
              suggestedActionTe: 'నేలలో తేమను కాపాడేందుకు మల్చింగ్ వాడండి మరియు పొదుపుగా విడతల వారీగా నీటిని అందించండి.',
            };
          }
          break;
        }
      }

      if (triggeredDay && alertContent) {
        const targetDate = triggeredDay.date;
        const dedupKey = `${villageId}:${rule.rule_code}:${targetDate}`;
        const validUntil = new Date(targetDate);
        validUntil.setHours(validUntil.getHours() + (rule.cooldown_hours || 24));

        const insertRes = await db.query(
          `INSERT INTO weather_alerts (
            village_id, rule_id, alert_type, severity, dedup_key, target_date,
            headline_en, headline_te, message_en, message_te,
            suggested_action_en, suggested_action_te, source, valid_until
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'system', $13)
          ON CONFLICT (dedup_key) DO NOTHING
          RETURNING *`,
          [
            villageId,
            rule.id,
            rule.alert_type,
            rule.severity,
            dedupKey,
            targetDate,
            alertContent.headlineEn,
            alertContent.headlineTe,
            alertContent.messageEn,
            alertContent.messageTe,
            alertContent.suggestedActionEn,
            alertContent.suggestedActionTe,
            validUntil,
          ]
        );

        if (insertRes.rows.length > 0) {
          const newAlert = insertRes.rows[0];
          generatedAlerts.push(newAlert);

          // Fan-out notifications to village farmers asynchronously
          try {
            await notificationService.fanOutWeatherAlert(newAlert.id);
          } catch (err: any) {
            console.error(`FanOut notification failed for alert ${newAlert.id}:`, err.message);
          }
        }
      }
    }

    return generatedAlerts;
  }

  /**
   * Agricultural Officer or Admin creates a manual advisory for a village.
   */
  async createManualAdvisory(input: CreateAdvisoryInput): Promise<any> {
    const validUntil = new Date();
    validUntil.setHours(validUntil.getHours() + (input.validHours || 24));
    const targetDate = new Date().toISOString().split('T')[0];
    const dedupKey = `${input.villageId}:manual:${Date.now()}`;

    const insertRes = await db.query(
      `INSERT INTO weather_alerts (
        village_id, alert_type, severity, dedup_key, target_date,
        headline_en, headline_te, message_en, message_te,
        suggested_action_en, suggested_action_te, source, created_by, valid_until
      )
      VALUES ($1, 'custom_advisory', $2, $3, $4, $5, $6, $7, $8, $9, $10, 'manual', $11, $12)
      RETURNING *`,
      [
        input.villageId,
        input.severity || 'advisory',
        dedupKey,
        targetDate,
        input.headlineEn,
        input.headlineTe,
        input.messageEn,
        input.messageTe,
        input.suggestedActionEn || null,
        input.suggestedActionTe || null,
        input.userId || null,
        validUntil,
      ]
    );

    const alert = insertRes.rows[0];

    if (input.notifyFarmers !== false) {
      try {
        await notificationService.fanOutWeatherAlert(alert.id);
      } catch (err: any) {
        console.error(`Manual advisory fan-out error:`, err.message);
      }
    }

    return alert;
  }

  /**
   * Retrieves alerts with optional village filter.
   */
  async listAlerts(params: { villageId?: string; isActive?: boolean; limit?: number }) {
    const conditions: string[] = [];
    const values: any[] = [];

    if (params.villageId) {
      values.push(params.villageId);
      conditions.push(`a.village_id = $${values.length}`);
    }
    if (params.isActive !== undefined) {
      values.push(params.isActive);
      conditions.push(`a.is_active = $${values.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = Math.min(params.limit || 50, 100);
    values.push(limit);

    const query = `
      SELECT a.*, v.name as village_name, u.email as created_by_email
      FROM weather_alerts a
      JOIN villages v ON v.id = a.village_id
      LEFT JOIN users u ON u.id = a.created_by
      ${whereClause}
      ORDER BY a.created_at DESC
      LIMIT $${values.length}
    `;

    const res = await db.query(query, values);
    return res.rows;
  }
}

export const alertEngine = new AlertEngine();
