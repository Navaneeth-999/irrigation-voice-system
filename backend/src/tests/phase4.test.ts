import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
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
  let panchayatCookie: string;
  let csrfToken: string;
  let villageId: string;
  let villageName: string;
  let otherVillageId: string;
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

    // 2. Retrieve seeded villages (Guntur Rural and Tenali North)
    const villageRes = await db.query(`SELECT id, name FROM villages ORDER BY name ASC LIMIT 2`);
    expect(villageRes.rows.length).toBeGreaterThanOrEqual(2);
    villageId = villageRes.rows[0].id;
    villageName = villageRes.rows[0].name;
    otherVillageId = villageRes.rows[1].id;

    // 3. Create AGRI_PANCHAYAT user scoped strictly to villageId
    const passwordHash = await bcrypt.hash('PanchayatPass123!', 10);
    const panchayatUser = await db.query(
      `INSERT INTO users (name, email, password_hash, role, is_active, must_change_password)
       VALUES ('Panchayat Officer', 'panchayat.officer@csp.gov.in', $1, 'AGRI_PANCHAYAT', true, false)
       RETURNING id`,
      [passwordHash]
    );
    const officerId = panchayatUser.rows[0].id;

    await db.query(
      `INSERT INTO user_scopes (user_id, scope_type, scope_value)
       VALUES ($1, 'village', $2)`,
      [officerId, villageId]
    );

    const officerLogin = await request(app)
      .post('/api/v1/auth/login')
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ email: 'panchayat.officer@csp.gov.in', password: 'PanchayatPass123!' });

    panchayatCookie = Array.isArray(officerLogin.headers['set-cookie'])
      ? officerLogin.headers['set-cookie'].join('; ')
      : officerLogin.headers['set-cookie'];

    // 4. Create test farmer with active season, contact, and explicit granted consent
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

    const plotRes = await db.query(
      `INSERT INTO plots (farmer_id, label, area_acres, is_active)
       VALUES ($1, 'P4 Main Field', 2.5, true)
       RETURNING id`,
      [farmerId]
    );
    const plotId = plotRes.rows[0].id;

    const cropRes = await db.query(`SELECT id FROM crops LIMIT 1`);
    const methodRes = await db.query(`SELECT id FROM irrigation_method_types LIMIT 1`);

    await db.query(
      `INSERT INTO seasons (
        season_code, farmer_id, plot_id, crop_id, irrigation_method_type_id,
        season_type, season_year, sowing_date, expected_harvest_date, area_acres_snapshot, status, data_origin
      )
      VALUES ('S-2026-P4-001', $1, $2, $3, $4, 'kharif', 2026, '2026-06-01', '2026-10-31', 2.5, 'active', 'real')`,
      [farmerId, plotId, cropRes.rows[0].id, methodRes.rows[0].id]
    );

    // Initial explicit opt-in consent for both SMS and Voice
    await db.query(
      `INSERT INTO consents (farmer_id, channel, status, method, note)
       VALUES ($1, 'sms', 'granted', 'written', 'Initial enrollment'),
              ($1, 'voice', 'granted', 'written', 'Initial enrollment')`,
      [farmerId]
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
        expect(err.message).toMatch(/(WEATHER_TIMEOUT|WEATHER_FETCH_FAILED|fetch failed)/);
      }
    });
  });

  describe('2. Weather Service & In-Database Caching', () => {
    it('fetches village weather, stores records, and serves subsequent calls from cache', async () => {
      const mockAdapter = new MockWeatherAdapter();
      const service = new WeatherService(mockAdapter);

      const freshResult = await service.getVillageWeather(villageId, true);
      expect(freshResult.villageId).toBe(villageId);
      expect(freshResult.forecast.length).toBe(7);
      expect(freshResult.observed.length).toBe(7);

      const dbCheck = await db.query(
        `SELECT COUNT(*)::int as count FROM weather_records WHERE village_id = $1`,
        [villageId]
      );
      expect(dbCheck.rows[0].count).toBeGreaterThanOrEqual(14);

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

  describe('3. Meteorological Alert Rules & Possibility Wording', () => {
    it('evaluates forecast and triggers alerts with possibility wording and bilingual headlines', async () => {
      const engine = new AlertEngine();
      const mockForecast: DailyWeatherData[] = [
        {
          date: '2026-10-01',
          tempMaxC: 34.0,
          tempMinC: 24.0,
          precipitationSumMm: 70.0,
          precipitationProbabilityMax: 80,
          weatherCode: 61,
          et0FaoEvapotranspiration: 4.8,
          isForecast: true,
          isDemo: true,
          source: 'mock',
        },
        {
          date: '2026-10-02',
          tempMaxC: 41.5,
          tempMinC: 26.0,
          precipitationSumMm: 70.0,
          precipitationProbabilityMax: 90,
          weatherCode: 95,
          et0FaoEvapotranspiration: 5.5,
          isForecast: true,
          isDemo: true,
          source: 'mock',
        },
      ];

      const alerts = await engine.evaluateForecast(villageId, mockForecast);
      expect(alerts.length).toBeGreaterThan(0);

      // Check Rain Expected alert uses possibility wording
      const rainAlert = alerts.find(a => a.alert_type === 'rain_expected');
      expect(rainAlert).toBeDefined();
      expect(rainAlert.headline_en).toContain('Rain Expected');
      expect(rainAlert.headline_te).toContain('వర్షం సూచన');
      expect(rainAlert.message_en).toContain('expected');
      expect(rainAlert.message_te).toContain('అవకాశం');

      // Check Heavy Rain alert uses possibility wording
      const heavyAlert = alerts.find(a => a.alert_type === 'heavy_rain');
      expect(heavyAlert).toBeDefined();
      expect(heavyAlert.message_en).toContain('possible');
      expect(heavyAlert.message_te).toContain('అవకాశం');
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

      const alerts = await engine.evaluateForecast(villageId, duplicateForecast);
      expect(alerts).toHaveLength(0);

      const countRes = await db.query(
        `SELECT COUNT(*)::int as count FROM weather_alerts 
         WHERE dedup_key = $1`,
        [`${villageId}:RULE_RAIN_EXPECTED:2026-10-01`]
      );
      expect(countRes.rows[0].count).toBe(1);
    });
  });

  describe('4. Notification Service Guardrails & Voice Alerts', () => {
    it('blocks outbound SMS when farmer has NO consent record (opt-in requirement)', async () => {
      // Create farmer with NO consent records
      const noConsentFarmer = await db.query(
        `INSERT INTO farmers (farmer_code, full_name, village_id, preferred_language, status)
         VALUES ('F-NOCONSENT', 'No Consent Farmer', $1, 'te', 'active')
         RETURNING id`,
        [villageId]
      );
      const noConsentId = noConsentFarmer.rows[0].id;

      const notificationService = new NotificationService(new MockSmsAdapter());
      const result = await notificationService.sendSms({
        farmerId: noConsentId,
        phone: '+919999900099',
        message: 'Opt-in check message',
        purpose: 'weather_alert',
        bypassQuietHours: true,
      });

      expect(result.status).toBe('blocked');
      expect(result.errorReason).toBe('NO_CONSENT');
    });

    it('blocks outbound SMS when farmer has withdrawn consent for SMS channel', async () => {
      const notificationService = new NotificationService(new MockSmsAdapter());

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

      // Re-grant consent for subsequent tests
      await db.query(
        `INSERT INTO consents (farmer_id, channel, status, method, note)
         VALUES ($1, 'sms', 'granted', 'written', 'Farmer re-enrolled')`,
        [farmerId]
      );
    });

    it('dispatches pre-recorded Telugu voice alert with DTMF prompt and logs channel=voice', async () => {
      const voiceFarmer = await db.query(
        `INSERT INTO farmers (farmer_code, full_name, village_id, preferred_language, status)
         VALUES ('F-VOICE-DIRECT', 'Direct Voice Farmer', $1, 'te', 'active')
         RETURNING id`,
        [villageId]
      );
      const directFarmerId = voiceFarmer.rows[0].id;
      const directPhone = '+919876500055';

      await db.query(
        `INSERT INTO farmer_contacts (farmer_id, phone_e164, type, is_active)
         VALUES ($1, $2, 'primary', true)`,
        [directFarmerId, directPhone]
      );

      await db.query(
        `INSERT INTO consents (farmer_id, channel, status, method, note)
         VALUES ($1, 'voice', 'granted', 'written', 'Voice opt-in')`,
        [directFarmerId]
      );

      const notificationService = new NotificationService(new MockSmsAdapter());

      const voiceRes = await notificationService.sendVoiceAlert({
        farmerId: directFarmerId,
        phone: directPhone,
        alertType: 'rain_expected',
        promptCode: 'prompt_alert_rain_expected',
        teluguText: 'రాబోయే 24 నుండి 48 గంటల్లో మీ ప్రాంతంలో వర్షం కురిసే అవకాశం ఉంది.',
        englishText: 'Rain is expected in your area in the next 24 to 48 hours.',
        bypassQuietHours: true,
      });

      expect(voiceRes.status).toBe('delivered');
      expect(voiceRes.providerMessageId).toContain('voice_alert_');

      const log = await db.query(
        `SELECT * FROM communication_logs WHERE id = $1`,
        [voiceRes.id]
      );
      expect(log.rows[0].channel).toBe('voice');
      expect(log.rows[0].purpose).toBe('weather_alert');
      expect(log.rows[0].status).toBe('delivered');
    });

    it('blocks voice alert outside 09:00 to 18:00 IST when not bypassed', async () => {
      const quietFarmer = await db.query(
        `INSERT INTO farmers (farmer_code, full_name, village_id, preferred_language, status)
         VALUES ('F-VOICE-QUIET', 'Quiet Hours Farmer', $1, 'te', 'active')
         RETURNING id`,
        [villageId]
      );
      const quietFarmerId = quietFarmer.rows[0].id;
      const quietPhone = '+919876500077';

      await db.query(
        `INSERT INTO farmer_contacts (farmer_id, phone_e164, type, is_active)
         VALUES ($1, $2, 'primary', true)`,
        [quietFarmerId, quietPhone]
      );

      await db.query(
        `INSERT INTO consents (farmer_id, channel, status, method, note)
         VALUES ($1, 'voice', 'granted', 'written', 'Voice opt-in')`,
        [quietFarmerId]
      );

      const notificationService = new NotificationService(new MockSmsAdapter());

      const result = await notificationService.sendVoiceAlert({
        farmerId: quietFarmerId,
        phone: quietPhone,
        alertType: 'rain_expected',
        promptCode: 'prompt_alert_rain_expected',
        teluguText: 'వర్షం సమాచారం',
        englishText: 'Rain advisory',
        bypassQuietHours: false,
      });

      const now = new Date();
      const istHours = (now.getUTCHours() + 5 + Math.floor((now.getUTCMinutes() + 30) / 60)) % 24;
      const isOutsideQuiet = istHours < 9 || istHours >= 18;

      if (isOutsideQuiet) {
        expect(result.status).toBe('blocked');
        expect(result.errorReason).toBe('QUIET_HOURS');
      } else {
        expect(result.status).toBe('delivered');
      }
    });

    it('enforces voice call daily cap of maximum 1 call attempt per farmer per calendar day', async () => {
      // Create fresh farmer with active season, contact, and voice consent
      const testFarmer = await db.query(
        `INSERT INTO farmers (farmer_code, full_name, village_id, preferred_language, status)
         VALUES ('F-VCAP-001', 'Voice Cap Farmer', $1, 'te', 'active')
         RETURNING id`,
        [villageId]
      );
      const capId = testFarmer.rows[0].id;
      const capPhone = '+919999900088';

      await db.query(
        `INSERT INTO farmer_contacts (farmer_id, phone_e164, type, is_active)
         VALUES ($1, $2, 'primary', true)`,
        [capId, capPhone]
      );

      await db.query(
        `INSERT INTO consents (farmer_id, channel, status, method, note)
         VALUES ($1, 'voice', 'granted', 'verbal', 'Voice opt-in')`,
        [capId]
      );

      const notificationService = new NotificationService(new MockSmsAdapter());

      // Attempt 1: Should succeed
      const res1 = await notificationService.sendVoiceAlert({
        farmerId: capId,
        phone: capPhone,
        alertType: 'heavy_rain',
        promptCode: 'prompt_alert_heavy_rain',
        teluguText: 'భారీ వర్ష సూచన',
        englishText: 'Heavy rain advisory',
        bypassQuietHours: true,
      });
      expect(res1.status).toBe('delivered');

      // Attempt 2: Blocked by daily voice cap (max 1/day)
      const res2 = await notificationService.sendVoiceAlert({
        farmerId: capId,
        phone: capPhone,
        alertType: 'heavy_rain',
        promptCode: 'prompt_alert_heavy_rain',
        teluguText: 'భారీ వర్ష సూచన 2',
        englishText: 'Heavy rain advisory 2',
        bypassQuietHours: true,
      });
      expect(res2.status).toBe('blocked');
      expect(res2.errorReason).toBe('DAILY_CAP_EXCEEDED');
    });

    it('enforces daily cap of maximum 2 SMS per farmer per calendar day', async () => {
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

      await db.query(
        `INSERT INTO consents (farmer_id, channel, status, method, note)
         VALUES ($1, 'sms', 'granted', 'verbal', 'SMS opt-in')`,
        [capFarmerId]
      );

      const notificationService = new NotificationService(new MockSmsAdapter());

      const res1 = await notificationService.sendSms({
        farmerId: capFarmerId,
        phone: capPhone,
        message: 'Message 1',
        purpose: 'weather_alert',
        bypassQuietHours: true,
      });
      expect(res1.status).toBe('sent');

      const res2 = await notificationService.sendSms({
        farmerId: capFarmerId,
        phone: capPhone,
        message: 'Message 2',
        purpose: 'weather_alert',
        bypassQuietHours: true,
      });
      expect(res2.status).toBe('sent');

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

    it('blocks outbound communications when global COMMUNICATIONS_ENABLED kill switch is false', async () => {
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

      await db.query(
        `INSERT INTO consents (farmer_id, channel, status, method, note)
         VALUES ($1, 'sms', 'granted', 'verbal', 'Dry run opt-in')`,
        [dryFarmerId]
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

  describe('5. Role Scoping, Manual Advisory & Communication Audit Trail', () => {
    it('POST /api/v1/weather/alerts/manual allows AGRI_PANCHAYAT officer to publish advisory in assigned village', async () => {
      const res = await request(app)
        .post('/api/v1/weather/alerts/manual')
        .set('Cookie', panchayatCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          villageId, // Assigned village
          headlineEn: 'Canal Water Release Notice',
          headlineTe: 'కాలువ నీటి విడుదల సమాచారం',
          messageEn: 'Canal rotation water is expected to be released tomorrow morning for 48 hours.',
          messageTe: 'రేపు ఉదయం నుండి 48 గంటల పాటు కాలువ నీరు విడుదలయ్యే అవకాశం ఉంది.',
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
    });

    it('rejects AGRI_PANCHAYAT officer publishing advisory outside their assigned village with 403', async () => {
      const res = await request(app)
        .post('/api/v1/weather/alerts/manual')
        .set('Cookie', panchayatCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          villageId: otherVillageId, // NOT assigned to this officer
          headlineEn: 'Unauthorized Advisory',
          headlineTe: 'అనధికారిక సూచన',
          messageEn: 'Test outside boundary',
          messageTe: 'పరిధి దాటిన పరీక్ష',
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('not assigned to this village');
    });

    it('GET /api/v1/weather/alerts retrieves list of active alerts with village metadata', async () => {
      const res = await request(app)
        .get(`/api/v1/weather/alerts?villageId=${villageId}`)
        .set('Cookie', adminCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.data[0].village_name).toBe(villageName);
    });

    it('GET /api/v1/communication/logs retrieves paginated audit trail containing both voice and SMS logs', async () => {
      const res = await request(app)
        .get('/api/v1/communication/logs?limit=20')
        .set('Cookie', adminCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.logs).toBeInstanceOf(Array);
      expect(res.body.data.total).toBeGreaterThan(0);

      const channels = res.body.data.logs.map((l: any) => l.channel);
      expect(channels).toContain('voice');
      expect(channels).toContain('sms');
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
