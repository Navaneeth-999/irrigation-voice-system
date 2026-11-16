import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { runMigrations } from '../scripts/migrate.js';
import { seedReferenceData } from '../scripts/seed-reference.js';
import { createAdminUser } from '../scripts/create-admin.js';
import { closeDatabase, db } from '../db/index.js';
import { recordAudit } from '../middleware/audit.js';

let app: any;
let adminCookie: string;
let nonAdminCookie: string;

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.ADMIN_BOOTSTRAP_PASSWORD = 'ChangeMeAdmin123!';
  await runMigrations();
  await seedReferenceData();
  await createAdminUser();
  app = createApp();

  // 1. Login as Admin
  const adminLoginRes = await request(app)
    .post('/api/v1/auth/login')
    .set('X-Requested-With', 'XMLHttpRequest')
    .send({
      email: 'admin@csp-irrigation.org',
      password: 'ChangeMeAdmin123!',
    });
  adminCookie = adminLoginRes.headers['set-cookie'][0];

  // 2. Create a non-admin user (AGRI_PANCHAYAT) and login
  await db.query(`
    INSERT INTO users (name, email, password_hash, role, is_active)
    VALUES ('Field Officer Test', 'field.officer.audit@test.org', '$2a$12$e8iW/kHj6Q3K.j9DvhfIhe9R3b7zP7L2m5W7M4Y3f7g1f8z7y8z2a', 'AGRI_PANCHAYAT', true)
    ON CONFLICT (email) DO NOTHING
  `);

  // Record a few test audit entries
  await recordAudit({
    action: 'TEST_ACTION_A',
    entityType: 'test_entity',
    entityId: 'test-123',
    before: { status: 'draft' },
    after: { status: 'published' },
  });

  await recordAudit({
    action: 'TEST_ACTION_B',
    entityType: 'test_entity_2',
    entityId: 'test-456',
    before: null,
    after: { key: 'value' },
  });
});

afterAll(async () => {
  await closeDatabase();
});

describe('Audit Logs Module Tests', () => {
  it('rejects unauthenticated request to /api/v1/audit with 401', async () => {
    const res = await request(app).get('/api/v1/audit');
    expect(res.status).toBe(401);
  });

  it('allows ADMIN to fetch paginated audit logs', async () => {
    const res = await request(app)
      .get('/api/v1/audit?page=1&limit=10')
      .set('Cookie', adminCookie)
      .set('X-Requested-With', 'XMLHttpRequest');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.meta).toBeDefined();
    expect(res.body.meta.total).toBeGreaterThanOrEqual(2);
  });

  it('filters audit logs by action', async () => {
    const res = await request(app)
      .get('/api/v1/audit?action=TEST_ACTION_A')
      .set('Cookie', adminCookie)
      .set('X-Requested-With', 'XMLHttpRequest');

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data[0].action).toBe('TEST_ACTION_A');
    expect(res.body.data[0].entity_type).toBe('test_entity');
  });

  it('filters audit logs by entityType', async () => {
    const res = await request(app)
      .get('/api/v1/audit?entityType=test_entity_2')
      .set('Cookie', adminCookie)
      .set('X-Requested-With', 'XMLHttpRequest');

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data[0].action).toBe('TEST_ACTION_B');
  });

  it('returns audit summary stats', async () => {
    const res = await request(app)
      .get('/api/v1/audit/stats')
      .set('Cookie', adminCookie)
      .set('X-Requested-With', 'XMLHttpRequest');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.totalRecords).toBeGreaterThanOrEqual(2);
    expect(res.body.data.isAppendOnlyEnforced).toBe(true);
    expect(Array.isArray(res.body.data.topActions)).toBe(true);
  });

  it('verifies audit integrity status', async () => {
    const res = await request(app)
      .get('/api/v1/audit/integrity')
      .set('Cookie', adminCookie)
      .set('X-Requested-With', 'XMLHttpRequest');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('TAMPER_PROOF_ACTIVE');
    expect(res.body.data.rowCount).toBeGreaterThanOrEqual(2);
  });
});
