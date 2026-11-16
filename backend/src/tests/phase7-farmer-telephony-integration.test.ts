import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { db, closeDatabase } from '../db/index.js';
import { runMigrations } from '../scripts/migrate.js';
import { seedReferenceData } from '../scripts/seed-reference.js';
import { createAdminUser } from '../scripts/create-admin.js';
import bcrypt from 'bcryptjs';

describe('Farmer, Certificate, and Telephony Integration Tests', () => {
  let app: any;
  let adminCookie: string;
  let village1Id: string;
  let village2Id: string;
  let cspMemberCookie: string;
  let cspUserId: string;

  let demoFarmerId: string;
  let demoPlotId: string;
  let demoCropId: string;
  let demoSeasonId: string;
  let demoCertId: string;

  let realFarmerId: string;
  let foreignFarmerId: string;
  let testCallAttemptId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.ADMIN_BOOTSTRAP_PASSWORD = 'ChangeMeAdmin123!';

    await runMigrations();
    await seedReferenceData();
    await createAdminUser();

    app = createApp();

    // Authenticate Admin
    let loginRes = await request(app)
      .post('/api/v1/auth/login')
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ email: 'admin@csp-irrigation.org', password: 'NewAdminPassword456!' });

    if (loginRes.status !== 200) {
      loginRes = await request(app)
        .post('/api/v1/auth/login')
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ email: 'admin@csp-irrigation.org', password: 'ChangeMeAdmin123!' });
    }

    const cookies = loginRes.headers['set-cookie'];
    adminCookie = Array.isArray(cookies) ? cookies.join('; ') : (cookies || '');

    if (loginRes.body?.data?.user?.mustChangePassword) {
      const changeRes = await request(app)
        .post('/api/v1/auth/change-password')
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          currentPassword: 'ChangeMeAdmin123!',
          newPassword: 'NewAdminPassword456!',
        });
      const newCookies = changeRes.headers['set-cookie'];
      if (newCookies) {
        adminCookie = Array.isArray(newCookies) ? newCookies.join('; ') : newCookies;
      }
    }

    // Villages
    const vRes = await db.query(`SELECT id FROM villages ORDER BY name ASC LIMIT 2`);
    village1Id = vRes.rows[0].id;
    village2Id = vRes.rows[1]?.id || vRes.rows[0].id;

    // Create an AGRI_PANCHAYAT user scoped strictly to village1Id
    const rand = Math.random().toString(36).substring(2, 8);
    const passwordHash = await bcrypt.hash('PanchayatPass123!', 10);
    const userRes = await db.query(
      `INSERT INTO users (email, password_hash, name, role, is_active)
       VALUES ($1, $2, 'Village1 Panchayat', 'AGRI_PANCHAYAT', true)
       RETURNING id`,
      [`panchayat_${rand}@village1.org`, passwordHash]
    );
    cspUserId = userRes.rows[0].id;

    await db.query(
      `INSERT INTO user_scopes (user_id, scope_type, scope_value) VALUES ($1, 'village', $2)`,
      [cspUserId, village1Id]
    );

    // Login as AGRI_PANCHAYAT user
    const cspLoginRes = await request(app)
      .post('/api/v1/auth/login')
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ email: `panchayat_${rand}@village1.org`, password: 'PanchayatPass123!' });
    const cspCookies = cspLoginRes.headers['set-cookie'];
    cspMemberCookie = Array.isArray(cspCookies) ? cspCookies.join('; ') : (cspCookies || '');

    // Create Demo Farmer A in Village 1
    const fRes1 = await db.query(
      `INSERT INTO farmers (farmer_code, full_name, village_id, preferred_language, status, data_origin)
       VALUES ($1, 'Ramesh Babu (Demo)', $2, 'te', 'active', 'demo')
       RETURNING id`,
      [`F-DEMO-${rand}`, village1Id]
    );
    demoFarmerId = fRes1.rows[0].id;

    // Contact for demo farmer
    await db.query(
      `INSERT INTO farmer_contacts (farmer_id, phone_e164, type, is_verified)
       VALUES ($1, '+919876500001', 'primary', true)`,
      [demoFarmerId]
    );

    // Plot for demo farmer
    const plotRes = await db.query(
      `INSERT INTO plots (farmer_id, label, area_acres, is_active)
       VALUES ($1, 'Demo Plot A', 2.5, true)
       RETURNING id`,
      [demoFarmerId]
    );
    demoPlotId = plotRes.rows[0].id;

    // Crop & Method
    const cropRes = await db.query(`SELECT id FROM crops LIMIT 1`);
    demoCropId = cropRes.rows[0].id;
    const methodRes = await db.query(`SELECT id FROM irrigation_method_types LIMIT 1`);
    const methodId = methodRes.rows[0].id;

    // Season for demo farmer
    const sRes = await db.query(
      `INSERT INTO seasons (
        season_code, farmer_id, plot_id, crop_id, irrigation_method_type_id,
        season_type, season_year, sowing_date, expected_harvest_date, area_acres_snapshot, status, data_origin
       ) VALUES ($1, $2, $3, $4, $5, 'rabi', 2026, '2025-11-01', '2026-03-15', 2.5, 'active', 'demo')
       RETURNING id`,
      [`S-DEMO-${rand}`, demoFarmerId, demoPlotId, demoCropId, methodId]
    );
    demoSeasonId = sRes.rows[0].id;

    // Create a certificate for Demo Farmer A
    const certHash = 'a'.repeat(64);
    const verificationToken = 'b'.repeat(64);
    const certRes = await db.query(
      `INSERT INTO certificates (
        certificate_code, season_id, farmer_id, plot_id, crop_id,
        version, status, water_use_ratio, water_use_ratio_band,
        confidence_score, confidence_band, actual_harvest_date,
        snapshot_data, sha256_hash, verification_token, created_by
       ) VALUES ($1, $2, $3, $4, $5, 1, 'active', 0.88, 'near_estimate', 85, 'high', '2026-03-15', '{"crop": "Rice"}'::jsonb, $6, $7, $8)
       RETURNING id`,
      [`WUR-DEMO-${rand}`, demoSeasonId, demoFarmerId, demoPlotId, demoCropId, certHash, verificationToken, cspUserId]
    );
    demoCertId = certRes.rows[0].id;

    // Create Real Field Farmer B in Village 1 (NO certificates, NO active seasons initially)
    const fRes2 = await db.query(
      `INSERT INTO farmers (farmer_code, full_name, village_id, preferred_language, status, data_origin)
       VALUES ($1, 'Suresh Reddy (Field)', $2, 'te', 'active', 'real')
       RETURNING id`,
      [`F-REAL-${rand}`, village1Id]
    );
    realFarmerId = fRes2.rows[0].id;

    await db.query(
      `INSERT INTO farmer_contacts (farmer_id, phone_e164, type, is_verified)
       VALUES ($1, '+919876500002', 'primary', false)`,
      [realFarmerId]
    );

    // Create Foreign Farmer C in Village 2
    const fRes3 = await db.query(
      `INSERT INTO farmers (farmer_code, full_name, village_id, preferred_language, status, data_origin)
       VALUES ($1, 'Venkatamma (Village 2)', $2, 'te', 'active', 'real')
       RETURNING id`,
      [`F-V2-${rand}`, village2Id]
    );
    foreignFarmerId = fRes3.rows[0].id;
  });

  afterAll(async () => {
    // cleanup
  });

  describe('1. Farmer Profile Summary Counts & Discovery', () => {
    it('returns enriched summary counts for farmer profile', async () => {
      const res = await request(app)
        .get(`/api/v1/farmers/${demoFarmerId}`)
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest');

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(demoFarmerId);
      expect(res.body.data.certificates_count).toBeGreaterThanOrEqual(1);
      expect(res.body.data.active_seasons_count).toBeGreaterThanOrEqual(1);
      expect(res.body.data.communications_count).toBeDefined();
      expect(res.body.data.surveys_count).toBeDefined();
    });

    it('returns zero counts for a fresh farmer without fabricated data', async () => {
      const res = await request(app)
        .get(`/api/v1/farmers/${realFarmerId}`)
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest');

      expect(res.status).toBe(200);
      expect(res.body.data.certificates_count).toBe(0);
      expect(res.body.data.active_seasons_count).toBe(0);
      expect(res.body.data.communications_count).toBe(0);
      expect(res.body.data.surveys_count).toBe(0);
    });
  });

  describe('2. Certificates Endpoint by Farmer ID', () => {
    it('returns issued certificates when filtered by farmerId', async () => {
      const res = await request(app)
        .get(`/api/v1/certificates?farmerId=${demoFarmerId}`)
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);

      const cert = res.body.data.find((c: any) => c.id === demoCertId);
      expect(cert).toBeDefined();
      expect(cert.farmerId).toBe(demoFarmerId);
      expect(cert.waterUseRatio).toBe(0.88);
      expect(cert.confidenceScore).toBe(85);
      expect(cert.status).toBe('active');
    });

    it('returns empty array honestly for farmer without certificates', async () => {
      const res = await request(app)
        .get(`/api/v1/certificates?farmerId=${realFarmerId}`)
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([]);
      expect(res.body.total).toBe(0);
    });
  });

  describe('3. Telephony Simulator & Call Logging with Direct Farmer ID', () => {
    it('starts a simulator call and logs farmer_id and season_id on call_attempts', async () => {
      const res = await request(app)
        .post('/api/v1/telephony/simulator/start')
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          farmerId: demoFarmerId,
          seasonId: demoSeasonId,
          phoneE164: '+919876500001',
        });

      expect(res.status).toBe(200);
      expect(res.body.sessionId).toBeDefined();
      expect(res.body.action).toBeDefined();

      // Check database persistence of call_attempts
      const caRes = await db.query(
        `SELECT * FROM call_attempts WHERE farmer_id = $1 ORDER BY started_at DESC LIMIT 1`,
        [demoFarmerId]
      );
      expect(caRes.rows.length).toBe(1);
      const attempt = caRes.rows[0];
      testCallAttemptId = attempt.id;

      expect(attempt.farmer_id).toBe(demoFarmerId);
      expect(attempt.season_id).toBe(demoSeasonId);
      expect(attempt.provider).toBe('simulator');
      expect(attempt.phone_e164).toBe('+919876500001');
    });

    it('fetches call attempt details via GET /telephony/attempts/:id with responses and farmer context', async () => {
      expect(testCallAttemptId).toBeDefined();

      const res = await request(app)
        .get(`/api/v1/telephony/attempts/${testCallAttemptId}`)
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(testCallAttemptId);
      expect(res.body.data.farmer_id).toBe(demoFarmerId);
      expect(res.body.data.season_id).toBe(demoSeasonId);
      expect(res.body.data.farmer_name).toBe('Ramesh Babu (Demo)');
      expect(Array.isArray(res.body.data.responses)).toBe(true);
    });
  });

  describe('4. Unified Farmer Communication History & Fallback SMS', () => {
    it('returns chronological communications history for a farmer', async () => {
      // Add a standalone communication log (e.g. weather advisory SMS)
      await db.query(
        `INSERT INTO communication_logs (farmer_id, channel, recipient_phone, message_body, purpose, status, provider, is_simulated)
         VALUES ($1, 'sms', '+919876500001', 'నమస్కారం, భారీ వర్షాల సూచన ఉంది.', 'weather_alert', 'delivered', 'mock_sms', false)`,
        [demoFarmerId]
      );

      const res = await request(app)
        .get(`/api/v1/telephony/farmers/${demoFarmerId}/history`)
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(2);

      // Verify both voice and SMS channels are present
      const voiceAttempt = res.body.data.find((c: any) => c.channel === 'voice');
      const smsLog = res.body.data.find((c: any) => c.channel === 'sms');

      expect(voiceAttempt).toBeDefined();
      expect(voiceAttempt.provider).toBe('simulator');

      expect(smsLog).toBeDefined();
      expect(smsLog.communication_type).toBe('weather_alert');
      expect(smsLog.fallback_sms_content).toContain('భారీ వర్షాల సూచన');
    });

    it('returns empty history honestly when farmer has no communications', async () => {
      const res = await request(app)
        .get(`/api/v1/telephony/farmers/${realFarmerId}/history`)
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([]);
      expect(res.body.total).toBe(0);
    });
  });

  describe('5. Village Scoping & Security Enforcement', () => {
    it('allows AGRI_PANCHAYAT user to view history of a farmer in their assigned village', async () => {
      const res = await request(app)
        .get(`/api/v1/telephony/farmers/${demoFarmerId}/history`)
        .set('Cookie', cspMemberCookie)
        .set('X-Requested-With', 'XMLHttpRequest');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('forbids AGRI_PANCHAYAT user from accessing history of farmer in unassigned village', async () => {
      const res = await request(app)
        .get(`/api/v1/telephony/farmers/${foreignFarmerId}/history`)
        .set('Cookie', cspMemberCookie)
        .set('X-Requested-With', 'XMLHttpRequest');

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('outside assigned village scope');
    });
  });
});
