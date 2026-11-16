import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { db, closeDatabase } from '../db/index.js';
import { runMigrations } from '../scripts/migrate.js';
import { seedReferenceData } from '../scripts/seed-reference.js';
import { createAdminUser } from '../scripts/create-admin.js';
import { analyticsService } from '../modules/analytics/service.js';

describe('Phase 2: Fix Analytics Tests (Water Saved, Savings %, Productivity, Profit, KPIs)', () => {
  let app: any;
  let adminCookie: string;
  let villageId: string;
  let farmerId: string;
  let plotId: string;
  let cropId: string;
  let methodId: string;

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

    // Village & Farmer
    const vRes = await db.query(`SELECT id FROM villages LIMIT 1`);
    villageId = vRes.rows[0].id;

    const fRes = await db.query(
      `INSERT INTO farmers (farmer_code, full_name, village_id, preferred_language, status)
       VALUES ('F-P2-ANALYTICS', 'K. Venkata Raman', $1, 'te', 'active')
       RETURNING id`,
      [villageId]
    );
    farmerId = fRes.rows[0].id;

    // Plot (1.0 Acre)
    const pRes = await db.query(
      `INSERT INTO plots (farmer_id, label, area_acres, is_active)
       VALUES ($1, 'Analytics Test Plot', 1.0, true)
       RETURNING id`,
      [farmerId]
    );
    plotId = pRes.rows[0].id;

    // Crop & Method (Flood Irrigation ~ 0.75 typical efficiency)
    const cRes = await db.query(`SELECT id FROM crops WHERE name = 'Maize' LIMIT 1`);
    cropId = cRes.rows[0].id;

    const mRes = await db.query(`SELECT id FROM irrigation_method_types WHERE code = 'flood' LIMIT 1`);
    methodId = mRes.rows[0].id;
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it('1. Positive savings: calculates water saved and positive savings % when applied < recommended', async () => {
    const sRes = await db.query(
      `INSERT INTO seasons (
        season_code, farmer_id, plot_id, crop_id, irrigation_method_type_id,
        season_type, season_year, sowing_date, expected_harvest_date, area_acres_snapshot, status
      )
      VALUES ('S-P2-POS-SAVINGS', $1, $2, $3, $4, 'kharif', 2026, '2026-06-01', '2026-06-10', 1.0, 'active')
      RETURNING id`,
      [farmerId, plotId, cropId, methodId]
    );
    const seasonId = sRes.rows[0].id;

    // Insert 5 daily water balance records: etc = 10mm each day, effective rain = 0 -> Net demand = 50mm = ~202.34 m3
    // With 0.75 efficiency: Gross demand = 202.34 / 0.75 = ~269.79 m3 = ~269,790 L
    for (let i = 1; i <= 5; i++) {
      const dateStr = `2026-06-0${i}`;
      await db.query(
        `INSERT INTO season_daily_water_balance (
          season_id, record_date, das, crop_stage_name, stage_kc, et0_mm, etc_mm,
          rainfall_mm, effective_rainfall_mm, irrigation_applied_mm, irrigation_applied_litres
        )
        VALUES ($1, $2, $3, 'Vegetative', 1.0, 10.0, 10.0, 0, 0, 8.0, 32375.0)`,
        [seasonId, dateStr, i]
      );
    }
    // Total applied = 5 * 32,375 L = 161,875 L = 161.88 m3

    const metrics = await analyticsService.recalculateSeasonWaterMetrics(seasonId);

    expect(metrics.grossRecommendedM3).toBeGreaterThan(260);
    expect(metrics.totalAppliedM3).toBeLessThan(metrics.grossRecommendedM3);
    expect(metrics.waterSavedM3).toBeGreaterThan(0);
    expect(metrics.waterSavedLitres).toBeGreaterThan(0);
    expect(metrics.waterSavedPercentage).toBeGreaterThan(0);
    expect(metrics.waterSavedPercentage).toBeCloseTo(60.0, 0); // ~60% savings based on 0.50 flood efficiency
  });

  it('2. Negative savings: preserves unclamped negative savings % when applied > recommended (no clamp to zero)', async () => {
    const sRes = await db.query(
      `INSERT INTO seasons (
        season_code, farmer_id, plot_id, crop_id, irrigation_method_type_id,
        season_type, season_year, sowing_date, expected_harvest_date, area_acres_snapshot, status
      )
      VALUES ('S-P2-NEG-SAVINGS', $1, $2, $3, $4, 'kharif', 2026, '2026-06-01', '2026-06-10', 1.0, 'active')
      RETURNING id`,
      [farmerId, plotId, cropId, methodId]
    );
    const seasonId = sRes.rows[0].id;

    // Daily records: net demand = 20mm = ~80.94 m3, Gross demand ~107.92 m3
    // Applied: 200 m3 = 200,000 L (over-irrigation)
    await db.query(
      `INSERT INTO season_daily_water_balance (
        season_id, record_date, das, crop_stage_name, stage_kc, et0_mm, etc_mm,
        rainfall_mm, effective_rainfall_mm, irrigation_applied_mm, irrigation_applied_litres
      )
      VALUES ($1, '2026-06-01', 1, 'Vegetative', 1.0, 20.0, 20.0, 0, 0, 49.42, 200000.0)`,
      [seasonId]
    );

    const metrics = await analyticsService.recalculateSeasonWaterMetrics(seasonId);

    expect(metrics.totalAppliedM3).toBeGreaterThan(metrics.grossRecommendedM3);
    expect(metrics.waterSavedM3).toBeLessThan(0);
    expect(metrics.waterSavedLitres).toBeLessThan(0);
    expect(metrics.waterSavedPercentage).toBeLessThan(0); // MUST be negative!
    expect(metrics.waterSavedPercentage).not.toBe(0);     // Must NOT clamp to 0
  });

  it('3. Zero recommended water: returns null savings percentage instead of dividing by zero (NaN)', async () => {
    const sRes = await db.query(
      `INSERT INTO seasons (
        season_code, farmer_id, plot_id, crop_id, irrigation_method_type_id,
        season_type, season_year, sowing_date, expected_harvest_date, area_acres_snapshot, status
      )
      VALUES ('S-P2-ZERO-REC', $1, $2, $3, $4, 'kharif', 2026, '2026-06-01', '2026-06-10', 1.0, 'active')
      RETURNING id`,
      [farmerId, plotId, cropId, methodId]
    );
    const seasonId = sRes.rows[0].id;

    // 0 demand (e.g. rain fully satisfied ETc: etc = 10, effRain = 10 -> net demand = 0)
    await db.query(
      `INSERT INTO season_daily_water_balance (
        season_id, record_date, das, crop_stage_name, stage_kc, et0_mm, etc_mm,
        rainfall_mm, effective_rainfall_mm, irrigation_applied_mm, irrigation_applied_litres
      )
      VALUES ($1, '2026-06-01', 1, 'Vegetative', 1.0, 10.0, 10.0, 10.0, 10.0, 5.0, 20000.0)`,
      [seasonId]
    );

    const metrics = await analyticsService.recalculateSeasonWaterMetrics(seasonId);

    expect(metrics.grossRecommendedM3).toBe(0);
    expect(metrics.waterSavedPercentage).toBeNull(); // Safe handling: null, not NaN or Infinity!
  });

  it('4. Missing yield: water productivity returns null when yield data is absent', async () => {
    const sRes = await db.query(
      `INSERT INTO seasons (
        season_code, farmer_id, plot_id, crop_id, irrigation_method_type_id,
        season_type, season_year, sowing_date, expected_harvest_date, area_acres_snapshot,
        status, actual_yield_quantity, yield_value
      )
      VALUES ('S-P2-NO-YIELD', $1, $2, $3, $4, 'kharif', 2026, '2026-06-01', '2026-06-10', 1.0, 'active', NULL, NULL)
      RETURNING id`,
      [farmerId, plotId, cropId, methodId]
    );
    const seasonId = sRes.rows[0].id;

    await db.query(
      `INSERT INTO season_daily_water_balance (
        season_id, record_date, das, crop_stage_name, stage_kc, et0_mm, etc_mm,
        rainfall_mm, effective_rainfall_mm, irrigation_applied_mm, irrigation_applied_litres
      )
      VALUES ($1, '2026-06-01', 1, 'Vegetative', 1.0, 10.0, 10.0, 0, 0, 10.0, 40468.6)`,
      [seasonId]
    );

    const metrics = await analyticsService.recalculateSeasonWaterMetrics(seasonId);

    expect(metrics.waterProductivityKgPerM3).toBeNull();
  });

  it('5. Valid yield with unit conversion: calculates water productivity in kg/m3 correctly', async () => {
    // 25 Quintals = 2,500 kg. Applied water = 1,000 m3 -> Productivity = 2.500 kg/m3
    const sRes = await db.query(
      `INSERT INTO seasons (
        season_code, farmer_id, plot_id, crop_id, irrigation_method_type_id,
        season_type, season_year, sowing_date, expected_harvest_date, area_acres_snapshot,
        status, actual_yield_quantity, actual_yield_unit
      )
      VALUES ('S-P2-YIELD-PROD', $1, $2, $3, $4, 'kharif', 2026, '2026-06-01', '2026-06-10', 1.0, 'active', 25.0, 'quintal')
      RETURNING id`,
      [farmerId, plotId, cropId, methodId]
    );
    const seasonId = sRes.rows[0].id;

    await db.query(
      `INSERT INTO season_daily_water_balance (
        season_id, record_date, das, crop_stage_name, stage_kc, et0_mm, etc_mm,
        rainfall_mm, effective_rainfall_mm, irrigation_applied_mm, irrigation_applied_litres
      )
      VALUES ($1, '2026-06-01', 1, 'Vegetative', 1.0, 10.0, 10.0, 0, 0, 247.11, 1000000.0)`,
      [seasonId]
    );

    const metrics = await analyticsService.recalculateSeasonWaterMetrics(seasonId);

    expect(metrics.totalAppliedM3).toBe(1000);
    expect(metrics.waterProductivityKgPerM3).toBe(2.5); // 2500 kg / 1000 m3
  });

  it('6. Missing pricing: net profit returns null when sale price or expense is absent', async () => {
    const sRes = await db.query(
      `INSERT INTO seasons (
        season_code, farmer_id, plot_id, crop_id, irrigation_method_type_id,
        season_type, season_year, sowing_date, expected_harvest_date, area_acres_snapshot,
        status, actual_yield_quantity, actual_yield_unit, crop_sale_price_per_unit, cultivation_expense_inr
      )
      VALUES ('S-P2-NO-PRICE', $1, $2, $3, $4, 'kharif', 2026, '2026-06-01', '2026-06-10', 1.0, 'active', 1000.0, 'kg', NULL, NULL)
      RETURNING id`,
      [farmerId, plotId, cropId, methodId]
    );
    const seasonId = sRes.rows[0].id;

    await db.query(
      `INSERT INTO season_daily_water_balance (
        season_id, record_date, das, crop_stage_name, stage_kc, et0_mm, etc_mm,
        rainfall_mm, effective_rainfall_mm, irrigation_applied_mm, irrigation_applied_litres
      )
      VALUES ($1, '2026-06-01', 1, 'Vegetative', 1.0, 10.0, 10.0, 0, 0, 10.0, 40000.0)`,
      [seasonId]
    );

    const metrics = await analyticsService.recalculateSeasonWaterMetrics(seasonId);

    expect(metrics.netProfitInr).toBeNull();
  });

  it('7. Complete economic calculation: computes net profit when yield, price, and expense exist', async () => {
    // 2,000 kg yield * 25 INR/kg = 50,000 INR revenue - 30,000 INR expense = 20,000 INR profit
    const sRes = await db.query(
      `INSERT INTO seasons (
        season_code, farmer_id, plot_id, crop_id, irrigation_method_type_id,
        season_type, season_year, sowing_date, expected_harvest_date, area_acres_snapshot,
        status, actual_yield_quantity, actual_yield_unit, crop_sale_price_per_unit, cultivation_expense_inr
      )
      VALUES ('S-P2-PROFIT', $1, $2, $3, $4, 'kharif', 2026, '2026-06-01', '2026-06-10', 1.0, 'active', 2000.0, 'kg', 25.0, 30000.0)
      RETURNING id`,
      [farmerId, plotId, cropId, methodId]
    );
    const seasonId = sRes.rows[0].id;

    await db.query(
      `INSERT INTO season_daily_water_balance (
        season_id, record_date, das, crop_stage_name, stage_kc, et0_mm, etc_mm,
        rainfall_mm, effective_rainfall_mm, irrigation_applied_mm, irrigation_applied_litres
      )
      VALUES ($1, '2026-06-01', 1, 'Vegetative', 1.0, 10.0, 10.0, 0, 0, 10.0, 40000.0)`,
      [seasonId]
    );

    const metrics = await analyticsService.recalculateSeasonWaterMetrics(seasonId);

    expect(metrics.netProfitInr).toBe(20000.0);
  });

  it('8. Missing irrigation records: recalculates cleanly without errors, handles missing records safely', async () => {
    const sRes = await db.query(
      `INSERT INTO seasons (
        season_code, farmer_id, plot_id, crop_id, irrigation_method_type_id,
        season_type, season_year, sowing_date, expected_harvest_date, area_acres_snapshot, status
      )
      VALUES ('S-P2-NO-IRR-RECORDS', $1, $2, $3, $4, 'kharif', 2026, '2026-06-01', '2026-06-10', 1.0, 'active')
      RETURNING id`,
      [farmerId, plotId, cropId, methodId]
    );
    const seasonId = sRes.rows[0].id;

    // Recalculate without any daily records or irrigation records
    const metrics = await analyticsService.recalculateSeasonWaterMetrics(seasonId);

    expect(metrics.totalAppliedLitres).toBe(0);
    expect(metrics.totalAppliedM3).toBe(0);
    expect(metrics.totalAppliedMm).toBe(0);
    expect(metrics.waterSavedPercentage).toBeNull(); // 0 recommended water -> null
  });

  it('9. Dashboard KPIs: returns real call counts from attempts & schedule and distinguishes 0 usage from missing', async () => {
    // Insert a scheduled call and a completed attempt
    const qSetRes = await db.query(`SELECT id FROM call_question_sets LIMIT 1`);
    const qSetId = qSetRes.rows[0].id;

    const sRes = await db.query(`SELECT id FROM seasons WHERE season_code = 'S-P2-POS-SAVINGS'`);
    const sId = sRes.rows[0].id;

    const schedRes = await db.query(
      `INSERT INTO call_schedule (
        season_id, cycle_number, question_set_id, farmer_id, phone_e164,
        scheduled_date, due_window_start, due_window_end, status
      )
      VALUES ($1, 99, $2, $3, '+919876543210', '2026-06-01', '2026-06-01', '2026-06-05', 'scheduled')
      RETURNING id`,
      [sId, qSetId, farmerId]
    );
    const schedId = schedRes.rows[0].id;

    await db.query(
      `INSERT INTO call_attempts (
        call_schedule_id, attempt_number, provider, status, duration_seconds
      )
      VALUES ($1, 1, 'simulator', 'completed', 45)`,
      [schedId]
    );

    const res = await request(app)
      .get('/api/v1/analytics/dashboard')
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.data.callsCompleted).toBeGreaterThanOrEqual(1);
    expect(res.body.data.callsPending).toBeGreaterThanOrEqual(1);
    expect(res.body.data).toHaveProperty('hasIrrigationRecords');
    expect(res.body.data).toHaveProperty('waterRecordsCount');
  });
});
