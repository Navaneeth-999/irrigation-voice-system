import { db } from '../../db/index.js';
import { ISmsAdapter } from './adapters/ISmsAdapter.js';
import { MockSmsAdapter } from './adapters/MockSmsAdapter.js';
import { TwilioSmsAdapter } from './adapters/TwilioSmsAdapter.js';
import { SmsNotificationRequest, NotificationResult, FanOutSummary } from './types.js';

export class NotificationService {
  private smsAdapter: ISmsAdapter;

  constructor(customAdapter?: ISmsAdapter) {
    if (customAdapter) {
      this.smsAdapter = customAdapter;
    } else {
      const provider = process.env.SMS_PROVIDER || 'mock';
      if (provider === 'twilio' && process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
        this.smsAdapter = new TwilioSmsAdapter();
      } else {
        this.smsAdapter = new MockSmsAdapter();
      }
    }
  }

  getProviderName(): 'mock_sms' | 'twilio_sms' {
    return this.smsAdapter.providerName;
  }

  /**
   * Renders a message template by substituting variable tokens.
   */
  async renderTemplate(
    templateCode: string,
    variables: Record<string, string>,
    preferredLanguage: string = 'te'
  ): Promise<{ text: string; templateId?: string }> {
    const res = await db.query(
      `SELECT id, content_english, content_telugu FROM message_templates WHERE template_code = $1 AND is_active = true`,
      [templateCode]
    );

    if (res.rows.length === 0) {
      // Fallback default message
      return {
        text: `Notice: ${variables.headline_en || ''}. ${variables.action_en || ''}`,
      };
    }

    const row = res.rows[0];
    let templateText = preferredLanguage === 'te' && row.content_telugu ? row.content_telugu : row.content_english;

    for (const [key, val] of Object.entries(variables)) {
      templateText = templateText.replaceAll(`{${key}}`, val);
    }

    return {
      text: templateText,
      templateId: row.id,
    };
  }

  /**
   * Dispatches a single outbound SMS with full guardrail evaluation (Kill switch, quiet hours, consent, daily cap).
   */
  async sendSms(req: SmsNotificationRequest): Promise<NotificationResult> {
    const isSimulated = this.smsAdapter.providerName === 'mock_sms';

    // 1. Kill Switch Enforcement (COMMUNICATIONS_ENABLED)
    const commsEnabled = process.env.COMMUNICATIONS_ENABLED !== 'false';
    if (!commsEnabled) {
      const logRes = await db.query(
        `INSERT INTO communication_logs (farmer_id, channel, purpose, recipient_phone, message_body, template_id, related_alert_id, provider, status, error_reason, is_simulated, triggered_by)
         VALUES ($1, 'sms', $2, $3, $4, $5, $6, $7, 'blocked', 'KILL_SWITCH_ACTIVE', $8, $9)
         RETURNING id, status, error_reason`,
        [req.farmerId, req.purpose, req.phone, req.message, req.templateId || null, req.relatedAlertId || null, this.getProviderName(), isSimulated, req.triggeredBy || null]
      );
      return {
        id: logRes.rows[0].id,
        status: 'blocked',
        errorReason: 'KILL_SWITCH_ACTIVE',
        isSimulated,
      };
    }

    // 2. Quiet Hours Enforcement (07:00 to 21:00 IST for SMS)
    const bypassQuiet = req.bypassQuietHours ?? (process.env.NODE_ENV === 'test');
    if (!bypassQuiet) {
      const now = new Date();
      // IST is UTC + 5:30
      const istHours = (now.getUTCHours() + 5 + Math.floor((now.getUTCMinutes() + 30) / 60)) % 24;
      if (istHours < 7 || istHours >= 21) {
        const logRes = await db.query(
          `INSERT INTO communication_logs (farmer_id, channel, purpose, recipient_phone, message_body, template_id, related_alert_id, provider, status, error_reason, is_simulated, triggered_by)
           VALUES ($1, 'sms', $2, $3, $4, $5, $6, $7, 'blocked', 'QUIET_HOURS', $8, $9)
           RETURNING id, status, error_reason`,
          [req.farmerId, req.purpose, req.phone, req.message, req.templateId || null, req.relatedAlertId || null, this.getProviderName(), isSimulated, req.triggeredBy || null]
        );
        return {
          id: logRes.rows[0].id,
          status: 'blocked',
          errorReason: 'QUIET_HOURS',
          isSimulated,
        };
      }
    }

    // 3. Consent Check (Farmer must not have withdrawn SMS consent)
    const consentRes = await db.query(
      `SELECT status FROM consents
       WHERE farmer_id = $1 AND channel = 'sms'
       ORDER BY recorded_at DESC, created_at DESC
       LIMIT 1`,
      [req.farmerId]
    );

    if (consentRes.rows.length > 0 && consentRes.rows[0].status === 'withdrawn') {
      const logRes = await db.query(
        `INSERT INTO communication_logs (farmer_id, channel, purpose, recipient_phone, message_body, template_id, related_alert_id, provider, status, error_reason, is_simulated, triggered_by)
         VALUES ($1, 'sms', $2, $3, $4, $5, $6, $7, 'blocked', 'NO_CONSENT', $8, $9)
         RETURNING id, status, error_reason`,
        [req.farmerId, req.purpose, req.phone, req.message, req.templateId || null, req.relatedAlertId || null, this.getProviderName(), isSimulated, req.triggeredBy || null]
      );
      return {
        id: logRes.rows[0].id,
        status: 'blocked',
        errorReason: 'NO_CONSENT',
        isSimulated,
      };
    }

    // 4. Daily SMS Cap Check (Max 2 SMS per farmer per day)
    const capRes = await db.query(
      `SELECT COUNT(*)::int as count FROM communication_logs
       WHERE farmer_id = $1
         AND channel = 'sms'
         AND status IN ('sent', 'delivered', 'queued')
         AND created_at >= CURRENT_DATE`,
      [req.farmerId]
    );

    if (capRes.rows[0].count >= 2) {
      const logRes = await db.query(
        `INSERT INTO communication_logs (farmer_id, channel, purpose, recipient_phone, message_body, template_id, related_alert_id, provider, status, error_reason, is_simulated, triggered_by)
         VALUES ($1, 'sms', $2, $3, $4, $5, $6, $7, 'blocked', 'DAILY_CAP_EXCEEDED', $8, $9)
         RETURNING id, status, error_reason`,
        [req.farmerId, req.purpose, req.phone, req.message, req.templateId || null, req.relatedAlertId || null, this.getProviderName(), isSimulated, req.triggeredBy || null]
      );
      return {
        id: logRes.rows[0].id,
        status: 'blocked',
        errorReason: 'DAILY_CAP_EXCEEDED',
        isSimulated,
      };
    }

    // 5. Dry Run Mode
    if (process.env.DRY_RUN === 'true') {
      const simId = `dry_run_${Date.now()}`;
      const logRes = await db.query(
        `INSERT INTO communication_logs (farmer_id, channel, purpose, recipient_phone, message_body, template_id, related_alert_id, provider, provider_message_id, status, is_simulated, triggered_by, delivered_at)
         VALUES ($1, 'sms', $2, $3, $4, $5, $6, $7, $8, 'sent', true, $9, CURRENT_TIMESTAMP)
         RETURNING id, status, provider_message_id`,
        [req.farmerId, req.purpose, req.phone, req.message, req.templateId || null, req.relatedAlertId || null, this.getProviderName(), simId, req.triggeredBy || null]
      );
      return {
        id: logRes.rows[0].id,
        status: 'sent',
        providerMessageId: simId,
        isSimulated: true,
      };
    }

    // 6. Real / Mock Transmission via Adapter
    const dispatch = await this.smsAdapter.sendSms(req.phone, req.message);
    const status = dispatch.success ? 'sent' : 'failed';
    const errorReason = dispatch.error || null;
    const deliveredAt = dispatch.success ? new Date() : null;

    const logRes = await db.query(
      `INSERT INTO communication_logs (farmer_id, channel, purpose, recipient_phone, message_body, template_id, related_alert_id, provider, provider_message_id, status, error_reason, is_simulated, triggered_by, delivered_at)
       VALUES ($1, 'sms', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING id, status, provider_message_id, error_reason`,
      [req.farmerId, req.purpose, req.phone, req.message, req.templateId || null, req.relatedAlertId || null, this.getProviderName(), dispatch.messageId || null, status, errorReason, isSimulated, req.triggeredBy || null, deliveredAt]
    );

    return {
      id: logRes.rows[0].id,
      status,
      errorReason: errorReason || undefined,
      providerMessageId: dispatch.messageId,
      isSimulated,
    };
  }

  /**
   * Fan-out an alert to all registered farmers in the affected village.
   */
  async fanOutWeatherAlert(alertId: string, bypassQuietHours?: boolean): Promise<FanOutSummary> {
    const alertRes = await db.query(
      `SELECT a.*, v.name as village_name
       FROM weather_alerts a
       JOIN villages v ON v.id = a.village_id
       WHERE a.id = $1`,
      [alertId]
    );

    if (alertRes.rows.length === 0) {
      throw new Error(`Weather alert with ID ${alertId} not found`);
    }

    const alert = alertRes.rows[0];

    // Find all farmers in this village with active primary contact
    const farmersRes = await db.query(
      `SELECT DISTINCT f.id, fc.phone_e164 as phone, f.preferred_language, f.full_name
       FROM farmers f
       JOIN farmer_contacts fc ON fc.farmer_id = f.id AND fc.type = 'primary' AND fc.is_active = true
       WHERE f.village_id = $1 AND f.status = 'active'`,
      [alert.village_id]
    );

    const farmers = farmersRes.rows;
    let sentCount = 0;
    let blockedCount = 0;
    let failedCount = 0;

    for (const farmer of farmers) {
      const templateCode = alert.source === 'manual' ? 'SMS_MANUAL_ADVISORY' : 'SMS_WEATHER_ALERT';
      const rendered = await this.renderTemplate(
        templateCode,
        {
          village_name: alert.village_name,
          farmer_name: farmer.full_name,
          headline_en: alert.headline_en,
          headline_te: alert.headline_te,
          action_en: alert.suggested_action_en || alert.message_en,
          action_te: alert.suggested_action_te || alert.message_te,
          message_en: alert.message_en,
          message_te: alert.message_te,
        },
        farmer.preferred_language || 'te'
      );

      const result = await this.sendSms({
        farmerId: farmer.id,
        phone: farmer.phone,
        message: rendered.text,
        purpose: alert.source === 'manual' ? 'manual_advisory' : 'weather_alert',
        templateId: rendered.templateId,
        templateCode,
        relatedAlertId: alert.id,
        bypassQuietHours,
      });

      if (result.status === 'sent' || result.status === 'delivered') {
        sentCount++;
      } else if (result.status === 'blocked') {
        blockedCount++;
      } else {
        failedCount++;
      }
    }

    return {
      alertId,
      villageId: alert.village_id,
      eligibleFarmers: farmers.length,
      sentCount,
      blockedCount,
      failedCount,
    };
  }

  /**
   * List communication logs with filters.
   */
  async listLogs(params: {
    farmerId?: string;
    channel?: string;
    status?: string;
    purpose?: string;
    limit?: number;
    offset?: number;
  }) {
    const limit = Math.min(params.limit || 50, 100);
    const offset = params.offset || 0;
    const conditions: string[] = [];
    const values: any[] = [];

    if (params.farmerId) {
      values.push(params.farmerId);
      conditions.push(`cl.farmer_id = $${values.length}`);
    }
    if (params.channel) {
      values.push(params.channel);
      conditions.push(`cl.channel = $${values.length}`);
    }
    if (params.status) {
      values.push(params.status);
      conditions.push(`cl.status = $${values.length}`);
    }
    if (params.purpose) {
      values.push(params.purpose);
      conditions.push(`cl.purpose = $${values.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRes = await db.query(
      `SELECT COUNT(*)::int as total FROM communication_logs cl ${whereClause}`,
      values
    );

    const query = `
      SELECT cl.*, f.full_name as farmer_name, fc.phone_e164 as farmer_phone, v.name as village_name
      FROM communication_logs cl
      JOIN farmers f ON f.id = cl.farmer_id
      LEFT JOIN farmer_contacts fc ON fc.farmer_id = f.id AND fc.type = 'primary'
      LEFT JOIN villages v ON v.id = f.village_id
      ${whereClause}
      ORDER BY cl.created_at DESC
      LIMIT $${values.length + 1} OFFSET $${values.length + 2}
    `;

    values.push(limit, offset);
    const logsRes = await db.query(query, values);

    return {
      total: countRes.rows[0].total,
      limit,
      offset,
      logs: logsRes.rows,
    };
  }
}

export const notificationService = new NotificationService();
