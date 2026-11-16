import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { runMigrations } from '../scripts/migrate.js';
import { seedReferenceData } from '../scripts/seed-reference.js';
import { createAdminUser } from '../scripts/create-admin.js';
import { closeDatabase, db } from '../db/index.js';
import { PdfCertificateService } from '../modules/certificates/PdfCertificateService.js';

let app: any;
let adminCookie: string;
let testVillageId: string;
let testFarmerId: string;

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.ADMIN_BOOTSTRAP_PASSWORD = 'ChangeMeAdmin123!';
  await runMigrations();
  await seedReferenceData();
  await createAdminUser();
  app = createApp();

  // Login as admin
  const loginRes = await request(app)
    .post('/api/v1/auth/login')
    .set('X-Requested-With', 'XMLHttpRequest')
    .send({
      email: 'admin@csp-irrigation.org',
      password: 'ChangeMeAdmin123!',
    });

  const cookies = loginRes.headers['set-cookie'];
  adminCookie = cookies ? cookies[0] : '';

  const villagesRes = await db.query('SELECT id FROM villages ORDER BY name ASC LIMIT 1');
  testVillageId = villagesRes.rows[0].id;
});

afterAll(async () => {
  await closeDatabase();
});

describe('Bug Fixes & Feature Enhancements Verification', () => {
  describe('1. Certificate PDF Generation & Telugu Fontkit Support', () => {
    it('generates a bilingual certificate PDF with NotoTelugu without glyph rendering error', async () => {
      const mockCertificate: any = {
        certificate_code: 'TEST-CERT-2026-001',
        farmer_name: 'వెంకటేశ్వర రావు (Venkateswara Rao)',
        village_name: 'నరసరావుపేట (Narasaraopeta)',
        mandal: 'Narasaraopeta',
        crop_name: 'వరి (Paddy)',
        season_type: 'kharif',
        season_year: 2026,
        confidence_band: 'HIGH',
        water_saved_litres: 125000,
        reduction_percentage: 28.5,
        qr_code_svg: '<svg></svg>',
        data_origin: 'demo',
        version: 1,
        issued_at: new Date().toISOString(),
        snapshot_metrics: {
          areaAcres: 2.5,
          totalCycles: 8,
          farmerReportedCycles: 8,
        },
      };

      const pdfBuffer = await new PdfCertificateService().generateCertificatePdf(mockCertificate);
      expect(pdfBuffer).toBeDefined();
      expect(pdfBuffer.length).toBeGreaterThan(10000); // Clean PDF with bundled Telugu font is ~30KB+
      expect(pdfBuffer.toString('utf8', 0, 5)).toBe('%PDF-');
    });
  });

  describe('2. Village Deduplication & Custom Village Creation', () => {
    it('enforces UNIQUE(name, mandal) constraint on villages table', async () => {
      const v = await db.query('SELECT name, mandal FROM villages LIMIT 1');
      const { name, mandal } = v.rows[0];

      // Attempt inserting duplicate (name, mandal)
      await expect(
        db.query(`INSERT INTO villages (name, mandal, district) VALUES ($1, $2, 'Guntur')`, [name, mandal])
      ).rejects.toThrow();
    });

    it('creates a custom village via POST /api/v1/reference/villages', async () => {
      const uniqueName = `TestVillage_${Date.now()}`;
      const res = await request(app)
        .post('/api/v1/reference/villages')
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          name: uniqueName,
          mandal: 'Amaravati',
          district: 'Guntur',
          gram_panchayat: `${uniqueName} GP`,
        });

      expect(res.status).toBe(201);
      expect(res.body.data.name).toBe(uniqueName);
      expect(res.body.data.id).toBeDefined();
      testVillageId = res.body.data.id;
    });
  });

  describe('3. Farmer Editing & Phone Verification Reset', () => {
    it('registers a new farmer with initial phone_verified = false', async () => {
      const res = await request(app)
        .post('/api/v1/farmers')
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          full_name: 'K. Subba Rao',
          village_id: testVillageId,
          phone: '+919876543210',
          data_origin: 'real',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.id).toBeDefined();
      expect(res.body.data.phone_verified).toBe(false);
      testFarmerId = res.body.data.id;
    });

    it('updates farmer details via PUT /api/v1/farmers/:id', async () => {
      const res = await request(app)
        .put(`/api/v1/farmers/${testFarmerId}`)
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          full_name: 'K. Subba Rao Edited',
          land_area_acres: 3.5,
          water_source: 'borewell',
          crop_type: 'maize',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.full_name).toBe('K. Subba Rao Edited');

      // Verify plot updated
      const plot = await db.query('SELECT area_acres FROM plots WHERE farmer_id = $1', [testFarmerId]);
      expect(plot.rows.length).toBeGreaterThan(0);
      expect(parseFloat(plot.rows[0].area_acres)).toBe(3.5);
    });

    it('resets phone_verified = false when phone number is changed', async () => {
      // First manually verify the farmer
      await db.query('UPDATE farmers SET phone_verified = true WHERE id = $1', [testFarmerId]);

      const verifyCheck = await db.query('SELECT phone_verified FROM farmers WHERE id = $1', [testFarmerId]);
      expect(verifyCheck.rows[0].phone_verified).toBe(true);

      // Change phone number via PUT
      const res = await request(app)
        .put(`/api/v1/farmers/${testFarmerId}`)
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          phone: '+919848011223',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.phone_verified).toBe(false);

      const contact = await db.query('SELECT is_verified FROM farmer_contacts WHERE farmer_id = $1 AND type = \'primary\'', [testFarmerId]);
      expect(contact.rows[0].is_verified).toBe(false);
    });
  });

  describe('4. Farmer OTP Verification', () => {
    it('dispatches a 6-digit OTP via POST /api/v1/farmers/send-otp', async () => {
      const res = await request(app)
        .post('/api/v1/farmers/send-otp')
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          phone: '+919848011223',
          farmerId: testFarmerId,
          mode: 'simulation',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.devOtp).toMatch(/^\d{6}$/);

      // Verify with the issued OTP
      const verifyRes = await request(app)
        .post('/api/v1/farmers/verify-otp')
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          phone: '+919848011223',
          farmerId: testFarmerId,
          otp: res.body.devOtp,
        });

      expect(verifyRes.status).toBe(200);
      expect(verifyRes.body.phone_verified).toBe(true);

      const fCheck = await db.query('SELECT phone_verified FROM farmers WHERE id = $1', [testFarmerId]);
      expect(fCheck.rows[0].phone_verified).toBe(true);
    });

    it('rejects invalid OTP with remaining attempts', async () => {
      // Re-trigger OTP
      await request(app)
        .post('/api/v1/farmers/send-otp')
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          phone: '+919848011223',
          farmerId: testFarmerId,
          mode: 'simulation',
        });

      const invalidRes = await request(app)
        .post('/api/v1/farmers/verify-otp')
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          phone: '+919848011223',
          farmerId: testFarmerId,
          otp: '000000',
        });

      expect(invalidRes.status).toBe(400);
      expect(invalidRes.body.error.code).toBe('INVALID_OTP');
    });
  });

  describe('5. Telephony Live Mode & Gating', () => {
    it('rejects live call dispatch to unverified farmer phone numbers', async () => {
      const unverifiedCode = `FARM-UNV-${Date.now()}`;
      const unverifiedRes = await db.query(`
        INSERT INTO farmers (farmer_code, full_name, village_id, phone_verified)
        VALUES ($1, 'Unverified Farmer', $2, false)
        RETURNING id
      `, [unverifiedCode, testVillageId]);
      const unverifiedId = unverifiedRes.rows[0].id;

      await db.query(`
        INSERT INTO farmer_contacts (farmer_id, phone_e164, type, is_active, is_verified)
        VALUES ($1, '+919111122222', 'primary', true, false)
      `, [unverifiedId]);

      const callRes = await request(app)
        .post('/api/v1/telephony/call/live')
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          farmerId: unverifiedId,
          phoneE164: '+919111122222',
        });

      expect(callRes.status).toBe(400);
      expect(callRes.body.error).toBe('PHONE_NOT_VERIFIED');
    });

    it('triggers automatic fallback Telugu SMS advisory and logs failure when Twilio is unconfigured', async () => {
      const callRes = await request(app)
        .post('/api/v1/telephony/call/live')
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          farmerId: testFarmerId,
          phoneE164: '+919848011223',
        });

      // Since Twilio credentials are mock/not configured in test, it should log failure and trigger fallback SMS
      expect([502, 503]).toContain(callRes.status);
      expect(callRes.body.fallbackSmsSent).toBe(true);
      expect(callRes.body.fallbackSmsContent).toContain('నమస్కారం');

      // Check log
      const logCheck = await db.query(
        'SELECT * FROM call_attempts WHERE phone_e164 = $1 ORDER BY started_at DESC LIMIT 1',
        ['+919848011223']
      );
      expect(logCheck.rows.length).toBeGreaterThan(0);
      expect(logCheck.rows[0].status).toBe('failed');
    });
  });
});
