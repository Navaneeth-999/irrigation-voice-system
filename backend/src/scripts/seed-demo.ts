import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { db, withTransaction, closeDatabase } from '../db/index.js';
import { snapshotService } from '../modules/certificates/SnapshotService.js';
import { pdfCertificateService } from '../modules/certificates/PdfCertificateService.js';

export async function seedDemoData() {
  console.log('🌱 Seeding rich demonstration data for end-to-end evaluation...');

  // 1. Fetch reference villages
  const villageRes = await db.query(
    `SELECT id, name FROM villages WHERE name IN ('Guntur Rural', 'Tenali North', 'Mangalagiri East') ORDER BY name`
  );
  if (villageRes.rows.length === 0) {
    throw new Error('Reference villages not found. Please run npm run seed:reference first.');
  }

  const vGuntur = villageRes.rows.find(v => v.name === 'Guntur Rural') || villageRes.rows[0];
  const vTenali = villageRes.rows.find(v => v.name === 'Tenali North') || villageRes.rows[1] || villageRes.rows[0];
  const vMangala = villageRes.rows.find(v => v.name === 'Mangalagiri East') || villageRes.rows[2] || villageRes.rows[0];

  // Fetch crops & methods
  const cropRes = await db.query(`SELECT id, name FROM crops`);
  const paddyCrop = cropRes.rows.find(c => c.name.includes('Paddy')) || cropRes.rows[0];
  const maizeCrop = cropRes.rows.find(c => c.name.includes('Maize')) || cropRes.rows[1] || cropRes.rows[0];
  const chilliCrop = cropRes.rows.find(c => c.name.includes('Chilli')) || cropRes.rows[2] || cropRes.rows[0];
  const pulseCrop = cropRes.rows.find(c => c.name.includes('Blackgram') || c.name.includes('Pulses')) || cropRes.rows[3] || cropRes.rows[0];

  const methodRes = await db.query(`SELECT id, code FROM irrigation_method_types`);
  const floodMethod = methodRes.rows.find(m => m.code === 'flood') || methodRes.rows[0];
  const dripMethod = methodRes.rows.find(m => m.code === 'drip') || methodRes.rows[1] || methodRes.rows[0];
  const sprinklerMethod = methodRes.rows.find(m => m.code === 'sprinkler') || methodRes.rows[2] || methodRes.rows[0];

  const wsRes = await db.query(`SELECT id, code FROM water_source_types`);
  const borewellWs = wsRes.rows.find(w => w.code === 'borewell') || wsRes.rows[0];
  const canalWs = wsRes.rows.find(w => w.code === 'canal') || wsRes.rows[1] || wsRes.rows[0];

  const qsRes = await db.query(`SELECT id FROM call_question_sets LIMIT 1`);
  const qSetId = qsRes.rows[0]?.id;

  const passwordHash = await bcrypt.hash('ChangeMeAdmin123!', 10);
  const officerHash = await bcrypt.hash('Officer123!', 10);
  const memberHash = await bcrypt.hash('Member123!', 10);

  // 2. Demo Users
  console.log('👤 Seeding demo users...');
  const userAdminRes = await db.query(
    `INSERT INTO users (name, email, password_hash, role, must_change_password)
     VALUES ('System Administrator', 'admin@csp-irrigation.org', $1, 'ADMIN', false)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, must_change_password = false
     RETURNING id`,
    [passwordHash]
  );
  const adminId = userAdminRes.rows[0].id;

  const userOfficerRes = await db.query(
    `INSERT INTO users (name, email, password_hash, role, must_change_password)
     VALUES ('Agricultural Officer (Guntur)', 'officer.guntur@csp-irrigation.org', $1, 'AGRI_PANCHAYAT', false)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, must_change_password = false
     RETURNING id`,
    [officerHash]
  );
  const officerId = userOfficerRes.rows[0].id;

  // Scope officer to Guntur Rural
  await db.query(`DELETE FROM user_scopes WHERE user_id = $1`, [officerId]);
  await db.query(
    `INSERT INTO user_scopes (user_id, scope_type, scope_value) VALUES ($1, 'village', $2)`,
    [officerId, vGuntur.id]
  );

  await db.query(
    `INSERT INTO users (name, email, password_hash, role, must_change_password)
     VALUES ('Field Officer Team Lead', 'member.csp@csp-irrigation.org', $1, 'CSP_MEMBER', false)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, must_change_password = false`,
    [memberHash]
  );

  // Clean existing demo farmers
  console.log('🌾 Seeding demo farmers, plots, and cultivation seasons...');
  const demoFarmerCodes = ['F-DEMO-001', 'F-DEMO-002', 'F-DEMO-003', 'F-DEMO-004'];

  for (const fCode of demoFarmerCodes) {
    const existing = await db.query(`SELECT id FROM farmers WHERE farmer_code = $1`, [fCode]);
    if (existing.rows.length > 0) {
      const fId = existing.rows[0].id;
      // Clean dependent records
      const seasons = await db.query(`SELECT id FROM seasons WHERE farmer_id = $1`, [fId]);
      for (const s of seasons.rows) {
        await db.query(`DELETE FROM certificates WHERE season_id = $1`, [s.id]);
        await db.query(`DELETE FROM season_reports WHERE season_id = $1`, [s.id]);
        await db.query(`DELETE FROM season_water_metrics WHERE season_id = $1`, [s.id]);
        await db.query(`DELETE FROM season_daily_water_balance WHERE season_id = $1`, [s.id]);
        await db.query(`DELETE FROM irrigation_records WHERE season_id = $1`, [s.id]);
        await db.query(`DELETE FROM farmer_feedback WHERE season_id = $1`, [s.id]);
        await db.query(`DELETE FROM crop_progress WHERE season_id = $1`, [s.id]);
        await db.query(`DELETE FROM call_schedule WHERE season_id = $1`, [s.id]);
        await db.query(`DELETE FROM action_items WHERE season_id = $1`, [s.id]);
      }
      await db.query(`DELETE FROM seasons WHERE farmer_id = $1`, [fId]);
      await db.query(`DELETE FROM plots WHERE farmer_id = $1`, [fId]);
      await db.query(`DELETE FROM consents WHERE farmer_id = $1`, [fId]);
      await db.query(`DELETE FROM farmer_contacts WHERE farmer_id = $1`, [fId]);
      await db.query(`DELETE FROM farmers WHERE id = $1`, [fId]);
    }
  }

  // Farmer 1: Venkata Subbaiah (Active Paddy Season, highly active, prime demo candidate)
  const f1 = (await db.query(
    `INSERT INTO farmers (farmer_code, full_name, village_id, address, preferred_language, call_window_start, call_window_end, status, data_origin)
     VALUES ('F-DEMO-001', 'Venkata Subbaiah (వెంకట సుబ్బయ్య)', $1, 'Plot 14, Main Road, Guntur Rural', 'te', '09:00:00', '18:00:00', 'active', 'demo')
     RETURNING id`,
    [vGuntur.id]
  )).rows[0];

  await db.query(
    `INSERT INTO farmer_contacts (farmer_id, phone_e164, type, is_active, is_verified)
     VALUES ($1, '+919848022338', 'primary', true, true)`,
    [f1.id]
  );
  await db.query(
    `INSERT INTO consents (farmer_id, channel, status, method)
     VALUES ($1, 'voice', 'granted', 'written'), ($1, 'sms', 'granted', 'written')`,
    [f1.id]
  );

  const p1 = (await db.query(
    `INSERT INTO plots (farmer_id, label, survey_number, area_acres, soil_type, is_active)
     VALUES ($1, 'Ganga Chenu (గంగా చేను)', 'SY-204/A', 3.0, 'Clay Loam', true)
     RETURNING id`,
    [f1.id]
  )).rows[0];

  await db.query(
    `INSERT INTO plot_water_sources (plot_id, water_source_type_id, pump_hp, discharge_lph, is_primary)
     VALUES ($1, $2, 5.0, 18000, true)`,
    [p1.id, borewellWs.id]
  );

  const s1 = (await db.query(
    `INSERT INTO seasons (season_code, farmer_id, plot_id, crop_id, irrigation_method_type_id, season_type, season_year, sowing_date, expected_harvest_date, area_acres_snapshot, status, data_origin)
     VALUES ('S-2026-DEMO-01', $1, $2, $3, $4, 'kharif', 2026, '2026-06-01', '2026-10-31', 3.0, 'active', 'demo')
     RETURNING id`,
    [f1.id, p1.id, paddyCrop.id, floodMethod.id]
  )).rows[0];

  // Seed 4 Fortnightly Irrigation & Feedback records for Farmer 1
  for (let cycle = 1; cycle <= 4; cycle++) {
    const startD = new Date('2026-06-01');
    startD.setDate(startD.getDate() + (cycle - 1) * 14);
    const startStr = startD.toISOString().split('T')[0];
    const endD = new Date('2026-06-14');
    endD.setDate(endD.getDate() + (cycle - 1) * 14);
    const endStr = endD.toISOString().split('T')[0];

    const fbRes = await db.query(
      `INSERT INTO farmer_feedback (
        season_id, cycle_number, period_start, period_end, rainfall_class,
        irrigated, irrigation_count, pump_hours, crop_condition, water_problem,
        crop_problem, callback_requested, source
      ) VALUES ($1, $2, $3, $4, 'light', true, 2, 12.0, 'good', 'none', 'none', false, 'ivr')
      RETURNING id`,
      [s1.id, cycle, startStr, endStr]
    );
    const fbId = fbRes.rows[0].id;

    await db.query(
      `INSERT INTO irrigation_records (
        season_id, period_start, period_end, event_count, raw_value,
        raw_unit, calculation_method, estimated_volume_l, estimated_depth_mm,
        measurement_type, source, feedback_id
      ) VALUES ($1, $2, $3, 2, 12.0, 'pump_hours', 'pump_hours_x_discharge', 216000, 18.0, 'farmer_reported', 'call', $4)`,
      [s1.id, startStr, endStr, fbId]
    );

    if (qSetId) {
      await db.query(
        `INSERT INTO call_schedule (
          season_id, cycle_number, question_set_id, farmer_id, phone_e164,
          scheduled_date, due_window_start, due_window_end, status
        ) VALUES ($1, $2, $3, $4, '+919848022338', $5, $5, $6, 'completed')`,
        [s1.id, cycle, qSetId, f1.id, startStr, endStr]
      );
    }
  }

  // Pre-calculate Water Metrics for Farmer 1
  await db.query(
    `INSERT INTO season_water_metrics (
      season_id, total_etc_mm, total_etc_m3, total_effective_rain_mm,
      total_effective_rain_m3, net_irrigation_demand_mm, net_irrigation_demand_m3,
      gross_irrigation_demand_m3, total_applied_litres, total_applied_m3,
      total_applied_mm, water_use_ratio, ratio_band, confidence_score,
      confidence_band, has_unvalidated_assumptions, unvalidated_assumptions_list
    ) VALUES (
      $1, 485.0, 5890.0, 160.0, 1940.0, 325.0, 3950.0, 4380.0,
      4128000, 4128.0, 340.0, 1.05, 'near_estimate', 88, 'high', true,
      ARRAY['Paddy baseline percolation rate uncalibrated', 'Kc mid-season value based on provisional FAO-56 table']
    )`,
    [s1.id]
  );

  // Farmer 2: Koteswara Rao (Active Maize Season with Drip, Tenali North)
  const f2 = (await db.query(
    `INSERT INTO farmers (farmer_code, full_name, village_id, address, preferred_language, call_window_start, call_window_end, status, data_origin)
     VALUES ('F-DEMO-002', 'Koteswara Rao (కోటేశ్వరరావు)', $1, 'Canal Bund, Tenali North', 'te', '08:30:00', '17:30:00', 'active', 'demo')
     RETURNING id`,
    [vTenali.id]
  )).rows[0];

  await db.query(
    `INSERT INTO farmer_contacts (farmer_id, phone_e164, type, is_active, is_verified)
     VALUES ($1, '+919440188992', 'primary', true, true)`,
    [f2.id]
  );
  await db.query(
    `INSERT INTO consents (farmer_id, channel, status, method)
     VALUES ($1, 'voice', 'granted', 'verbal'), ($1, 'sms', 'granted', 'verbal')`,
    [f2.id]
  );

  const p2 = (await db.query(
    `INSERT INTO plots (farmer_id, label, survey_number, area_acres, soil_type, is_active)
     VALUES ($1, 'Rami Reddy Madi (రామిరెడ్డి మడి)', 'SY-88/2', 2.5, 'Black Cotton', true)
     RETURNING id`,
    [f2.id]
  )).rows[0];

  await db.query(
    `INSERT INTO plot_water_sources (plot_id, water_source_type_id, pump_hp, discharge_lph, is_primary)
     VALUES ($1, $2, 3.0, 12000, true)`,
    [p2.id, canalWs.id]
  );

  const s2 = (await db.query(
    `INSERT INTO seasons (season_code, farmer_id, plot_id, crop_id, irrigation_method_type_id, season_type, season_year, sowing_date, expected_harvest_date, area_acres_snapshot, status, data_origin)
     VALUES ('S-2026-DEMO-02', $1, $2, $3, $4, 'kharif', 2026, '2026-06-15', '2026-10-15', 2.5, 'active', 'demo')
     RETURNING id`,
    [f2.id, p2.id, maizeCrop.id, dripMethod.id]
  )).rows[0];

  // Farmer 3: Lakshmi Devi (COMPLETED Season + ACCREDITED Conservation Certificate)
  const f3 = (await db.query(
    `INSERT INTO farmers (farmer_code, full_name, village_id, address, preferred_language, status, data_origin)
     VALUES ('F-DEMO-003', 'Lakshmi Devi (లక్ష్మీ దేవి)', $1, 'East Street, Mangalagiri East', 'te', 'active', 'demo')
     RETURNING id`,
    [vMangala.id]
  )).rows[0];

  await db.query(
    `INSERT INTO farmer_contacts (farmer_id, phone_e164, type, is_active, is_verified)
     VALUES ($1, '+919959144771', 'primary', true, true)`,
    [f3.id]
  );
  await db.query(
    `INSERT INTO consents (farmer_id, channel, status, method)
     VALUES ($1, 'voice', 'granted', 'written'), ($1, 'sms', 'granted', 'written')`,
    [f3.id]
  );

  const p3 = (await db.query(
    `INSERT INTO plots (farmer_id, label, survey_number, area_acres, soil_type, is_active)
     VALUES ($1, 'Pedda Polam (పెద్ద పొలం)', 'SY-301/C', 4.0, 'Red Sandy Loam', true)
     RETURNING id`,
    [f3.id]
  )).rows[0];

  await db.query(
    `INSERT INTO plot_water_sources (plot_id, water_source_type_id, pump_hp, discharge_lph, is_primary)
     VALUES ($1, $2, 7.5, 25000, true)`,
    [p3.id, borewellWs.id]
  );

  const s3 = (await db.query(
    `INSERT INTO seasons (
      season_code, farmer_id, plot_id, crop_id, irrigation_method_type_id,
      season_type, season_year, sowing_date, expected_harvest_date, actual_harvest_date,
      area_acres_snapshot, status, data_origin
    ) VALUES (
      'S-2026-DEMO-03', $1, $2, $3, $4,
      'rabi', 2026, '2025-11-01', '2026-03-15', '2026-03-10',
      4.0, 'completed', 'demo'
    ) RETURNING id`,
    [f3.id, p3.id, chilliCrop.id, dripMethod.id]
  )).rows[0];

  await db.query(
    `INSERT INTO season_water_metrics (
      season_id, total_etc_mm, total_etc_m3, total_effective_rain_mm,
      total_effective_rain_m3, net_irrigation_demand_mm, net_irrigation_demand_m3,
      gross_irrigation_demand_m3, total_applied_litres, total_applied_m3,
      total_applied_mm, water_use_ratio, ratio_band, confidence_score,
      confidence_band, has_unvalidated_assumptions, unvalidated_assumptions_list
    ) VALUES (
      $1, 310.0, 5018.0, 45.0, 728.0, 265.0, 4290.0, 4760.0,
      4370000, 4370.0, 270.0, 1.02, 'near_estimate', 85, 'high', false,
      ARRAY[]::text[]
    )`,
    [s3.id]
  );

  // Generate and issue sealed demo certificate for Farmer 3
  console.log('📜 Sealing accredited Water Conservation Certificate for Demo Farmer 3...');
  const snapshot3 = await snapshotService.buildSeasonSnapshot(s3.id, '2026-03-10', 48.0, 'quintal');
  const sha256_3 = snapshotService.computeSha256(snapshot3);

  const verifyToken3 = crypto.randomUUID().replace(/-/g, '');

  const cert3 = (await db.query(
    `INSERT INTO certificates (
      certificate_code, season_id, farmer_id, plot_id, crop_id,
      water_use_ratio, water_use_ratio_band, confidence_score, confidence_band,
      actual_harvest_date, yield_quantity, yield_unit, snapshot_data,
      sha256_hash, verification_token, is_revoked, version, created_by
    ) VALUES (
      'JALAMITRA-2026-00001', $1, $2, $3, $4,
      1.02, 'near_estimate', 85, 'high',
      '2026-03-10', 48.0, 'quintal', $5::jsonb,
      $6, $7, false, 1, $8
    ) RETURNING *`,
    [s3.id, f3.id, p3.id, chilliCrop.id, JSON.stringify(snapshot3), sha256_3, verifyToken3, adminId]
  )).rows[0];

  await pdfCertificateService.saveCertificatePdf(cert3);

  // Farmer 4: Srinivasa Rao (COMPLETED Season + INELIGIBLE -> Summary Report Generated)
  const f4 = (await db.query(
    `INSERT INTO farmers (farmer_code, full_name, village_id, address, preferred_language, status, data_origin)
     VALUES ('F-DEMO-004', 'Srinivasa Rao (శ్రీనివాస రావు)', $1, 'Kaluva Gattu, Guntur Rural', 'te', 'active', 'demo')
     RETURNING id`,
    [vGuntur.id]
  )).rows[0];

  await db.query(
    `INSERT INTO farmer_contacts (farmer_id, phone_e164, type, is_active, is_verified)
     VALUES ($1, '+919866123456', 'primary', true, true)`,
    [f4.id]
  );
  await db.query(
    `INSERT INTO consents (farmer_id, channel, status, method)
     VALUES ($1, 'voice', 'granted', 'written'), ($1, 'sms', 'granted', 'written')`,
    [f4.id]
  );

  const p4 = (await db.query(
    `INSERT INTO plots (farmer_id, label, survey_number, area_acres, soil_type, is_active)
     VALUES ($1, 'Kaluva Gattu (కాలువ గట్టు)', 'SY-112/B', 2.0, 'Alluvial Loam', true)
     RETURNING id`,
    [f4.id]
  )).rows[0];

  await db.query(
    `INSERT INTO plot_water_sources (plot_id, water_source_type_id, pump_hp, discharge_lph, is_primary)
     VALUES ($1, $2, 3.0, 10000, true)`,
    [p4.id, canalWs.id]
  );

  const s4 = (await db.query(
    `INSERT INTO seasons (
      season_code, farmer_id, plot_id, crop_id, irrigation_method_type_id,
      season_type, season_year, sowing_date, expected_harvest_date, actual_harvest_date,
      area_acres_snapshot, status, data_origin
    ) VALUES (
      'S-2026-DEMO-04', $1, $2, $3, $4,
      'rabi', 2026, '2025-11-15', '2026-03-01', '2026-02-28',
      2.0, 'completed', 'demo'
    ) RETURNING id`,
    [f4.id, p4.id, pulseCrop.id, sprinklerMethod.id]
  )).rows[0];

  await db.query(
    `INSERT INTO season_water_metrics (
      season_id, total_etc_mm, total_etc_m3, total_effective_rain_mm,
      total_effective_rain_m3, net_irrigation_demand_mm, net_irrigation_demand_m3,
      gross_irrigation_demand_m3, total_applied_litres, total_applied_m3,
      total_applied_mm, water_use_ratio, ratio_band, confidence_score,
      confidence_band, has_unvalidated_assumptions, unvalidated_assumptions_list
    ) VALUES (
      $1, 195.0, 1578.0, 30.0, 243.0, 165.0, 1335.0, 1780.0,
      1133000, 1133.0, 140.0, 0.85, 'near_estimate', 42, 'low', true,
      ARRAY['Insufficient survey cycle completeness (< 50%)', 'Blackgram leaf-area baseline unvalidated']
    )`,
    [s4.id]
  );

  console.log('📋 Generating Seasonal Water Summary Report for Ineligible Demo Season 4...');
  const snapshot4 = await snapshotService.buildSeasonSnapshot(s4.id, '2026-02-28', 14.5, 'quintal');
  const report4 = (await db.query(
    `INSERT INTO season_reports (
      report_code, season_id, farmer_id, plot_id, crop_id,
      actual_harvest_date, yield_quantity, yield_unit,
      monitoring_cycle_coverage, confidence_score, confidence_band,
      water_use_ratio, water_use_ratio_band, is_certificate_eligible,
      ineligibility_reasons, snapshot_data, created_by
    ) VALUES (
      'REP-2026-00001', $1, $2, $3, $4,
      '2026-02-28', 14.5, 'quintal',
      33.3, 42.0, 'low',
      0.85, 'near_estimate', false,
      '["Monitoring cycle coverage 33.3% is below minimum required 50.0%", "Confidence score 42 is below minimum required 50", "Confidence band \\"low\\" does not meet minimum \\"medium\\" requirement"]'::jsonb,
      $5::jsonb, $6
    ) RETURNING *`,
    [s4.id, f4.id, p4.id, pulseCrop.id, JSON.stringify(snapshot4), adminId]
  )).rows[0];

  await pdfCertificateService.saveSeasonReportPdf(report4);

  // 3. Demo Weather Records & Alerts
  console.log('⛅ Seeding demo weather records and IMD alert rules...');
  for (let d = -10; d <= 5; d++) {
    const recDate = new Date();
    recDate.setDate(recDate.getDate() + d);
    const dateStr = recDate.toISOString().split('T')[0];
    const isForecast = d > 0;

    await db.query(
      `INSERT INTO weather_records (
        village_id, record_date, temp_max_c, temp_min_c, precipitation_sum_mm,
        precipitation_probability_max, weather_code, et0_fao_evapotranspiration, source, is_forecast, is_demo
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'mock', $9, true)
      ON CONFLICT (village_id, record_date, is_forecast) DO NOTHING`,
      [
        vGuntur.id,
        dateStr,
        isForecast ? 36.5 : 34.0,
        isForecast ? 25.0 : 24.2,
        isForecast && d === 2 ? 42.0 : 0.0,
        isForecast && d === 2 ? 85 : 10,
        isForecast && d === 2 ? 63 : 1,
        isForecast ? 4.8 : 4.5,
        isForecast,
      ]
    );
  }

  // Active Weather Alert for Demonstration
  const alertTargetDate = new Date();
  alertTargetDate.setDate(alertTargetDate.getDate() + 2);
  const targetDateStr = alertTargetDate.toISOString().split('T')[0];

  const ruleHeavyRes = await db.query(`SELECT id, alert_type FROM alert_rules WHERE rule_code = 'RULE_HEAVY_RAIN' LIMIT 1`);
  const ruleHeavy = ruleHeavyRes.rows[0];

  await db.query(
    `INSERT INTO weather_alerts (
      village_id, rule_id, alert_type, severity, target_date, headline_en, headline_te,
      message_en, message_te, suggested_action_en, suggested_action_te, dedup_key, source, is_active, valid_until
    ) VALUES (
      $1, $2, $3, 'warning', $4,
      'Heavy Rainfall Expected (42 mm)', 'భారీ వర్ష సూచన (42 మి.మీ.)',
      'Heavy rainfall is possible over the next 48 hours. Postpone non-essential irrigation.',
      'రాబోయే 48 గంటల్లో భారీ వర్షం కురిసే అవకాశం ఉంది. దయచేసి నీటిపారుదలని వాయిదా వేసుకోండి.',
      'Avoid running pumps and inspect field bunds for proper drainage.',
      'మోటార్లు నడపవద్దు మరియు మురుగునీటి పారుదలని సరిచూసుకోండి.',
      $5, 'system', true, CURRENT_TIMESTAMP + INTERVAL '48 hours'
    ) ON CONFLICT (dedup_key) DO NOTHING`,
    [
      vGuntur.id,
      ruleHeavy?.id || null,
      ruleHeavy?.alert_type || 'heavy_rain',
      targetDateStr,
      `${vGuntur.id}:RULE_HEAVY_RAIN:${targetDateStr}`
    ]
  );

  // 4. Demo Action Items
  console.log('📌 Seeding demo field action items...');
  await db.query(`DELETE FROM action_items WHERE referral_note LIKE '%DEMO%'`);
  await db.query(
    `INSERT INTO action_items (
      source, season_id, farmer_id, type, priority, referral_note, status, created_at
    ) VALUES
    ('call', $1, $2, 'pump_power_problem', 'high', '[DEMO] Farmer reported frequent 3-phase power tripping during Call Cycle #3', 'open', CURRENT_TIMESTAMP - INTERVAL '2 days'),
    ('manual', $1, $2, 'crop_pest_disease', 'medium', '[DEMO] Minor leaf discoloration reported in eastern quadrant; advisory dispatched', 'in_progress', CURRENT_TIMESTAMP - INTERVAL '5 days'),
    ('system', $3, $4, 'other_field_issue', 'low', '[DEMO] Season audit verified zero over-irrigation under drip system', 'resolved', CURRENT_TIMESTAMP - INTERVAL '10 days')`,
    [s1.id, f1.id, s3.id, f3.id]
  );

  console.log('\n======================================================================');
  console.log('✨ SMART IRRIGATION ADVISORY DEMO DATASET SEEDED SUCCESSFULLY');
  console.log('======================================================================');
  console.log('Demo Credentials:');
  console.log('  • Admin:            admin@csp-irrigation.org          / ChangeMeAdmin123!');
  console.log('  • Agronomist:       officer.guntur@csp-irrigation.org / Officer123!');
  console.log('  • Team Member:      member.csp@csp-irrigation.org     / Member123!\n');
  console.log('Demo Farmer Accounts:');
  console.log('  • F-DEMO-001: Venkata Subbaiah (Active Paddy, 4 Call Cycles, Guntur Rural)');
  console.log('  • F-DEMO-002: Koteswara Rao    (Active Maize, Drip, Tenali North)');
  console.log('  • F-DEMO-003: Lakshmi Devi     (Accredited Certificate JALAMITRA-2026-00001)');
  console.log('  • F-DEMO-004: Srinivasa Rao    (Ineligible Season -> Summary Report REP-2026-00001)\n');
}

// Direct execution
if (process.argv[1] && process.argv[1].endsWith('seed-demo.ts')) {
  seedDemoData()
    .then(async () => {
      await closeDatabase();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('❌ Demo seeding failed:', err);
      await closeDatabase();
      process.exit(1);
    });
}
