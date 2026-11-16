import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../app.js';
import { db } from '../db/index.js';
import { runMigrations } from '../scripts/migrate.js';
import { seedReferenceData } from '../scripts/seed-reference.js';
import { generateToken } from '../middleware/auth.js';
import { surveyService } from '../modules/surveys/service.js';
import { certificateService } from '../modules/certificates/service.js';

describe('Phase 5: Field Surveys, Provenance & Certificate Lifecycle Tests', () => {
  let app: any;
  let adminToken: string;
  let cspToken: string;
  let adminUserId: string;
  let farmerId: string;
  let villageId: string;
  let plotId: string;
  let seasonId: string;
  let cropId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await runMigrations();
    await seedReferenceData();

    app = createApp();

    // 1. Fetch reference IDs
    const villageRes = await db.query(`SELECT id FROM villages LIMIT 1`);
    villageId = villageRes.rows[0].id;

    const cropRes = await db.query(`SELECT id FROM crops LIMIT 1`);
    cropId = cropRes.rows[0].id;

    // 2. Setup Test Users
    const pwdHash = await bcrypt.hash('TestPass123!', 4);
    const suffix = Math.random().toString(36).substring(2, 7);

    const adminRes = await db.query(
      `INSERT INTO users (name, email, password_hash, role, is_active, must_change_password)
       VALUES ($1, $2, $3, 'ADMIN', true, false)
       RETURNING id, email, role`,
      [`Admin ${suffix}`, `admin_${suffix}@test.org`, pwdHash]
    );
    adminUserId = adminRes.rows[0].id;
    adminToken = generateToken(adminRes.rows[0]);

    const cspRes = await db.query(
      `INSERT INTO users (name, email, password_hash, role, is_active, must_change_password)
       VALUES ($1, $2, $3, 'CSP_MEMBER', true, false)
       RETURNING id, email, role`,
      [`CSP ${suffix}`, `csp_${suffix}@test.org`, pwdHash]
    );
    cspToken = generateToken(cspRes.rows[0]);

    // 3. Create test farmer
    const farmerRes = await db.query(
      `INSERT INTO farmers (
        farmer_code, full_name, village_id, status, data_origin, preferred_language
      ) VALUES ($1, $2, $3, 'active', 'real', 'te')
      RETURNING id`,
      [`FMR-SURV-${suffix}`, 'Anji Reddy', villageId]
    );
    farmerId = farmerRes.rows[0].id;

    await db.query(
      `INSERT INTO farmer_contacts (farmer_id, phone_e164, type, is_verified)
       VALUES ($1, '+919848011223', 'primary', true)`,
      [farmerId]
    );

    // 4. Create test plot
    const plotRes = await db.query(
      `INSERT INTO plots (farmer_id, label, area_acres, soil_type, tenure)
       VALUES ($1, 'Survey Test Plot 1', 2.50, 'Red Sandy Loam', 'owned')
       RETURNING id`,
      [farmerId]
    );
    plotId = plotRes.rows[0].id;

    // 5. Create test season
    const methodRes = await db.query(`SELECT id FROM irrigation_method_types LIMIT 1`);
    const methodId = methodRes.rows[0].id;

    const seasonRes = await db.query(
      `INSERT INTO seasons (
        season_code, farmer_id, plot_id, season_type, season_year,
        crop_id, sowing_date, expected_harvest_date, irrigation_method_type_id,
        area_acres_snapshot, status, data_origin
      ) VALUES ($1, $2, $3, 'rabi', 2026, $4, '2025-11-01', '2026-03-15', $5, 2.50, 'active', 'real')
      RETURNING id`,
      [`SSN-SURV-${suffix}`, farmerId, plotId, cropId, methodId]
    );
    seasonId = seasonRes.rows[0].id;
  });

  describe('1. Survey Creation & Water Measurements Calculation', () => {
    it('computes applied water volume from pump discharge and hours', () => {
      // 10 LPS * 4 hours = 40 * 3600 = 144,000 Litres = 144 m3
      const metrics = surveyService.calculateWaterMetrics({
        pumpDischargeLps: 10,
        pumpHoursPerEvent: 4,
      });

      expect(metrics.appliedWaterLitres).toBe(144000);
      expect(metrics.appliedWaterVolumeM3).toBe(144);
    });

    it('computes applied water volume from depth mm and area acres', () => {
      // 2.0 acres * 4046.86 * (50mm / 1000) = 404.686 m3 = 404,686 Litres
      const metrics = surveyService.calculateWaterMetrics({
        areaAcres: 2.0,
        irrigationDepthMm: 50,
      });

      expect(metrics.appliedWaterVolumeM3).toBeCloseTo(404.69, 1);
      expect(metrics.appliedWaterLitres).toBeCloseTo(404686, 0);
    });

    it('creates a field survey via API with full provenance and audit log', async () => {
      const res = await request(app)
        .post('/api/v1/surveys')
        .set('Authorization', `Bearer ${cspToken}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          farmerId,
          plotId,
          seasonId,
          surveyDate: '2026-01-15',
          surveyPeriod: 'monthly',
          pumpDischargeLps: 8.5,
          pumpHoursPerEvent: 5.0,
          rainfallMm: 12.0,
          rainfallSource: 'rain_gauge_measured',
          waterAvailabilityStatus: 'adequate',
          cropCondition: 'good',
          farmerRemarks: 'Crop flowering stage, borewell running well.',
          surveyorName: 'Ramesh Reddy (CSP)',
          dataOrigin: 'real',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBeDefined();
      expect(res.body.data.appliedWaterLitres).toBe(8.5 * 5.0 * 3600); // 153,000 L
      expect(res.body.data.version).toBe(1);
      expect(res.body.data.isCorrection).toBe(false);

      // Verify audit log was created
      const auditRes = await request(app)
        .get(`/api/v1/surveys/${res.body.data.id}/audit-logs`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(auditRes.status).toBe(200);
      expect(auditRes.body.data.length).toBe(1);
      expect(auditRes.body.data[0].action).toBe('create');
    });

    it('automatically feeds measured water into irrigation_records and water balance', async () => {
      const records = await db.query(
        `SELECT * FROM irrigation_records WHERE season_id = $1 AND period_start = '2026-01-15'`,
        [seasonId]
      );

      expect(records.rows.length).toBeGreaterThanOrEqual(1);
      expect(Number(records.rows[0].estimated_volume_l)).toBe(153000);
      expect(records.rows[0].source).toBe('field_visit');
      expect(records.rows[0].measurement_type).toBe('measured');
      expect(records.rows[0].is_simulated).toBe(false);
    });
  });

  describe('2. Repeated Surveys & Versioned Corrections', () => {
    let firstSurveyId: string;
    let secondSurveyId: string;

    it('supports repeated seasonal surveys for the same farmer without overwriting', async () => {
      // First survey (January)
      const res1 = await request(app)
        .post('/api/v1/surveys')
        .set('Authorization', `Bearer ${cspToken}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          farmerId,
          plotId,
          seasonId,
          surveyDate: '2026-01-20',
          surveyPeriod: 'monthly',
          pumpDischargeLps: 8.0,
          pumpHoursPerEvent: 4.0,
          cropCondition: 'good',
        });
      expect(res1.status).toBe(201);
      firstSurveyId = res1.body.data.id;

      // Second survey (February)
      const res2 = await request(app)
        .post('/api/v1/surveys')
        .set('Authorization', `Bearer ${cspToken}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          farmerId,
          plotId,
          seasonId,
          surveyDate: '2026-02-18',
          surveyPeriod: 'monthly',
          pumpDischargeLps: 6.5,
          pumpHoursPerEvent: 6.0,
          waterAvailabilityStatus: 'moderate_shortage',
          cropCondition: 'average',
        });
      expect(res2.status).toBe(201);
      secondSurveyId = res2.body.data.id;

      expect(firstSurveyId).not.toBe(secondSurveyId);

      // Verify list returns both surveys
      const listRes = await request(app)
        .get(`/api/v1/surveys?farmerId=${farmerId}`)
        .set('Authorization', `Bearer ${cspToken}`);

      expect(listRes.body.data.length).toBeGreaterThanOrEqual(2);
    });

    it('requires a mandatory correctionReason to update a survey', async () => {
      const res = await request(app)
        .put(`/api/v1/surveys/${firstSurveyId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          pumpHoursPerEvent: 5.0,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/correctionReason/i);
    });

    it('increments version and creates audit log upon valid correction', async () => {
      const res = await request(app)
        .put(`/api/v1/surveys/${firstSurveyId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          pumpHoursPerEvent: 5.0,
          correctionReason: 'Corrected pump hours after logbook verification with farmer',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.version).toBe(2);
      expect(res.body.data.isCorrection).toBe(true);
      expect(res.body.data.correctionReason).toBe('Corrected pump hours after logbook verification with farmer');

      // Verify audit trail
      const auditRes = await request(app)
        .get(`/api/v1/surveys/${firstSurveyId}/audit-logs`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(auditRes.body.data.length).toBe(2);
      expect(auditRes.body.data[1].action).toBe('correction');
      expect(auditRes.body.data[1].reason).toContain('logbook verification');
    });

    it('compares two surveys side-by-side with calculated deltas', async () => {
      const res = await request(app)
        .get(`/api/v1/surveys/compare?id1=${firstSurveyId}&id2=${secondSurveyId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.survey1.id).toBe(firstSurveyId);
      expect(res.body.data.survey2.id).toBe(secondSurveyId);
      expect(res.body.data.deltas.cropConditionChanged).toBe(true);
      expect(res.body.data.deltas.waterStatusChanged).toBe(true);
    });
  });

  describe('3. Certificate Sealing, Status History & Lifecycle', () => {
    let testCertId: string;

    beforeAll(async () => {
      // Create weather records for the test period
      for (let i = 0; i < 14; i++) {
        const d = new Date('2026-06-01');
        d.setDate(d.getDate() + i);
        const dStr = d.toISOString().split('T')[0];
        await db.query(
          `INSERT INTO weather_records (
            village_id, record_date, temp_max_c, temp_min_c, precipitation_sum_mm,
            et0_fao_evapotranspiration, source, is_forecast
          )
          VALUES ($1, $2, 33.0, 25.0, 0.0, 5.5, 'openmeteo', false)
          ON CONFLICT DO NOTHING`,
          [villageId, dStr]
        );
      }

      // Create a 14-day season with feedback for certificate lifecycle
      const methodRes = await db.query(`SELECT id FROM irrigation_method_types LIMIT 1`);
      const methodId = methodRes.rows[0].id;
      const certSeasonRes = await db.query(
        `INSERT INTO seasons (
          season_code, farmer_id, plot_id, crop_id, irrigation_method_type_id,
          season_type, season_year, sowing_date, expected_harvest_date, area_acres_snapshot, status, data_origin
        )
        VALUES ($1, $2, $3, $4, $5, 'kharif', 2026, '2026-06-01', '2026-06-14', 2.5, 'active', 'real')
        RETURNING id`,
        [`SSN-CERT-${Math.random().toString(36).substring(2, 7)}`, farmerId, plotId, cropId, methodId]
      );
      const certSeasonId = certSeasonRes.rows[0].id;

      await db.query(
        `INSERT INTO farmer_feedback (
          season_id, cycle_number, period_start, period_end, rainfall_class, irrigated, irrigation_count,
          pump_hours, crop_condition, water_problem, crop_problem, callback_requested, source
        )
        VALUES 
          ($1, 1, '2026-06-01', '2026-06-07', 'light', true, 1, 4.0, 'good', 'none', 'none', false, 'manual'),
          ($1, 2, '2026-06-08', '2026-06-14', 'moderate', true, 1, 4.0, 'good', 'none', 'none', false, 'manual')`,
        [certSeasonId]
      );

      // Seed an irrigation record so water usage is verified
      await db.query(
        `INSERT INTO irrigation_records (
          season_id, period_start, period_end, raw_value, raw_unit,
          calculation_method, estimated_volume_l, estimated_depth_mm, measurement_type
        )
        VALUES ($1, '2026-06-05', '2026-06-05', 8.0, 'pump_hours', 'pump_hours_x_discharge', 50000.0, 6.18, 'estimated')`,
        [certSeasonId]
      );

      // Issue a certificate for testing lifecycle
      const issueRes = await certificateService.issueCertificate({
        seasonId: certSeasonId,
        actualHarvestDate: '2026-06-14',
        yieldQuantity: 3200,
        yieldUnit: 'kg',
        completionNotes: 'Harvest completed with verified survey data',
        userId: adminUserId,
      });

      expect(issueRes.eligible).toBe(true);
      expect(issueRes.certificate).toBeDefined();
      testCertId = issueRes.certificate!.id;
    });

    it('initializes certificate with active status and records in status history', async () => {
      const cert = await certificateService.getCertificateById(testCertId);
      expect(cert?.status).toBe('active');
      expect(cert?.isRevoked).toBe(false);

      const history = await certificateService.getCertificateHistory(testCertId);
      expect(history.length).toBeGreaterThanOrEqual(1);
      expect(history[0].newStatus).toBe('active');
    });

    it('seals a certificate with mandatory reason and freezes edits', async () => {
      const res = await request(app)
        .post(`/api/v1/certificates/${testCertId}/seal`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          reason: 'Official accreditation audit completed; season metrics sealed.',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('sealed');
      expect(res.body.data.sealedReason).toContain('Official accreditation audit');

      // Check status history
      const history = await certificateService.getCertificateHistory(testCertId);
      const sealEntry = history.find((h: any) => h.newStatus === 'sealed');
      expect(sealEntry).toBeDefined();
      expect(sealEntry.reason).toContain('Official accreditation audit');
    });

    it('revokes a certificate with reason and records status transition', async () => {
      const res = await request(app)
        .post(`/api/v1/certificates/${testCertId}/revoke`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          reason: 'Meter calibration discrepancy detected upon second field audit.',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('revoked');
      expect(res.body.data.isRevoked).toBe(true);

      // Verify cannot seal an already revoked certificate
      const sealAttempt = await request(app)
        .post(`/api/v1/certificates/${testCertId}/seal`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ reason: 'Attempt to seal revoked' });

      expect(sealAttempt.status).toBe(400);
      expect(sealAttempt.body.error).toMatch(/Cannot seal a revoked certificate/i);
    });
  });
});
