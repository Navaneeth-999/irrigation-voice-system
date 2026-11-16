import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import twilio from 'twilio';
import bcrypt from 'bcryptjs';
import { createApp } from '../app.js';
import { runMigrations } from '../scripts/migrate.js';
import { seedReferenceData } from '../scripts/seed-reference.js';
import { createAdminUser } from '../scripts/create-admin.js';
import { db, closeDatabase } from '../db/index.js';
import { CallFlowEngine } from '../modules/telephony/CallFlowEngine.js';
import {
  QUESTION_SPECS,
  QUESTION_OPTIONS,
  buildPromptText,
} from '../modules/telephony/QuestionnaireConfig.js';
import { TelephonyService } from '../modules/telephony/service.js';
import { TwilioAdapter } from '../modules/telephony/adapters/TwilioAdapter.js';

describe('Phase 3: Telephony, Voice Flow, State Machine & Simulator Tests', () => {
  let app: any;
  let adminCookie: string;
  let adminUserId: string;
  let viewerCookie: string;
  let demoSeasonId: string;
  let demoFarmerId: string;
  let demoScheduleId: string;
  let realFarmerId: string;
  let realSeasonId: string;
  let sourceTypeId: string;
  let methodId: string;
  let cropId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.ADMIN_BOOTSTRAP_PASSWORD = 'ChangeMeAdmin123!';
    process.env.ALLOW_UNREVIEWED_PROMPTS = 'false';
    process.env.TWILIO_AUTH_TOKEN = 'test_twilio_secret_token_12345';

    await runMigrations();
    await seedReferenceData();
    await createAdminUser();
    app = createApp();

    // 1. Authenticate admin (handle both fresh seed and re-runs)
    let loginRes = await request(app)
      .post('/api/v1/auth/login')
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({
        email: 'admin@csp-irrigation.org',
        password: 'NewAdminPassword456!',
      });

    if (loginRes.status !== 200) {
      loginRes = await request(app)
        .post('/api/v1/auth/login')
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          email: 'admin@csp-irrigation.org',
          password: 'ChangeMeAdmin123!',
        });
    }

    const cookies = loginRes.headers['set-cookie'];
    adminCookie = Array.isArray(cookies) ? cookies.join('; ') : (cookies || '');

    const userRes = await db.query("SELECT id FROM users WHERE email = 'admin@csp-irrigation.org'");
    adminUserId = userRes.rows[0].id;

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

    // 2. Reference data IDs
    const villageRes = await db.query('SELECT id FROM villages LIMIT 1');
    const villageId = villageRes.rows[0].id;
    const cropRes = await db.query("SELECT id FROM crops WHERE name LIKE 'Paddy%' LIMIT 1");
    cropId = cropRes.rows[0].id;
    const methodRes = await db.query('SELECT id FROM irrigation_method_types LIMIT 1');
    methodId = methodRes.rows[0].id;
    const sourceRes = await db.query("SELECT id FROM water_source_types WHERE code = 'borewell' LIMIT 1");
    sourceTypeId = sourceRes.rows[0].id;

    // Create a regular non-admin user (AGRI_PANCHAYAT) for RBAC testing
    const viewerPasswordHash = await bcrypt.hash('ViewerPassword123!', 10);
    await db.query(`
      INSERT INTO users (email, password_hash, name, role, is_active, must_change_password)
      VALUES ('viewer@csp-test.org', $1, 'Viewer Official', 'AGRI_PANCHAYAT', true, false)
      ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
    `, [viewerPasswordHash]);

    const viewerLogin = await request(app)
      .post('/api/v1/auth/login')
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({
        email: 'viewer@csp-test.org',
        password: 'ViewerPassword123!',
      });
    viewerCookie = viewerLogin.headers['set-cookie']?.[0] || '';

    // Clean up test farmers from any previous runs
    const existingP3 = await db.query(`SELECT id FROM farmers WHERE farmer_code IN ('F-REAL-P3', 'F-DEMO-P3')`);
    for (const f of existingP3.rows) {
      const seasons = await db.query(`SELECT id FROM seasons WHERE farmer_id = $1`, [f.id]);
      for (const s of seasons.rows) {
        await db.query(`DELETE FROM call_schedule WHERE season_id = $1`, [s.id]);
        await db.query(`DELETE FROM action_items WHERE season_id = $1`, [s.id]);
        await db.query(`DELETE FROM irrigation_records WHERE season_id = $1`, [s.id]);
        await db.query(`DELETE FROM farmer_feedback WHERE season_id = $1`, [s.id]);
        await db.query(`DELETE FROM crop_progress WHERE season_id = $1`, [s.id]);
        await db.query(`DELETE FROM seasons WHERE id = $1`, [s.id]);
      }
      await db.query(`DELETE FROM plots WHERE farmer_id = $1`, [f.id]);
      await db.query(`DELETE FROM consents WHERE farmer_id = $1`, [f.id]);
      await db.query(`DELETE FROM farmer_contacts WHERE farmer_id = $1`, [f.id]);
      await db.query(`DELETE FROM farmers WHERE id = $1`, [f.id]);
    }

    // 3. Real farmer (for gating test)
    const realFarmerRes = await db.query(`
      INSERT INTO farmers (farmer_code, full_name, village_id, status, data_origin)
      VALUES ('F-REAL-P3', 'Real Farmer Rao', $1, 'active', 'real')
      RETURNING id
    `, [villageId]);
    realFarmerId = realFarmerRes.rows[0].id;

    const realPlotRes = await db.query(`
      INSERT INTO plots (farmer_id, label, area_acres, survey_number, is_active)
      VALUES ($1, 'Real Field', 3.0, 'SN-REAL-101', true)
      RETURNING id
    `, [realFarmerId]);
    const realPlotId = realPlotRes.rows[0].id;

    await db.query(`
      INSERT INTO plot_water_sources (plot_id, water_source_type_id, pump_hp, discharge_lph, is_primary)
      VALUES ($1, $2, 5.0, 36000, true)
    `, [realPlotId, sourceTypeId]);

    const realSeasonRes = await request(app)
      .post('/api/v1/seasons')
      .set('Cookie', adminCookie)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({
        farmer_id: realFarmerId,
        plot_id: realPlotId,
        season_type: 'kharif',
        season_year: 2026,
        crop_id: cropId,
        sowing_date: '2026-06-01',
        expected_harvest_date: '2026-10-01',
        irrigation_method_type_id: methodId,
        data_origin: 'real',
      });
    realSeasonId = realSeasonRes.body.data.id;

    // 4. Demo farmer (for simulator tests)
    const demoFarmerRes = await db.query(`
      INSERT INTO farmers (farmer_code, full_name, village_id, status, data_origin)
      VALUES ('F-DEMO-P3', 'Demo Farmer Krishna', $1, 'active', 'demo')
      RETURNING id
    `, [villageId]);
    demoFarmerId = demoFarmerRes.rows[0].id;

    await db.query(`
      INSERT INTO farmer_contacts (farmer_id, phone_e164, type, is_active)
      VALUES ($1, '+919876543210', 'primary', true)
    `, [demoFarmerId]);

    const demoPlotRes = await db.query(`
      INSERT INTO plots (farmer_id, label, area_acres, survey_number, is_active)
      VALUES ($1, 'Demo Field Plot', 2.5, 'SN-DEMO-202', true)
      RETURNING id
    `, [demoFarmerId]);
    const demoPlotId = demoPlotRes.rows[0].id;

    await db.query(`
      INSERT INTO plot_water_sources (plot_id, water_source_type_id, pump_hp, discharge_lph, is_primary)
      VALUES ($1, $2, 5.0, 36000, true)
    `, [demoPlotId, sourceTypeId]);

    const demoSeasonRes = await request(app)
      .post('/api/v1/seasons')
      .set('Cookie', adminCookie)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({
        farmer_id: demoFarmerId,
        plot_id: demoPlotId,
        season_type: 'kharif',
        season_year: 2026,
        crop_id: cropId,
        sowing_date: '2026-06-01',
        expected_harvest_date: '2026-10-01',
        irrigation_method_type_id: methodId,
        data_origin: 'demo',
      });
    demoSeasonId = demoSeasonRes.body.data.id;

    // Activate demo season (triggers automated fortnightly call scheduling)
    await request(app)
      .post(`/api/v1/seasons/${demoSeasonId}/activate`)
      .set('Cookie', adminCookie)
      .set('X-Requested-With', 'XMLHttpRequest');

    const schRes = await db.query(
      'SELECT id FROM call_schedule WHERE season_id = $1 ORDER BY cycle_number ASC LIMIT 1',
      [demoSeasonId]
    );
    demoScheduleId = schRes.rows[0]?.id;
  });

  afterAll(async () => {
    await closeDatabase();
  });

  // =========================================================================
  // 1. SINGLE SOURCE OF TRUTH: OPTION TABLES & PROMPT TEXT AGREEMENT
  // =========================================================================
  describe('1. Single Source of Truth & Option-Prompt Agreement', () => {
    it('verifies all option tables use strictly 1-based digit mappings (no 0)', () => {
      for (const [key, options] of Object.entries(QUESTION_OPTIONS)) {
        for (const opt of options) {
          expect(opt.digit).not.toBe('0');
          expect(['1', '2', '3', '4', '5']).toContain(opt.digit);
          expect(opt.labelTe).toBeDefined();
          expect(opt.labelEn).toBeDefined();
        }
      }
    });

    it('verifies buildPromptText includes every option label and repeat key in Telugu and English', () => {
      for (const [code, options] of Object.entries(QUESTION_OPTIONS)) {
        const spec = Object.values(QUESTION_SPECS).find(s => s.code === code);
        expect(spec).toBeDefined();

        const { teluguText, englishText } = buildPromptText(
          spec!.basePromptTe,
          spec!.basePromptEn,
          spec!.options,
          spec!.repeatKey
        );

        for (const opt of options) {
          expect(teluguText).toContain(opt.labelTe);
          expect(englishText).toContain(opt.labelEn);
        }
        expect(teluguText).toContain(spec!.repeatKey);
        expect(englishText).toContain(spec!.repeatKey);
      }
    });

    it('verifies parser validates and parses all 1-based options', () => {
      // Rain: 1=none, 2=light, 3=moderate, 4=heavy
      const rainSpec = QUESTION_SPECS[2];
      expect(CallFlowEngine['validateAndParse'](rainSpec, '1').parsedValue).toBe('none');
      expect(CallFlowEngine['validateAndParse'](rainSpec, '2').parsedValue).toBe('light');
      expect(CallFlowEngine['validateAndParse'](rainSpec, '3').parsedValue).toBe('moderate');
      expect(CallFlowEngine['validateAndParse'](rainSpec, '4').parsedValue).toBe('heavy');
      expect(CallFlowEngine['validateAndParse'](rainSpec, '0').isValid).toBe(false);

      // Water Problem: 1=none, 2=shortage, 3=pump_power, 4=source_unavailable
      const waterSpec = QUESTION_SPECS[8];
      expect(CallFlowEngine['validateAndParse'](waterSpec, '1').parsedValue).toBe('none');
      expect(CallFlowEngine['validateAndParse'](waterSpec, '2').parsedValue).toBe('shortage');
      expect(CallFlowEngine['validateAndParse'](waterSpec, '3').parsedValue).toBe('pump_power');
      expect(CallFlowEngine['validateAndParse'](waterSpec, '4').parsedValue).toBe('source_unavailable');
      expect(CallFlowEngine['validateAndParse'](waterSpec, '0').isValid).toBe(false);

      // Crop Problem: 1=none, 2=pests_disease, 3=yellowing_drying, 4=other
      const cropSpec = QUESTION_SPECS[9];
      expect(CallFlowEngine['validateAndParse'](cropSpec, '1').parsedValue).toBe('none');
      expect(CallFlowEngine['validateAndParse'](cropSpec, '2').parsedValue).toBe('pests_disease');
      expect(CallFlowEngine['validateAndParse'](cropSpec, '3').parsedValue).toBe('yellowing_drying');
      expect(CallFlowEngine['validateAndParse'](cropSpec, '4').parsedValue).toBe('other');
      expect(CallFlowEngine['validateAndParse'](cropSpec, '0').isValid).toBe(false);
    });

    it('verifies "count" (1-2 digits + #) and "hours" (1-3 digits + #, total running hours) validation', () => {
      const countSpec = QUESTION_SPECS[4];
      expect(CallFlowEngine['validateAndParse'](countSpec, '3').isValid).toBe(true);
      expect(CallFlowEngine['validateAndParse'](countSpec, '3#').isValid).toBe(true);
      expect(CallFlowEngine['validateAndParse'](countSpec, '15#').parsedValue).toBe(15);
      expect(CallFlowEngine['validateAndParse'](countSpec, '35#').isValid).toBe(false); // exceeds 30

      const hoursSpec = QUESTION_SPECS[5];
      expect(CallFlowEngine['validateAndParse'](hoursSpec, '6#').parsedValue).toBe(6);
      expect(CallFlowEngine['validateAndParse'](hoursSpec, '120#').parsedValue).toBe(120);
      expect(CallFlowEngine['validateAndParse'](hoursSpec, '999#').parsedValue).toBe(999);
      expect(CallFlowEngine['validateAndParse'](hoursSpec, '1000#').isValid).toBe(false); // max 999
    });
  });

  // =========================================================================
  // 2. PURE STATE MACHINE: FLOW, BRANCHING & SEMANTICS
  // =========================================================================
  describe('2. Pure State Machine Flow & Branching', () => {
    it('initializes session at Step 1 with Telugu intro prompt', () => {
      const { action, state } = CallFlowEngine.initSession({
        sessionId: 'test-session-1',
        phoneE164: '+919876543210',
        provider: 'simulator',
      });

      expect(state.currentStep).toBe(1);
      expect(action.promptCode).toBe('prompt_intro_te');
      expect(action.type).toBe('PLAY_AND_GATHER');
      expect(action.teluguText).toContain('నమస్కారం');
    });

    it('repeats the question when * is pressed', () => {
      const { state } = CallFlowEngine.initSession({
        sessionId: 'test-repeat',
        phoneE164: '+919876543210',
        provider: 'simulator',
      });

      CallFlowEngine.handleInput(state, '1'); // to step 2 (rain)
      expect(state.currentStep).toBe(2);

      const action = CallFlowEngine.handleInput(state, '*');
      expect(state.currentStep).toBe(2);
      expect(action.promptCode).toBe('prompt_rain_te');
    });

    it('BRANCHING RULE 1: If Question 3 (irrigated) is 2 (No), skips count & hours directly to Question 6', () => {
      const { state } = CallFlowEngine.initSession({
        sessionId: 'test-skip-branching',
        phoneE164: '+919876543210',
        provider: 'simulator',
      });

      CallFlowEngine.handleInput(state, '1'); // Step 1: Intro -> 1
      CallFlowEngine.handleInput(state, '1'); // Step 2: Rain -> 1 (none)
      expect(state.currentStep).toBe(3);

      const action = CallFlowEngine.handleInput(state, '2'); // Step 3: Irrigated? -> 2 (NO)
      expect(state.currentStep).toBe(6);
      expect(action.promptCode).toBe('prompt_crop_condition_te');
      expect(state.responses['irrigation_count'].skipped).toBe(true);
      expect(state.responses['hours'].skipped).toBe(true);
    });

    it('BRANCHING RULE 2: If Question 7 (stage) is 2 (Different), branches to Sub-step 72 for stage selection', () => {
      const { state } = CallFlowEngine.initSession({
        sessionId: 'test-stage-branching',
        phoneE164: '+919876543210',
        provider: 'simulator',
      });

      CallFlowEngine.handleInput(state, '1'); // 1. Intro
      CallFlowEngine.handleInput(state, '1'); // 2. Rain
      CallFlowEngine.handleInput(state, '2'); // 3. Irrigated? -> No (skips to 6)
      CallFlowEngine.handleInput(state, '1'); // 6. Condition -> Good
      expect(state.currentStep).toBe(7);

      // Press 2 on stage confirmation: "2 = different"
      const action72 = CallFlowEngine.handleInput(state, '2');
      expect(state.currentStep).toBe(72);
      expect(action72.promptCode).toBe('prompt_reported_stage_select_te');
      expect(action72.teluguText).toContain('దశను ఎంచుకోండి');

      // Farmer selects stage 2 (tillering)
      const action8 = CallFlowEngine.handleInput(state, '2');
      expect(state.responses['reported_stage_select'].parsedValue).toBe('tillering_vegetative');
      expect(state.currentStep).toBe(8); // Advances to water problem
      expect(action8.promptCode).toBe('prompt_water_problem_te');
    });

    it('CRITICAL: 9 pressed on Question 5 (hours) represents 9 total pump hours, NEVER an opt-out', () => {
      const { state } = CallFlowEngine.initSession({
        sessionId: 'test-hours-not-optout',
        phoneE164: '+919876543210',
        provider: 'simulator',
      });

      CallFlowEngine.handleInput(state, '1'); // intro
      CallFlowEngine.handleInput(state, '2'); // rain
      CallFlowEngine.handleInput(state, '1'); // irrigated: yes
      CallFlowEngine.handleInput(state, '2#'); // count: 2
      expect(state.currentStep).toBe(5);

      // Press 9# for 9 pump hours
      const action = CallFlowEngine.handleInput(state, '9#');
      expect(state.isOptedOut).toBe(false);
      expect(state.currentStep).toBe(6);
      expect(state.responses['hours'].parsedValue).toBe(9);
      expect(action.promptCode).toBe('prompt_crop_condition_te');
    });

    it('QUESTION 11 (Voice Note): supports voice recording and skip with digit 1', () => {
      const { state } = CallFlowEngine.initSession({
        sessionId: 'test-voice-note',
        phoneE164: '+919876543210',
        provider: 'simulator',
      });

      CallFlowEngine.handleInput(state, '1'); // 1. Intro
      CallFlowEngine.handleInput(state, '1'); // 2. Rain
      CallFlowEngine.handleInput(state, '2'); // 3. Irrigated? No -> 6
      CallFlowEngine.handleInput(state, '1'); // 6. Condition
      CallFlowEngine.handleInput(state, '1'); // 7. Stage confirmed
      CallFlowEngine.handleInput(state, '1'); // 8. Water problem
      CallFlowEngine.handleInput(state, '1'); // 9. Crop problem
      const act10 = CallFlowEngine.handleInput(state, '1'); // 10. Callback requested -> Yes

      // Must advance to Question 11 (voice note)
      expect(state.currentStep).toBe(11);
      expect(act10.promptCode).toBe('prompt_voice_note_te');
      expect(act10.expectedInputType).toBe('voice_recording');

      // Farmer presses 1 to skip voice note
      const act99 = CallFlowEngine.handleInput(state, '1');
      expect(state.currentStep).toBe(99); // Goodbye
      expect(act99.promptCode).toBe('prompt_goodbye_te');

      // Final hangup
      const termAct = CallFlowEngine.handleInput(state, '1');
      expect(termAct.type).toBe('TERMINATE');
      expect(state.isCompleted).toBe(true);
    });
  });

  // =========================================================================
  // 3. SAFETY GATING & AUDIO PROMPT REVIEW WORKFLOW
  // =========================================================================
  describe('3. Safety Gating & Audio Review Workflow', () => {
    it('TwilioAdapter rejects calls if unapproved prompt exists and ALLOW_UNREVIEWED_PROMPTS is false', async () => {
      const adapter = new TwilioAdapter();

      await db.query(`
        INSERT INTO audio_prompts (prompt_code, language_code, text_content, english_meaning, review_status)
        VALUES ('test_unapproved_prompt_te', 'te', 'పరీక్ష', 'Test', 'draft')
        ON CONFLICT (prompt_code) DO UPDATE SET review_status = 'draft'
      `);

      process.env.ALLOW_UNREVIEWED_PROMPTS = 'false';

      await expect(
        adapter.assertApprovedPrompts(['test_unapproved_prompt_te'])
      ).rejects.toThrow('AUDIO_PROMPT_NOT_APPROVED');
    });

    it('approves audio prompt via review endpoint and records reviewer user ID and timestamp', async () => {
      const res = await request(app)
        .post('/api/v1/telephony/prompts/test_unapproved_prompt_te/review')
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          status: 'approved',
          notes: 'Reviewed and certified by senior CSP agronomist.',
        });

      expect(res.status).toBe(200);
      expect(res.body.review_status).toBe('approved');
      expect(res.body.reviewed_by).toBe(adminUserId);
      expect(res.body.reviewed_at).toBeDefined();

      const adapter = new TwilioAdapter();
      await expect(
        adapter.assertApprovedPrompts(['test_unapproved_prompt_te'])
      ).resolves.not.toThrow();
    });

    it('enforces RBAC: non-admin/non-CSP member cannot review audio prompts', async () => {
      // Unauthenticated request receives 401
      const resUnauth = await request(app)
        .post('/api/v1/telephony/prompts/test_unapproved_prompt_te/review')
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ status: 'approved' });
      expect(resUnauth.status).toBe(401);

      // Authenticated as AGRI_PANCHAYAT receives 403 Forbidden
      const resForbidden = await request(app)
        .post('/api/v1/telephony/prompts/test_unapproved_prompt_te/review')
        .set('Cookie', viewerCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ status: 'approved' });
      expect(resForbidden.status).toBe(403);
    });
  });

  // =========================================================================
  // 4. SIMULATOR DEMO RESTRICTION & DOWNSTREAM RECORD CREATION
  // =========================================================================
  describe('4. Simulator Demo Restriction & Downstream Records', () => {
    let simSessionId: string;

    it('RESTRICTION: rejects interactive simulator on real farmer with 403 SIMULATOR_DEMO_ONLY', async () => {
      const res = await request(app)
        .post('/api/v1/telephony/simulator/start')
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          seasonId: realSeasonId,
          farmerId: realFarmerId,
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('SIMULATOR_DEMO_ONLY');
    });

    it('starts interactive simulator call for demo farmer and completes full survey', async () => {
      const startRes = await request(app)
        .post('/api/v1/telephony/simulator/start')
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          scheduleId: demoScheduleId,
          seasonId: demoSeasonId,
          farmerId: demoFarmerId,
        });

      expect(startRes.status).toBe(200);
      expect(startRes.body.sessionId).toBeDefined();
      simSessionId = startRes.body.sessionId;

      // 1. Intro -> 1 (continue)
      await request(app)
        .post('/api/v1/telephony/simulator/dtmf')
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ sessionId: simSessionId, digits: '1' });

      // 2. Rain -> 2 (light)
      await request(app)
        .post('/api/v1/telephony/simulator/dtmf')
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ sessionId: simSessionId, digits: '2' });

      // 3. Irrigated? -> 1 (yes)
      await request(app)
        .post('/api/v1/telephony/simulator/dtmf')
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ sessionId: simSessionId, digits: '1' });

      // 4. Count -> 2# (2 irrigations)
      await request(app)
        .post('/api/v1/telephony/simulator/dtmf')
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ sessionId: simSessionId, digits: '2#' });

      // 5. Total Hours -> 6# (6 total running pump hours for the fortnight)
      await request(app)
        .post('/api/v1/telephony/simulator/dtmf')
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ sessionId: simSessionId, digits: '6#' });

      // 6. Crop Condition -> 2 (average)
      await request(app)
        .post('/api/v1/telephony/simulator/dtmf')
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ sessionId: simSessionId, digits: '2' });

      // 7. Stage Confirmation -> 1 (confirmed)
      await request(app)
        .post('/api/v1/telephony/simulator/dtmf')
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ sessionId: simSessionId, digits: '1' });

      // 8. Water Problem -> 2 (shortage)
      await request(app)
        .post('/api/v1/telephony/simulator/dtmf')
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ sessionId: simSessionId, digits: '2' });

      // 9. Crop Problem -> 1 (none)
      await request(app)
        .post('/api/v1/telephony/simulator/dtmf')
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ sessionId: simSessionId, digits: '1' });

      // 10. Callback Requested -> 1 (yes)
      await request(app)
        .post('/api/v1/telephony/simulator/dtmf')
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ sessionId: simSessionId, digits: '1' });

      // 11. Voice Note -> 1 (skip)
      await request(app)
        .post('/api/v1/telephony/simulator/dtmf')
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ sessionId: simSessionId, digits: '1' });

      // 99. Goodbye -> 1 (hangup)
      const finalRes = await request(app)
        .post('/api/v1/telephony/simulator/dtmf')
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ sessionId: simSessionId, digits: '1' });

      expect(finalRes.status).toBe(200);
      expect(finalRes.body.action.type).toBe('TERMINATE');
    });

    it('verifies call completion created farmer_feedback with source=simulator and is_simulated=true', async () => {
      const fbRes = await db.query(
        'SELECT * FROM farmer_feedback WHERE season_id = $1 AND cycle_number = 1',
        [demoSeasonId]
      );

      expect(fbRes.rows.length).toBe(1);
      const fb = fbRes.rows[0];
      expect(fb.source).toBe('simulator');
      expect(fb.is_simulated).toBe(true);
      expect(fb.rainfall_class).toBe('light');
      expect(fb.irrigated).toBe(true);
      expect(fb.irrigation_count).toBe(2);
      expect(Number(fb.pump_hours)).toBe(6); // Total pump hours
      expect(fb.water_problem).toBe('shortage');
      expect(fb.callback_requested).toBe(true);
    });

    it('verifies call completion created irrigation_record with volume = total_hours x discharge', async () => {
      const irRes = await db.query(
        'SELECT * FROM irrigation_records WHERE season_id = $1 ORDER BY created_at DESC LIMIT 1',
        [demoSeasonId]
      );

      expect(irRes.rows.length).toBe(1);
      const ir = irRes.rows[0];
      expect(ir.measurement_type).toBe('estimated');
      expect(ir.raw_unit).toBe('pump_hours');
      expect(Number(ir.raw_value)).toBe(6); // Total pump hours
      // Volume = 6 hours * 36,000 L/h = 216,000 Litres
      expect(Number(ir.estimated_volume_l)).toBe(216000);
      expect(ir.calculation_method).toBe('pump_hours_x_discharge');
    });

    it('verifies call completion generated deduplicated action items for water shortage and callback', async () => {
      const actRes = await db.query(
        'SELECT * FROM action_items WHERE season_id = $1',
        [demoSeasonId]
      );

      expect(actRes.rows.length).toBeGreaterThanOrEqual(2);
      const types = actRes.rows.map((a: any) => a.type);
      expect(types).toContain('water_shortage');
      expect(types).toContain('callback_requested');
    });

    it('verifies call_schedule was marked as completed', async () => {
      const schRes = await db.query(
        'SELECT status FROM call_schedule WHERE id = $1',
        [demoScheduleId]
      );
      expect(schRes.rows[0].status).toBe('completed');
    });
  });

  // =========================================================================
  // 5. OPT-OUT ON 9: CONSENT AUDIT & FUTURE SCHEDULE CANCELLATION
  // =========================================================================
  describe('5. Opt-Out on 9: Consent Audit & Cycle Cancellation', () => {
    it('pressing 9 at Intro records withdrawn consent in consents table and cancels future cycles', async () => {
      // 1. Create a farmer and active season with multiple scheduled cycles
      const villageRes = await db.query('SELECT id FROM villages LIMIT 1');
      const villageId = villageRes.rows[0].id;

      const optOutCode = `F-OPTOUT-${Date.now()}`;
      const fRes = await db.query(`
        INSERT INTO farmers (farmer_code, full_name, village_id, status, data_origin)
        VALUES ($1, 'Opt Out Farmer', $2, 'active', 'demo')
        RETURNING id
      `, [optOutCode, villageId]);
      const optOutFarmerId = fRes.rows[0].id;

      await db.query(`
        INSERT INTO farmer_contacts (farmer_id, phone_e164, type, is_active)
        VALUES ($1, '+919876543277', 'primary', true)
      `, [optOutFarmerId]);

      const plotRes = await db.query(`
        INSERT INTO plots (farmer_id, label, area_acres, is_active)
        VALUES ($1, 'Opt Out Plot', 2.0, true)
        RETURNING id
      `, [optOutFarmerId]);

      await db.query(`
        INSERT INTO plot_water_sources (plot_id, water_source_type_id, pump_hp, discharge_lph, is_primary)
        VALUES ($1, $2, 5.0, 36000, true)
      `, [plotRes.rows[0].id, sourceTypeId]);

      const sRes = await request(app)
        .post('/api/v1/seasons')
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          farmer_id: optOutFarmerId,
          plot_id: plotRes.rows[0].id,
          season_type: 'rabi',
          season_year: 2026,
          crop_id: cropId,
          sowing_date: '2026-10-01',
          expected_harvest_date: '2027-02-01',
          irrigation_method_type_id: methodId,
          data_origin: 'demo',
        });
      const optSeasonId = sRes.body.data.id;

      await request(app)
        .post(`/api/v1/seasons/${optSeasonId}/activate`)
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest');

      // Verify multiple cycles scheduled
      const schsRes = await db.query(
        'SELECT id, cycle_number, status FROM call_schedule WHERE season_id = $1 ORDER BY cycle_number ASC',
        [optSeasonId]
      );
      expect(schsRes.rows.length).toBeGreaterThan(1);
      const cycle1Id = schsRes.rows[0].id;

      // Start simulator call for cycle 1
      const startRes = await request(app)
        .post('/api/v1/telephony/simulator/start')
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          scheduleId: cycle1Id,
          seasonId: optSeasonId,
          farmerId: optOutFarmerId,
        });

      // Farmer presses 9 on intro
      const optOutRes = await request(app)
        .post('/api/v1/telephony/simulator/dtmf')
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ sessionId: startRes.body.sessionId, digits: '9' });

      expect(optOutRes.body.action.type).toBe('TERMINATE');
      expect(optOutRes.body.action.promptCode).toBe('prompt_opt_out_confirm_te');

      // Assert 1: Consent audit row inserted with status = 'withdrawn'
      const consentRes = await db.query(
        'SELECT * FROM consents WHERE farmer_id = $1 AND channel = $2',
        [optOutFarmerId, 'voice']
      );
      expect(consentRes.rows.length).toBe(1);
      expect(consentRes.rows[0].status).toBe('withdrawn');
      expect(consentRes.rows[0].method).toBe('ivr');

      // Assert 2: Current schedule marked as 'opted_out'
      const currentSch = await db.query('SELECT status FROM call_schedule WHERE id = $1', [cycle1Id]);
      expect(currentSch.rows[0].status).toBe('opted_out');

      // Assert 3: All future scheduled cycles marked as 'cancelled'
      const futureSchs = await db.query(
        'SELECT status FROM call_schedule WHERE season_id = $1 AND id != $2',
        [optSeasonId, cycle1Id]
      );
      for (const row of futureSchs.rows) {
        expect(row.status).toBe('cancelled');
      }
    });
  });

  // =========================================================================
  // 6. TWILIO SIGNATURE VERIFICATION & WEBHOOK IDEMPOTENCY
  // =========================================================================
  describe('6. Twilio Signature & Webhook Idempotency', () => {
    it('accepts valid Twilio cryptographic signature and rejects invalid signature with 403', async () => {
      const fullUrl = 'http://127.0.0.1/api/v1/webhooks/twilio/voice?scheduleId=';
      const params = { CallSid: 'CA_TEST_SIG_VALID', From: '+919876543210' };
      const authToken = 'test_twilio_secret_token_12345';
      process.env.TWILIO_AUTH_TOKEN = authToken;

      const validSignature = twilio.getExpectedTwilioSignature(authToken, fullUrl, params);

      // Request with valid signature
      const validRes = await request(app)
        .post('/api/v1/webhooks/twilio/voice?scheduleId=')
        .set('Host', '127.0.0.1')
        .set('X-Twilio-Signature', validSignature)
        .type('form')
        .send(params);
      expect(validRes.status).toBe(200);
      expect(validRes.text).toContain('<Response>');

      // Request with invalid signature
      const invalidRes = await request(app)
        .post('/api/v1/webhooks/twilio/voice?scheduleId=')
        .set('Host', '127.0.0.1')
        .set('X-Twilio-Signature', 'invalid_signature_xyz')
        .type('form')
        .send(params);
      expect(invalidRes.status).toBe(403);
      expect(invalidRes.text).toContain('Invalid Twilio Signature');
    });

    it('processes status callback and ensures idempotency prevents duplicate events', async () => {
      const eventId = `test-call-sid-${Date.now()}`;

      const res1 = await request(app)
        .post('/api/v1/webhooks/twilio/status')
        .send({
          CallSid: eventId,
          CallStatus: 'completed',
        });
      expect(res1.status).toBe(200);

      const res2 = await request(app)
        .post('/api/v1/webhooks/twilio/status')
        .send({
          CallSid: eventId,
          CallStatus: 'completed',
        });
      expect(res2.status).toBe(200);

      const countRes = await db.query(
        'SELECT COUNT(*) as count FROM provider_webhook_events WHERE event_id = $1',
        [`${eventId}-completed`]
      );
      expect(Number(countRes.rows[0].count)).toBe(1);
    });
  });

  // =========================================================================
  // 7. DISPATCH JOB CONSTRAINTS: CONSENT, DAILY CAP, RETRIES & CONSECUTIVE FAILURES
  // =========================================================================
  describe('7. Dispatch Job Constraints & Consecutive Failure Tracking', () => {
    it('dispatch job respects withdrawn consent and daily cap', async () => {
      const villageRes = await db.query('SELECT id FROM villages LIMIT 1');
      const villageId = villageRes.rows[0].id;
      const qSetRes = await db.query('SELECT id FROM call_question_sets LIMIT 1');
      const qSetId = qSetRes.rows[0].id;

      // Create farmer with withdrawn consent
      const noConsentCode = `F-NO-CONSENT-${Date.now()}`;
      const fNoConsent = await db.query(`
        INSERT INTO farmers (farmer_code, full_name, village_id, status, data_origin)
        VALUES ($1, 'No Consent Farmer', $2, 'active', 'demo')
        RETURNING id
      `, [noConsentCode, villageId]);
      const noConsentFarmerId = fNoConsent.rows[0].id;

      await db.query(`
        INSERT INTO consents (farmer_id, channel, status, method)
        VALUES ($1, 'voice', 'withdrawn', 'ivr')
      `, [noConsentFarmerId]);

      const schNoConsent = await db.query(`
        INSERT INTO call_schedule (
          season_id, cycle_number, question_set_id, farmer_id, phone_e164,
          scheduled_date, due_window_start, due_window_end, status
        )
        VALUES ($1, 101, $2, $3, '+919999000001', '2020-01-01', '2019-12-28', '2020-01-04', 'scheduled')
        RETURNING id
      `, [demoSeasonId, qSetId, noConsentFarmerId]);

      // Create farmer that already has an attempt today (daily cap)
      const cappedCode = `F-DAILY-CAPPED-${Date.now()}`;
      const fCapped = await db.query(`
        INSERT INTO farmers (farmer_code, full_name, village_id, status, data_origin)
        VALUES ($1, 'Daily Capped Farmer', $2, 'active', 'demo')
        RETURNING id
      `, [cappedCode, villageId]);
      const cappedFarmerId = fCapped.rows[0].id;

      const schCapped = await db.query(`
        INSERT INTO call_schedule (
          season_id, cycle_number, question_set_id, farmer_id, phone_e164,
          scheduled_date, due_window_start, due_window_end, status
        )
        VALUES ($1, 102, $2, $3, '+919999000002', '2020-01-01', '2019-12-28', '2020-01-04', 'scheduled')
        RETURNING id
      `, [demoSeasonId, qSetId, cappedFarmerId]);

      await db.query(`
        INSERT INTO call_attempts (
          call_schedule_id, attempt_number, provider, provider_call_sid, status, started_at
        )
        VALUES ($1, 1, 'simulator', 'ca-capped-today', 'no_answer', NOW())
      `, [schCapped.rows[0].id]);

      // Dispatch due calls
      const result = await TelephonyService.processDueCallSchedule({
        limit: 50,
        provider: 'simulator',
        bypassTimeWindow: true,
      });

      // Neither no-consent nor capped farmer should be dispatched
      const dispatchedScheduleIds = result.callsDispatched.map(c => c.scheduleId);
      expect(dispatchedScheduleIds).not.toContain(schNoConsent.rows[0].id);
      expect(dispatchedScheduleIds).not.toContain(schCapped.rows[0].id);
    });

    it('retries up to max_attempts, marks failed on final attempt, and creates repeated_missed_calls after two consecutive failed cycles', async () => {
      const villageRes = await db.query('SELECT id FROM villages LIMIT 1');
      const villageId = villageRes.rows[0].id;
      const qSetRes = await db.query('SELECT id FROM call_question_sets LIMIT 1');
      const qSetId = qSetRes.rows[0].id;

      const repeatedFailCode = `F-REPEATED-FAIL-${Date.now()}`;
      const fRes = await db.query(`
        INSERT INTO farmers (farmer_code, full_name, village_id, status, data_origin)
        VALUES ($1, 'Repeated Missed Farmer', $2, 'active', 'demo')
        RETURNING id
      `, [repeatedFailCode, villageId]);
      const testFarmerId = fRes.rows[0].id;

      const plotRes = await db.query(`
        INSERT INTO plots (farmer_id, label, area_acres, is_active)
        VALUES ($1, 'Fail Plot', 1.5, true)
        RETURNING id
      `, [testFarmerId]);

      await db.query(`
        INSERT INTO plot_water_sources (plot_id, water_source_type_id, pump_hp, discharge_lph, is_primary)
        VALUES ($1, $2, 5.0, 36000, true)
      `, [plotRes.rows[0].id, sourceTypeId]);

      const seasonRes = await request(app)
        .post('/api/v1/seasons')
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          farmer_id: testFarmerId,
          plot_id: plotRes.rows[0].id,
          season_type: 'kharif',
          season_year: 2026,
          crop_id: cropId,
          sowing_date: '2026-06-01',
          expected_harvest_date: '2026-10-01',
          irrigation_method_type_id: methodId,
          data_origin: 'demo',
        });
      const failSeasonId = seasonRes.body.data.id;

      // Cycle 1: Failed
      const c1Res = await db.query(`
        INSERT INTO call_schedule (
          season_id, cycle_number, question_set_id, farmer_id, phone_e164,
          scheduled_date, due_window_start, due_window_end, status, attempt_count, max_attempts
        )
        VALUES ($1, 1, $2, $3, '+919999000003', '2020-01-01', '2019-12-28', '2020-01-04', 'failed', 3, 3)
        RETURNING id
      `, [failSeasonId, qSetId, testFarmerId]);

      // Cycle 2: Attempt 1 failure -> status reverts to 'scheduled' for retry
      const c2Res = await db.query(`
        INSERT INTO call_schedule (
          season_id, cycle_number, question_set_id, farmer_id, phone_e164,
          scheduled_date, due_window_start, due_window_end, status, attempt_count, max_attempts
        )
        VALUES ($1, 2, $2, $3, '+919999000003', '2020-01-15', '2020-01-12', '2020-01-18', 'in_progress', 1, 3)
        RETURNING id
      `, [failSeasonId, qSetId, testFarmerId]);
      const c2Id = c2Res.rows[0].id;

      await TelephonyService.handleScheduleFailure(c2Id, 'no_answer');
      const c2AfterRetry = await db.query('SELECT status FROM call_schedule WHERE id = $1', [c2Id]);
      expect(c2AfterRetry.rows[0].status).toBe('scheduled'); // Re-queued for retry

      // Cycle 2: Final attempt (attempt_count = 3) failure -> status becomes 'failed'
      await db.query('UPDATE call_schedule SET attempt_count = 3, status = $1 WHERE id = $2', ['in_progress', c2Id]);
      await TelephonyService.handleScheduleFailure(c2Id, 'busy');

      const c2Final = await db.query('SELECT status FROM call_schedule WHERE id = $1', [c2Id]);
      expect(c2Final.rows[0].status).toBe('failed');

      // Check consecutive failure trigger: since Cycle 1 was failed and Cycle 2 failed, repeated_missed_calls action item must be created!
      const actionItemRes = await db.query(
        `SELECT * FROM action_items WHERE season_id = $1 AND type = 'repeated_missed_calls'`,
        [failSeasonId]
      );
      expect(actionItemRes.rows.length).toBe(1);
      expect(actionItemRes.rows[0].priority).toBe('high');
      expect(actionItemRes.rows[0].referral_note).toContain('unreachable across two consecutive call cycles');
    });
  });
});
