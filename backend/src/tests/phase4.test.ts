import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { db, closeDatabase } from '../db/index.js';
import { runMigrations } from '../scripts/migrate.js';
import { seedReferenceData } from '../scripts/seed-reference.js';
import { createAdminUser } from '../scripts/create-admin.js';
import { MockWeatherAdapter } from '../modules/weather/adapters/MockWeatherAdapter.js';
import { OpenMeteoAdapter } from '../modules/weather/adapters/OpenMeteoAdapter.js';
import { WeatherService } from '../modules/weather/service.js';
import { AlertEngine } from '../modules/weather/AlertEngine.js';
import { NotificationService } from '../modules/communication/NotificationService.js';
import { MockSmsAdapter } from '../modules/communication/adapters/MockSmsAdapter.js';
import { DailyWeatherData } from '../modules/weather/types.js';

describe('Phase 4: Weather, Alerts & Communication Engine Tests', () => {
  let app: any;
  let adminCookie: string;
  let csrfToken: string;
  let villageId: string;
  let farmerId: string;
  let farmerPhone: string = '+919876543210';

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.ADMIN_BOOTSTRAP_PASSWORD = 'ChangeMeAdmin123!';
    process.env.COMMUNICATIONS_ENABLED = 'true';
    delete process.env.DRY_RUN;

    await runMigrations();
    await seedReferenceData();
    await createAdminUser();

    app = createApp();

    // 1. Authenticate Admin with X-Requested-With header
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ email: 'admin@csp-irrigation.org', password: 'ChangeMeAdmin123!' });

    expect(loginRes.status).toBe(200);
    const cookies = loginRes.headers['set-cookie'];
    adminCookie = Array.isArray(cookies) ? cookies.join('; ') : cookies;

    // Change password to clear must_change_password flag
    await request(app)
      .post('/api/v1/auth/change-password')
      .set('Cookie', adminCookie)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({
        currentPassword: 'ChangeMeAdmin123!',
        newPassword: 'NewAdminPassword456!',
      });

    const meRes = await request(app)
      .get('/api/v1/auth/me')
      .set('Cookie', adminCookie);

    expect(meRes.status).toBe(200);
    csrfToken = meRes.body.csrfToken;

    // 2. Retrieve seeded village (Guntur Rural)
    const villageRes = await db.query(`SELECT id FROM villages WHERE name = 'Guntur Rural' LIMIT 1`);
    expect(villageRes.rows.length).toBeGreaterThan(0);
    villageId = villageRes.rows[0].id;

    // 3. Create test farmer for communication testing
    const insertFarmer = await db.query(
      `INSERT INTO farmers (farmer_code, full_name, village_id, preferred_language, status)
       VALUES ('F-TEST-P4', 'Subba Rao', $1, 'te', 'active')
       RETURNING id`,
      [villageId]
    );
    farmerId = insertFarmer.rows[0].id;

    await db.query(
      `INSERT INTO farmer_contacts (farmer_id, phone_e164, type, is_active)
       VALUES ($1, $2, 'primary', true)`,
      [farmerId, farmerPhone]
    );
  });

  afterAll(async () => {
    await closeDatabase();
  });

  describe('1. Meteorological Adapters', () => {
    it('MockWeatherAdapter generates deterministic 7-day forecast with required fields and demo tags', async () => {
      const mockAdapter = new MockWeatherAdapter();
      const forecast = await mockAdapter.getForecast(16.3067, 80.4365, 7);

      expect(forecast).toHaveLength(7);
      expect(forecast[0].isDemo).toBe(true);
      expect(forecast[0].source).toBe('mock');
      expect(forecast[0].tempMaxC).toBeGreaterThan(25);
      expect(forecast[0].precipitationSumMm).toBeGreaterThanOrEqual(0);
      expect(forecast[0].et0FaoEvapotranspiration).toBeGreaterThan(0);

      const observed = await mockAdapter.getObserved(16.3067, 80.4365, '2026-09-15', '2026-09-20');
      expect(observed.length).toBe(6);
      expect(observed[0].isForecast).toBe(false);
      expect(observed[0].source).toBe('mock');
    });

    it('OpenMeteoAdapter connects or falls back gracefully with valid structure', async () => {
      const openMeteo = new OpenMeteoAdapter();
      try {
        const forecast = await openMeteo.getForecast(16.3067, 80.4365, 3);
        expect(forecast.length).toBe(3);
        expect(forecast[0].source).toBe('openmeteo');
        expect(forecast[0].isDemo).toBe(false);
      } catch (err: any) {
        // If test environment is offline, error should be a recognized network/timeout error
        expect(err.message).toMatch(/(WEATHER_TIMEOUT|WEATHER_FETCH_FAILED|fetch failed)/);
      }
    });
  });

  describe('2. Weather Service & In-Database Caching', () => {
    it('fetches village weather, stores records, and serves subsequent calls from cache', async () => {
      const mockAdapter = new MockWeatherAdapter();
      const service = new WeatherService(mockAdapter);

      // First call: populates cache
      const freshResult = await service.getVillageWeather(villageId, true);
      expect(freshResult.villageId).toBe(villageId);
      expect(freshResult.forecast.length).toBe(7);
      expect(freshResult.observed.length).toBe(7);

      // Verify records in database
      const dbCheck = await db.query(
        `SELECT COUNT(*)::int as count FROM weather_records WHERE village_id = $1`,
        [villageId]
      );
      expect(dbCheck.rows[0].count).toBeGreaterThanOrEqual(14);

      // Second call: serves from cache
      const cachedResult = await service.getVillageWeather(villageId, false);
      expect(cachedResult.villageId).toBe(villageId);
      expect(cachedResult.forecast.length).toBeGreaterThanOrEqual(3);
    });

    it('API: GET /api/v1/weather/villages/:villageId returns weather data', async () => {
      const res = await request(app)
        .get(`/api/v1/weather/villages/${villageId}`)
        .set('Cookie', adminCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.villageId).toBe(villageId);
      expect(res.body.data.forecast).toBeInstanceOf(Array);
    });
  });

  describe('3. Meteorological Alert Rules & Composite Deduplication', () => {
    it('evaluates forecast and triggers alerts with bilingual headlines for IMD thresholds', async () => {
      const engine = new AlertEngine();
      const mockForecast: DailyWeatherData[] = [
        {
          date: '2026-10-01',
          tempMaxC: 34.0,
          tempMinC: 24.0,
          precipitationSumMm: 15.0,
          precipitationProbabilityMax: 80,
          weatherCode: 61,
          et0FaoEvapotranspiration: 4.8,
          isForecast: true,
          isDemo: true,
          source: 'mock',
        },
        {
          date: '2026-10-02',
          tempMaxC: 41.5, // High temp trigger
          tempMinC: 26.0,
          precipitationSumMm: 70.0, // Heavy rain trigger
          precipitationProbabilityMax: 90,
          weatherCode: 95, // Thunderstorm trigger
          et0FaoEvapotranspiration: 5.5,
          isForecast: true,
          isDemo: true,
          source: 'mock',
        },
      ];

      const alerts = await engine.evaluateForecast(villageId, mockForecast);
      expect(alerts.length).toBeGreaterThan(0);

      // Check Rain Expected or Heavy Rain alert
      const rainAlert = alerts.find(a => a.alert_type === 'rain_expected');
      expect(rainAlert).toBeDefined();
      expect(rainAlert.headline_en).toContain('Rain Expected');
      expect(rainAlert.headline_te).toContain('వర్షం సూచన');
      expect(rainAlert.dedup_key).toBe(`${villageId}:RULE_RAIN_EXPECTED:2026-10-01`);
    });

    it('enforces composite deduplication: evaluating same forecast a second time does not duplicate alerts', async () => {
      const engine = new AlertEngine();
      const duplicateForecast: DailyWeatherData[] = [
        {
          date: '2026-10-01',
          tempMaxC: 34.0,
          tempMinC: 24.0,
          precipitationSumMm: 15.0,
          precipitationProbabilityMax: 80,
          weatherCode: 61,
          et0FaoEvapotranspiration: 4.8,
          isForecast: true,
          isDemo: true,
          source: 'mock',
        },
      ];

      // Re-evaluating the exact same date and rule
      const alerts = await engine.evaluateForecast(villageId, duplicateForecast);
      // Because ON CONFLICT (dedup_key) DO NOTHING, no new rows are returned
      expect(alerts).toHaveLength(0);

      const countRes = await db.query(
        `SELECT COUNT(*)::int as count FROM weather_alerts 
         WHERE dedup_key = $1`,
        [`${villageId}:RULE_RAIN_EXPECTED:2026-10-01`]
      );
      expect(countRes.rows[0].count).toBe(1);
    });
  });

  describe('4. Notification Service Guardrails', () => {
    it('blocks outbound SMS when farmer has withdrawn consent for SMS channel', async () => {
      const notificationService = new NotificationService(new MockSmsAdapter());

      // Insert withdrawn consent for SMS
      await db.query(
        `INSERT INTO consents (farmer_id, channel, status, method, note)
         VALUES ($1, 'sms', 'withdrawn', 'sms_reply', 'Farmer replied STOP')`,
        [farmerId]
      );

      const result = await notificationService.sendSms({
        farmerId,
        phone: farmerPhone,
        message: 'Test message',
        purpose: 'weather_alert',
        bypassQuietHours: true,
      });

      expect(result.status).toBe('blocked');
      expect(result.errorReason).toBe('NO_CONSENT');

      // Verify audit log
      const log = await db.query(
        `SELECT * FROM communication_logs WHERE id = $1`,
        [result.id]
      );
      expect(log.rows[0].status).toBe('blocked');
      expect(log.rows[0].error_reason).toBe('NO_CONSENT');

      // Re-grant consent for subsequent tests
      await db.query(
        `INSERT INTO consents (farmer_id, channel, status, method, note)
         VALUES ($1, 'sms', 'granted', 'written', 'Farmer re-enrolled')`,
        [farmerId]
      );
    });

    it('blocks outbound SMS outside quiet hours (07:00 to 21:00 IST) when not bypassed', async () => {
      const notificationService = new NotificationService(new MockSmsAdapter());

      // Force quiet hours check without bypass
      const result = await notificationService.sendSms({
        farmerId,
        phone: farmerPhone,
        message: 'Late night notice',
        purpose: 'system_notice',
        bypassQuietHours: false, // Enforce current clock
      });

      const now = new Date();
      const istHours = (now.getUTCHours() + 5 + Math.floor((now.getUTCMinutes() + 30) / 60)) % 24;
      const isOutsideQuiet = istHours < 7 || istHours >= 21;

      if (isOutsideQuiet) {
        expect(result.status).toBe('blocked');
        expect(result.errorReason).toBe('QUIET_HOURS');
      } else {
        expect(result.status).toBe('sent');
      }
    });

    it('enforces daily cap of maximum 2 SMS per farmer per calendar day', async () => {
      // Create a fresh farmer for clean daily cap testing
      const testFarmer = await db.query(
        `INSERT INTO farmers (farmer_code, full_name, village_id, preferred_language, status)
         VALUES ('F-CAP-001', 'Cap Test Farmer', $1, 'en', 'active')
         RETURNING id`,
        [villageId]
      );
      const capFarmerId = testFarmer.rows[0].id;
      const capPhone = '+919999900001';

      await db.query(
        `INSERT INTO farmer_contacts (farmer_id, phone_e164, type, is_active)
         VALUES ($1, $2, 'primary', true)`,
        [capFarmerId, capPhone]
      );

      const notificationService = new NotificationService(new MockSmsAdapter());

      // Attempt 1: Should succeed
      const res1 = await notificationService.sendSms({
        farmerId: capFarmerId,
        phone: capPhone,
        message: 'Message 1',
        purpose: 'weather_alert',
        bypassQuietHours: true,
      });
      expect(res1.status).toBe('sent');

      // Attempt 2: Should succeed
      const res2 = await notificationService.sendSms({
        farmerId: capFarmerId,
        phone: capPhone,
        message: 'Message 2',
        purpose: 'weather_alert',
        bypassQuietHours: true,
      });
      expect(res2.status).toBe('sent');

      // Attempt 3: Should be blocked by daily cap (max 2/day)
      const res3 = await notificationService.sendSms({
        farmerId: capFarmerId,
        phone: capPhone,
        message: 'Message 3',
        purpose: 'weather_alert',
        bypassQuietHours: true,
      });
      expect(res3.status).toBe('blocked');
      expect(res3.errorReason).toBe('DAILY_CAP_EXCEEDED');
    });

    it('blocks outbound SMS when global COMMUNICATIONS_ENABLED kill switch is false', async () => {
      process.env.COMMUNICATIONS_ENABLED = 'false';

      const notificationService = new NotificationService(new MockSmsAdapter());
      const result = await notificationService.sendSms({
        farmerId,
        phone: farmerPhone,
        message: 'Emergency check',
        purpose: 'system_notice',
        bypassQuietHours: true,
      });

      expect(result.status).toBe('blocked');
      expect(result.errorReason).toBe('KILL_SWITCH_ACTIVE');

      // Reset kill switch
      process.env.COMMUNICATIONS_ENABLED = 'true';
    });

    it('supports DRY_RUN mode without calling external provider', async () => {
      process.env.DRY_RUN = 'true';

      const testFarmer = await db.query(
        `INSERT INTO farmers (farmer_code, full_name, village_id, preferred_language, status)
         VALUES ('F-DRY-001', 'Dry Run Farmer', $1, 'en', 'active')
         RETURNING id`,
        [villageId]
      );
      const dryFarmerId = testFarmer.rows[0].id;
      const dryPhone = '+919999900002';

      await db.query(
        `INSERT INTO farmer_contacts (farmer_id, phone_e164, type, is_active)
         VALUES ($1, $2, 'primary', true)`,
        [dryFarmerId, dryPhone]
      );

      const notificationService = new NotificationService(new MockSmsAdapter());
      const result = await notificationService.sendSms({
        farmerId: dryFarmerId,
        phone: dryPhone,
        message: 'Dry run test',
        purpose: 'system_notice',
        bypassQuietHours: true,
      });

      expect(result.status).toBe('sent');
      expect(result.isSimulated).toBe(true);
      expect(result.providerMessageId).toContain('dry_run_');

      delete process.env.DRY_RUN;
    });
  });

  describe('5. Manual Agricultural Advisory & Communication Audit Trail', () => {
    let createdAlertId: string;

    it('POST /api/v1/weather/alerts/manual allows Agri Officer/Admin to publish custom bilingual advisory', async () => {
      const res = await request(app)
        .post('/api/v1/weather/alerts/manual')
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          villageId,
          headlineEn: 'Canal Water Release Notice',
          headlineTe: 'కాలువ నీటి విడుదల సమాచారం',
          messageEn: 'Canal rotation water will be released tomorrow morning for 48 hours.',
          messageTe: 'రేపు ఉదయం నుండి 48 గంటల పాటు కాలువ నీరు విడుదల చేయబడుతుంది.',
          suggestedActionEn: 'Prepare field channels and irrigate tail-end plots first.',
          suggestedActionTe: 'ముందుగా చివరి ఆయకట్టు పొలాలకు నీరు అందేలా చూసుకోండి.',
          severity: 'advisory',
          validHours: 48,
          notifyFarmers: true,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.alert_type).toBe('custom_advisory');
      expect(res.body.data.source).toBe('manual');
      createdAlertId = res.body.data.id;
    });

    it('GET /api/v1/weather/alerts retrieves list of active alerts with village metadata', async () => {
      const res = await request(app)
        .get(`/api/v1/weather/alerts?villageId=${villageId}`)
        .set('Cookie', adminCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.data[0].village_name).toBe('Guntur Rural');
    });

    it('GET /api/v1/communication/logs retrieves paginated audit trail of all outbound messages', async () => {
      const res = await request(app)
        .get('/api/v1/communication/logs?limit=10')
        .set('Cookie', adminCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.logs).toBeInstanceOf(Array);
      expect(res.body.data.total).toBeGreaterThan(0);

      // Check log schema attributes
      const log = res.body.data.logs[0];
      expect(log).toHaveProperty('recipient_phone');
      expect(log).toHaveProperty('channel');
      expect(log).toHaveProperty('purpose');
      expect(log).toHaveProperty('status');
      expect(log).toHaveProperty('created_at');
    });

    it('rejects manual advisory creation from unauthenticated requests with 401', async () => {
      const res = await request(app)
        .post('/api/v1/weather/alerts/manual')
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          villageId,
          headlineEn: 'Unauthorized',
          headlineTe: 'అనధికారిక',
          messageEn: 'Test',
          messageTe: 'టెస్ట్',
        });

      expect(res.status).toBe(401);
    });
  });
});
