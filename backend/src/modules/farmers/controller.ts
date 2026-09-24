import { Request, Response } from 'express';
import { db, withTransaction } from '../../db/index.js';
import { AppError } from '../../middleware/errorHandler.js';
import { recordAudit } from '../../middleware/audit.js';
import { normalizePhone, maskPhone } from '../../utils/phone.js';
import { getScopedVillageFilter } from '../../middleware/auth.js';
import {
  createFarmerSchema,
  updateFarmerSchema,
  createContactSchema,
  recordConsentSchema,
} from './schemas.js';

export async function listFarmers(req: Request, res: Response): Promise<void> {
  const { search, village_id, status, data_origin } = req.query;
  const user = req.user;

  // Role-based village scoping
  const scopedVillages = getScopedVillageFilter(user);

  let query = `
    SELECT f.id, f.farmer_code, f.full_name, f.village_id, v.name as village_name,
           v.mandal, v.district, f.gram_panchayat, f.preferred_language,
           f.call_window_start, f.call_window_end, f.status, f.data_source, f.data_origin,
           f.notes, f.created_at,
           c.phone_e164 as primary_phone,
           (SELECT COUNT(*)::int FROM plots p WHERE p.farmer_id = f.id AND p.is_active = true) as active_plots_count
    FROM farmers f
    JOIN villages v ON f.village_id = v.id
    LEFT JOIN farmer_contacts c ON f.id = c.farmer_id AND c.type = 'primary' AND c.is_active = true
    WHERE 1=1
  `;
  const params: any[] = [];

  if (scopedVillages !== null) {
    if (scopedVillages.length === 0) {
      res.json({ data: [] });
      return;
    }
    params.push(scopedVillages);
    query += ` AND f.village_id = ANY($${params.length})`;
  }

  if (village_id) {
    params.push(village_id);
    query += ` AND f.village_id = $${params.length}`;
  }

  if (status) {
    params.push(status);
    query += ` AND f.status = $${params.length}`;
  }

  if (data_origin) {
    params.push(data_origin);
    query += ` AND f.data_origin = $${params.length}`;
  }

  if (search) {
    params.push(`%${search}%`);
    query += ` AND (f.full_name ILIKE $${params.length} OR f.farmer_code ILIKE $${params.length} OR c.phone_e164 ILIKE $${params.length} OR v.name ILIKE $${params.length})`;
  }

  query += ` ORDER BY f.created_at DESC LIMIT 200`;

  const farmersRes = await db.query(query, params);

  // Mask phone numbers based on role
  const role = user?.role || 'AGRI_PANCHAYAT';
  const data = farmersRes.rows.map(f => ({
    ...f,
    primary_phone: f.primary_phone ? maskPhone(f.primary_phone, role) : null,
  }));

  res.json({ data });
}

export async function getFarmer(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;
  const user = req.user;
  const scopedVillages = getScopedVillageFilter(user);

  const farmerRes = await db.query(`
    SELECT f.*, v.name as village_name, v.mandal, v.district
    FROM farmers f
    JOIN villages v ON f.village_id = v.id
    WHERE f.id = $1
  `, [id]);

  if (farmerRes.rows.length === 0) {
    throw new AppError('Farmer not found', 404, 'NOT_FOUND');
  }

  const farmer = farmerRes.rows[0];

  if (scopedVillages !== null && !scopedVillages.includes(farmer.village_id)) {
    throw new AppError('Forbidden: You do not have access to farmers in this village.', 403, 'FORBIDDEN');
  }

  // Fetch contacts
  const contactsRes = await db.query(`
    SELECT id, phone_e164, type, is_active, is_verified, created_at
    FROM farmer_contacts
    WHERE farmer_id = $1
    ORDER BY type ASC, created_at ASC
  `, [id]);

  // Fetch consents
  const consentsRes = await db.query(`
    SELECT id, channel, status, method, recorded_at, note
    FROM consents
    WHERE farmer_id = $1
    ORDER BY recorded_at DESC
  `, [id]);

  // Fetch plots with water sources
  const plotsRes = await db.query(`
    SELECT p.*,
           COALESCE(json_agg(json_build_object(
             'id', pws.id,
             'water_source_type_id', pws.water_source_type_id,
             'source_name', wst.name,
             'source_name_te', wst.name_te,
             'pump_hp', pws.pump_hp,
             'discharge_lph', pws.discharge_lph,
             'is_primary', pws.is_primary,
             'notes', pws.notes
           )) FILTER (WHERE pws.id IS NOT NULL), '[]') as water_sources
    FROM plots p
    LEFT JOIN plot_water_sources pws ON p.id = pws.plot_id
    LEFT JOIN water_source_types wst ON pws.water_source_type_id = wst.id
    WHERE p.farmer_id = $1 AND p.is_active = true
    GROUP BY p.id
    ORDER BY p.created_at ASC
  `, [id]);

  const role = user?.role || 'AGRI_PANCHAYAT';

  // Record sensitive phone access audit if unmasked full phone is viewed by ADMIN or CSP_MEMBER
  if (role === 'ADMIN' || role === 'CSP_MEMBER') {
    await recordAudit({
      userId: user?.id,
      action: 'SENSITIVE_DATA_ACCESS',
      entityType: 'farmers',
      entityId: id,
      after: { accessed: 'unmasked_phone_numbers' },
      req,
    });
  }

  const maskedContacts = contactsRes.rows.map(c => ({
    ...c,
    phone_e164: maskPhone(c.phone_e164, role),
  }));

  res.json({
    data: {
      ...farmer,
      contacts: maskedContacts,
      consents: consentsRes.rows,
      plots: plotsRes.rows,
    },
  });
}

export async function createFarmer(req: Request, res: Response): Promise<void> {
  const data = createFarmerSchema.parse(req.body);
  const normalizedPhone = normalizePhone(data.phone);

  const farmerCode = `FARM-AP-${Math.floor(100000 + Math.random() * 900000)}`;

  const created = await withTransaction(async (tx) => {
    // 1. Insert Farmer
    const fRes = await tx.query(`
      INSERT INTO farmers (
        farmer_code, full_name, village_id, address, gram_panchayat,
        preferred_language, call_window_start, call_window_end,
        status, data_source, data_origin, notes, created_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active', $9, $10, $11, $12)
      RETURNING *
    `, [
      farmerCode, data.full_name, data.village_id, data.address || null, data.gram_panchayat || null,
      data.preferred_language, data.call_window_start, data.call_window_end,
      data.data_source, data.data_origin, data.notes || null, req.user?.id || null,
    ]);
    const farmer = fRes.rows[0];

    // 2. Insert Primary Contact
    await tx.query(`
      INSERT INTO farmer_contacts (farmer_id, phone_e164, type, is_active, is_verified)
      VALUES ($1, $2, 'primary', true, true)
    `, [farmer.id, normalizedPhone]);

    // 3. Record Initial Consents
    if (data.voice_consent) {
      await tx.query(`
        INSERT INTO consents (farmer_id, channel, status, method, recorded_by, note)
        VALUES ($1, 'voice', 'granted', 'verbal', $2, 'Granted during onboarding')
      `, [farmer.id, req.user?.id || null]);
    }
    if (data.sms_consent) {
      await tx.query(`
        INSERT INTO consents (farmer_id, channel, status, method, recorded_by, note)
        VALUES ($1, 'sms', 'granted', 'verbal', $2, 'Granted during onboarding')
      `, [farmer.id, req.user?.id || null]);
    }

    return farmer;
  });

  await recordAudit({
    userId: req.user?.id,
    action: 'FARMER_CREATED',
    entityType: 'farmers',
    entityId: created.id,
    after: { farmer_code: created.farmer_code, full_name: created.full_name, village_id: created.village_id },
    req,
  });

  res.status(201).json({ data: created });
}

export async function updateFarmer(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;
  const updates = updateFarmerSchema.parse(req.body);

  const existingRes = await db.query('SELECT * FROM farmers WHERE id = $1', [id]);
  if (existingRes.rows.length === 0) {
    throw new AppError('Farmer not found', 404, 'NOT_FOUND');
  }
  const before = existingRes.rows[0];

  const fullName = updates.full_name ?? before.full_name;
  const villageId = updates.village_id ?? before.village_id;
  const address = updates.address !== undefined ? updates.address : before.address;
  const gramPanchayat = updates.gram_panchayat !== undefined ? updates.gram_panchayat : before.gram_panchayat;
  const preferredLang = updates.preferred_language ?? before.preferred_language;
  const callStart = updates.call_window_start ?? before.call_window_start;
  const callEnd = updates.call_window_end ?? before.call_window_end;
  const notes = updates.notes !== undefined ? updates.notes : before.notes;

  const resFarmer = await db.query(`
    UPDATE farmers
    SET full_name = $1, village_id = $2, address = $3, gram_panchayat = $4,
        preferred_language = $5, call_window_start = $6, call_window_end = $7,
        notes = $8, updated_at = CURRENT_TIMESTAMP
    WHERE id = $9
    RETURNING *
  `, [fullName, villageId, address, gramPanchayat, preferredLang, callStart, callEnd, notes, id]);

  const after = resFarmer.rows[0];

  await recordAudit({
    userId: req.user?.id,
    action: 'FARMER_UPDATED',
    entityType: 'farmers',
    entityId: id,
    before: { full_name: before.full_name, village_id: before.village_id },
    after: { full_name: after.full_name, village_id: after.village_id },
    req,
  });

  res.json({ data: after });
}

export async function deactivateFarmer(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;

  const resFarmer = await db.query(`
    UPDATE farmers
    SET status = 'inactive', updated_at = CURRENT_TIMESTAMP
    WHERE id = $1
    RETURNING id, farmer_code, full_name, status
  `, [id]);

  if (resFarmer.rows.length === 0) {
    throw new AppError('Farmer not found', 404, 'NOT_FOUND');
  }

  await recordAudit({
    userId: req.user?.id,
    action: 'FARMER_DEACTIVATED',
    entityType: 'farmers',
    entityId: id,
    after: { status: 'inactive' },
    req,
  });

  res.json({ data: resFarmer.rows[0] });
}

export async function reactivateFarmer(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;

  const resFarmer = await db.query(`
    UPDATE farmers
    SET status = 'active', updated_at = CURRENT_TIMESTAMP
    WHERE id = $1
    RETURNING id, farmer_code, full_name, status
  `, [id]);

  if (resFarmer.rows.length === 0) {
    throw new AppError('Farmer not found', 404, 'NOT_FOUND');
  }

  await recordAudit({
    userId: req.user?.id,
    action: 'FARMER_REACTIVATED',
    entityType: 'farmers',
    entityId: id,
    after: { status: 'active' },
    req,
  });

  res.json({ data: resFarmer.rows[0] });
}

export async function getFarmerHistory(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;

  const historyRes = await db.query(`
    SELECT a.id, a.action, a.entity_type, a.before, a.after, a.created_at, u.name as user_name
    FROM audit_logs a
    LEFT JOIN users u ON a.user_id = u.id
    WHERE a.entity_id = $1 OR (a.after->>'farmer_id' = $1)
    ORDER BY a.created_at DESC
    LIMIT 50
  `, [id]);

  res.json({ data: historyRes.rows });
}

export async function addContact(req: Request, res: Response): Promise<void> {
  const farmerId = req.params.id as string;
  const data = createContactSchema.parse(req.body);
  const phoneNormalized = normalizePhone(data.phone);

  const resContact = await db.query(`
    INSERT INTO farmer_contacts (farmer_id, phone_e164, type, is_active, is_verified)
    VALUES ($1, $2, $3, true, $4)
    RETURNING *
  `, [farmerId, phoneNormalized, data.type, data.is_verified]);

  await recordAudit({
    userId: req.user?.id,
    action: 'FARMER_CONTACT_ADDED',
    entityType: 'farmer_contacts',
    entityId: resContact.rows[0].id,
    after: { farmer_id: farmerId, type: data.type },
    req,
  });

  res.status(201).json({ data: resContact.rows[0] });
}

export async function recordConsent(req: Request, res: Response): Promise<void> {
  const farmerId = req.params.id as string;
  const data = recordConsentSchema.parse(req.body);

  const resConsent = await db.query(`
    INSERT INTO consents (farmer_id, channel, status, method, recorded_by, note)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
  `, [farmerId, data.channel, data.status, data.method, req.user?.id || null, data.note || null]);

  await recordAudit({
    userId: req.user?.id,
    action: 'FARMER_CONSENT_RECORDED',
    entityType: 'consents',
    entityId: resConsent.rows[0].id,
    after: { farmer_id: farmerId, channel: data.channel, status: data.status },
    req,
  });

  res.status(201).json({ data: resConsent.rows[0] });
}

export async function importFarmers(req: Request, res: Response): Promise<void> {
  const { rows, dryRun = true } = req.body;

  if (!Array.isArray(rows) || rows.length === 0) {
    throw new AppError('A valid array of farmer rows is required for import.', 400, 'EMPTY_IMPORT');
  }

  const villagesRes = await db.query('SELECT id, name FROM villages');
  const villageMap = new Map(villagesRes.rows.map(v => [v.name.toLowerCase().trim(), v.id]));

  const results: any[] = [];
  const errors: { row: number; field: string; message: string }[] = [];
  const seenPhones = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i];
    const rowNum = i + 1;

    try {
      let normalizedPhone: string;
      try {
        normalizedPhone = normalizePhone(raw.phone);
      } catch (err: any) {
        errors.push({ row: rowNum, field: 'phone', message: err.message });
        continue;
      }

      if (seenPhones.has(normalizedPhone)) {
        errors.push({ row: rowNum, field: 'phone', message: `Duplicate phone in CSV: ${normalizedPhone}` });
        continue;
      }
      seenPhones.add(normalizedPhone);

      const villageId = villageMap.get(raw.village_name?.toLowerCase().trim());
      if (!villageId) {
        errors.push({ row: rowNum, field: 'village_name', message: `Unknown village: "${raw.village_name}". Available villages: ${Array.from(villageMap.keys()).join(', ')}` });
        continue;
      }

      const farmerData = {
        row: rowNum,
        full_name: raw.full_name,
        village_id: villageId,
        village_name: raw.village_name,
        phone: normalizedPhone,
        address: raw.address || null,
        gram_panchayat: raw.gram_panchayat || null,
        call_window_start: raw.call_window_start || '09:00:00',
        call_window_end: raw.call_window_end || '18:00:00',
        voice_consent: raw.voice_consent !== false,
        sms_consent: raw.sms_consent !== false,
      };

      results.push(farmerData);
    } catch (err: any) {
      errors.push({ row: rowNum, field: 'general', message: err.message });
    }
  }

  if (dryRun) {
    res.json({
      data: {
        dryRun: true,
        totalRows: rows.length,
        validCount: results.length,
        errorCount: errors.length,
        preview: results.slice(0, 10),
        errors,
      },
    });
    return;
  }

  // Execute Real Import
  const importedFarmers = await withTransaction(async (tx) => {
    const imported: any[] = [];
    for (const item of results) {
      const farmerCode = `FARM-AP-${Math.floor(100000 + Math.random() * 900000)}`;

      const fRes = await tx.query(`
        INSERT INTO farmers (
          farmer_code, full_name, village_id, address, gram_panchayat,
          preferred_language, call_window_start, call_window_end,
          status, data_source, data_origin, created_by
        )
        VALUES ($1, $2, $3, $4, $5, 'te', $6, $7, 'active', 'survey', 'real', $8)
        RETURNING *
      `, [
        farmerCode, item.full_name, item.village_id, item.address, item.gram_panchayat,
        item.call_window_start, item.call_window_end, req.user?.id || null,
      ]);

      const farmer = fRes.rows[0];

      await tx.query(`
        INSERT INTO farmer_contacts (farmer_id, phone_e164, type, is_active, is_verified)
        VALUES ($1, $2, 'primary', true, true)
      `, [farmer.id, item.phone]);

      if (item.voice_consent) {
        await tx.query(`
          INSERT INTO consents (farmer_id, channel, status, method, recorded_by, note)
          VALUES ($1, 'voice', 'granted', 'written', $2, 'CSV bulk import consent')
        `, [farmer.id, req.user?.id || null]);
      }

      imported.push(farmer);
    }
    return imported;
  });

  await recordAudit({
    userId: req.user?.id,
    action: 'FARMERS_BULK_IMPORTED',
    entityType: 'farmers',
    after: { count: importedFarmers.length },
    req,
  });

  res.status(201).json({
    data: {
      dryRun: false,
      importedCount: importedFarmers.length,
      errors,
    },
  });
}
