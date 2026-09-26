import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { db, closeDatabase } from '../db/index.js';
import { runMigrations } from '../scripts/migrate.js';
import { seedReferenceData } from '../scripts/seed-reference.js';
import { createAdminUser } from '../scripts/create-admin.js';
import { effectiveRainfallService } from '../modules/analytics/EffectiveRainfallService.js';
import { fao56Engine } from '../modules/analytics/Fao56Engine.js';
import { paddyPondingModel } from '../modules/analytics/PaddyPondingModel.js';
import { waterUseRatioEngine } from '../modules/analytics/WaterUseRatioEngine.js';
import { anomalyEngine, AnomalyEngine } from '../modules/analytics/AnomalyEngine.js';
import { dataConfidenceService } from '../modules/analytics/DataConfidenceService.js';
import { analyticsService } from '../modules/analytics/service.js';

describe('Phase 5: Water Analytics, FAO-56 Engine, Paddy Model & Data Confidence Tests', () => {
  let app: any;
  let adminCookie: string;
  let villageId: string;
  let farmerId: string;
  let plotId: string;
  let maizeSeasonId: string;
  let paddySeasonId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.ADMIN_BOOTSTRAP_PASSWORD = 'ChangeMeAdmin123!';

    await runMigrations();
    await seedReferenceData();
    await createAdminUser();

    app = createApp();

    // Authenticate Admin
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ email: 'admin@csp-irrigation.org', password: 'ChangeMeAdmin123!' });

    const cookies = loginRes.headers['set-cookie'];
    adminCookie = Array.isArray(cookies) ? cookies.join('; ') : cookies;

    // Change password to clear must_change_password
    await request(app)
      .post('/api/v1/auth/change-password')
      .set('Cookie', adminCookie)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({
        currentPassword: 'ChangeMeAdmin123!',
        newPassword: 'NewAdminPassword456!',
      });

    // Retrieve village
    const villageRes = await db.query(`SELECT id FROM villages LIMIT 1`);
    villageId = villageRes.rows[0].id;

    // Create test farmer
    const farmerRes = await db.query(
      `INSERT INTO farmers (farmer_code, full_name, village_id, preferred_language, status)
       VALUES ('F-P5-TEST', 'Venkat Rao', $1, 'te', 'active')
       RETURNING id`,
      [villageId]
    );
    farmerId = farmerRes.rows[0].id;

    // Create test plot with 2.0 acres
    const plotRes = await db.query(
      `INSERT INTO plots (farmer_id, label, area_acres, is_active)
       VALUES ($1, 'Main Delta Field', 2.0, true)
       RETURNING id`,
      [farmerId]
    );
    plotId = plotRes.rows[0].id;

    // Fetch crops and irrigation method
    const maizeRes = await db.query(`SELECT id FROM crops WHERE name = 'Maize'`);
    const paddyRes = await db.query(`SELECT id FROM crops WHERE name = 'Paddy (Rice)'`);
    const methodRes = await db.query(`SELECT id FROM irrigation_method_types WHERE code = 'drip'`);

    // Create Maize Season (kc_standard)
    const mSeason = await db.query(
      `INSERT INTO seasons (
        season_code, farmer_id, plot_id, crop_id, irrigation_method_type_id,
        season_type, season_year, sowing_date, expected_harvest_date, area_acres_snapshot, status, data_origin
      )
      VALUES ('S-2026-MAIZE-001', $1, $2, $3, $4, 'kharif', 2026, '2026-06-01', '2026-09-15', 2.0, 'active', 'real')
      RETURNING id`,
      [farmerId, plotId, maizeRes.rows[0].id, methodRes.rows[0].id]
    );
    maizeSeasonId = mSeason.rows[0].id;

    // Create Paddy Season (paddy_ponding)
    const pSeason = await db.query(
      `INSERT INTO seasons (
        season_code, farmer_id, plot_id, crop_id, irrigation_method_type_id,
        season_type, season_year, sowing_date, expected_harvest_date, area_acres_snapshot, status, data_origin
      )
      VALUES ('S-2026-PADDY-001', $1, $2, $3, $4, 'kharif', 2026, '2026-06-01', '2026-09-30', 2.0, 'active', 'real')
      RETURNING id`,
      [farmerId, plotId, paddyRes.rows[0].id, methodRes.rows[0].id]
    );
    paddySeasonId = pSeason.rows[0].id;

    // Seed weather records for 14 days
    for (let day = 1; day <= 14; day++) {
      const dateStr = `2026-06-${day.toString().padStart(2, '0')}`;
      const rain = day === 5 ? 20.0 : (day === 10 ? 60.0 : 0.0);
      await db.query(
        `INSERT INTO weather_records (
          village_id, record_date, temp_max_c, temp_min_c, precipitation_sum_mm,
          et0_fao_evapotranspiration, is_forecast, source, is_demo
        )
        VALUES ($1, $2, 34.0, 24.0, $3, 4.5, false, 'mock', true)
        ON CONFLICT (village_id, record_date, is_forecast) DO NOTHING`,
        [villageId, dateStr, rain]
      );
    }
  });

  afterAll(async () => {
    await closeDatabase();
  });

  describe('1. Configurable Effective Rainfall Engine (Directive 2 & ASSUMPTIONS.md)', () => {
    it('loads dynamic configuration from app_settings and computes standard effective rainfall correctly', async () => {
      const cfg = await effectiveRainfallService.getConfig();
      expect(cfg.minThresholdMm).toBe(5.0);
      expect(cfg.fraction).toBe(0.75);
      expect(cfg.maxCapMm).toBe(35.0);

      // Rainfall < 5mm -> 0mm effective
      const zeroRain = await effectiveRainfallService.calculateEffectiveRainfall(3.0);
      expect(zeroRain.effectiveRainfallMm).toBe(0);

      // Rainfall 25mm -> (25 - 5) * 0.75 = 15.0mm
      const midRain = await effectiveRainfallService.calculateEffectiveRainfall(25.0);
      expect(midRain.effectiveRainfallMm).toBe(15.0);

      // Rainfall 60mm -> (60 - 5) * 0.75 = 41.25 -> capped at maxCapMm 35.0mm
      const heavyRain = await effectiveRainfallService.calculateEffectiveRainfall(60.0);
      expect(heavyRain.effectiveRainfallMm).toBe(35.0);
      expect(heavyRain.isVerified).toBe(false); // Uncalibrated heuristic
    });

    it('computes bunded paddy rainfall retention and drainage overflow', async () => {
      // Current depth 40mm, bund height 100mm -> storage capacity 60mm
      // Rainfall 80mm -> 60mm captured, 20mm overflow
      const paddyRain = await effectiveRainfallService.calculatePaddyEffectiveRainfall(80.0, 40.0, 100.0);
      expect(paddyRain.effectiveRainfallMm).toBe(60.0);
      expect(paddyRain.drainageOverflowMm).toBe(20.0);
    });
  });

  describe('2. FAO-56 Crop Evapotranspiration & Stage Interpolation', () => {
    it('resolves stages and interpolates Kc for Maize with verified FAO-56 Table 12 parameters', async () => {
      const cropRes = await db.query(`SELECT id FROM crops WHERE name = 'Maize'`);
      const stages = await fao56Engine.getCropStages(cropRes.rows[0].id);
      expect(stages.length).toBe(4);

      // Stage 1: Initial (DAS 0-20), Kc = 0.40 (verified)
      const stage1 = fao56Engine.resolveStage(10, stages);
      expect(stage1.stage.name).toContain('Initial');
      expect(stage1.interpolatedKc).toBe(0.40);

      // Stage 3: Mid-Season (DAS 51-80), Kc = 1.15 (verified)
      const stage3 = fao56Engine.resolveStage(65, stages);
      expect(stage3.stage.name).toContain('Mid-Season');
      expect(stage3.interpolatedKc).toBe(1.15);

      // Calculate daily demand with ET0 = 4.5mm
      const demand = fao56Engine.calculateDailyWaterDemand(65, stages, 4.5, 0, 0.90, true);
      // ETc = 1.15 * 4.5 = 5.175 -> 5.18mm
      expect(demand.etcMm).toBeCloseTo(5.18, 1);
      expect(demand.kcVerified).toBe(true);
      expect(demand.unvalidatedParams).toHaveLength(0);
    });

    it('identifies unvalidated Kc assumptions for crops like Chilli and Paddy (Directive 1)', async () => {
      const chilliRes = await db.query(`SELECT id FROM crops WHERE name = 'Chilli'`);
      const stages = await fao56Engine.getCropStages(chilliRes.rows[0].id);

      const demand = fao56Engine.calculateDailyWaterDemand(30, stages, 4.5, 0, 0.65, false);
      expect(demand.kcVerified).toBe(false);
      expect(demand.unvalidatedParams.some(p => p.includes('Kc for'))).toBe(true);
      expect(demand.unvalidatedParams.some(p => p.includes('Irrigation Efficiency'))).toBe(true);
    });
  });

  describe('3. Paddy Ponding Water Balance Model', () => {
    it('simulates daily standing water depth, percolation, and captures unvalidated parameters', async () => {
      const paddyRes = await db.query(`SELECT id FROM crops WHERE name = 'Paddy (Rice)'`);
      const stages = await fao56Engine.getCropStages(paddyRes.rows[0].id);
      const params = await paddyPondingModel.getPaddyParams(paddyRes.rows[0].id);

      expect(params.puddlingWaterMm).toBe(200);
      expect(params.percolationRateMmDay).toBe(4.0);
      expect(params.puddlingVerified).toBe(false);
      expect(params.percolationVerified).toBe(false);

      const { stage, interpolatedKc } = fao56Engine.resolveStage(10, stages);

      // Day 1: Previous depth 40mm, Rain 0, Irrigation 20mm, ET0 4.5, Percolation 4.0
      // ETc = 1.10 * 4.5 = 4.95mm
      // Tentative depth = 40 + 0 + 20 - 4.95 - 4.0 = 51.05mm
      const day1 = paddyPondingModel.calculateDayBalance(
        10, stage, interpolatedKc, 40.0, 4.5, 0, 20.0, params, 0.75, false
      );

      expect(day1.pondingDepthMm).toBeCloseTo(51.05, 1);
      expect(day1.percolationMm).toBe(4.0);
      expect(day1.soilDepletionMm).toBe(0);
      expect(day1.unvalidatedParams.length).toBeGreaterThan(0);
      expect(day1.unvalidatedParams.some(p => p.includes('Paddy Kc'))).toBe(true);
      expect(day1.unvalidatedParams.some(p => p.includes('Percolation Rate'))).toBe(true);
    });
  });

  describe('4. Water Use Ratio Non-Competitive Bands (Directive 3)', () => {
    it('categorizes WUR into qualitative bands without leaderboards or rankings', () => {
      // Applied 500 m³, Demand 1000 m³ -> WUR = 0.50 (< 0.85) -> below_estimate
      const deficit = waterUseRatioEngine.evaluateRatio(500, 1000);
      expect(deficit.ratio).toBe(0.50);
      expect(deficit.band).toBe('below_estimate');
      expect(deficit.labelEn).toBe('Below Estimated Demand');

      // Applied 1050 m³, Demand 1000 m³ -> WUR = 1.05 (0.85-1.20) -> near_estimate
      const balanced = waterUseRatioEngine.evaluateRatio(1050, 1000);
      expect(balanced.ratio).toBe(1.05);
      expect(balanced.band).toBe('near_estimate');
      expect(balanced.labelEn).toBe('Near Agronomic Target');

      // Applied 1600 m³, Demand 1000 m³ -> WUR = 1.60 (> 1.20) -> above_estimate
      const surplus = waterUseRatioEngine.evaluateRatio(1600, 1000);
      expect(surplus.ratio).toBe(1.60);
      expect(surplus.band).toBe('above_estimate');
      expect(surplus.labelEn).toBe('Above Estimated Demand');
    });

    it('converts mm depth over acres to cubic meters and litres accurately', () => {
      // 1 mm over 2 acres = 2 * 4046.86 Litres = 8,093.72 Litres = 8.09 m³
      const m3 = waterUseRatioEngine.mmToCubicMeters(1.0, 2.0);
      expect(m3).toBeCloseTo(8.09, 1);

      const depth = waterUseRatioEngine.litresToMmDepth(8093.72, 2.0);
      expect(depth).toBeCloseTo(1.0, 1);
    });
  });

  describe('5. Anomaly Detection Reasoning Over 336-Hour Fortnight (Directive 4)', () => {
    it('flags IMPLAUSIBLE_PUMP_HOURS when reported hours exceed physical 336 hours in 14 days', () => {
      // 400 hours reported in 14 days -> Physically impossible (> 336 hrs)
      const res = anomalyEngine.evaluatePumpHoursAnomaly(400, 14);
      expect(res.hasAnomaly).toBe(true);
      expect(res.anomalyType).toBe('IMPLAUSIBLE_PUMP_HOURS');
      expect(res.severity).toBe('critical');
      expect(res.description).toContain('exceeds the total physical hours in a 14-day period');
    });

    it('flags warning when reported hours exceed operational 280 hours thermal/power ceiling in 14 days', () => {
      // 300 hours in 14 days (> 280 hrs) -> Exceeds rural power availability
      const res = anomalyEngine.evaluatePumpHoursAnomaly(300, 14);
      expect(res.hasAnomaly).toBe(true);
      expect(res.anomalyType).toBe('IMPLAUSIBLE_PUMP_HOURS');
      expect(res.severity).toBe('warning');
    });

    it('passes plausible fortnightly pump hours cleanly', () => {
      // 60 hours in 14 days (~4.3 hrs/day) -> Normal plausible rural irrigation
      const res = anomalyEngine.evaluatePumpHoursAnomaly(60, 14);
      expect(res.hasAnomaly).toBe(false);
    });

    it('flags RAIN_IRRIGATION_CONFLICT when high irrigation is reported during heavy rainfall', () => {
      // 45mm applied on a day with 60mm rain -> Conflict
      const res = anomalyEngine.evaluateRainIrrigationConflict(45.0, 60.0);
      expect(res.hasAnomaly).toBe(true);
      expect(res.anomalyType).toBe('RAIN_IRRIGATION_CONFLICT');
    });
  });

  describe('6. Data Confidence Scoring Engine', () => {
    it('computes confidence score across coverage, completeness, field evidence and anomalies', async () => {
      // Insert 2 completed cycles for Maize season
      await db.query(
        `INSERT INTO farmer_feedback (
          season_id, cycle_number, period_start, period_end, rainfall_class,
          irrigated, irrigation_count, pump_hours, crop_condition, source
        )
        VALUES ($1, 1, '2026-06-01', '2026-06-14', 'none', true, 3, 24.0, 'good', 'ivr'),
               ($1, 2, '2026-06-15', '2026-06-28', 'light', true, 4, 30.0, 'good', 'manual')
        ON CONFLICT (season_id, cycle_number) DO NOTHING`,
        [maizeSeasonId]
      );

      const confidence = await dataConfidenceService.computeConfidenceScore(maizeSeasonId);
      expect(confidence.totalScore).toBeGreaterThanOrEqual(60);
      expect(confidence.responseCoverage).toBeGreaterThan(0);
      expect(confidence.dataCompleteness).toBeGreaterThan(0);
      expect(confidence.fieldEvidence).toBe(15); // Had 'manual' source
      expect(confidence.anomalyConsistency).toBe(15); // Zero anomalies
      expect(['medium', 'high']).toContain(confidence.band);
    });
  });

  describe('7. End-to-End Analytics Service, Recalculation & API Endpoints', () => {
    it('computes daily water balance and seasonal metrics for Maize season', async () => {
      // Insert irrigation record
      await db.query(
        `INSERT INTO irrigation_records (
          season_id, period_start, period_end, raw_value, raw_unit,
          calculation_method, estimated_volume_l, estimated_depth_mm, measurement_type
        )
        VALUES ($1, '2026-06-03', '2026-06-03', 10.0, 'pump_hours', 'pump_hours_x_discharge', 120000.0, 14.83, 'estimated')`,
        [maizeSeasonId]
      );

      const dailyRecords = await analyticsService.computeSeasonDailyBalance(
        maizeSeasonId,
        '2026-06-01',
        '2026-06-14'
      );
      expect(dailyRecords.length).toBe(14);
      expect(dailyRecords[0].etcMm).toBeGreaterThan(0);

      const metrics = await analyticsService.recalculateSeasonWaterMetrics(maizeSeasonId);
      expect(metrics.totalEtcMm).toBeGreaterThan(0);
      expect(metrics.totalAppliedLitres).toBeGreaterThanOrEqual(120000);
      expect(['below_estimate', 'near_estimate', 'above_estimate']).toContain(metrics.ratioBand);
      expect(metrics.confidenceScore).toBeGreaterThan(0);
    });

    it('computes daily water balance and seasonal metrics for Paddy season with unvalidated assumptions', async () => {
      const dailyRecords = await analyticsService.computeSeasonDailyBalance(
        paddySeasonId,
        '2026-06-01',
        '2026-06-14'
      );
      expect(dailyRecords.length).toBe(14);
      expect(dailyRecords[0].percolationMm).toBe(4.0);

      const metrics = await analyticsService.recalculateSeasonWaterMetrics(paddySeasonId);
      expect(metrics.hasUnvalidatedAssumptions).toBe(true);
      expect(metrics.unvalidatedAssumptionsList.length).toBeGreaterThan(0);
      expect(metrics.unvalidatedAssumptionsList.some(p => p.includes('Paddy Kc'))).toBe(true);
    });

    it('GET /api/v1/analytics/seasons/:seasonId returns full payload with unvalidated assumptions banner data', async () => {
      const res = await request(app)
        .get(`/api/v1/analytics/seasons/${paddySeasonId}`)
        .set('Cookie', adminCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.metrics.season_id).toBe(paddySeasonId);
      expect(res.body.data.metrics.has_unvalidated_assumptions).toBe(true);
      expect(res.body.data.dailyRecords.length).toBeGreaterThan(0);
    });

    it('processes queued analytics batch jobs using FOR UPDATE SKIP LOCKED without collision', async () => {
      // Insert queue jobs
      await db.query(
        `INSERT INTO analytics_processing_queue (season_id, job_type, target_date, status)
         VALUES ($1, 'daily_et_calc', '2026-06-05', 'pending'),
                ($1, 'water_balance_summary', '2026-06-14', 'pending')`,
        [maizeSeasonId]
      );

      const processed = await analyticsService.processAnalyticsQueue(5);
      expect(processed).toBeGreaterThanOrEqual(2);

      const remainingRes = await db.query(
        `SELECT COUNT(*)::int as count FROM analytics_processing_queue WHERE status = 'pending'`
      );
      expect(remainingRes.rows[0].count).toBe(0);
    });
  });

  describe('8. Directives Verification: Bund Height, Configurable Assumptions & Village Scoping', () => {
    it('confirms bund-overflow parameter is flagged unvalidated=false in Paddy ponding model', async () => {
      const paddyParams = await paddyPondingModel.getPaddyParams(
        (await db.query(`SELECT id FROM crops WHERE name = 'Paddy (Rice)'`)).rows[0].id
      );
      expect(paddyParams.bundHeightMm).toBe(100);
      expect(paddyParams.bundHeightVerified).toBe(false);

      const dayBalance = paddyPondingModel.calculateDayBalance(
        10,
        { order: 1, name: 'Land Prep', nameTe: 'దమ్ము', startDas: 0, endDas: 20, kc: 1.10, kcSource: 'FAO-56', kcVerified: false },
        1.10,
        20.0,
        5.0,
        15.0,
        25.0,
        paddyParams
      );
      expect(dayBalance.unvalidatedParams.some(p => p.includes('Paddy Bund Height & Overflow Threshold'))).toBe(true);
    });

    it('confirms WUR band thresholds and anomaly operational ceiling are stored as configurable assumptions and tracked', async () => {
      // 1. Seed custom app settings for WUR bands
      await db.query(
        `INSERT INTO app_settings (key, value, description)
         VALUES ('wur_band_thresholds', '{"lower_band_edge": 0.80, "upper_band_edge": 1.30, "is_verified": false, "source": "District Water Audit Baseline"}'::jsonb, 'Custom WUR bands')
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`
      );

      waterUseRatioEngine.clearCache();
      const wurConfig = await waterUseRatioEngine.getThresholdsConfig();
      expect(wurConfig.lowerBandEdge).toBe(0.80);
      expect(wurConfig.upperBandEdge).toBe(1.30);
      expect(wurConfig.isVerified).toBe(false);

      const evalResult = waterUseRatioEngine.evaluateRatio(82, 100, wurConfig);
      expect(evalResult.band).toBe('near_estimate');
      expect(evalResult.unvalidatedAssumption).toContain('Water Use Ratio qualitative bands');

      // 2. Anomaly thresholds
      anomalyEngine.clearCache();
      const anomalyConfig = await anomalyEngine.getThresholdsConfig();
      expect(anomalyConfig.operationalCeilingHours).toBe(280);
      expect(anomalyConfig.isVerified).toBe(false);
    });

    it('enforces AGRI_PANCHAYAT village scoping on GET and POST analytics endpoints (blocks cross-village access)', async () => {
      // 1. Create a second village
      const v2Res = await db.query(
        `INSERT INTO villages (name, mandal, district, gram_panchayat, latitude, longitude)
         VALUES ('East Delta Village', 'Amalapuram', 'Konaseema', 'East GP', 16.57, 82.00)
         RETURNING id`
      );
      const village2Id = v2Res.rows[0].id;

      // 2. Create AGRI_PANCHAYAT user assigned ONLY to village2Id
      const officerEmail = 'officer.delta@csp-irrigation.org';
      const userRes = await request(app)
        .post('/api/v1/users')
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          name: 'Officer Delta',
          email: officerEmail,
          password: 'OfficerPassword123!',
          role: 'AGRI_PANCHAYAT',
        });
      expect(userRes.status).toBe(201);
      const officerId = userRes.body.data.id;

      // Assign scope strictly to village2Id
      await request(app)
        .put(`/api/v1/users/${officerId}/scopes`)
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          scopes: [
            { scope_type: 'village', scope_value: village2Id },
          ],
        });

      // Login as officer
      const offLogin = await request(app)
        .post('/api/v1/auth/login')
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          email: officerEmail,
          password: 'OfficerPassword123!',
        });
      expect(offLogin.status).toBe(200);
      const officerCookies = offLogin.headers['set-cookie'];
      const officerCookie = Array.isArray(officerCookies) ? officerCookies.join('; ') : officerCookies;

      // Attempt to access paddySeasonId (which belongs to villageId, NOT village2Id)
      const getRes = await request(app)
        .get(`/api/v1/analytics/seasons/${paddySeasonId}`)
        .set('Cookie', officerCookie);
      expect(getRes.status).toBe(403);
      expect(getRes.body.error).toContain('outside assigned village scope');

      // Attempt to recalculate paddySeasonId
      const postRes = await request(app)
        .post(`/api/v1/analytics/seasons/${paddySeasonId}/recalculate`)
        .set('Cookie', officerCookie)
        .set('X-Requested-With', 'XMLHttpRequest');
      expect(postRes.status).toBe(403);
      expect(postRes.body.error).toContain('outside assigned village scope');
    });
  });
});
