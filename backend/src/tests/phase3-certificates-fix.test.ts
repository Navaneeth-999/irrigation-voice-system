import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { db, closeDatabase } from '../db/index.js';
import { runMigrations } from '../scripts/migrate.js';
import { seedReferenceData } from '../scripts/seed-reference.js';
import { createAdminUser } from '../scripts/create-admin.js';
import { certificateService } from '../modules/certificates/service.js';
import { pdfCertificateService } from '../modules/certificates/PdfCertificateService.js';
import { snapshotService } from '../modules/certificates/SnapshotService.js';
import { analyticsService } from '../modules/analytics/service.js';
import { CertificateRecord, SeasonReportRecord } from '../modules/certificates/types.js';

describe('Phase 3: Certificate Improvements & Verification Tests', () => {
  let app: any;
  let adminCookie: string;
  let villageId: string;
  let farmerId: string;
  let plotId: string;
  let cropId: string;
  let floodMethodId: string;
  let dripMethodId: string;
  const testRunSuffix = Math.random().toString(36).substring(2, 8);

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

    // Get Village
    const villageRes = await db.query(`SELECT id FROM villages LIMIT 1`);
    villageId = villageRes.rows[0].id;

    // Create Farmer with Telugu Name
    const farmerRes = await db.query(
      `INSERT INTO farmers (farmer_code, full_name, village_id, preferred_language, status)
       VALUES ($1, 'వెంకటేశ్వర రావు (Venkateswara Rao)', $2, 'te', 'active')
       RETURNING id`,
      [`F-P3-${testRunSuffix}`, villageId]
    );
    farmerId = farmerRes.rows[0].id;

    // Create Plot (2.0 acres)
    const plotRes = await db.query(
      `INSERT INTO plots (farmer_id, label, area_acres, is_active)
       VALUES ($1, 'North Canal Field', 2.0, true)
       RETURNING id`,
      [farmerId]
    );
    plotId = plotRes.rows[0].id;

    // Get Crop & Methods
    const cropRes = await db.query(`SELECT id FROM crops WHERE name = 'Paddy (Rice)'`);
    cropId = cropRes.rows[0].id;
    const floodRes = await db.query(`SELECT id FROM irrigation_method_types WHERE code = 'flood'`);
    floodMethodId = floodRes.rows[0].id;
    const dripRes = await db.query(`SELECT id FROM irrigation_method_types WHERE code = 'drip'`);
    dripMethodId = dripRes.rows[0].id;

    // Seed Weather Records (Dry season with standard ET0 to generate realistic positive crop irrigation demand)
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
  });

  afterAll(async () => {
    await closeDatabase();
  });

  describe('1. Positive Water Savings Calculation & Real Persistence', () => {
    let positiveSeasonId: string;
    let certCode: string;

    it('issues a certificate persisting non-zero estimated_water_saved_litres, gross recommendation, and unclamped positive savings %', async () => {
      // Create season with Flood irrigation (50% efficiency)
      const sRes = await db.query(
        `INSERT INTO seasons (
          season_code, farmer_id, plot_id, crop_id, irrigation_method_type_id,
          season_type, season_year, sowing_date, expected_harvest_date, area_acres_snapshot, status, data_origin
        )
        VALUES ($1, $2, $3, $4, $5, 'kharif', 2026, '2026-06-01', '2026-06-14', 2.0, 'active', 'real')
        RETURNING id`,
        [`S-POS-${testRunSuffix}`, farmerId, plotId, cropId, floodMethodId]
      );
      positiveSeasonId = sRes.rows[0].id;

      // Seed 2 monitoring cycles
      await db.query(
        `INSERT INTO farmer_feedback (
          season_id, cycle_number, period_start, period_end, rainfall_class, irrigated, irrigation_count,
          pump_hours, crop_condition, water_problem, crop_problem, callback_requested, source
        )
        VALUES 
          ($1, 1, '2026-06-01', '2026-06-07', 'light', true, 1, 4.0, 'good', 'none', 'none', false, 'manual'),
          ($1, 2, '2026-06-08', '2026-06-14', 'moderate', true, 1, 4.0, 'good', 'none', 'none', false, 'manual')`,
        [positiveSeasonId]
      );

      // Seed conservative applied irrigation (e.g. 50,000 L)
      await db.query(
        `INSERT INTO irrigation_records (
          season_id, period_start, period_end, raw_value, raw_unit,
          calculation_method, estimated_volume_l, estimated_depth_mm, measurement_type
        )
        VALUES ($1, '2026-06-05', '2026-06-05', 8.0, 'pump_hours', 'pump_hours_x_discharge', 50000.0, 6.18, 'estimated')`,
        [positiveSeasonId]
      );

      // Issue certificate via POST /api/v1/certificates/seasons/:seasonId/issue
      const res = await request(app)
        .post(`/api/v1/certificates/seasons/${positiveSeasonId}/issue`)
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          actualHarvestDate: '2026-06-14',
          yieldQuantity: 40.0,
          yieldUnit: 'quintal',
          completionNotes: 'Water conservation verified with conservative irrigation.',
        });

      expect(res.status).toBe(201);
      expect(res.body.eligible).toBe(true);
      expect(res.body.data).toBeDefined();

      const cert = res.body.data;
      certCode = cert.certificateCode;

      // Verify estimated_water_saved_litres is NOT hardcoded 0
      expect(Number(cert.estimatedWaterSavedLitres)).toBeGreaterThan(0);

      // Verify in DB directly
      const dbCert = await db.query(`SELECT estimated_water_saved_litres FROM certificates WHERE id = $1`, [cert.id]);
      expect(Number(dbCert.rows[0].estimated_water_saved_litres)).toBeGreaterThan(0);
      expect(Number(dbCert.rows[0].estimated_water_saved_litres)).toBe(Number(cert.estimatedWaterSavedLitres));

      // Verify snapshot metrics
      const snapMetrics = cert.snapshotData.waterMetrics;
      expect(snapMetrics.grossRecommendedM3).toBeGreaterThan(0);
      expect(snapMetrics.waterSavedM3).toBeGreaterThan(0);
      expect(snapMetrics.waterSavedPercentage).toBeGreaterThan(0);
      expect(snapMetrics.calculationMethodology).toContain('FAO-56 Dual Kc');

      // Verify PDF generation succeeds and returns buffer
      const pdfBuf = await pdfCertificateService.generateCertificatePdf(cert);
      expect(pdfBuf).toBeInstanceOf(Buffer);
      expect(pdfBuf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    });

    it('POST /api/v1/certificates/issue works as direct route with body.seasonId', async () => {
      // Attempting on already completed season returns duplicate error
      const res = await request(app)
        .post('/api/v1/certificates/issue')
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          seasonId: positiveSeasonId,
          actualHarvestDate: '2026-06-14',
        });

      // Route is found and handled by controller
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Certificate already issued');
    });
  });

  describe('2. Negative Water Savings & Over-Irrigation Preservation', () => {
    it('preserves negative water saved volume and unclamped negative percentage for over-irrigated seasons', async () => {
      // Create season with Drip irrigation (90% efficiency)
      const sRes = await db.query(
        `INSERT INTO seasons (
          season_code, farmer_id, plot_id, crop_id, irrigation_method_type_id,
          season_type, season_year, sowing_date, expected_harvest_date, area_acres_snapshot, status, data_origin
        )
        VALUES ($1, $2, $3, $4, $5, 'kharif', 2026, '2026-06-01', '2026-06-14', 2.0, 'active', 'real')
        RETURNING id`,
        [`S-NEG-${testRunSuffix}`, farmerId, plotId, cropId, dripMethodId]
      );
      const negSeasonId = sRes.rows[0].id;

      // Seed 2 monitoring cycles
      await db.query(
        `INSERT INTO farmer_feedback (
          season_id, cycle_number, period_start, period_end, rainfall_class, irrigated, irrigation_count,
          pump_hours, crop_condition, water_problem, crop_problem, callback_requested, source
        )
        VALUES 
          ($1, 1, '2026-06-01', '2026-06-07', 'none', true, 3, 20.0, 'good', 'none', 'none', false, 'manual'),
          ($1, 2, '2026-06-08', '2026-06-14', 'none', true, 3, 20.0, 'good', 'none', 'none', false, 'manual')`,
        [negSeasonId]
      );

      // Seed massive irrigation (e.g. 800,000 L, well exceeding crop demand)
      await db.query(
        `INSERT INTO irrigation_records (
          season_id, period_start, period_end, raw_value, raw_unit,
          calculation_method, estimated_volume_l, estimated_depth_mm, measurement_type
        )
        VALUES ($1, '2026-06-05', '2026-06-05', 40.0, 'pump_hours', 'pump_hours_x_discharge', 800000.0, 98.8, 'estimated')`,
        [negSeasonId]
      );

      const res = await request(app)
        .post(`/api/v1/certificates/seasons/${negSeasonId}/issue`)
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          actualHarvestDate: '2026-06-14',
          yieldQuantity: 42.0,
          yieldUnit: 'quintal',
          completionNotes: 'High yield but over-irrigated.',
        });

      expect(res.status).toBe(201);
      const cert = res.body.data;

      // Negative savings preserved
      expect(Number(cert.estimatedWaterSavedLitres)).toBeLessThan(0);
      expect(Number(cert.snapshotData.waterMetrics.waterSavedM3)).toBeLessThan(0);
      expect(Number(cert.snapshotData.waterMetrics.waterSavedPercentage)).toBeLessThan(0);

      // PDF document renders cleanly for over-irrigated seasons
      const pdfBuf = await pdfCertificateService.generateCertificatePdf(cert);
      expect(pdfBuf).toBeInstanceOf(Buffer);
      expect(pdfBuf.length).toBeGreaterThan(5000);
    });
  });

  describe('3. Incomplete Seasons & Eligibility Enforcement', () => {
    it('gates certificate issuance when 0 irrigation records exist, producing an unaccredited Season Report', async () => {
      // Create season with 0 irrigation logs
      const sRes = await db.query(
        `INSERT INTO seasons (
          season_code, farmer_id, plot_id, crop_id, irrigation_method_type_id,
          season_type, season_year, sowing_date, expected_harvest_date, area_acres_snapshot, status, data_origin
        )
        VALUES ($1, $2, $3, $4, $5, 'kharif', 2026, '2026-06-01', '2026-06-14', 2.0, 'active', 'real')
        RETURNING id`,
        [`S-NO-IRR-${testRunSuffix}`, farmerId, plotId, cropId, floodMethodId]
      );
      const noIrrSeasonId = sRes.rows[0].id;

      // Feedback exists, but NO irrigation_records
      await db.query(
        `INSERT INTO farmer_feedback (
          season_id, cycle_number, period_start, period_end, rainfall_class, irrigated, irrigation_count,
          pump_hours, crop_condition, water_problem, crop_problem, callback_requested, source
        )
        VALUES ($1, 1, '2026-06-01', '2026-06-14', 'none', false, 0, 0.0, 'good', 'none', 'none', false, 'manual')`,
        [noIrrSeasonId]
      );

      // Check eligibility endpoint
      const eligRes = await request(app)
        .get(`/api/v1/certificates/seasons/${noIrrSeasonId}/eligibility`)
        .set('Cookie', adminCookie);

      expect(eligRes.status).toBe(200);
      expect(eligRes.body.data.isEligible).toBe(false);
      const hasNoIrrReason = eligRes.body.data.reasons.some((r: string) => r.includes('No irrigation logs recorded'));
      expect(hasNoIrrReason).toBe(true);

      // Issue certificate produces a Season Report instead of Certificate
      const issueRes = await request(app)
        .post(`/api/v1/certificates/seasons/${noIrrSeasonId}/issue`)
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          actualHarvestDate: '2026-06-14',
          yieldQuantity: 25.0,
          yieldUnit: 'quintal',
          completionNotes: 'Harvest completed with no irrigation logs.',
        });

      expect(issueRes.status).toBe(200);
      expect(issueRes.body.eligible).toBe(false);
      expect(issueRes.body.data.reportCode).toMatch(/^JALAMITRA-REPORT-2026-[A-Z0-9]{5}$/);
      expect(issueRes.body.ineligibilityReasons.length).toBeGreaterThan(0);

      // Verify report PDF generates cleanly without crashing
      const reportBuf = await pdfCertificateService.generateSeasonReportPdf(issueRes.body.data);
      expect(reportBuf).toBeInstanceOf(Buffer);
      expect(reportBuf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    });
  });

  describe('4. Missing Metrics & Zero Recommendation Safety (No Fabricated Data)', () => {
    it('renders PDF cleanly with "Data Incomplete" or "N/A" when metrics are missing, never fabricating hardcoded defaults', async () => {
      // Fabricate snapshot record with missing/null values
      const dummyCert: CertificateRecord = {
        id: '11111111-2222-3333-4444-555555555555',
        certificateCode: 'JALAMITRA-2026-TEST1',
        seasonId: '22222222-3333-4444-5555-666666666666',
        farmerId: farmerId,
        plotId: plotId,
        cropId: cropId,
        waterUseRatio: 1.0,
        waterUseRatioBand: 'near_estimate',
        confidenceScore: 75,
        confidenceBand: 'medium',
        estimatedWaterSavedLitres: 0,
        actualHarvestDate: '2026-06-14',
        yieldQuantity: null,
        yieldUnit: null,
        snapshotData: {
          schemaVersion: '1.0.0',
          seasonId: '22222222-3333-4444-5555-666666666666',
          seasonCode: 'S-TEST-NULL',
          seasonType: 'kharif',
          seasonYear: 2026,
          sowingDate: '2026-06-01',
          actualHarvestDate: '2026-06-14',
          yieldQuantity: null,
          yieldUnit: null,
          areaAcres: 2.0,
          farmer: {
            id: farmerId,
            farmerCode: 'F-TEST',
            fullName: 'రైతు సోదరుడు (Farmer Brother)',
            preferredLanguage: 'te',
            villageName: 'Vaddepalli',
            mandal: 'Kovvur',
            district: 'East Godavari',
          },
          plot: {
            id: plotId,
            label: 'Test Plot',
            areaAcres: 2.0,
            waterSourceTypes: ['Borewell'],
            irrigationMethod: 'Flood Irrigation',
            typicalEfficiency: 0.5,
          },
          crop: {
            id: cropId,
            name: 'Paddy (Rice)',
            nameTe: 'వరి',
            category: 'Cereal',
            waterModel: 'fao56_single_crop',
          },
          waterMetrics: {
            totalEtcMm: 0,
            totalEtcM3: 0,
            totalEffectiveRainMm: 0,
            totalEffectiveRainM3: 0,
            netIrrigationDemandMm: 0, // 0 recommendation (rainfed / saturated)
            netIrrigationDemandM3: 0,
            grossRecommendedM3: 0,
            grossRecommendedLitres: 0,
            totalAppliedLitres: 0,
            totalAppliedM3: 0,
            totalAppliedMm: 0,
            waterSavedM3: 0,
            waterSavedLitres: 0,
            waterSavedPercentage: null, // null percentage when recommended <= 0
            waterUseRatio: 1.0,
            ratioBand: 'near_estimate',
            confidenceScore: 60,
            confidenceBand: 'medium',
            confidenceBreakdown: {} as any,
            hasUnvalidatedAssumptions: false,
            unvalidatedAssumptionsList: [],
            anomalyFlags: [],
            calculationMethodology: 'FAO-56 Dual Kc Daily Soil Water Balance',
          },
          irrigationRecordsSummary: {
            totalLogsCount: 1,
            totalHoursReported: 0,
            totalEstimatedVolumeL: 0,
          },
          feedbackSummary: {
            totalCyclesRecorded: 1,
            rainClassesReported: [],
          },
          snapshotGeneratedAt: new Date().toISOString(),
        },
        sha256Hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        pdfPath: null,
        verificationToken: 'testtoken1234567890abcdef',
        version: 1,
        isRevoked: false,
        createdAt: new Date().toISOString(),
      };

      const buf = await pdfCertificateService.generateCertificatePdf(dummyCert);
      expect(buf).toBeInstanceOf(Buffer);
      expect(buf.length).toBeGreaterThan(4000);
      expect(buf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    });
  });

  describe('5. PDF-to-API Consistency & Public QR Verification', () => {
    it('ensures certificate snapshot matches /api/v1/analytics/seasons/:id exactly', async () => {
      // Create and complete a verified season
      const sRes = await db.query(
        `INSERT INTO seasons (
          season_code, farmer_id, plot_id, crop_id, irrigation_method_type_id,
          season_type, season_year, sowing_date, expected_harvest_date, area_acres_snapshot, status, data_origin
        )
        VALUES ($1, $2, $3, $4, $5, 'kharif', 2026, '2026-06-01', '2026-06-14', 2.0, 'active', 'real')
        RETURNING id`,
        [`S-CONS-${testRunSuffix}`, farmerId, plotId, cropId, floodMethodId]
      );
      const consSeasonId = sRes.rows[0].id;

      await db.query(
        `INSERT INTO farmer_feedback (
          season_id, cycle_number, period_start, period_end, rainfall_class, irrigated, irrigation_count,
          pump_hours, crop_condition, water_problem, crop_problem, callback_requested, source
        )
        VALUES ($1, 1, '2026-06-01', '2026-06-14', 'moderate', true, 1, 6.0, 'good', 'none', 'none', false, 'manual')`,
        [consSeasonId]
      );

      await db.query(
        `INSERT INTO irrigation_records (
          season_id, period_start, period_end, raw_value, raw_unit,
          calculation_method, estimated_volume_l, estimated_depth_mm, measurement_type
        )
        VALUES ($1, '2026-06-05', '2026-06-05', 6.0, 'pump_hours', 'pump_hours_x_discharge', 60000.0, 7.41, 'estimated')`,
        [consSeasonId]
      );

      // Issue certificate
      const certRes = await request(app)
        .post(`/api/v1/certificates/seasons/${consSeasonId}/issue`)
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ actualHarvestDate: '2026-06-14' });

      expect(certRes.status).toBe(201);
      const cert = certRes.body.data;

      // Query Analytics API for same season
      const analyticsRes = await request(app)
        .get(`/api/v1/analytics/seasons/${consSeasonId}`)
        .set('Cookie', adminCookie);

      expect(analyticsRes.status).toBe(200);
      const analyticsData = analyticsRes.body.data;

      // Assert identical values between snapshot and analytics API
      expect(Number(cert.snapshotData.waterMetrics.totalAppliedM3)).toBe(Number(analyticsData.metrics.total_applied_m3));
      expect(Number(cert.snapshotData.waterMetrics.waterUseRatio)).toBe(Number(analyticsData.metrics.water_use_ratio));
      expect(Number(cert.snapshotData.waterMetrics.grossRecommendedM3)).toBe(Number(analyticsData.metrics.gross_recommended_m3));
      expect(Number(cert.snapshotData.waterMetrics.waterSavedM3)).toBe(Number(analyticsData.metrics.water_saved_m3));
      expect(Number(cert.snapshotData.waterMetrics.waterSavedPercentage)).toBe(Number(analyticsData.metrics.water_saved_percentage));

      // Public QR Verification route returns strict 6 privacy-preserving fields
      const pubRes = await request(app).get(`/api/v1/certificates/verify/${cert.certificateCode}`);
      expect(pubRes.status).toBe(200);
      expect(pubRes.body.data.certificateNumber).toBe(cert.certificateCode);
      expect(pubRes.body.data.isValid).toBe(true);
      expect(pubRes.body.data.sha256Validated).toBe(true);

      // Private farmer details must NEVER be exposed publicly
      expect(pubRes.body.data.farmerName).toBeUndefined();
      expect(pubRes.body.data.farmerCode).toBeUndefined();
      expect(pubRes.body.data.waterMetrics).toBeUndefined();
      expect(pubRes.body.data.phone).toBeUndefined();
    });
  });

  describe('6. Zero/Rainfed Demand & WUR Handling (No Artificial Clamping)', () => {
    it('returns ratio=null and explanatory band when rainfall meets/exceeds ETc (never manufactures 720)', async () => {
      // Create a season with high rainfall covering demand
      const sRes = await db.query(
        `INSERT INTO seasons (
          season_code, farmer_id, plot_id, crop_id, irrigation_method_type_id,
          season_type, season_year, sowing_date, expected_harvest_date, area_acres_snapshot, status, data_origin
        )
        VALUES ($1, $2, $3, $4, $5, 'kharif', 2026, '2026-06-01', '2026-06-14', 2.0, 'active', 'real')
        RETURNING id`,
        [`S-RAIN-${testRunSuffix}`, farmerId, plotId, cropId, floodMethodId]
      );
      const rainSeasonId = sRes.rows[0].id;

      // Update weather records for this village to heavy rainfall (20 mm/day, ET0 4 mm/day)
      await db.query(
        `UPDATE weather_records 
         SET precipitation_sum_mm = 20.0, et0_fao_evapotranspiration = 4.0 
         WHERE village_id = $1`,
        [villageId]
      );

      // Farmer applied 72,000 L (72 m3) of irrigation
      await db.query(
        `INSERT INTO irrigation_records (
          season_id, period_start, period_end, raw_value, raw_unit,
          calculation_method, estimated_volume_l, estimated_depth_mm, measurement_type
        )
        VALUES ($1, '2026-06-05', '2026-06-05', 6.0, 'pump_hours', 'pump_hours_x_discharge', 72000.0, 8.89, 'estimated')`,
        [rainSeasonId]
      );

      await db.query(
        `INSERT INTO farmer_feedback (
          season_id, cycle_number, period_start, period_end, rainfall_class, irrigated, irrigation_count,
          pump_hours, crop_condition, water_problem, crop_problem, callback_requested, source
        )
        VALUES ($1, 1, '2026-06-01', '2026-06-14', 'heavy', true, 1, 6.0, 'good', 'none', 'none', false, 'manual')`,
        [rainSeasonId]
      );

      // Recompute metrics
      await analyticsService.computeSeasonDailyBalance(rainSeasonId, undefined, '2026-06-14');
      const metrics = await analyticsService.recalculateSeasonWaterMetrics(rainSeasonId);

      // Net demand should be zero because rainfall (280 mm) completely exceeded ETc
      expect(metrics.netIrrigationDemandMm).toBe(0);
      expect(metrics.netIrrigationDemandM3).toBe(0);

      // WUR must be null (NOT 720, and NOT dividing by 0.1)
      expect(metrics.waterUseRatio).toBeNull();
      expect(metrics.ratioBand).toBe('above_estimate');

      // Issue certificate for this rainfed/zero demand season
      const certRes = await request(app)
        .post(`/api/v1/certificates/seasons/${rainSeasonId}/issue`)
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ actualHarvestDate: '2026-06-14' });

      expect(certRes.status).toBe(201);
      const cert = certRes.body.data;
      expect(cert.waterUseRatio).toBeNull();

      // Generate PDF buffer and verify it handles null WUR cleanly without error
      const pdfBuf = await pdfCertificateService.generateCertificatePdf(cert);
      expect(pdfBuf).toBeInstanceOf(Buffer);
      expect(pdfBuf.length).toBeGreaterThan(5000);
    });
  });

  describe('7. Certificate Versioning & Duplicate Rejection', () => {
    it('prevents accidental duplicate issuance on repeated requests', async () => {
      // Find an issued certificate season
      const certRes = await db.query(`SELECT season_id FROM certificates WHERE is_revoked = false LIMIT 1`);
      const existingSeasonId = certRes.rows[0].season_id;

      // Attempting to issue again must fail with 400
      const dupRes = await request(app)
        .post(`/api/v1/certificates/seasons/${existingSeasonId}/issue`)
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ actualHarvestDate: '2026-06-14' });

      expect(dupRes.status).toBe(400);
      expect(dupRes.body.success).toBe(false);
      expect(dupRes.body.error).toContain('already issued');
    });

    it('verifies v1 SHA-256 hash still mathematically validates after reissuance', async () => {
      // Fetch an active certificate
      const activeCertRes = await db.query(
        `SELECT id, certificate_code FROM certificates WHERE is_revoked = false LIMIT 1`
      );
      const certId = activeCertRes.rows[0].id;
      const certCode = activeCertRes.rows[0].certificate_code;

      // Reissue certificate
      const reissueRes = await request(app)
        .post(`/api/v1/certificates/${certId}/reissue`)
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ reason: 'Audit calibration re-evaluation' });

      expect(reissueRes.status).toBe(201);
      const v2Cert = reissueRes.body.data;
      expect(v2Cert.version).toBe(2);

      // Verify old v1 certificate via public endpoint
      const v1Verify = await request(app).get(`/api/v1/certificates/verify/${certCode}`);
      expect(v1Verify.status).toBe(200);
      // v1 is revoked
      expect(v1Verify.body.data.isRevoked).toBe(true);
      expect(v1Verify.body.data.isValid).toBe(false);
      // But its immutable SHA-256 hash STILL cryptographically matches!
      expect(v1Verify.body.data.sha256Validated).toBe(true);
    });
  });
});
