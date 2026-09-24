import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { runMigrations } from '../scripts/migrate.js';
import { seedReferenceData } from '../scripts/seed-reference.js';
import { createAdminUser } from '../scripts/create-admin.js';
import { closeDatabase, db } from '../db/index.js';

let app: any;
let adminCookie: string;
let adminToken: string;
let panchayatCookie: string;
let testVillageId: string;

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  await runMigrations();
  await seedReferenceData();
  await createAdminUser();
  app = createApp();

  const villagesRes = await db.query('SELECT id FROM villages LIMIT 1');
  testVillageId = villagesRes.rows[0].id;
});

afterAll(async () => {
  await closeDatabase();
});

describe('Phase 1: Foundation & Core Domain Tests', () => {
  describe('1. Health and System Readiness', () => {
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
  });

  describe('2. Authentication & CSRF Defense', () => {
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

    it('rejects mutating request when CSRF header is missing and enforced', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .set('x-enforce-csrf', 'true')
        .send({
          email: 'admin@csp-irrigation.org',
          password: 'ChangeMeAdmin123!',
        });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('CSRF_ERROR');
    });

    it('successfully logs in with valid bootstrap credentials and returns cookie + token', async () => {
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
      expect(res.body.data.token).toBeDefined();

      adminToken = res.body.data.token;
      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();
      adminCookie = cookies[0];
    });

    it('GET /api/v1/auth/me returns authenticated admin user', async () => {
      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Cookie', adminCookie);

      expect(res.status).toBe(200);
      expect(res.body.data.user.email).toBe('admin@csp-irrigation.org');
      expect(res.body.data.user.role).toBe('ADMIN');
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

    it('ADMIN creates an AGRI_PANCHAYAT user', async () => {
      const res = await request(app)
        .post('/api/v1/users')
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          name: 'Panchayat Officer Tenali',
          email: 'officer.tenali@panchayat.ap.gov',
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
          email: 'officer.tenali@panchayat.ap.gov',
          password: 'OfficerPassword123!',
        });

      expect(res.status).toBe(200);
      panchayatCookie = res.headers['set-cookie'][0];
    });

    it('AGRI_PANCHAYAT user is forbidden from creating other users', async () => {
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

  describe('5. Farmer and Plot Management with Privacy Masking', () => {
    let createdFarmerId: string;
    let createdPlotId: string;

    it('creates a farmer with normalized primary phone and consents', async () => {
      const res = await request(app)
        .post('/api/v1/farmers')
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          full_name: 'Venkateswara Rao',
          village_id: testVillageId,
          address: 'Plot 14, Main Road, Guntur',
          gram_panchayat: 'Guntur GP',
          phone: '9848022338', // 10 digit Indian number
          voice_consent: true,
          sms_consent: true,
          data_origin: 'real',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.farmer_code).toMatch(/^FARM-AP-\d+/);
      expect(res.body.data.full_name).toBe('Venkateswara Rao');
      createdFarmerId = res.body.data.id;
    });

    it('ADMIN views farmer profile and sees full unmasked phone number', async () => {
      const res = await request(app)
        .get(`/api/v1/farmers/${createdFarmerId}`)
        .set('Cookie', adminCookie);

      expect(res.status).toBe(200);
      expect(res.body.data.contacts.length).toBeGreaterThan(0);
      expect(res.body.data.contacts[0].phone_e164).toBe('+919848022338');
      expect(res.body.data.consents.length).toBe(2);
    });

    it('AGRI_PANCHAYAT views farmer and sees masked phone number', async () => {
      const res = await request(app)
        .get(`/api/v1/farmers/${createdFarmerId}`)
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
          farmer_id: createdFarmerId,
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
      createdPlotId = res.body.data.id;
    });

    it('deactivates and reactivates a farmer with audit logs', async () => {
      const deact = await request(app)
        .post(`/api/v1/farmers/${createdFarmerId}/deactivate`)
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest');
      expect(deact.status).toBe(200);
      expect(deact.body.data.status).toBe('inactive');

      const react = await request(app)
        .post(`/api/v1/farmers/${createdFarmerId}/reactivate`)
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest');
      expect(react.status).toBe(200);
      expect(react.body.data.status).toBe('active');

      const history = await request(app)
        .get(`/api/v1/farmers/${createdFarmerId}/history`)
        .set('Cookie', adminCookie);
      expect(history.status).toBe(200);
      expect(history.body.data.length).toBeGreaterThan(0);
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
              phone: '123', // invalid
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
      expect(res.body.data.totalFarmers).toBeGreaterThanOrEqual(1);
      expect(res.body.data.activeFarmers).toBeGreaterThanOrEqual(1);
      expect(res.body.data.totalAcres).toBeGreaterThanOrEqual(3.5);
    });
  });
});
