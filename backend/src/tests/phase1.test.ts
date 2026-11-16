import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { runMigrations } from '../scripts/migrate.js';
import { seedReferenceData } from '../scripts/seed-reference.js';
import { createAdminUser } from '../scripts/create-admin.js';
import { closeDatabase, db } from '../db/index.js';

let app: any;
let adminCookie: string;
let panchayatCookie: string;
let testVillageId: string;
let otherVillageId: string;
let otherVillageFarmerId: string;

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.ADMIN_BOOTSTRAP_PASSWORD = 'ChangeMeAdmin123!';
  await runMigrations();
  await seedReferenceData();
  await createAdminUser();
  app = createApp();

  const villagesRes = await db.query('SELECT id FROM villages ORDER BY name ASC LIMIT 2');
  testVillageId = villagesRes.rows[0].id;
  otherVillageId = villagesRes.rows[1].id;
});

afterAll(async () => {
  await closeDatabase();
});

describe('Phase 1: Foundation & Core Domain Tests', () => {
  describe('1. Health, System Readiness & Unauthenticated Protection', () => {
    it('GET /healthz returns 200 with uptime', async () => {
      const res = await request(app).get('/healthz');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    });

    it('GET /readyz returns 200 with database connected', async () => {
      const res = await request(app).get('/readyz');
      expect(res.status).toBe(200);
      expect(res.body.database).toBe('connected');
    });

    it('unauthenticated request to GET /api/v1/farmers returns 401 UNAUTHORIZED', async () => {
      const res = await request(app).get('/api/v1/farmers');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('unauthenticated request to GET /api/v1/plots returns 401 UNAUTHORIZED', async () => {
      const res = await request(app).get('/api/v1/plots');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('unauthenticated request to GET /api/v1/reference/villages returns 401 UNAUTHORIZED', async () => {
      const res = await request(app).get('/api/v1/reference/villages');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });
  });

  describe('2. Authentication, Forced Password Change & CSRF Defense', () => {
    it('rejects login with invalid password', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          email: 'admin@csp-irrigation.org',
          password: 'WrongPassword123!',
        });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    });

    it('rejects mutating request when CSRF header is missing', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'admin@csp-irrigation.org',
          password: 'ChangeMeAdmin123!',
        });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('CSRF_ERROR');
    });

    it('successfully logs in with valid bootstrap credentials, sets HttpOnly cookie, and flags must_change_password', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          email: 'admin@csp-irrigation.org',
          password: 'ChangeMeAdmin123!',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.user.email).toBe('admin@csp-irrigation.org');
      expect(res.body.data.user.role).toBe('ADMIN');
      expect(res.body.data.user.must_change_password).toBe(true);

      // Verify no token is returned in JSON body (cookie is the sole session carrier)
      expect(res.body.data.token).toBeUndefined();

      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();
      expect(cookies[0]).toContain('HttpOnly');
      adminCookie = cookies[0];
    });

    it('admin changes password via /api/v1/auth/change-password and clears must_change_password', async () => {
      const res = await request(app)
        .post('/api/v1/auth/change-password')
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          currentPassword: 'ChangeMeAdmin123!',
          newPassword: 'NewSecureAdminPassword2026!',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.message).toBe('Password changed successfully.');

      // Check current user state
      const meRes = await request(app)
        .get('/api/v1/auth/me')
        .set('Cookie', adminCookie);

      expect(meRes.status).toBe(200);
      expect(meRes.body.data.user.must_change_password).toBe(false);
    });
  });

  describe('3. Reference Data Endpoints', () => {
    it('GET /api/v1/reference/villages returns seeded villages', async () => {
      const res = await request(app)
        .get('/api/v1/reference/villages')
        .set('Cookie', adminCookie);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThanOrEqual(4);
      expect(res.body.data[0]).toHaveProperty('name');
      expect(res.body.data[0]).toHaveProperty('mandal');
    });

    it('GET /api/v1/reference/crops returns Paddy, Maize, and Chilli with stages and model parameters', async () => {
      const res = await request(app)
        .get('/api/v1/reference/crops')
        .set('Cookie', adminCookie);

      expect(res.status).toBe(200);
      const crops = res.body.data;
      expect(crops.length).toBeGreaterThanOrEqual(3);

      const paddy = crops.find((c: any) => c.name.includes('Paddy'));
      expect(paddy).toBeDefined();
      expect(paddy.water_model).toBe('paddy_ponding');
      expect(paddy.stages.length).toBe(4);
      expect(paddy.parameters.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('4. Users & Scoping RBAC', () => {
    let panchayatUserId: string;
    const panchayatEmail = `officer.tenali.${Date.now()}@panchayat.ap.gov`;

    it('ADMIN creates an AGRI_PANCHAYAT user', async () => {
      const res = await request(app)
        .post('/api/v1/users')
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          name: 'Panchayat Officer Tenali',
          email: panchayatEmail,
          password: 'OfficerPassword123!',
          role: 'AGRI_PANCHAYAT',
        });

      expect(res.status).toBe(201);
      panchayatUserId = res.body.data.id;
      expect(res.body.data.role).toBe('AGRI_PANCHAYAT');
    });

    it('ADMIN assigns village scope to AGRI_PANCHAYAT user', async () => {
      const res = await request(app)
        .put(`/api/v1/users/${panchayatUserId}/scopes`)
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          scopes: [
            { scope_type: 'village', scope_value: testVillageId },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.data.scopes.length).toBe(1);
    });

    it('AGRI_PANCHAYAT user logs in successfully', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          email: panchayatEmail,
          password: 'OfficerPassword123!',
        });

      expect(res.status).toBe(200);
      panchayatCookie = res.headers['set-cookie'][0];
    });

    it('AGRI_PANCHAYAT user is forbidden from creating other users (403)', async () => {
      const res = await request(app)
        .post('/api/v1/users')
        .set('Cookie', panchayatCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          name: 'Hacker',
          email: 'hacker@test.com',
          password: 'Password123!',
          role: 'ADMIN',
        });

      expect(res.status).toBe(403);
    });
  });

  describe('5. Farmer Domain & Scoping Enforcement', () => {
    let scopedFarmerId: string;

    it('creates a farmer in the scoped village and a farmer in the other village', async () => {
      // Farmer 1: In testVillageId (accessible by panchayat user)
      const res1 = await request(app)
        .post('/api/v1/farmers')
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          full_name: 'Venkateswara Rao',
          village_id: testVillageId,
          address: 'Plot 14, Main Road',
          gram_panchayat: 'Test GP',
          phone: '9848022338',
          voice_consent: true,
          sms_consent: true,
          data_origin: 'real',
        });

      expect(res1.status).toBe(201);
      scopedFarmerId = res1.body.data.id;

      // Farmer 2: In otherVillageId (NOT accessible by panchayat user)
      const res2 = await request(app)
        .post('/api/v1/farmers')
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          full_name: 'Narayana Murthy',
          village_id: otherVillageId,
          address: 'Sector 5, Other Village',
          gram_panchayat: 'Other GP',
          phone: '9848099887',
          voice_consent: true,
          sms_consent: true,
          data_origin: 'real',
        });

      expect(res2.status).toBe(201);
      otherVillageFarmerId = res2.body.data.id;
    });

    it('AGRI_PANCHAYAT listing farmers only sees farmers in their assigned village', async () => {
      const res = await request(app)
        .get('/api/v1/farmers')
        .set('Cookie', panchayatCookie);

      expect(res.status).toBe(200);
      const farmerIds = res.body.data.map((f: any) => f.id);
      expect(farmerIds).toContain(scopedFarmerId);
      expect(farmerIds).not.toContain(otherVillageFarmerId);
    });

    it('AGRI_PANCHAYAT attempting to view a farmer outside their assigned village receives 403 FORBIDDEN', async () => {
      const res = await request(app)
        .get(`/api/v1/farmers/${otherVillageFarmerId}`)
        .set('Cookie', panchayatCookie);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('AGRI_PANCHAYAT attempting to edit a farmer outside their assigned village receives 403 FORBIDDEN', async () => {
      const res = await request(app)
        .patch(`/api/v1/farmers/${otherVillageFarmerId}`)
        .set('Cookie', panchayatCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          full_name: 'Tampered Name',
        });

      expect(res.status).toBe(403);
    });

    it('ADMIN views farmer profile and sees full unmasked phone number', async () => {
      const res = await request(app)
        .get(`/api/v1/farmers/${scopedFarmerId}`)
        .set('Cookie', adminCookie);

      expect(res.status).toBe(200);
      expect(res.body.data.contacts.length).toBeGreaterThan(0);
      expect(res.body.data.contacts[0].phone_e164).toBe('+919848022338');
    });

    it('AGRI_PANCHAYAT views their scoped farmer and sees masked phone number', async () => {
      const res = await request(app)
        .get(`/api/v1/farmers/${scopedFarmerId}`)
        .set('Cookie', panchayatCookie);

      expect(res.status).toBe(200);
      const phone = res.body.data.contacts[0].phone_e164;
      expect(phone).toContain('******');
      expect(phone).toBe('+91 ****** 2338');
    });

    it('creates a plot for the farmer with water source and pump details', async () => {
      const wsRes = await db.query('SELECT id FROM water_source_types WHERE code = $1', ['borewell']);
      const borewellId = wsRes.rows[0].id;

      const res = await request(app)
        .post('/api/v1/plots')
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          farmer_id: scopedFarmerId,
          label: 'North Riverfield Plot',
          survey_number: 'SY-204/2B',
          area_acres: 3.5,
          soil_type: 'Black Cotton Clay Loam',
          tenure: 'owned',
          water_sources: [
            {
              water_source_type_id: borewellId,
              pump_hp: 5.0,
              discharge_lph: 15000,
              is_primary: true,
              notes: '5 HP submersible pump',
            },
          ],
        });

      expect(res.status).toBe(201);
      expect(res.body.data.label).toBe('North Riverfield Plot');
      expect(parseFloat(res.body.data.area_acres)).toBe(3.5);
    });

    it('performs dry-run CSV import preview and detects errors', async () => {
      const res = await request(app)
        .post('/api/v1/farmers/import')
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          dryRun: true,
          rows: [
            {
              full_name: 'Subba Rao',
              village_name: 'Guntur Rural',
              phone: '9848111222',
            },
            {
              full_name: 'Invalid Phone Farmer',
              village_name: 'Guntur Rural',
              phone: '123',
            },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.data.dryRun).toBe(true);
      expect(res.body.data.validCount).toBe(1);
      expect(res.body.data.errorCount).toBe(1);
    });

    it('GET /api/v1/analytics/dashboard returns live real KPI counts', async () => {
      const res = await request(app)
        .get('/api/v1/analytics/dashboard')
        .set('Cookie', adminCookie);

      expect(res.status).toBe(200);
      expect(res.body.data.totalFarmers).toBeGreaterThanOrEqual(2);
      expect(res.body.data.activeFarmers).toBeGreaterThanOrEqual(2);
      expect(res.body.data.totalAcres).toBeGreaterThanOrEqual(3.5);
    });
  });
});
