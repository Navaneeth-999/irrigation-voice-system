import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { runMigrations } from '../scripts/migrate.js';
import { seedReferenceData } from '../scripts/seed-reference.js';
import { createAdminUser } from '../scripts/create-admin.js';
import { closeDatabase, db } from '../db/index.js';

let app: any;
let adminCookie: string;
let testVillageId: string;
let testCropId: string;
let testIrrigationMethodId: string;
let testWaterSourceTypeId: string;

let farmerId: string;
let plotId: string;
let seasonId: string;

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.ADMIN_BOOTSTRAP_PASSWORD = 'ChangeMeAdmin123!';
  await runMigrations();
  await seedReferenceData();
  await createAdminUser();
  app = createApp();

  // 1. Authenticate admin and change initial password
  const loginRes = await request(app)
    .post('/api/v1/auth/login')
    .set('X-Requested-With', 'XMLHttpRequest')
    .send({
      email: 'admin@csp-irrigation.org',
      password: 'ChangeMeAdmin123!',
    });
  adminCookie = loginRes.headers['set-cookie'][0];

  await request(app)
    .post('/api/v1/auth/change-password')
    .set('Cookie', adminCookie)
    .set('X-Requested-With', 'XMLHttpRequest')
    .send({
      currentPassword: 'ChangeMeAdmin123!',
      newPassword: 'NewAdminPassword456!',
    });

  // 2. Fetch reference IDs
  const vRes = await db.query('SELECT id FROM villages LIMIT 1');
  testVillageId = vRes.rows[0].id;

  const cRes = await db.query("SELECT id FROM crops WHERE name ILIKE '%Paddy%' LIMIT 1");
  testCropId = cRes.rows[0].id;

  const imRes = await db.query("SELECT id FROM irrigation_method_types WHERE code = 'flood' OR name ILIKE '%flood%' LIMIT 1");
  testIrrigationMethodId = imRes.rows[0].id;

  const wstRes = await db.query("SELECT id FROM water_source_types WHERE code = 'borewell' OR name ILIKE '%borewell%' LIMIT 1");
  testWaterSourceTypeId = wstRes.rows[0].id;

  // 3. Create test Farmer
  const fRes = await request(app)
    .post('/api/v1/farmers')
    .set('Cookie', adminCookie)
    .set('X-Requested-With', 'XMLHttpRequest')
    .send({
      full_name: 'Ramesh Reddy',
      phone: '+919876543210',
      village_id: testVillageId,
    });
  farmerId = fRes.body.data.id;

  // 4. Create test Plot with 2.50 acres and Borewell with 5 HP and 25000 L/hr
  const pRes = await request(app)
    .post('/api/v1/plots')
    .set('Cookie', adminCookie)
    .set('X-Requested-With', 'XMLHttpRequest')
    .send({
      farmer_id: farmerId,
      label: 'North Field 1',
      survey_number: 'SN-402',
      area_acres: 2.5,
      soil_type: 'clay_loam',
      tenure: 'owned',
      water_sources: [
        {
          water_source_type_id: testWaterSourceTypeId,
          is_primary: true,
          pump_hp: 5,
          discharge_lph: 25000,
        },
      ],
    });
  plotId = pRes.body.data.id;
});

afterAll(async () => {
  await closeDatabase();
});

describe('Phase 2: Seasons, Records, Feedback & Actions Tests', () => {
  describe('1. Season Creation, Snapshot Preservation & Draft Refresh', () => {
    it('creates season in draft and takes immutable snapshot of plot area and water sources', async () => {
      const res = await request(app)
        .post('/api/v1/seasons')
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          farmer_id: farmerId,
          plot_id: plotId,
          crop_id: testCropId,
          season_type: 'kharif',
          season_year: 2026,
          sowing_date: '2026-06-15',
          expected_harvest_date: '2026-10-25',
          irrigation_method_type_id: testIrrigationMethodId,
        });

      expect(res.status).toBe(201);
      const season = res.body.data;
      seasonId = season.id;
      expect(season.status).toBe('draft');
      expect(parseFloat(season.area_acres_snapshot)).toBe(2.5);

      // Verify water source snapshots
      const getRes = await request(app).get(`/api/v1/seasons/${seasonId}`).set('Cookie', adminCookie);
      const waterSources = getRes.body.data.water_sources_snapshot;
      expect(waterSources).toHaveLength(1);
      expect(parseFloat(waterSources[0].pump_hp_snapshot)).toBe(5);
      expect(parseFloat(waterSources[0].discharge_lph_snapshot)).toBe(25000);
    });

    it('refreshes draft snapshot when plot attributes change before activation', async () => {
      // Modify plot area to 3.0 acres
      await request(app)
        .patch(`/api/v1/plots/${plotId}`)
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          label: 'North Field 1 Expanded',
          area_acres: 3.0,
        });

      // Season before refresh should still be 2.5
      let seasonRes = await request(app).get(`/api/v1/seasons/${seasonId}`).set('Cookie', adminCookie);
      expect(parseFloat(seasonRes.body.data.area_acres_snapshot)).toBe(2.5);

      // Trigger draft refresh
      const refreshRes = await request(app)
        .post(`/api/v1/seasons/${seasonId}/refresh-draft`)
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest');

      expect(refreshRes.status).toBe(200);

      const refreshedSeasonRes = await request(app).get(`/api/v1/seasons/${seasonId}`).set('Cookie', adminCookie);
      expect(parseFloat(refreshedSeasonRes.body.data.area_acres_snapshot)).toBe(3.0);
    });

    it('activates season and permanently freezes snapshot', async () => {
      const activateRes = await request(app)
        .post(`/api/v1/seasons/${seasonId}/activate`)
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest');

      expect(activateRes.status).toBe(200);
      expect(activateRes.body.data.status).toBe('active');
    });

    it('CRITICAL: mutating plot after activation does NOT alter season snapshot', async () => {
      // Mutate the live plot to 5.0 acres
      await request(app)
        .patch(`/api/v1/plots/${plotId}`)
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          label: 'North Field Mutated',
          area_acres: 5.0,
        });

      // Verify the active season snapshot remains strictly frozen at 3.0 acres
      const seasonRes = await request(app).get(`/api/v1/seasons/${seasonId}`).set('Cookie', adminCookie);
      expect(parseFloat(seasonRes.body.data.area_acres_snapshot)).toBe(3.0);

      // Attempting to refresh draft snapshot on active season must be rejected
      const failRefreshRes = await request(app)
        .post(`/api/v1/seasons/${seasonId}/refresh-draft`)
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest');

      expect(failRefreshRes.status).toBe(400);
      expect(failRefreshRes.body.error.code).toBe('SNAPSHOT_FROZEN');
    });
  });

  describe('2. Irrigation Records & Estimation Calculation', () => {
    it('records manual irrigation event and calculates volume and depth with "estimated" measurement_type', async () => {
      const res = await request(app)
        .post('/api/v1/irrigation')
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          season_id: seasonId,
          period_start: '2026-06-20',
          period_end: '2026-06-20',
          event_count: 1,
          raw_value: 4.0, // 4 pump hours
          raw_unit: 'pump_hours',
          source: 'admin_entry',
        });

      expect(res.status).toBe(201);
      const record = res.body.data;
      expect(record.measurement_type).toBe('estimated');
      // 4 hours * 25000 L/hr = 100,000 L
      expect(parseFloat(record.estimated_volume_l)).toBe(100000);
      // Area = 3.0 acres = 3.0 * 4046.86 m2 = 12140.58 m2
      // Depth = 100000 L / 12140.58 m2 = 8.24 mm
      expect(parseFloat(record.estimated_depth_mm)).toBeCloseTo(8.24, 1);
      expect(record.calculation_method).toBe('pump_hours_x_discharge');
    });

    it('lists irrigation records for a season', async () => {
      const res = await request(app)
        .get(`/api/v1/irrigation?season_id=${seasonId}`)
        .set('Cookie', adminCookie);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data[0].season_id).toBe(seasonId);
    });
  });

  describe('3. Crop Progress Observations & Expected Stage Calculation', () => {
    it('records crop progress and evaluates expected stage from days after sowing', async () => {
      // Sowing date was 2026-06-15. Observation on 2026-06-30 is DAS 15
      const res = await request(app)
        .post('/api/v1/crop-progress')
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          season_id: seasonId,
          observed_on: '2026-06-30',
          condition: 'good',
          notes: 'Healthy tillering observed',
          source: 'field_visit',
        });

      expect(res.status).toBe(201);
      const progress = res.body.data;
      expect(progress.condition).toBe('good');
      expect(progress.expected_stage_id).toBeDefined();
    });

    it('lists crop progress observations for a season', async () => {
      const res = await request(app)
        .get(`/api/v1/crop-progress?season_id=${seasonId}`)
        .set('Cookie', adminCookie);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('4. Farmer Feedback Cycle & Atomic Action Generation', () => {
    it('atomically creates feedback, irrigation record, crop progress and action items', async () => {
      const feedbackPayload = {
        season_id: seasonId,
        cycle_number: 1,
        period_start: '2026-07-01',
        period_end: '2026-07-07',
        rainfall_class: 'light',
        irrigated: true,
        irrigation_count: 2,
        pump_hours: 6.0,
        crop_condition: 'average',
        stage_confirmed: true,
        water_problem: 'shortage',
        crop_problem: 'yellowing_drying',
        callback_requested: true,
        source: 'ivr',
        is_simulated: false,
      };

      const res = await request(app)
        .post('/api/v1/feedback')
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send(feedbackPayload);

      expect(res.status).toBe(201);
      expect(res.body.data.feedback).toBeDefined();
      expect(res.body.data.feedback.cycle_number).toBe(1);

      // Verify linked irrigation record was created
      expect(res.body.data.irrigationRecord).toBeDefined();
      // 6.0 pump hours * 25000 L/hr = 150,000 L
      expect(parseFloat(res.body.data.irrigationRecord.estimated_volume_l)).toBe(150000);
      expect(res.body.data.irrigationRecord.measurement_type).toBe('estimated');

      // Verify season transitioned to monitoring
      const seasonRes = await request(app).get(`/api/v1/seasons/${seasonId}`).set('Cookie', adminCookie);
      expect(seasonRes.body.data.status).toBe('monitoring');

      // Verify action items were created for water_shortage, crop_pest_disease, and callback_requested
      const actionsRes = await request(app)
        .get(`/api/v1/action-items?season_id=${seasonId}`)
        .set('Cookie', adminCookie);

      expect(actionsRes.status).toBe(200);
      const items = actionsRes.body.data;
      expect(items.length).toBe(3);

      const types = items.map((i: any) => i.type);
      expect(types).toContain('water_shortage');
      expect(types).toContain('crop_pest_disease');
      expect(types).toContain('callback_requested');
    });

    it('lists feedback history for the season', async () => {
      const res = await request(app)
        .get(`/api/v1/feedback?season_id=${seasonId}`)
        .set('Cookie', adminCookie);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].cycle_number).toBe(1);
    });
  });

  describe('5. Action Queue Management & Status Resolution', () => {
    let targetActionItemId: string;

    it('lists and filters action items by priority and status', async () => {
      const res = await request(app)
        .get('/api/v1/action-items?status=open&priority=high')
        .set('Cookie', adminCookie);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      targetActionItemId = res.body.data[0].id;
    });

    it('resolves an action item and records closed_at timestamp', async () => {
      const res = await request(app)
        .patch(`/api/v1/action-items/${targetActionItemId}`)
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          status: 'resolved',
          referral_note: 'Resolved after field volunteer visited and cleared clogged channel',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('resolved');
      expect(res.body.data.closed_at).toBeDefined();
      expect(res.body.data.closed_at).not.toBeNull();
    });
  });

  describe('6. Season Completion Flow & Timeline Aggregation', () => {
    it('completes season with harvest date and yield metrics', async () => {
      const res = await request(app)
        .post(`/api/v1/seasons/${seasonId}/complete`)
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          actual_harvest_date: '2026-10-25',
          yield_value: 6200,
          yield_unit: 'kg',
          harvest_notes: 'Successful harvest with good grain fill',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('completed');
      expect(parseFloat(res.body.data.yield_value)).toBe(6200);
      expect(res.body.data.actual_harvest_date).toMatch(/2026-10-25/);
    });

    it('retrieves comprehensive chronological timeline for the season', async () => {
      const res = await request(app)
        .get(`/api/v1/seasons/${seasonId}/timeline`)
        .set('Cookie', adminCookie);

      expect(res.status).toBe(200);
      const timeline = res.body.data.events;
      expect(timeline.length).toBeGreaterThanOrEqual(4);

      // Verify event types exist
      const eventTypes = timeline.map((e: any) => e.type);
      expect(eventTypes).toContain('sowing');
      expect(eventTypes).toContain('irrigation');
      expect(eventTypes).toContain('progress');
      expect(eventTypes).toContain('feedback');
      expect(eventTypes).toContain('harvest');

      // Verify chronological sorting
      for (let i = 0; i < timeline.length - 1; i++) {
        const d1 = new Date(timeline[i].date).getTime();
        const d2 = new Date(timeline[i + 1].date).getTime();
        expect(d1).toBeLessThanOrEqual(d2);
      }
    });
  });
});
