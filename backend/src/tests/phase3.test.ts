import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { runMigrations } from '../scripts/migrate.js';
import { seedReferenceData } from '../scripts/seed-reference.js';
import { createAdminUser } from '../scripts/create-admin.js';
import { db, closeDatabase } from '../db/index.js';
import { CallFlowEngine, QUESTION_DEFINITIONS, SYSTEM_PROMPTS } from '../modules/telephony/CallFlowEngine.js';
import { TelephonyService } from '../modules/telephony/service.js';
import { TwilioAdapter } from '../modules/telephony/adapters/TwilioAdapter.js';

describe('Phase 3: Telephony, Voice Flow, State Machine & Simulator Tests', () => {
  let app: any;
  let adminCookie: string;
  let testSeasonId: string;
  let testFarmerId: string;
  let testScheduleId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.ADMIN_BOOTSTRAP_PASSWORD = 'ChangeMeAdmin123!';
    process.env.ALLOW_UNREVIEWED_PROMPTS = 'false';

    await runMigrations();
    await seedReferenceData();
    await createAdminUser();
    app = createApp();

    // 1. Authenticate admin and clear must_change_password
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({
        email: 'admin@csp-irrigation.org',
        password: 'ChangeMeAdmin123!',
      });
    adminCookie = loginRes.headers['set-cookie']?.[0] || '';

    await request(app)
      .post('/api/v1/auth/change-password')
      .set('Cookie', adminCookie)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({
        currentPassword: 'ChangeMeAdmin123!',
        newPassword: 'NewAdminPassword456!',
      });

    // 2. Set up test farmer, plot, and active season
    const villageRes = await db.query('SELECT id FROM villages LIMIT 1');
    const villageId = villageRes.rows[0].id;
    const cropRes = await db.query("SELECT id FROM crops WHERE name LIKE 'Paddy%' LIMIT 1");
    const cropId = cropRes.rows[0].id;
    const methodRes = await db.query('SELECT id FROM irrigation_method_types LIMIT 1');
    const methodId = methodRes.rows[0].id;
    const sourceRes = await db.query("SELECT id FROM water_source_types WHERE code = 'borewell' LIMIT 1");
    const sourceTypeId = sourceRes.rows[0].id;

    // Create farmer
    const farmerRes = await db.query(`
      INSERT INTO farmers (farmer_code, full_name, village_id, status)
      VALUES ('F-TEST-P3', 'Rao Phase3', $1, 'active')
      RETURNING id
    `, [villageId]);
    testFarmerId = farmerRes.rows[0].id;

    await db.query(`
      INSERT INTO farmer_contacts (farmer_id, phone_e164, type, is_active)
      VALUES ($1, '+919876543210', 'primary', true)
    `, [testFarmerId]);

    // Create plot with pump discharge
    const plotRes = await db.query(`
      INSERT INTO plots (farmer_id, label, area_acres, survey_number, is_active)
      VALUES ($1, 'Phase3 North Plot', 2.5, 'SN-P3-101', true)
      RETURNING id
    `, [testFarmerId]);
    const plotId = plotRes.rows[0].id;

    await db.query(`
      INSERT INTO plot_water_sources (plot_id, water_source_type_id, pump_hp, discharge_lph, is_primary)
      VALUES ($1, $2, 5.0, 36000, true)
    `, [plotId, sourceTypeId]);

    // Create season in draft
    const seasonRes = await request(app)
      .post('/api/v1/seasons')
      .set('Cookie', adminCookie)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({
        farmer_id: testFarmerId,
        plot_id: plotId,
        season_type: 'kharif',
        season_year: 2026,
        crop_id: cropId,
        sowing_date: '2026-06-01',
        expected_harvest_date: '2026-10-01',
        irrigation_method_type_id: methodId,
        data_origin: 'real',
      });
    testSeasonId = seasonRes.body.data.id;

    // Activate season (this also triggers automated fortnightly call scheduling!)
    await request(app)
      .post(`/api/v1/seasons/${testSeasonId}/activate`)
      .set('Cookie', adminCookie)
      .set('X-Requested-With', 'XMLHttpRequest');

    // Retrieve created schedule
    const schRes = await db.query(
      'SELECT id FROM call_schedule WHERE season_id = $1 ORDER BY cycle_number ASC LIMIT 1',
      [testSeasonId]
    );
    testScheduleId = schRes.rows[0]?.id;
  });

  afterAll(async () => {
    await closeDatabase();
  });

  // =========================================================================
  // 1. PURE STATE MACHINE TESTS (CallFlowEngine)
  // =========================================================================
  describe('1. Pure State Machine (CallFlowEngine)', () => {
    it('initializes session at Step 1 (Intro) with Telugu intro prompt', () => {
      const { action, state } = CallFlowEngine.initSession({
        sessionId: 'test-session-1',
        phoneE164: '+919876543210',
        provider: 'simulator',
      });

      expect(state.currentStep).toBe(1);
      expect(action.promptCode).toBe('prompt_intro_te');
      expect(action.type).toBe('PLAY_AND_GATHER');
      expect(action.teluguText).toContain('నమస్కారం');
      expect(action.englishText).toContain('Greeting');
    });

    it('triggers opt-out when 9 is pressed on Step 1 (Intro)', () => {
      const { state } = CallFlowEngine.initSession({
        sessionId: 'test-opt-out',
        phoneE164: '+919876543210',
        provider: 'simulator',
      });

      const action = CallFlowEngine.handleInput(state, '9');
      expect(action.type).toBe('TERMINATE');
      expect(action.promptCode).toBe('prompt_opt_out_confirm_te');
      expect(state.isOptedOut).toBe(true);
      expect(state.isCompleted).toBe(true);
    });

    it('repeats the question when * is pressed', () => {
      const { state } = CallFlowEngine.initSession({
        sessionId: 'test-repeat',
        phoneE164: '+919876543210',
        provider: 'simulator',
      });

      // Advance to step 2 (rain)
      CallFlowEngine.handleInput(state, '1');
      expect(state.currentStep).toBe(2);

      // Press repeat
      const action = CallFlowEngine.handleInput(state, '*');
      expect(state.currentStep).toBe(2);
      expect(action.promptCode).toBe('prompt_rain_te');
    });

    it('handles invalid input with re-prompt and enforces retry limit', () => {
      const { state } = CallFlowEngine.initSession({
        sessionId: 'test-invalid',
        phoneE164: '+919876543210',
        provider: 'simulator',
      });

      // Advance to step 2 (rain: valid digits 0,1,2,3)
      CallFlowEngine.handleInput(state, '1');

      // Invalid input 1
      const act1 = CallFlowEngine.handleInput(state, '8');
      expect(state.questionRetryCount).toBe(1);
      expect(act1.teluguText).toContain('సరికాదు');

      // Invalid input 2
      const act2 = CallFlowEngine.handleInput(state, '7');
      expect(state.questionRetryCount).toBe(2);

      // Invalid input 3 (exceeds limit -> gracefully terminates)
      const act3 = CallFlowEngine.handleInput(state, '6');
      expect(act3.type).toBe('TERMINATE');
      expect(state.isCompleted).toBe(true);
    });

    it('BRANCHING RULE: If Question 3 (irrigated) is 2 (No), skips questions 4 and 5 directly to Question 6', () => {
      const { state } = CallFlowEngine.initSession({
        sessionId: 'test-skip-branching',
        phoneE164: '+919876543210',
        provider: 'simulator',
      });

      // Step 1: Intro -> press 1
      CallFlowEngine.handleInput(state, '1');
      // Step 2: Rain -> press 0 (none)
      CallFlowEngine.handleInput(state, '0');
      expect(state.currentStep).toBe(3);

      // Step 3: Irrigated? -> press 2 (NO)
      const action = CallFlowEngine.handleInput(state, '2');

      // Must have jumped directly to step 6 (crop_condition)!
      expect(state.currentStep).toBe(6);
      expect(action.promptCode).toBe('prompt_crop_condition_te');

      // Questions 4 and 5 must be recorded with skipped = true
      expect(state.responses['irrigation_count'].skipped).toBe(true);
      expect(state.responses['hours'].skipped).toBe(true);
    });

    it('CRITICAL: 9 pressed on Question 5 (hours) represents 9 pump hours, NEVER an opt-out', () => {
      const { state } = CallFlowEngine.initSession({
        sessionId: 'test-hours-not-optout',
        phoneE164: '+919876543210',
        provider: 'simulator',
      });

      CallFlowEngine.handleInput(state, '1'); // intro
      CallFlowEngine.handleInput(state, '1'); // rain
      CallFlowEngine.handleInput(state, '1'); // irrigated: yes -> step 4
      CallFlowEngine.handleInput(state, '2#'); // count: 2 -> step 5 (hours)
      expect(state.currentStep).toBe(5);

      // Press 9# for 9 pump hours
      const action = CallFlowEngine.handleInput(state, '9#');

      // Must NOT be opt-out! Must advance to step 6 (crop_condition)
      expect(state.isOptedOut).toBe(false);
      expect(state.currentStep).toBe(6);
      expect(state.responses['hours'].parsedValue).toBe(9);
      expect(action.promptCode).toBe('prompt_crop_condition_te');
    });

    it('completes the full 10-question flow and extracts valid payload', () => {
      const { state } = CallFlowEngine.initSession({
        sessionId: 'test-full-flow',
        phoneE164: '+919876543210',
        provider: 'simulator',
        seasonId: 'season-123',
        farmerId: 'farmer-456',
      });

      CallFlowEngine.handleInput(state, '1'); // 1. Intro -> continue
      CallFlowEngine.handleInput(state, '2'); // 2. Rain -> moderate
      CallFlowEngine.handleInput(state, '1'); // 3. Irrigated? -> yes
      CallFlowEngine.handleInput(state, '3#'); // 4. Count -> 3
      CallFlowEngine.handleInput(state, '4.5#'); // 5. Hours -> 4.5
      CallFlowEngine.handleInput(state, '1'); // 6. Condition -> good
      CallFlowEngine.handleInput(state, '1'); // 7. Stage confirmed -> yes
      CallFlowEngine.handleInput(state, '1'); // 8. Water problem -> shortage
      CallFlowEngine.handleInput(state, '0'); // 9. Crop problem -> none
      CallFlowEngine.handleInput(state, '1'); // 10. Callback requested -> yes

      expect(state.currentStep).toBe(99); // Goodbye

      const finalAction = CallFlowEngine.handleInput(state, '1');
      expect(finalAction.type).toBe('TERMINATE');
      expect(state.isCompleted).toBe(true);

      const payload = CallFlowEngine.extractCompletionPayload(state, 1);
      expect(payload.rainfallCategory).toBe('moderate');
      expect(payload.irrigated).toBe(true);
      expect(payload.irrigationCount).toBe(3);
      expect(payload.hoursPerIrrigation).toBe(4.5);
      expect(payload.cropCondition).toBe('good');
      expect(payload.stageConfirmed).toBe(true);
      expect(payload.waterProblem).toBe('shortage');
      expect(payload.callbackRequested).toBe(true);
    });
  });

  // =========================================================================
  // 2. SAFETY GATING & AUDIO PROMPT REVIEW WORKFLOW
  // =========================================================================
  describe('2. Safety Gating & Audio Review Workflow', () => {
    it('TwilioAdapter rejects calls if unapproved prompt exists and ALLOW_UNREVIEWED_PROMPTS is false', async () => {
      const adapter = new TwilioAdapter();

      // Insert a prompt in 'draft' status
      await db.query(`
        INSERT INTO audio_prompts (prompt_code, language_code, text_content, english_meaning, review_status)
        VALUES ('test_draft_prompt_te', 'te', 'పరీక్ష', 'Test', 'draft')
        ON CONFLICT (prompt_code) DO UPDATE SET review_status = 'draft'
      `);

      process.env.ALLOW_UNREVIEWED_PROMPTS = 'false';

      await expect(
        adapter.assertApprovedPrompts(['test_draft_prompt_te'])
      ).rejects.toThrow('AUDIO_PROMPT_NOT_APPROVED');
    });

    it('approves audio prompt via review endpoint and permits execution', async () => {
      const res = await request(app)
        .post('/api/v1/telephony/prompts/test_draft_prompt_te/review')
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          status: 'approved',
          notes: 'Reviewed and certified by agronomist.',
        });

      expect(res.status).toBe(200);
      expect(res.body.review_status).toBe('approved');

      // Now assertApprovedPrompts should pass
      const adapter = new TwilioAdapter();
      await expect(
        adapter.assertApprovedPrompts(['test_draft_prompt_te'])
      ).resolves.not.toThrow();
    });

    it('lists all registered audio prompts with review statuses', async () => {
      const res = await request(app)
        .get('/api/v1/telephony/prompts')
        .set('Cookie', adminCookie);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(10);
      expect(res.body.some((p: any) => p.prompt_code === 'prompt_intro_te')).toBe(true);
    });
  });

  // =========================================================================
  // 3. INTERACTIVE SIMULATOR API & ATOMIC DOWNSTREAM RECORD CREATION
  // =========================================================================
  describe('3. Simulator API & Downstream Record Creation', () => {
    let simSessionId: string;

    it('starts interactive simulator call for the scheduled cycle', async () => {
      const res = await request(app)
        .post('/api/v1/telephony/simulator/start')
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          scheduleId: testScheduleId,
          seasonId: testSeasonId,
          farmerId: testFarmerId,
        });

      expect(res.status).toBe(200);
      expect(res.body.sessionId).toBeDefined();
      expect(res.body.action.promptCode).toBe('prompt_intro_te');
      simSessionId = res.body.sessionId;
    });

    it('steps through the simulator call and completes with irrigation & shortage', async () => {
      // Step 1: Intro -> 1
      await request(app)
        .post('/api/v1/telephony/simulator/dtmf')
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ sessionId: simSessionId, digits: '1' });

      // Step 2: Rain -> 1 (light)
      await request(app)
        .post('/api/v1/telephony/simulator/dtmf')
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ sessionId: simSessionId, digits: '1' });

      // Step 3: Irrigated? -> 1 (yes)
      await request(app)
        .post('/api/v1/telephony/simulator/dtmf')
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ sessionId: simSessionId, digits: '1' });

      // Step 4: Count -> 2#
      await request(app)
        .post('/api/v1/telephony/simulator/dtmf')
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ sessionId: simSessionId, digits: '2#' });

      // Step 5: Hours -> 3# (3 pump hours)
      await request(app)
        .post('/api/v1/telephony/simulator/dtmf')
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ sessionId: simSessionId, digits: '3#' });

      // Step 6: Condition -> 2 (average)
      await request(app)
        .post('/api/v1/telephony/simulator/dtmf')
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ sessionId: simSessionId, digits: '2' });

      // Step 7: Stage -> 1 (confirmed)
      await request(app)
        .post('/api/v1/telephony/simulator/dtmf')
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ sessionId: simSessionId, digits: '1' });

      // Step 8: Water problem -> 1 (shortage)
      await request(app)
        .post('/api/v1/telephony/simulator/dtmf')
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ sessionId: simSessionId, digits: '1' });

      // Step 9: Crop problem -> 0 (none)
      await request(app)
        .post('/api/v1/telephony/simulator/dtmf')
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ sessionId: simSessionId, digits: '0' });

      // Step 10: Callback -> 1 (yes)
      await request(app)
        .post('/api/v1/telephony/simulator/dtmf')
        .set('Cookie', adminCookie)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ sessionId: simSessionId, digits: '1' });

      // Goodbye -> finish
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
        [testSeasonId]
      );

      expect(fbRes.rows.length).toBe(1);
      const fb = fbRes.rows[0];
      expect(fb.source).toBe('simulator');
      expect(fb.is_simulated).toBe(true);
      expect(fb.rainfall_class).toBe('light');
      expect(fb.irrigated).toBe(true);
      expect(fb.water_problem).toBe('shortage');
      expect(fb.callback_requested).toBe(true);
    });

    it('verifies call completion created irrigation_record with estimated volume from pump hours', async () => {
      const irRes = await db.query(
        'SELECT * FROM irrigation_records WHERE season_id = $1 ORDER BY created_at DESC LIMIT 1',
        [testSeasonId]
      );

      expect(irRes.rows.length).toBe(1);
      const ir = irRes.rows[0];
      expect(ir.measurement_type).toBe('estimated');
      expect(ir.raw_unit).toBe('pump_hours');
      // 2 irrigations * 3 hours = 6 total pump hours
      expect(Number(ir.raw_value)).toBe(6);
      // Volume = 6 hours * 36,000 L/h = 216,000 L
      expect(Number(ir.estimated_volume_l)).toBe(216000);
    });

    it('verifies call completion generated deduplicated action items for water shortage and callback', async () => {
      const actRes = await db.query(
        'SELECT * FROM action_items WHERE season_id = $1',
        [testSeasonId]
      );

      expect(actRes.rows.length).toBeGreaterThanOrEqual(2);
      const types = actRes.rows.map((a: any) => a.type);
      expect(types).toContain('water_shortage');
      expect(types).toContain('callback_requested');
    });

    it('verifies call_schedule was marked as completed', async () => {
      const schRes = await db.query(
        'SELECT status FROM call_schedule WHERE id = $1',
        [testScheduleId]
      );
      expect(schRes.rows[0].status).toBe('completed');
    });
  });

  // =========================================================================
  // 4. WEBHOOK IDEMPOTENCY & STATUS CALLBACKS
  // =========================================================================
  describe('4. Webhook Idempotency & Twilio Status Callbacks', () => {
    it('processes status callback and ensures idempotency prevents duplicate processing', async () => {
      const eventId = `test-call-sid-${Date.now()}`;

      // First webhook call
      const res1 = await request(app)
        .post('/api/v1/webhooks/twilio/status')
        .send({
          CallSid: eventId,
          CallStatus: 'completed',
        });
      expect(res1.status).toBe(200);

      // Verify recorded in provider_webhook_events
      const evtRes = await db.query(
        'SELECT * FROM provider_webhook_events WHERE event_id = $1',
        [`${eventId}-completed`]
      );
      expect(evtRes.rows.length).toBe(1);

      // Duplicate webhook call
      const res2 = await request(app)
        .post('/api/v1/webhooks/twilio/status')
        .send({
          CallSid: eventId,
          CallStatus: 'completed',
        });
      expect(res2.status).toBe(200);

      // Verify no duplicate record created
      const countRes = await db.query(
        'SELECT COUNT(*) as count FROM provider_webhook_events WHERE event_id = $1',
        [`${eventId}-completed`]
      );
      expect(Number(countRes.rows[0].count)).toBe(1);
    });
  });

  // =========================================================================
  // 5. CALL SCHEDULING QUEUE & ROW-LEVEL LOCKING
  // =========================================================================
  describe('5. Call Scheduling Queue & Row-Level Locking', () => {
    it('processes due calls queue using row locking without crashing', async () => {
      // Insert a due schedule row
      const villageRes = await db.query('SELECT id FROM villages LIMIT 1');
      const villageId = villageRes.rows[0].id;

      const fRes = await db.query(`
        INSERT INTO farmers (farmer_code, full_name, village_id, status)
        VALUES ('F-DUE-TEST', 'Due Farmer', $1, 'active')
        RETURNING id
      `, [villageId]);
      const dueFarmerId = fRes.rows[0].id;

      await db.query(`
        INSERT INTO farmer_contacts (farmer_id, phone_e164, type, is_active)
        VALUES ($1, '+919876543299', 'primary', true)
      `, [dueFarmerId]);

      const qSetRes = await db.query('SELECT id FROM call_question_sets LIMIT 1');
      const questionSetId = qSetRes.rows[0].id;

      const schRes = await db.query(`
        INSERT INTO call_schedule (
          season_id, cycle_number, question_set_id, farmer_id, phone_e164,
          scheduled_date, due_window_start, due_window_end, status
        )
        VALUES ($1, 99, $2, $3, '+919876543299', '2020-01-01', '2019-12-28', '2020-01-04', 'scheduled')
        RETURNING id
      `, [testSeasonId, questionSetId, dueFarmerId]);

      const dueScheduleId = schRes.rows[0].id;

      // Process due queue
      const processRes = await TelephonyService.processDueCallSchedule({
        limit: 20,
        provider: 'simulator',
        bypassTimeWindow: true,
      });

      expect(processRes.processedCount).toBeGreaterThanOrEqual(1);

      // Verify schedule transitioned to in_progress
      const updatedSch = await db.query(
        'SELECT status, attempt_count FROM call_schedule WHERE id = $1',
        [dueScheduleId]
      );
      expect(updatedSch.rows[0].status).toBe('in_progress');
      expect(updatedSch.rows[0].attempt_count).toBe(1);
    });
  });
});
