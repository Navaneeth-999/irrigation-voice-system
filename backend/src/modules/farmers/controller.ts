import crypto from 'crypto';
import twilio from 'twilio';
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
  sendOtpSchema,
  verifyOtpSchema,
} from './schemas.js';

// In-memory OTP storage fallback
const otpStore = new Map<string, { hash: string; expiresAt: number; attempts: number }>();

export async function listFarmers(req: Request, res: Response): Promise<void> {
  const { search, village_id, status, data_origin } = req.query;
  const user = req.user;

  // Role-based village scoping
  const scopedVillages = getScopedVillageFilter(user);

  let query = `
    SELECT f.id, f.farmer_code, f.full_name, f.village_id, v.name as village_name,
           v.mandal, v.district, f.gram_panchayat, f.preferred_language,
           f.call_window_start, f.call_window_end, f.status, f.data_source, f.data_origin,
           f.notes, f.created_at, f.updated_at,
           COALESCE(f.phone_verified, false) as phone_verified,
           c.phone_e164 as primary_phone,
           (SELECT COUNT(*)::int FROM plots p WHERE p.farmer_id = f.id AND p.is_active = true) as active_plots_count,
           (SELECT p.area_acres FROM plots p WHERE p.farmer_id = f.id AND p.is_active = true ORDER BY p.created_at ASC LIMIT 1) as land_area_acres,
           (SELECT cr.name FROM seasons s JOIN crops cr ON s.crop_id = cr.id WHERE s.farmer_id = f.id ORDER BY s.created_at DESC LIMIT 1) as crop_name,
           (SELECT cr.id FROM seasons s JOIN crops cr ON s.crop_id = cr.id WHERE s.farmer_id = f.id ORDER BY s.created_at DESC LIMIT 1) as crop_id,
           (SELECT wst.code FROM plots p JOIN plot_water_sources pws ON p.id = pws.plot_id JOIN water_source_types wst ON pws.water_source_type_id = wst.id WHERE p.farmer_id = f.id ORDER BY p.created_at ASC LIMIT 1) as water_source
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

  const villageFilter = village_id || req.query.villageId;
  if (villageFilter) {
    params.push(villageFilter);
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
    SELECT f.*, v.name as village_name, v.mandal, v.district,
           COALESCE(f.phone_verified, false) as phone_verified,
           (SELECT p.area_acres FROM plots p WHERE p.farmer_id = f.id AND p.is_active = true ORDER BY p.created_at ASC LIMIT 1) as land_area_acres,
           (SELECT cr.name FROM seasons s JOIN crops cr ON s.crop_id = cr.id WHERE s.farmer_id = f.id ORDER BY s.created_at DESC LIMIT 1) as crop_name,
           (SELECT cr.id FROM seasons s JOIN crops cr ON s.crop_id = cr.id WHERE s.farmer_id = f.id ORDER BY s.created_at DESC LIMIT 1) as crop_id,
           (SELECT wst.code FROM plots p JOIN plot_water_sources pws ON p.id = pws.plot_id JOIN water_source_types wst ON pws.water_source_type_id = wst.id WHERE p.farmer_id = f.id ORDER BY p.created_at ASC LIMIT 1) as water_source
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

  const primaryContact = contactsRes.rows.find(c => c.type === 'primary');

  // Fetch summary counts for the farmer profile
  const countsRes = await db.query(`
    SELECT
      (SELECT COUNT(*)::int FROM certificates WHERE farmer_id = $1) as certificates_count,
      (SELECT COUNT(*)::int FROM call_attempts WHERE farmer_id = $1) +
      (SELECT COUNT(*)::int FROM communication_logs WHERE farmer_id = $1 AND id NOT IN (SELECT communication_log_id FROM call_attempts WHERE communication_log_id IS NOT NULL)) as communications_count,
      (SELECT COUNT(*)::int FROM field_surveys WHERE farmer_id = $1) as surveys_count,
      (SELECT COUNT(*)::int FROM seasons WHERE farmer_id = $1 AND status = 'active') as active_seasons_count,
      (SELECT COUNT(*)::int FROM seasons WHERE farmer_id = $1) as total_seasons_count
  `, [id]);
  const counts = countsRes.rows[0] || {};

  res.json({
    data: {
      ...farmer,
      ...counts,
      primary_phone: primaryContact ? maskPhone(primaryContact.phone_e164, role) : null,
      primary_phone_raw: role === 'ADMIN' || role === 'CSP_MEMBER' ? primaryContact?.phone_e164 : undefined,
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
        status, data_source, data_origin, notes, created_by,
        phone_verified
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active', $9, $10, $11, $12, false)
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
      VALUES ($1, $2, 'primary', true, false)
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

  const scopedVillages = getScopedVillageFilter(req.user);
  if (scopedVillages !== null && !scopedVillages.includes(before.village_id)) {
    throw new AppError('Forbidden: You do not have permission to modify farmers in this village.', 403, 'FORBIDDEN');
  }

  const updatedFarmer = await withTransaction(async (tx) => {
    // 1. Resolve Village if specified
    let targetVillageId = before.village_id;
    const villageInput = updates.village_id || updates.village;
    if (villageInput) {
      const vRes = await tx.query(`SELECT id FROM villages WHERE id::text = $1 OR name ILIKE $1 LIMIT 1`, [villageInput]);
      if (vRes.rows.length > 0) {
        targetVillageId = vRes.rows[0].id;
      }
    }

    // 2. Update Farmers table
    const fullName = updates.full_name || updates.name || before.full_name;
    const address = updates.address !== undefined ? updates.address : before.address;
    const gramPanchayat = updates.gram_panchayat !== undefined ? updates.gram_panchayat : before.gram_panchayat;
    const preferredLang = updates.preferred_language ?? before.preferred_language;
    const callStart = updates.call_window_start ?? before.call_window_start;
    const callEnd = updates.call_window_end ?? before.call_window_end;
    const notes = updates.notes !== undefined ? updates.notes : before.notes;

    const resFarmer = await tx.query(`
      UPDATE farmers
      SET full_name = $1, village_id = $2, address = $3, gram_panchayat = $4,
          preferred_language = $5, call_window_start = $6, call_window_end = $7,
          notes = $8, updated_at = CURRENT_TIMESTAMP
      WHERE id = $9
      RETURNING *
    `, [fullName, targetVillageId, address, gramPanchayat, preferredLang, callStart, callEnd, notes, id]);

    let farmerRow = resFarmer.rows[0];

    // 3. Handle Phone update (Reset phone_verified to false if changed)
    const phoneInput = updates.phone || updates.phone_number;
    if (phoneInput) {
      const normalizedPhone = normalizePhone(phoneInput);
      const contactRes = await tx.query(
        `SELECT id, phone_e164 FROM farmer_contacts WHERE farmer_id = $1 AND type = 'primary' LIMIT 1`,
        [id]
      );

      if (contactRes.rows.length === 0 || contactRes.rows[0].phone_e164 !== normalizedPhone) {
        // Phone number changed: reset phone_verified to false
        const fUp = await tx.query(
          `UPDATE farmers SET phone_verified = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *`,
          [id]
        );
        farmerRow = fUp.rows[0];

        if (contactRes.rows.length > 0) {
          await tx.query(
            `UPDATE farmer_contacts
             SET phone_e164 = $1, is_verified = false, updated_at = CURRENT_TIMESTAMP
             WHERE id = $2`,
            [normalizedPhone, contactRes.rows[0].id]
          );
        } else {
          await tx.query(
            `INSERT INTO farmer_contacts (farmer_id, phone_e164, type, is_active, is_verified)
             VALUES ($1, $2, 'primary', true, false)`,
            [id, normalizedPhone]
          );
        }
      }
    }

    // 4. Handle Land Area (Acres)
    let plotId: string | null = null;
    const plotRes = await tx.query(
      `SELECT id FROM plots WHERE farmer_id = $1 AND is_active = true ORDER BY created_at ASC LIMIT 1`,
      [id]
    );

    if (updates.land_area_acres !== undefined) {
      if (plotRes.rows.length > 0) {
        plotId = plotRes.rows[0].id;
        await tx.query(
          `UPDATE plots SET area_acres = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
          [updates.land_area_acres, plotId]
        );
      } else {
        const newPlot = await tx.query(
          `INSERT INTO plots (farmer_id, label, area_acres) VALUES ($1, 'Main Plot', $2) RETURNING id`,
          [id, updates.land_area_acres]
        );
        plotId = newPlot.rows[0].id;
      }

      // Update active season area snapshot
      await tx.query(
        `UPDATE seasons SET area_acres_snapshot = $1, updated_at = CURRENT_TIMESTAMP WHERE farmer_id = $2 AND status = 'active'`,
        [updates.land_area_acres, id]
      );
    } else if (plotRes.rows.length > 0) {
      plotId = plotRes.rows[0].id;
    }

    // 5. Handle Water Source
    if (updates.water_source) {
      const wstRes = await tx.query(
        `SELECT id FROM water_source_types WHERE code = $1 OR id::text = $1 LIMIT 1`,
        [updates.water_source]
      );
      if (wstRes.rows.length > 0) {
        const wstId = wstRes.rows[0].id;
        if (!plotId) {
          const newPlot = await tx.query(
            `INSERT INTO plots (farmer_id, label, area_acres) VALUES ($1, 'Main Plot', 1.0) RETURNING id`,
            [id]
          );
          plotId = newPlot.rows[0].id;
        }

        const pwsRes = await tx.query(
          `SELECT id FROM plot_water_sources WHERE plot_id = $1 AND is_primary = true LIMIT 1`,
          [plotId]
        );
        if (pwsRes.rows.length > 0) {
          await tx.query(
            `UPDATE plot_water_sources SET water_source_type_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
            [wstId, pwsRes.rows[0].id]
          );
        } else {
          await tx.query(
            `INSERT INTO plot_water_sources (plot_id, water_source_type_id, is_primary) VALUES ($1, $2, true)`,
            [plotId, wstId]
          );
        }
      }
    }

    // 6. Handle Crop Type
    if (updates.crop_type) {
      const crRes = await tx.query(
        `SELECT id FROM crops WHERE id::text = $1 OR name ILIKE $1 OR name_te ILIKE $1 LIMIT 1`,
        [updates.crop_type]
      );
      if (crRes.rows.length > 0) {
        const cropId = crRes.rows[0].id;
        const seasonRes = await tx.query(
          `SELECT id FROM seasons WHERE farmer_id = $1 AND status = 'active' ORDER BY created_at DESC LIMIT 1`,
          [id]
        );
        if (seasonRes.rows.length > 0) {
          await tx.query(
            `UPDATE seasons SET crop_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
            [cropId, seasonRes.rows[0].id]
          );
        }
      }
    }

    return farmerRow;
  });

  await recordAudit({
    userId: req.user?.id,
    action: 'FARMER_UPDATED',
    entityType: 'farmers',
    entityId: id,
    before: { full_name: before.full_name, village_id: before.village_id },
    after: { full_name: updatedFarmer.full_name, village_id: updatedFarmer.village_id },
    req,
  });

  res.json({ data: updatedFarmer });
}

export async function sendFarmerOtp(req: Request, res: Response): Promise<void> {
  const data = sendOtpSchema.parse(req.body);
  const normalizedPhone = normalizePhone(data.phone);

  // Generate 6-digit OTP
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const hash = crypto.createHash('sha256').update(otp).digest('hex');
  const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

  // In-memory store
  otpStore.set(normalizedPhone, { hash, expiresAt, attempts: 0 });

  // Update in DB if farmer exists
  let farmerId = data.farmerId;
  if (!farmerId) {
    const fRes = await db.query(
      `SELECT f.id FROM farmers f JOIN farmer_contacts fc ON f.id = fc.farmer_id WHERE fc.phone_e164 = $1 LIMIT 1`,
      [normalizedPhone]
    );
    if (fRes.rows.length > 0) {
      farmerId = fRes.rows[0].id;
    }
  }

  if (farmerId) {
    await db.query(
      `UPDATE farmers
       SET otp_code_hash = $1,
           otp_expires_at = NOW() + INTERVAL '10 minutes',
           otp_attempts = 0,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [hash, farmerId]
    );
  }

  let smsSent = false;
  let smsError: string | null = null;

  if (data.mode === 'live') {
    const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID;
    const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
    const twilioPhone = process.env.TWILIO_PHONE_NUMBER;

    if (twilioAccountSid && twilioAuthToken && twilioPhone) {
      try {
        const client = twilio(twilioAccountSid, twilioAuthToken);
        const messageBody = `స్మార్ట్ సాగు నీటి సలహా వ్యవస్థ: మీ ధృవీకరణ కోడ్ ${otp}. ఇది 10 నిమిషాలు మాత్రమే చెల్లుతుంది. / Smart Irrigation Advisory OTP: ${otp}. Valid for 10 min.`;
        await client.messages.create({
          to: normalizedPhone,
          from: twilioPhone,
          body: messageBody,
        });
        smsSent = true;
      } catch (err: any) {
        smsError = err.message || 'SMS delivery failed';
        console.error('Twilio OTP SMS delivery error:', err);
      }
    } else {
      smsError = 'Twilio not configured for live SMS delivery.';
    }
  }

  res.json({
    success: true,
    message: smsSent ? 'OTP sent via SMS' : (data.mode === 'live' ? `OTP simulated (${smsError})` : 'OTP sent (Simulation)'),
    phone: normalizedPhone,
    mode: data.mode,
    expiresInSeconds: 600,
    ...(data.mode === 'simulation' || process.env.NODE_ENV !== 'production' ? { devOtp: otp } : {}),
  });
}

export async function verifyFarmerOtp(req: Request, res: Response): Promise<void> {
  const data = verifyOtpSchema.parse(req.body);
  const normalizedPhone = normalizePhone(data.phone);
  const submittedHash = crypto.createHash('sha256').update(data.otp).digest('hex');

  let stored = otpStore.get(normalizedPhone);

  let dbFarmer: any = null;
  if (data.farmerId) {
    const fRes = await db.query(`SELECT id, otp_code_hash, otp_expires_at, otp_attempts FROM farmers WHERE id = $1`, [data.farmerId]);
    if (fRes.rows.length > 0) dbFarmer = fRes.rows[0];
  } else {
    const fRes = await db.query(
      `SELECT f.id, f.otp_code_hash, f.otp_expires_at, f.otp_attempts
       FROM farmers f
       JOIN farmer_contacts fc ON f.id = fc.farmer_id
       WHERE fc.phone_e164 = $1
       LIMIT 1`,
      [normalizedPhone]
    );
    if (fRes.rows.length > 0) dbFarmer = fRes.rows[0];
  }

  const hashToMatch = dbFarmer?.otp_code_hash || stored?.hash;
  const attempts = (dbFarmer?.otp_attempts ?? stored?.attempts ?? 0);
  const expiresAtTime = dbFarmer?.otp_expires_at ? new Date(dbFarmer.otp_expires_at).getTime() : stored?.expiresAt;

  if (!hashToMatch) {
    throw new AppError('No OTP was requested for this phone number or it has expired.', 400, 'INVALID_OTP');
  }

  if (attempts >= 3) {
    throw new AppError('Too many failed attempts. Please request a new OTP.', 400, 'MAX_ATTEMPTS_EXCEEDED');
  }

  if (expiresAtTime && Date.now() > expiresAtTime) {
    throw new AppError('OTP has expired. Please request a new OTP.', 400, 'OTP_EXPIRED');
  }

  if (submittedHash !== hashToMatch) {
    if (stored) stored.attempts += 1;
    if (dbFarmer) {
      await db.query(`UPDATE farmers SET otp_attempts = otp_attempts + 1 WHERE id = $1`, [dbFarmer.id]);
    }
    const remaining = 3 - (attempts + 1);
    throw new AppError(`Invalid OTP. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`, 400, 'INVALID_OTP');
  }

  // OTP Verified Successfully
  otpStore.delete(normalizedPhone);

  if (dbFarmer) {
    await db.query(
      `UPDATE farmers
       SET phone_verified = true,
           otp_code_hash = NULL,
           otp_expires_at = NULL,
           otp_attempts = 0,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [dbFarmer.id]
    );

    await db.query(
      `UPDATE farmer_contacts
       SET is_verified = true, updated_at = CURRENT_TIMESTAMP
       WHERE farmer_id = $1 AND phone_e164 = $2`,
      [dbFarmer.id, normalizedPhone]
    );
  }

  res.json({
    success: true,
    message: 'Phone number verified successfully.',
    phone_verified: true,
  });
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
