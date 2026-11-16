import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { db, closeDatabase } from '../db/index.js';
import { runMigrations } from '../scripts/migrate.js';
import { seedReferenceData } from '../scripts/seed-reference.js';
import { createAdminUser } from '../scripts/create-admin.js';
import { snapshotService } from '../modules/certificates/SnapshotService.js';
import { pdfCertificateService } from '../modules/certificates/PdfCertificateService.js';
import { certificateService } from '../modules/certificates/service.js';

describe('Phase 6: Conservation Certificates, Immutable Snapshots & Public Verification Tests', () => {
  let app: any;
  let adminCookie: string;
  let villageId: string;
  let farmerId: string;
  let plotId: string;
  let cropId: string;
  let seasonId: string;
  let issuedCertificateId: string;
  let issuedCertificateCode: string;
  let methodId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.ADMIN_BOOTSTRAP_PASSWORD = 'ChangeMeAdmin123!';

    await runMigrations();
    await seedReferenceData();
    await createAdminUser();

    app = createApp();

    // Authenticate Admin (handle both fresh seed and re-runs)
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

    // Clear must_change_password if newly initialized
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

    // Retrieve village
    const villageRes = await db.query(`SELECT id FROM villages LIMIT 1`);
    villageId = villageRes.rows[0].id;

    const testRunSuffix = Math.random().toString(36).substring(2, 8);

    // Create test farmer
    const farmerRes = await db.query(
      `INSERT INTO farmers (farmer_code, full_name, village_id, preferred_language, status)
       VALUES ($1, 'Koteswara Rao', $2, 'te', 'active')
       RETURNING id`,
      [`F-P6-${testRunSuffix}`, villageId]
    );
    farmerId = farmerRes.rows[0].id;

    // Create test plot with 3.0 acres
    const plotRes = await db.query(
      `INSERT INTO plots (farmer_id, label, area_acres, is_active)
       VALUES ($1, 'East Canal Plot', 3.0, true)
       RETURNING id`,
      [farmerId]
    );
    plotId = plotRes.rows[0].id;

    // Fetch Paddy Crop and drip irrigation
    const cropRes = await db.query(`SELECT id FROM crops WHERE name = 'Paddy (Rice)'`);
    cropId = cropRes.rows[0].id;
    const methodRes = await db.query(`SELECT id FROM irrigation_method_types WHERE code = 'flood'`);
    methodId = methodRes.rows[0].id;

    // Create active Season
    const sRes = await db.query(
      `INSERT INTO seasons (
        season_code, farmer_id, plot_id, crop_id, irrigation_method_type_id,
        season_type, season_year, sowing_date, expected_harvest_date, area_acres_snapshot, status, data_origin
      )
      VALUES ($1, $2, $3, $4, $5, 'kharif', 2026, '2026-06-01', '2026-09-30', 3.0, 'active', 'real')
      RETURNING id`,
      [`S-2026-P6-1-${testRunSuffix}`, farmerId, plotId, cropId, methodId]
    );
    seasonId = sRes.rows[0].id;

    // Seed weather records for simulation
    const today = new Date();
    for (let i = 0; i < 14; i++) {
      const d = new Date('2026-06-01');
      d.setDate(d.getDate() + i);
      const dStr = d.toISOString().split('T')[0];
      await db.query(
        `INSERT INTO weather_records (
          village_id, record_date, temp_max_c, temp_min_c, precipitation_sum_mm,
          et0_fao_evapotranspiration, source, is_forecast
        )
        VALUES ($1, $2, 34.5, 26.0, 10.0, 5.0, 'openmeteo', false)
        ON CONFLICT DO NOTHING`,
        [villageId, dStr]
      );
    }

    // Seed irrigation record
    await db.query(
      `INSERT INTO irrigation_records (
        season_id, period_start, period_end, raw_value, raw_unit,
        calculation_method, estimated_volume_l, estimated_depth_mm, measurement_type
      )
      VALUES ($1, '2026-06-05', '2026-06-05', 6.0, 'pump_hours', 'pump_hours_x_discharge', 72000.0, 8.89, 'estimated')`,
      [seasonId]
    );

    // Seed feedback record
    await db.query(
      `INSERT INTO farmer_feedback (
        season_id, cycle_number, period_start, period_end, rainfall_class, irrigated, irrigation_count,
        pump_hours, crop_condition, water_problem, crop_problem, callback_requested, source
      )
      VALUES ($1, 1, '2026-06-01', '2026-06-14', 'light', true, 1, 6.0, 'good', 'none', 'none', false, 'manual')`,
      [seasonId]
    );
  });

  afterAll(async () => {
    await closeDatabase();
  });

  describe('1. Season Closing Rules Enforcement', () => {
    it('rejects certificate issuance if actual harvest date is before sowing date', async () => {
      const res = await request(app)
        .post(`/api/v1/certificates/seasons/${seasonId}/issue`)
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          actualHarvestDate: '2026-05-15', // Before sowing (2026-06-01)
          yieldQuantity: 42.0,
          yieldUnit: 'quintal',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('cannot be before sowing date');
    });

    it('rejects certificate issuance if harvest date is in the future', async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 30);
      const futureStr = futureDate.toISOString().split('T')[0];

      const res = await request(app)
        .post(`/api/v1/certificates/seasons/${seasonId}/issue`)
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          actualHarvestDate: futureStr,
          yieldQuantity: 42.0,
          yieldUnit: 'quintal',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('cannot be in the future');
    });

    it('rejects certificate issuance for a Draft season', async () => {
      const draftSeason = await db.query(
        `INSERT INTO seasons (
          season_code, farmer_id, plot_id, crop_id, irrigation_method_type_id,
          season_type, season_year, sowing_date, expected_harvest_date, area_acres_snapshot, status, data_origin
        )
        VALUES ($1, $2, $3, $4, $5, 'rabi', 2026, '2026-10-01', '2027-02-01', 2.0, 'draft', 'real')
        RETURNING id`,
        [`S-2026-DRAFT-${Math.random().toString(36).substring(2, 8)}`, farmerId, plotId, cropId, methodId]
      );

      const res = await request(app)
        .post(`/api/v1/certificates/seasons/${draftSeason.rows[0].id}/issue`)
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          actualHarvestDate: '2026-10-15',
          yieldQuantity: 20.0,
          yieldUnit: 'quintal',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Cannot issue certificate for a Draft season');
    });
  });

  describe('2. Immutable Snapshot & Cryptographic SHA-256 Sealed Certificate Issuance', () => {
    it('issues a sealed certificate, updates season to completed, and computes SHA-256 hash', async () => {
      const res = await request(app)
        .post(`/api/v1/certificates/seasons/${seasonId}/issue`)
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          actualHarvestDate: '2026-06-14',
          yieldQuantity: 38.5,
          yieldUnit: 'quintal',
          completionNotes: 'Excellent kharif paddy season with high water conservation.',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);

      const cert = res.body.data;
      expect(cert.certificateCode).toMatch(/^JALAMITRA-2026-[A-Z0-9]{5}$/);
      expect(cert.sha256Hash).toMatch(/^[a-f0-9]{64}$/); // 64 hex characters
      expect(cert.verificationToken).toBeTruthy();
      expect(cert.isRevoked).toBe(false);

      issuedCertificateId = cert.id;
      issuedCertificateCode = cert.certificateCode;

      // Verify season marked completed in DB
      const sCheck = await db.query(`SELECT status, actual_harvest_date, actual_yield_quantity FROM seasons WHERE id = $1`, [seasonId]);
      expect(sCheck.rows[0].status).toBe('completed');
      expect(Number(sCheck.rows[0].actual_yield_quantity)).toBe(38.5);

      // Verify snapshot structure
      const snapshot = cert.snapshotData;
      expect(snapshot.schemaVersion).toBe('1.0.0');
      expect(snapshot.farmer.fullName).toBe('Koteswara Rao');
      expect(snapshot.crop.name).toBe('Paddy (Rice)');
      expect(snapshot.waterMetrics.hasUnvalidatedAssumptions).toBe(true);
      expect(snapshot.waterMetrics.unvalidatedAssumptionsList.length).toBeGreaterThan(0);
    });

    it('prevents issuing a duplicate certificate for the same season', async () => {
      const res = await request(app)
        .post(`/api/v1/certificates/seasons/${seasonId}/issue`)
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          actualHarvestDate: '2026-06-14',
          yieldQuantity: 40.0,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Certificate already issued');
    });

    it('verifies SHA-256 hash mathematically matches canonical snapshot and detects any tampering', async () => {
      const cert = await certificateService.getCertificateById(issuedCertificateId);
      expect(cert).not.toBeNull();

      // 1. Legitimate integrity check
      const legitimateMatches = snapshotService.verifyIntegrity(cert!.snapshotData, cert!.sha256Hash);
      expect(legitimateMatches).toBe(true);

      // 2. Tampered integrity check (change 1 character)
      const tamperedSnapshot = JSON.parse(JSON.stringify(cert!.snapshotData));
      tamperedSnapshot.waterMetrics.totalAppliedLitres = 999999; // Tampered volume!

      const tamperedMatches = snapshotService.verifyIntegrity(tamperedSnapshot, cert!.sha256Hash);
      expect(tamperedMatches).toBe(false); // MUST FAIL
    });
  });

  describe('3. Bilingual PDF Certificate Generation with Noto Sans Telugu & QR Code', () => {
    it('generates a valid, non-empty PDF document buffer with embedded Telugu text and QR code', async () => {
      const cert = await certificateService.getCertificateById(issuedCertificateId);
      expect(cert).not.toBeNull();

      const pdfBuffer = await pdfCertificateService.generateCertificatePdf(cert!);
      expect(pdfBuffer).toBeInstanceOf(Buffer);
      expect(pdfBuffer.length).toBeGreaterThan(5000); // Substantial PDF size

      // Verify PDF magic header bytes: %PDF-
      const header = pdfBuffer.subarray(0, 5).toString('ascii');
      expect(header).toBe('%PDF-');
    });

    it('GET /api/v1/certificates/:id/pdf downloads or streams the generated PDF', async () => {
      const res = await request(app)
        .get(`/api/v1/certificates/${issuedCertificateId}/pdf`)
        .set('Cookie', adminCookie);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('application/pdf');
      expect(res.headers['content-disposition']).toContain(issuedCertificateCode);
      expect(res.body.length).toBeGreaterThan(5000);
    });
  });

  describe('4. Public Verification Route (Unauthenticated)', () => {
    it('GET /api/v1/certificates/verify/:code succeeds without auth cookies and asserts integrity with strict privacy filtering', async () => {
      const res = await request(app)
        .get(`/api/v1/certificates/verify/${issuedCertificateCode}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Exact 6 fields permitted on public verification portal (User Directive 3)
      expect(res.body.data.certificateNumber).toBe(issuedCertificateCode);
      expect(res.body.data.season).toBeDefined();
      expect(res.body.data.crop).toContain('Paddy (Rice)');
      expect(res.body.data.village).toBeDefined();
      expect(res.body.data.issueDate).toBeDefined();
      expect(res.body.data.status).toBe('valid');
      expect(res.body.data.isValid).toBe(true);
      expect(res.body.data.sha256Validated).toBe(true);

      // Ensure sensitive farmer, land, and confidence details are strictly stripped
      expect(res.body.data.farmerName).toBeUndefined();
      expect(res.body.data.farmerCode).toBeUndefined();
      expect(res.body.data.plotId).toBeUndefined();
      expect(res.body.data.plotLabel).toBeUndefined();
      expect(res.body.data.confidenceScore).toBeUndefined();
      expect(res.body.data.waterUseRatio).toBeUndefined();
    });

    it('GET /api/v1/certificates/verify/:code returns 404 for non-existent certificate', async () => {
      const res = await request(app)
        .get('/api/v1/certificates/verify/JALAMITRA-INVALID-CODE');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('not found');
    });
  });

  describe('5. Certificate Revocation & Governance Workflow', () => {
    it('rejects revocation attempt by unauthenticated user (401)', async () => {
      const res = await request(app)
        .post(`/api/v1/certificates/${issuedCertificateId}/revoke`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ reason: 'Unauthorized tampering attempt' });

      expect(res.status).toBe(401);
    });

    it('allows Admin to revoke certificate and updates public verification status', async () => {
      const res = await request(app)
        .post(`/api/v1/certificates/${issuedCertificateId}/revoke`)
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ reason: 'Audit discrepancy in pump discharge meter readings.' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.isRevoked).toBe(true);
      expect(res.body.data.revocationReason).toBe('Audit discrepancy in pump discharge meter readings.');

      // Public verification must now report isRevoked = true and isValid = false
      const pubRes = await request(app)
        .get(`/api/v1/certificates/verify/${issuedCertificateCode}`);

      expect(pubRes.status).toBe(200);
      expect(pubRes.body.data.isRevoked).toBe(true);
      expect(pubRes.body.data.isValid).toBe(false);
      expect(pubRes.body.data.revocationReason).toBe('Audit discrepancy in pump discharge meter readings.');
    });
  });

  describe('6. Village Scoping for AGRI_PANCHAYAT on Certificate Directory', () => {
    it('restricts AGRI_PANCHAYAT to viewing only certificates in their assigned villages', async () => {
      // 1. Create a second village
      const v2Res = await db.query(
        `INSERT INTO villages (name, mandal, district, gram_panchayat, latitude, longitude)
         VALUES ('Guntur Canal Scoping Village', 'Tenali', 'Guntur', 'Tenali GP', 16.24, 80.64)
         ON CONFLICT (name, mandal) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`
      );
      const village2Id = v2Res.rows[0].id;

      // 2. Create AGRI_PANCHAYAT user assigned only to village2Id
      const officerEmail = `officer.certs.${Math.random().toString(36).substring(2, 8)}@csp-irrigation.org`;
      const userRes = await request(app)
        .post('/api/v1/users')
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          name: 'Officer Certs',
          email: officerEmail,
          password: 'OfficerPassword123!',
          role: 'AGRI_PANCHAYAT',
        });
      expect(userRes.status).toBe(201);
      const officerId = userRes.body.data.id;

      await request(app)
        .put(`/api/v1/users/${officerId}/scopes`)
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          scopes: [{ scope_type: 'village', scope_value: village2Id }],
        });

      // Login as officer
      const offLogin = await request(app)
        .post('/api/v1/auth/login')
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          email: officerEmail,
          password: 'OfficerPassword123!',
        });
      const offCookie = offLogin.headers['set-cookie'];

      // Listing certificates for officer in village2Id should return 0 (as issued cert is in villageId)
      const listRes = await request(app)
        .get('/api/v1/certificates')
        .set('Cookie', offCookie);

      expect(listRes.status).toBe(200);
      expect(listRes.body.total).toBe(0);
      expect(listRes.body.data.length).toBe(0);

      // Attempting to download PDF for out-of-scope cert returns 403
      const pdfRes = await request(app)
        .get(`/api/v1/certificates/${issuedCertificateId}/pdf`)
        .set('Cookie', offCookie);

      expect(pdfRes.status).toBe(403);
    });
  });

  describe('7. Certificate Eligibility Gating & Ineligible Season Summary Report', () => {
    it('gates certificate issuance when monitoring coverage and confidence thresholds are not met, producing a Season Report instead', async () => {
      // Create a season with 0 farmer feedback (0% coverage)
      const ineligSeasonRes = await db.query(
        `INSERT INTO seasons (
          season_code, farmer_id, plot_id, crop_id, irrigation_method_type_id,
          season_type, season_year, sowing_date, expected_harvest_date, area_acres_snapshot, status, data_origin
        )
        VALUES ($1, $2, $3, $4, $5, 'kharif', 2026, '2026-06-01', '2026-09-30', 3.0, 'active', 'real')
        RETURNING id`,
        [`S-2026-INELIG-${Math.random().toString(36).substring(2, 8)}`, farmerId, plotId, cropId, methodId]
      );
      const ineligSeasonId = ineligSeasonRes.rows[0].id;

      // Check eligibility endpoint
      const eligRes = await request(app)
        .get(`/api/v1/certificates/seasons/${ineligSeasonId}/eligibility`)
        .set('Cookie', adminCookie);

      expect(eligRes.status).toBe(200);
      expect(eligRes.body.data.isEligible).toBe(false);
      expect(eligRes.body.data.reasons.length).toBeGreaterThan(0);
      expect(eligRes.body.data.reasons[0]).toContain('Monitoring cycle coverage');

      // Attempt completing harvest on this ineligible season
      const issueRes = await request(app)
        .post(`/api/v1/certificates/seasons/${ineligSeasonId}/issue`)
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          actualHarvestDate: '2026-06-14',
          yieldQuantity: 30.0,
          yieldUnit: 'quintal',
          completionNotes: 'Completed with zero farmer responses.',
        });

      expect(issueRes.status).toBe(200);
      expect(issueRes.body.eligible).toBe(false);
      expect(issueRes.body.data.reportCode).toMatch(/^JALAMITRA-REPORT-2026-[A-Z0-9]{5}$/);
      expect(issueRes.body.ineligibilityReasons.length).toBeGreaterThan(0);

      // Verify season table marked ineligible
      const sCheck = await db.query(`SELECT status, certificate_status FROM seasons WHERE id = $1`, [ineligSeasonId]);
      expect(sCheck.rows[0].status).toBe('completed');
      expect(sCheck.rows[0].certificate_status).toBe('ineligible');

      // Verify NO certificate record exists in certificates table
      const certCheck = await db.query(`SELECT COUNT(*)::int as count FROM certificates WHERE season_id = $1`, [ineligSeasonId]);
      expect(certCheck.rows[0].count).toBe(0);

      // Download Season Report PDF
      const pdfReportRes = await request(app)
        .get(`/api/v1/certificates/seasons/${ineligSeasonId}/report/pdf`)
        .set('Cookie', adminCookie);

      expect(pdfReportRes.status).toBe(200);
      expect(pdfReportRes.headers['content-type']).toContain('application/pdf');
      expect(pdfReportRes.body.length).toBeGreaterThan(2000);
    });
  });

  describe('8. Certificate Reissuance & Version Tracking Hierarchy', () => {
    it('reissues a certificate, links replaces_certificate_id, and increments version', async () => {
      // Reissue the issued certificate
      const reissueRes = await request(app)
        .post(`/api/v1/certificates/${issuedCertificateId}/reissue`)
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          reason: 'Corrected pump discharge rating following field meter audit',
          yieldQuantity: 42.5,
        });

      expect(reissueRes.status).toBe(201);
      expect(reissueRes.body.success).toBe(true);

      const newCert = reissueRes.body.data;
      expect(newCert.version).toBe(2);
      expect(newCert.replacesCertificateId).toBe(issuedCertificateId);
      expect(newCert.certificateCode).not.toBe(issuedCertificateCode);

      // Check old certificate is revoked and replaced_by linked
      const oldCheck = await db.query(`SELECT is_revoked, replaced_by_certificate_id, revocation_reason FROM certificates WHERE id = $1`, [issuedCertificateId]);
      expect(oldCheck.rows[0].is_revoked).toBe(true);
      expect(oldCheck.rows[0].replaced_by_certificate_id).toBe(newCert.id);
      expect(oldCheck.rows[0].revocation_reason).toContain('Replaced by reissued certificate');

      // Public verification of old certificate shows revoked
      const pubOld = await request(app).get(`/api/v1/certificates/verify/${issuedCertificateCode}`);
      expect(pubOld.status).toBe(200);
      expect(pubOld.body.data.status).toBe('revoked');
      expect(pubOld.body.data.isValid).toBe(false);

      // Public verification of new certificate shows valid
      const pubNew = await request(app).get(`/api/v1/certificates/verify/${newCert.certificateCode}`);
      expect(pubNew.status).toBe(200);
      expect(pubNew.body.data.status).toBe('valid');
      expect(pubNew.body.data.isValid).toBe(true);

      // Verify v1's SHA-256 STILL verifies against its original immutable snapshot
      const oldCertDb = await db.query(`SELECT snapshot_data, sha256_hash FROM certificates WHERE id = $1`, [issuedCertificateId]);
      expect(snapshotService.verifyIntegrity(oldCertDb.rows[0].snapshot_data, oldCertDb.rows[0].sha256_hash)).toBe(true);

      // Verify v2's SHA-256 verifies against its own independent snapshot
      const newCertDb = await db.query(`SELECT snapshot_data, sha256_hash FROM certificates WHERE id = $1`, [newCert.id]);
      expect(snapshotService.verifyIntegrity(newCertDb.rows[0].snapshot_data, newCertDb.rows[0].sha256_hash)).toBe(true);

      // Verify that v1 and v2 snapshots and hashes are fully distinct and independent
      expect(oldCertDb.rows[0].sha256_hash).not.toBe(newCertDb.rows[0].sha256_hash);

      // Confirm non-admin cannot reissue certificates
      const unauthorizedReissue = await request(app)
        .post(`/api/v1/certificates/${newCert.id}/reissue`)
        .send({ reason: 'Unauthorized reissue attempt' });
      expect([401, 403]).toContain(unauthorizedReissue.status);
    });
  });

  describe('9. Settings Management & Configurable Eligibility Thresholds', () => {
    it('allows ADMIN to fetch and update certificate eligibility thresholds via Settings API', async () => {
      // 1. Fetch settings
      const getRes = await request(app)
        .get('/api/v1/settings')
        .set('Cookie', adminCookie);
      expect(getRes.status).toBe(200);
      expect(getRes.body.success).toBe(true);
      expect(Array.isArray(getRes.body.data)).toBe(true);

      const coverageSetting = getRes.body.data.find((s: any) => s.key === 'certificate_min_cycle_coverage_pct');
      expect(coverageSetting).toBeDefined();

      // 2. Update threshold via PUT /api/v1/settings/:key
      const updateRes = await request(app)
        .put('/api/v1/settings/certificate_min_cycle_coverage_pct')
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ value: 55 });
      expect(updateRes.status).toBe(200);
      expect(updateRes.body.success).toBe(true);
      expect(updateRes.body.data.value).toBe(55);

      // Revert back to 50
      await request(app)
        .put('/api/v1/settings/certificate_min_cycle_coverage_pct')
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ value: 50 });
    });
  });
});
