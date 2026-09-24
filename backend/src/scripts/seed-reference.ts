import { db, withTransaction, closeDatabase } from '../db/index.js';

export async function seedReferenceData() {
  console.log('🌱 Seeding reference data...');

  await withTransaction(async (tx) => {
    // 1. Villages
    const villages = [
      { name: 'Guntur Rural', mandal: 'Guntur', district: 'Guntur', gram_panchayat: 'Guntur GP', lat: 16.3067, lon: 80.4365 },
      { name: 'Tenali North', mandal: 'Tenali', district: 'Guntur', gram_panchayat: 'Tenali GP', lat: 16.2430, lon: 80.6400 },
      { name: 'Mangalagiri East', mandal: 'Mangalagiri', district: 'Guntur', gram_panchayat: 'Mangalagiri GP', lat: 16.4300, lon: 80.5500 },
      { name: 'Amaravati Central', mandal: 'Amaravati', district: 'Palnadu', gram_panchayat: 'Amaravati GP', lat: 16.5800, lon: 80.3200 },
      { name: 'Bapatla Coastal', mandal: 'Bapatla', district: 'Bapatla', gram_panchayat: 'Bapatla GP', lat: 15.9000, lon: 80.4700 },
      { name: 'Ponnur Valley', mandal: 'Ponnur', district: 'Guntur', gram_panchayat: 'Ponnur GP', lat: 16.0700, lon: 80.5600 },
    ];

    for (const v of villages) {
      await tx.query(`
        INSERT INTO villages (name, mandal, district, gram_panchayat, latitude, longitude, is_demo)
        VALUES ($1, $2, $3, $4, $5, $6, false)
        ON CONFLICT DO NOTHING
      `, [v.name, v.mandal, v.district, v.gram_panchayat, v.lat, v.lon]);
    }

    // 2. Water Source Types
    const waterSources = [
      { code: 'borewell', name: 'Borewell', name_te: 'బోరుబావి', requires_pump: true },
      { code: 'canal', name: 'Canal', name_te: 'కాలువ', requires_pump: false },
      { code: 'open_well', name: 'Open Well', name_te: 'బావి', requires_pump: true },
      { code: 'tank', name: 'Farm Pond / Tank', name_te: 'చెరువు / కుంట', requires_pump: true },
      { code: 'rainfed', name: 'Rainfed', name_te: 'వర్షాధార', requires_pump: false },
    ];

    for (const ws of waterSources) {
      await tx.query(`
        INSERT INTO water_source_types (code, name, name_te, requires_pump)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (code) DO UPDATE SET
          name = EXCLUDED.name,
          name_te = EXCLUDED.name_te,
          requires_pump = EXCLUDED.requires_pump
      `, [ws.code, ws.name, ws.name_te, ws.requires_pump]);
    }

    // 3. Irrigation Method Types
    const irrigationMethods = [
      { code: 'drip', name: 'Drip Irrigation', name_te: 'బిందు సేద్యం (డ్రిప్)', efficiency: 0.90, source: 'FAO-56 Paper Table 24', verified: true },
      { code: 'sprinkler', name: 'Sprinkler Irrigation', name_te: 'తుంపర సేద్యం (స్ప్రింక్లర్)', efficiency: 0.75, source: 'FAO-56 Paper', verified: true },
      { code: 'furrow', name: 'Furrow Irrigation', name_te: 'సాలు సేద్యం', efficiency: 0.65, source: 'ICAR Baseline Guidelines', verified: false },
      { code: 'flood', name: 'Flood / Basin Irrigation', name_te: 'ముంపు సేద్యం', efficiency: 0.50, source: 'APAU Field Guidelines', verified: false },
      { code: 'rainfed', name: 'Rainfed / Supplemental', name_te: 'వర్షాధార', efficiency: 1.00, source: 'Standard Definition', verified: true },
    ];

    for (const im of irrigationMethods) {
      await tx.query(`
        INSERT INTO irrigation_method_types (code, name, name_te, typical_efficiency, efficiency_source, efficiency_verified)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (code) DO UPDATE SET
          name = EXCLUDED.name,
          name_te = EXCLUDED.name_te,
          typical_efficiency = EXCLUDED.typical_efficiency,
          efficiency_source = EXCLUDED.efficiency_source,
          efficiency_verified = EXCLUDED.efficiency_verified
      `, [im.code, im.name, im.name_te, im.efficiency, im.source, im.verified]);
    }

    // 4. Crops, Stages, and Parameters
    // Crop A: Paddy / Rice
    const paddyRes = await tx.query(`
      INSERT INTO crops (name, name_te, category, default_duration_days, water_model, is_active)
      VALUES ('Paddy (Rice)', 'వరి', 'Cereal', 120, 'paddy_ponding', true)
      ON CONFLICT (name) DO UPDATE SET
        name_te = EXCLUDED.name_te,
        category = EXCLUDED.category,
        default_duration_days = EXCLUDED.default_duration_days,
        water_model = EXCLUDED.water_model
      RETURNING id
    `);
    const paddyId = paddyRes.rows[0].id;

    const paddyStages = [
      { order: 1, name: 'Land Preparation & Nursery', name_te: 'నారుమడి మరియు దమ్ము చేయడం', start_das: 0, end_das: 20, kc: 1.10, source: 'FAO-56 Paddy Baseline', verified: false },
      { order: 2, name: 'Vegetative & Tillering', name_te: 'పిలకలు వేసే దశ', start_das: 21, end_das: 55, kc: 1.15, source: 'FAO-56 Paddy Baseline', verified: false },
      { order: 3, name: 'Reproductive & Flowering', name_te: 'చిరుపొట్ట మరియు పూత దశ', start_das: 56, end_das: 85, kc: 1.25, source: 'FAO-56 Paddy Baseline', verified: false },
      { order: 4, name: 'Ripening & Maturation', name_te: 'గింజ పాలుపోసుకునే మరియు కోత దశ', start_das: 86, end_das: 120, kc: 0.95, source: 'FAO-56 Paddy Baseline', verified: false },
    ];

    await tx.query('DELETE FROM crop_stages WHERE crop_id = $1', [paddyId]);
    for (const s of paddyStages) {
      await tx.query(`
        INSERT INTO crop_stages (crop_id, stage_order, name, name_te, start_das, end_das, kc, kc_source, kc_verified)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [paddyId, s.order, s.name, s.name_te, s.start_das, s.end_das, s.kc, s.source, s.verified]);
    }

    const paddyParams = [
      { key: 'puddling_water_mm', value: 200, unit: 'mm', source: 'ICAR Baseline', verified: false, notes: 'Land soaking & puddling water requirement' },
      { key: 'percolation_rate_mm_day', value: 4.0, unit: 'mm/day', source: 'APAU Sandy-Clay Loam Estimate', verified: false, notes: 'Estimated daily deep percolation' },
      { key: 'target_ponding_depth_mm', value: 40, unit: 'mm', source: 'Agronomic Practice Guideline', verified: false, notes: 'Standard ponding water depth' },
    ];

    await tx.query('DELETE FROM crop_model_parameters WHERE crop_id = $1', [paddyId]);
    for (const p of paddyParams) {
      await tx.query(`
        INSERT INTO crop_model_parameters (crop_id, key, value_numeric, unit, source, verified, notes)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [paddyId, p.key, p.value, p.unit, p.source, p.verified, p.notes]);
    }

    // Crop B: Maize / Corn
    const maizeRes = await tx.query(`
      INSERT INTO crops (name, name_te, category, default_duration_days, water_model, is_active)
      VALUES ('Maize', 'మొక్కజొన్న', 'Cereal', 105, 'kc_standard', true)
      ON CONFLICT (name) DO UPDATE SET
        name_te = EXCLUDED.name_te,
        category = EXCLUDED.category,
        default_duration_days = EXCLUDED.default_duration_days,
        water_model = EXCLUDED.water_model
      RETURNING id
    `);
    const maizeId = maizeRes.rows[0].id;

    const maizeStages = [
      { order: 1, name: 'Initial', name_te: 'మొలక దశ', start_das: 0, end_das: 20, kc: 0.40, source: 'FAO-56 Table 12', verified: true },
      { order: 2, name: 'Crop Development', name_te: 'పైరు పెరుగుదల దశ', start_das: 21, end_das: 50, kc: 0.80, source: 'FAO-56 Table 12', verified: true },
      { order: 3, name: 'Mid-Season (Tasseling & Silking)', name_te: 'పూత మరియు కండె దశ', start_das: 51, end_das: 80, kc: 1.15, source: 'FAO-56 Table 12', verified: true },
      { order: 4, name: 'Late Season (Maturity)', name_te: 'గింజ ముదిరే దశ', start_das: 81, end_das: 105, kc: 0.60, source: 'FAO-56 Table 12', verified: true },
    ];

    await tx.query('DELETE FROM crop_stages WHERE crop_id = $1', [maizeId]);
    for (const s of maizeStages) {
      await tx.query(`
        INSERT INTO crop_stages (crop_id, stage_order, name, name_te, start_das, end_das, kc, kc_source, kc_verified)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [maizeId, s.order, s.name, s.name_te, s.start_das, s.end_das, s.kc, s.source, s.verified]);
    }

    // Crop C: Chilli
    const chilliRes = await tx.query(`
      INSERT INTO crops (name, name_te, category, default_duration_days, water_model, is_active)
      VALUES ('Chilli', 'మిరప', 'Commercial / Spice', 150, 'kc_standard', true)
      ON CONFLICT (name) DO UPDATE SET
        name_te = EXCLUDED.name_te,
        category = EXCLUDED.category,
        default_duration_days = EXCLUDED.default_duration_days,
        water_model = EXCLUDED.water_model
      RETURNING id
    `);
    const chilliId = chilliRes.rows[0].id;

    const chilliStages = [
      { order: 1, name: 'Transplanting & Establishment', name_te: 'నాటు మరియు వేరు పారే దశ', start_das: 0, end_das: 25, kc: 0.45, source: 'Provisional AP Baseline', verified: false },
      { order: 2, name: 'Vegetative & Branching', name_te: 'కొమ్మలు వేసే దశ', start_das: 26, end_das: 65, kc: 0.75, source: 'Provisional AP Baseline', verified: false },
      { order: 3, name: 'Flowering & Fruit Setting', name_te: 'పూత మరియు కాయ దశ', start_das: 66, end_das: 115, kc: 1.05, source: 'Provisional AP Baseline', verified: false },
      { order: 4, name: 'Fruit Ripening & Picking', name_te: 'పండు పక్వానికి వచ్చే దశ', start_das: 116, end_das: 150, kc: 0.80, source: 'Provisional AP Baseline', verified: false },
    ];

    await tx.query('DELETE FROM crop_stages WHERE crop_id = $1', [chilliId]);
    for (const s of chilliStages) {
      await tx.query(`
        INSERT INTO crop_stages (crop_id, stage_order, name, name_te, start_das, end_das, kc, kc_source, kc_verified)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [chilliId, s.order, s.name, s.name_te, s.start_das, s.end_das, s.kc, s.source, s.verified]);
    }

    // 5. App Settings
    const settings = [
      { key: 'call_schedule_interval_days', value: 14, desc: 'Days between fortnightly voice feedback calls' },
      { key: 'call_window_default_start', value: '09:00:00', desc: 'Permitted start time for calls (IST)' },
      { key: 'call_window_default_end', value: '18:00:00', desc: 'Permitted end time for calls (IST)' },
      { key: 'call_max_retries', value: 3, desc: 'Maximum retry attempts per call cycle' },
      { key: 'effective_rainfall_method', value: { min_threshold_mm: 5.0, fraction: 0.75, max_cap_mm: 35.0 }, desc: 'Effective rainfall parameters' },
      { key: 'confidence_weights', value: { coverage: 0.40, completeness: 0.30, field_evidence: 0.15, consistency: 0.15 }, desc: 'Weights for data confidence computation' },
      { key: 'certificate_min_confidence', value: 70, desc: 'Minimum confidence percentage required for certificate issuance' },
    ];

    for (const s of settings) {
      await tx.query(`
        INSERT INTO app_settings (key, value, description)
        VALUES ($1, $2, $3)
        ON CONFLICT (key) DO UPDATE SET
          value = EXCLUDED.value,
          description = EXCLUDED.description
      `, [s.key, JSON.stringify(s.value), s.desc]);
    }
  });

  console.log('✅ Reference data seeded successfully.');
}

if (process.argv[1] && process.argv[1].endsWith('seed-reference.ts')) {
  seedReferenceData()
    .then(async () => {
      await closeDatabase();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('❌ Failed seeding reference data:', err);
      await closeDatabase();
      process.exit(1);
    });
}
