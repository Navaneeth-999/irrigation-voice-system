import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { db, withTransaction } from '../../db/index.js';
import { config } from '../../config/index.js';
import {
  FieldObservation,
  CreateObservationDTO,
  UpdateObservationDTO,
  WithdrawConsentDTO,
  SurveySummary,
  ObservationCategory,
  ConsentMethod,
} from './types.js';

export class ObservationService {
  private storageDir: string;

  constructor() {
    this.storageDir = path.resolve(process.cwd(), config.STORAGE_LOCAL_DIR, 'observations');
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
  }

  /**
   * Validates image magic bytes, MIME type, and size to ensure genuine photographic files.
   * Rejects renamed binaries or executable payloads.
   */
  validateImageBuffer(buffer: Buffer, originalMime: string): { isValid: boolean; detectedMime: string; extension: string } {
    if (!buffer || buffer.length === 0) {
      throw new Error('Image file is empty');
    }

    if (buffer.length > 5 * 1024 * 1024) {
      throw new Error('Image file size exceeds maximum permitted limit (5 MB)');
    }

    // Inspect Magic Bytes
    // JPEG: FF D8 FF
    const isJpeg = buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;

    // PNG: 89 50 4E 47 0D 0A 1A 0A
    const isPng =
      buffer.length >= 8 &&
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer[4] === 0x0d &&
      buffer[5] === 0x0a &&
      buffer[6] === 0x1a &&
      buffer[7] === 0x0a;

    // WebP: 'RIFF' .... 'WEBP'
    const isWebp =
      buffer.length >= 12 &&
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP';

    if (!isJpeg && !isPng && !isWebp) {
      throw new Error('Invalid image file: File signature does not match supported image formats (JPEG, PNG, WebP)');
    }

    if (isJpeg) return { isValid: true, detectedMime: 'image/jpeg', extension: '.jpg' };
    if (isPng) return { isValid: true, detectedMime: 'image/png', extension: '.png' };
    return { isValid: true, detectedMime: 'image/webp', extension: '.webp' };
  }

  /**
   * Strips APP1 (EXIF, GPS, XMP), APP13 (IPTC), and COM segments from JPEG images.
   */
  stripExifFromJpeg(buffer: Buffer): Buffer {
    if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
      return buffer;
    }

    const chunks: Buffer[] = [buffer.subarray(0, 2)]; // Keep SOI (FF D8)
    let pos = 2;

    while (pos < buffer.length) {
      if (buffer[pos] !== 0xff) {
        chunks.push(buffer.subarray(pos));
        break;
      }

      const marker = buffer[pos + 1];

      // EOI (End of image)
      if (marker === 0xd9) {
        chunks.push(buffer.subarray(pos));
        break;
      }

      // RST markers or escaped 0xFF 0x00
      if (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7)) {
        chunks.push(buffer.subarray(pos, pos + 2));
        pos += 2;
        continue;
      }

      if (pos + 4 > buffer.length) {
        chunks.push(buffer.subarray(pos));
        break;
      }

      const segmentLength = buffer.readUInt16BE(pos + 2);
      if (segmentLength < 2 || pos + 2 + segmentLength > buffer.length) {
        chunks.push(buffer.subarray(pos));
        break;
      }

      // Strip APP1 (0xE1: EXIF, GPS, XMP), APP13 (0xED: IPTC), COM (0xFE)
      if (marker === 0xe1 || marker === 0xed || marker === 0xfe) {
        pos += 2 + segmentLength;
        continue;
      }

      // Start of Scan (0xDA) marks compressed image data till end
      if (marker === 0xda) {
        chunks.push(buffer.subarray(pos));
        break;
      }

      chunks.push(buffer.subarray(pos, pos + 2 + segmentLength));
      pos += 2 + segmentLength;
    }

    return Buffer.concat(chunks);
  }

  /**
   * Strips metadata chunks (eXIf, tEXt, zTXt, iTXt) from PNG images.
   */
  stripExifFromPng(buffer: Buffer): Buffer {
    const pngSig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (buffer.length < 8 || !buffer.subarray(0, 8).equals(pngSig)) {
      return buffer;
    }

    const chunks: Buffer[] = [buffer.subarray(0, 8)];
    let pos = 8;
    const metadataChunks = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt']);

    while (pos + 8 <= buffer.length) {
      const length = buffer.readUInt32BE(pos);
      const chunkType = buffer.subarray(pos + 4, pos + 8).toString('ascii');
      const totalChunkLength = 4 + 4 + length + 4;

      if (pos + totalChunkLength > buffer.length) {
        chunks.push(buffer.subarray(pos));
        break;
      }

      if (metadataChunks.has(chunkType)) {
        pos += totalChunkLength;
        continue;
      }

      chunks.push(buffer.subarray(pos, pos + totalChunkLength));
      pos += totalChunkLength;

      if (chunkType === 'IEND') {
        break;
      }
    }

    return Buffer.concat(chunks);
  }

  /**
   * Strips EXIF and XMP chunks from WebP images.
   */
  stripExifFromWebp(buffer: Buffer): Buffer {
    if (buffer.length < 12) return buffer;
    const isRiff = buffer.subarray(0, 4).toString('ascii') === 'RIFF';
    const isWebp = buffer.subarray(8, 12).toString('ascii') === 'WEBP';
    if (!isRiff || !isWebp) return buffer;

    const chunks: Buffer[] = [];
    let pos = 12;

    while (pos + 8 <= buffer.length) {
      const fourCC = buffer.subarray(pos, pos + 4).toString('ascii');
      const chunkSize = buffer.readUInt32LE(pos + 4);
      const paddedSize = chunkSize + (chunkSize % 2);
      const totalChunkLength = 8 + paddedSize;

      if (pos + totalChunkLength > buffer.length) {
        chunks.push(buffer.subarray(pos));
        break;
      }

      if (fourCC === 'EXIF' || fourCC === 'XMP ') {
        pos += totalChunkLength;
        continue;
      }

      if (fourCC === 'VP8X' && chunkSize >= 10) {
        const vp8xChunk = Buffer.from(buffer.subarray(pos, pos + totalChunkLength));
        vp8xChunk[8] = vp8xChunk[8] & ~0x0c; // Clear EXIF and XMP flags
        chunks.push(vp8xChunk);
        pos += totalChunkLength;
        continue;
      }

      chunks.push(buffer.subarray(pos, pos + totalChunkLength));
      pos += totalChunkLength;
    }

    const payload = Buffer.concat(chunks);
    const header = Buffer.alloc(12);
    header.write('RIFF', 0, 'ascii');
    header.writeUInt32LE(4 + payload.length, 4);
    header.write('WEBP', 8, 'ascii');

    return Buffer.concat([header, payload]);
  }

  /**
   * Scrubs EXIF and device/GPS metadata from image buffer before saving.
   */
  scrubExifMetadata(buffer: Buffer, mimeType: string): Buffer {
    if (mimeType === 'image/jpeg') {
      return this.stripExifFromJpeg(buffer);
    } else if (mimeType === 'image/png') {
      return this.stripExifFromPng(buffer);
    } else if (mimeType === 'image/webp') {
      return this.stripExifFromWebp(buffer);
    }
    return buffer;
  }

  /**
   * Creates a new field observation with private image storage and consent verification.
   */
  async createObservation(
    dto: CreateObservationDTO,
    fileBuffer: Buffer,
    userId?: string
  ): Promise<FieldObservation> {
    const { isValid, detectedMime, extension } = this.validateImageBuffer(fileBuffer, '');
    if (!isValid) {
      throw new Error('Invalid image file');
    }

    // Verify village existence
    const villageRes = await db.query(`SELECT id FROM villages WHERE id = $1`, [dto.villageId]);
    if (villageRes.rows.length === 0) {
      throw new Error(`Village with ID ${dto.villageId} not found`);
    }

    // Scrub EXIF and GPS metadata before storing on disk to protect participant privacy
    const sanitizedBuffer = this.scrubExifMetadata(fileBuffer, detectedMime);

    // Generate randomized non-guessable storage key
    const photoStorageKey = `obs_${crypto.randomUUID()}${extension}`;
    const filePath = path.join(this.storageDir, photoStorageKey);

    // Save image to private storage directory
    try {
      fs.writeFileSync(filePath, sanitizedBuffer);
    } catch (err: any) {
      throw new Error(`Failed to write observation image to storage: ${err.message}`);
    }

    try {
      const res = await db.query(
        `INSERT INTO field_observations (
          village_id, farmer_id, plot_id, observation_date, category, title, caption,
          photo_storage_key, file_size_bytes, mime_type, surveyor_name,
          consent_verified, consent_method, consent_notes, is_published, created_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        RETURNING *`,
        [
          dto.villageId,
          dto.farmerId || null,
          dto.plotId || null,
          dto.observationDate,
          dto.category,
          dto.title.trim(),
          dto.caption.trim(),
          photoStorageKey,
          sanitizedBuffer.length,
          detectedMime,
          dto.surveyorName?.trim() || null,
          Boolean(dto.consentVerified),
          dto.consentMethod || 'not_applicable',
          dto.consentNotes?.trim() || null,
          dto.isPublished !== undefined ? Boolean(dto.isPublished) : true,
          userId || null,
        ]
      );

      return this.mapObservationRow(res.rows[0], userId ? { id: userId, role: 'CSP_MEMBER' } : undefined);
    } catch (err: any) {
      // Clean up orphaned disk file on database insertion failure
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch {
          // ignore cleanup error
        }
      }
      throw err;
    }
  }

  /**
   * Lists observations with village scoping, category filtering, and consent filters.
   */
  async listObservations(
    scopedVillages: string[] | null,
    options: {
      category?: ObservationCategory;
      villageId?: string;
      search?: string;
      onlyWithConsent?: boolean;
      page?: number;
      limit?: number;
    } = {},
    requestingUser?: { id: string; role: string }
  ): Promise<{ data: FieldObservation[]; total: number; page: number; limit: number; totalPages: number }> {
    const page = Math.max(1, options.page || 1);
    const limit = Math.min(100, Math.max(1, options.limit || 20));
    const offset = (page - 1) * limit;

    const conditions: string[] = ['fo.is_published = true'];
    const params: any[] = [];
    let pIdx = 1;

    // Enforce AGRI_PANCHAYAT village scoping
    if (scopedVillages !== null) {
      if (scopedVillages.length === 0) {
        return { data: [], total: 0, page, limit, totalPages: 0 };
      }
      conditions.push(`fo.village_id = ANY($${pIdx++})`);
      params.push(scopedVillages);
    }

    if (options.villageId) {
      conditions.push(`fo.village_id = $${pIdx++}`);
      params.push(options.villageId);
    }

    if (options.category) {
      conditions.push(`fo.category = $${pIdx++}`);
      params.push(options.category);
    }

    // Hide photos where consent was explicitly withdrawn
    conditions.push('fo.consent_withdrawn = false');

    if (options.onlyWithConsent) {
      conditions.push('fo.consent_verified = true');
    }

    if (options.search) {
      conditions.push(`(fo.title ILIKE $${pIdx} OR fo.caption ILIKE $${pIdx} OR fo.surveyor_name ILIKE $${pIdx})`);
      params.push(`%${options.search.trim()}%`);
      pIdx++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRes = await db.query(
      `SELECT count(*) as total FROM field_observations fo ${whereClause}`,
      params
    );
    const total = parseInt(countRes.rows[0].total, 10);

    const queryParams = [...params, limit, offset];
    const dataRes = await db.query(
      `SELECT fo.*, v.name as village_name, v.mandal, v.district, u.name as created_by_name,
              f.full_name as farmer_name, f.farmer_code
       FROM field_observations fo
       JOIN villages v ON v.id = fo.village_id
       LEFT JOIN users u ON u.id = fo.created_by
       LEFT JOIN farmers f ON f.id = fo.farmer_id
       ${whereClause}
       ORDER BY fo.observation_date DESC, fo.created_at DESC
       LIMIT $${pIdx++} OFFSET $${pIdx++}`,
      queryParams
    );

    return {
      data: dataRes.rows.map((r) => this.mapObservationRow(r, requestingUser)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Fetches single observation record with village scope validation.
   */
  async getObservationById(
    id: string,
    scopedVillages: string[] | null,
    requestingUser?: { id: string; role: string }
  ): Promise<FieldObservation | null> {
    const res = await db.query(
      `SELECT fo.*, v.name as village_name, v.mandal, v.district, u.name as created_by_name,
              f.full_name as farmer_name, f.farmer_code
       FROM field_observations fo
       JOIN villages v ON v.id = fo.village_id
       LEFT JOIN users u ON u.id = fo.created_by
       LEFT JOIN farmers f ON f.id = fo.farmer_id
       WHERE fo.id = $1`,
      [id]
    );

    if (res.rows.length === 0) return null;

    const row = res.rows[0];
    if (scopedVillages !== null && !scopedVillages.includes(row.village_id)) {
      throw new Error('Forbidden: Observation outside assigned village scope');
    }

    return this.mapObservationRow(row, requestingUser);
  }

  /**
   * Retrieves private photo buffer and MIME type for authenticated streaming.
   * Enforces village scope and consent checks.
   */
  async getObservationPhoto(
    id: string,
    scopedVillages: string[] | null,
    requestingUser?: { id: string; role: string }
  ): Promise<{ buffer: Buffer; mimeType: string; filename: string }> {
    const res = await db.query(
      `SELECT id, village_id, photo_storage_key, mime_type, consent_verified, 
              consent_withdrawn, category, created_by
       FROM field_observations
       WHERE id = $1`,
      [id]
    );

    if (res.rows.length === 0) {
      throw new Error(`Observation ${id} not found`);
    }

    const obs = res.rows[0];

    // Village scoping check
    if (scopedVillages !== null && !scopedVillages.includes(obs.village_id)) {
      throw new Error('Forbidden: Access outside assigned village scope');
    }

    // Consent check: if consent was withdrawn, block photo delivery
    if (obs.consent_withdrawn) {
      throw new Error('Forbidden: Participant consent has been withdrawn for this record');
    }

    // For farmer interviews, require verified consent unless user is ADMIN or the author CSP member
    const isOwnerOrAdmin =
      requestingUser &&
      (requestingUser.role === 'ADMIN' ||
        (requestingUser.role === 'CSP_MEMBER' && obs.created_by === requestingUser.id));

    if (obs.category === 'farmer_interview' && !obs.consent_verified && !isOwnerOrAdmin) {
      throw new Error('Photo restricted: Participant consent verification pending');
    }

    // Prevent path traversal and enforce storage boundary
    const safeKey = path.basename(obs.photo_storage_key);
    const resolvedPath = path.resolve(this.storageDir, safeKey);
    const resolvedStorageDir = path.resolve(this.storageDir);

    if (!resolvedPath.startsWith(resolvedStorageDir) || safeKey !== obs.photo_storage_key) {
      throw new Error('Forbidden: Invalid storage key or path traversal detected');
    }

    if (!fs.existsSync(resolvedPath)) {
      throw new Error('Observation photo file not found on storage disk');
    }

    const buffer = fs.readFileSync(resolvedPath);
    return {
      buffer,
      mimeType: obs.mime_type,
      filename: safeKey,
    };
  }

  /**
   * Updates observation metadata. Enforces ownership: ADMIN or author CSP member.
   */
  async updateObservation(
    id: string,
    dto: UpdateObservationDTO,
    user: { id: string; role: string },
    scopedVillages: string[] | null
  ): Promise<FieldObservation> {
    const existing = await this.getObservationById(id, scopedVillages, user);
    if (!existing) {
      throw new Error(`Observation ${id} not found`);
    }

    // Authorization: ADMIN can edit any; CSP_MEMBER can only edit their own
    if (user.role !== 'ADMIN' && existing.createdBy !== user.id) {
      throw new Error('Forbidden: You can only edit field observations that you uploaded');
    }

    // Prevent ordinary edits from silently restoring consent once participant consent has been withdrawn
    if (existing.consentWithdrawn && dto.consentVerified === true) {
      throw new Error('Forbidden: Cannot restore consent through ordinary edits once participant consent has been formally withdrawn');
    }

    const res = await db.query(
      `UPDATE field_observations
       SET title = COALESCE($1, title),
           caption = COALESCE($2, caption),
           category = COALESCE($3, category),
           observation_date = COALESCE($4, observation_date),
           surveyor_name = COALESCE($5, surveyor_name),
           consent_verified = CASE WHEN consent_withdrawn = true THEN false ELSE COALESCE($6, consent_verified) END,
           consent_method = COALESCE($7, consent_method),
           consent_notes = COALESCE($8, consent_notes),
           is_published = COALESCE($9, is_published),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $10
       RETURNING *`,
      [
        dto.title?.trim(),
        dto.caption?.trim(),
        dto.category,
        dto.observationDate,
        dto.surveyorName?.trim(),
        dto.consentVerified !== undefined ? Boolean(dto.consentVerified) : null,
        dto.consentMethod,
        dto.consentNotes?.trim(),
        dto.isPublished !== undefined ? Boolean(dto.isPublished) : null,
        id,
      ]
    );

    return this.mapObservationRow(res.rows[0], user);
  }

  /**
   * Withdraws consent for an observation and immediately hides the photo.
   */
  async withdrawConsent(
    id: string,
    dto: WithdrawConsentDTO,
    user: { id: string; role: string },
    scopedVillages: string[] | null
  ): Promise<FieldObservation> {
    const existing = await this.getObservationById(id, scopedVillages);
    if (!existing) {
      throw new Error(`Observation ${id} not found`);
    }

    if (user.role !== 'ADMIN' && existing.createdBy !== user.id) {
      throw new Error('Forbidden: Only Administrators or the authoring CSP surveyor can log consent withdrawal');
    }

    const res = await db.query(
      `UPDATE field_observations
       SET consent_withdrawn = true,
           consent_withdrawn_at = CURRENT_TIMESTAMP,
           consent_withdrawn_reason = $1,
           consent_verified = false,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING *`,
      [dto.reason.trim(), id]
    );

    return this.mapObservationRow(res.rows[0], user);
  }

  /**
   * Deletes an observation record and cleans up the stored photo from disk.
   */
  async deleteObservation(
    id: string,
    user: { id: string; role: string },
    scopedVillages: string[] | null
  ): Promise<boolean> {
    const existing = await this.getObservationById(id, scopedVillages, user);
    if (!existing) {
      throw new Error(`Observation ${id} not found`);
    }

    if (user.role !== 'ADMIN' && existing.createdBy !== user.id) {
      throw new Error('Forbidden: You can only delete field observations that you uploaded');
    }

    await db.query(`DELETE FROM field_observations WHERE id = $1`, [id]);

    // Clean up file from disk
    const safeKey = path.basename(existing.photoStorageKey);
    const fullPath = path.join(this.storageDir, safeKey);
    if (fs.existsSync(fullPath)) {
      try {
        fs.unlinkSync(fullPath);
      } catch {
        // ignore disk deletion error
      }
    }

    return true;
  }

  /**
   * Generates aggregated Community Survey summary from actual database records.
   * Accurately distinguishes unique farmer respondents from survey/feedback records.
   * Strictly avoids exposing farmer PII, phone numbers, or parcel coordinates.
   */
  async getSurveySummary(scopedVillages: string[] | null): Promise<SurveySummary> {
    const villageFilter = scopedVillages !== null
      ? 'WHERE f.village_id = ANY($1)'
      : '';
    const villageParams = scopedVillages !== null ? [scopedVillages] : [];

    // 1. Respondent Counts - explicitly distinct real survey farmers from demo fixtures
    const farmerRes = await db.query(
      `SELECT count(DISTINCT f.id) as distinct_farmers,
              count(DISTINCT f.village_id) as distinct_villages,
              count(DISTINCT f.id) FILTER (WHERE f.data_origin = 'real') as genuine_farmers,
              count(DISTINCT f.id) FILTER (WHERE f.data_origin = 'demo') as demo_farmers
       FROM farmers f
       ${villageFilter}`,
      villageParams
    );

    const distinctFarmers = parseInt(farmerRes.rows[0].distinct_farmers, 10) || 0;
    const distinctVillages = parseInt(farmerRes.rows[0].distinct_villages, 10) || 0;
    const genuineFarmersCount = parseInt(farmerRes.rows[0].genuine_farmers, 10) || 0;
    const demoFarmersCount = parseInt(farmerRes.rows[0].demo_farmers, 10) || 0;

    const fbScopeFilter = scopedVillages !== null
      ? 'JOIN seasons s ON s.id = fb.season_id JOIN farmers f ON f.id = s.farmer_id WHERE f.village_id = ANY($1)'
      : '';
    const fbRes = await db.query(
      `SELECT count(fb.id) as feedback_count FROM farmer_feedback fb ${fbScopeFilter}`,
      villageParams
    );
    const feedbackCyclesRecorded = parseInt(fbRes.rows[0].feedback_count, 10) || 0;

    const callsRes = await db.query(`SELECT count(*) as total_calls FROM call_attempts`);
    const totalCallAttempts = parseInt(callsRes.rows[0].total_calls, 10) || 0;

    const schedRes = await db.query(`SELECT count(*) as scheduled_count FROM call_schedule`);
    const scheduledCallsCount = parseInt(schedRes.rows[0].scheduled_count, 10) || 0;

    // 2. Irrigation Source Breakdown across Plots
    const plotScopeFilter = scopedVillages !== null
      ? 'JOIN farmers f ON f.id = p.farmer_id WHERE f.village_id = ANY($1)'
      : '';
    const plotSourcesRes = await db.query(
      `SELECT wst.name as source_type, count(pws.id) as count
       FROM water_source_types wst
       LEFT JOIN plot_water_sources pws ON pws.water_source_type_id = wst.id
       LEFT JOIN plots p ON p.id = pws.plot_id
       ${plotScopeFilter}
       GROUP BY wst.name
       ORDER BY count DESC`,
      villageParams
    );

    const totalPlotsSampled = plotSourcesRes.rows.reduce((sum, r) => sum + parseInt(r.count, 10), 0);
    const breakdown = plotSourcesRes.rows.map((r) => {
      const count = parseInt(r.count, 10);
      return {
        sourceType: r.source_type,
        count,
        percentage: totalPlotsSampled > 0 ? Math.round((count / totalPlotsSampled) * 1000) / 10 : 0,
      };
    });

    // 3. Water Challenges Reported
    const challengesRes = await db.query(
      `SELECT 
         count(*) as total_responses,
         count(*) FILTER (WHERE fb.water_problem = 'shortage') as shortage_count,
         count(*) FILTER (WHERE fb.water_problem = 'none') as adequate_count
       FROM farmer_feedback fb
       ${fbScopeFilter}`,
      villageParams
    );

    const totalWaterResponses = parseInt(challengesRes.rows[0].total_responses, 10) || 0;
    const shortageCount = parseInt(challengesRes.rows[0].shortage_count, 10) || 0;
    const adequateCount = parseInt(challengesRes.rows[0].adequate_count, 10) || 0;

    // 4. Crop Condition Feedback
    const condRes = await db.query(
      `SELECT 
         count(*) as total_cond,
         count(*) FILTER (WHERE fb.crop_condition = 'good') as normal_count,
         count(*) FILTER (WHERE fb.crop_condition = 'moderate' OR fb.crop_condition = 'poor') as stress_count,
         count(*) FILTER (WHERE fb.crop_problem IS NOT NULL AND fb.crop_problem != 'none') as pest_count
       FROM farmer_feedback fb
       ${fbScopeFilter}`,
      villageParams
    );

    const totalCond = parseInt(condRes.rows[0].total_cond, 10) || 0;
    const normalCount = parseInt(condRes.rows[0].normal_count, 10) || 0;
    const stressCount = parseInt(condRes.rows[0].stress_count, 10) || 0;
    const pestOrDiseaseCount = parseInt(condRes.rows[0].pest_count, 10) || 0;

    // 5. Field Observations Count
    const obsScopeFilter = scopedVillages !== null
      ? 'WHERE fo.village_id = ANY($1)'
      : '';
    const obsRes = await db.query(
      `SELECT 
         count(*) as total_obs,
         count(*) FILTER (WHERE fo.consent_verified = true AND fo.consent_withdrawn = false) as verified_consent,
         count(*) FILTER (WHERE fo.category = 'farmer_interview') as interview_count,
         count(*) FILTER (WHERE fo.category = 'irrigation_source') as source_count,
         count(*) FILTER (WHERE fo.category = 'water_scarcity') as scarcity_count,
         count(*) FILTER (WHERE fo.category = 'canal_infrastructure') as canal_count
       FROM field_observations fo
       ${obsScopeFilter}`,
      villageParams
    );

    const o = obsRes.rows[0];

    return {
      respondentCount: {
        distinctFarmers,
        distinctVillages,
        genuineFarmersCount,
        demoFarmersCount,
        feedbackCyclesRecorded,
        totalCallAttempts,
        scheduledCallsCount,
      },
      irrigationSources: {
        totalPlotsSampled,
        breakdown,
      },
      waterChallenges: {
        totalResponsesWithWaterStatus: totalWaterResponses,
        shortageCount,
        shortagePercentage: totalWaterResponses > 0 ? Math.round((shortageCount / totalWaterResponses) * 1000) / 10 : null,
        adequateCount,
        adequatePercentage: totalWaterResponses > 0 ? Math.round((adequateCount / totalWaterResponses) * 1000) / 10 : null,
      },
      cropConditions: {
        totalResponsesWithCondition: totalCond,
        normalCount,
        stressCount,
        pestOrDiseaseCount,
      },
      fieldObservations: {
        totalObservationsCount: parseInt(o.total_obs, 10) || 0,
        withVerifiedConsentCount: parseInt(o.verified_consent, 10) || 0,
        byCategory: {
          farmer_interview: parseInt(o.interview_count, 10) || 0,
          irrigation_source: parseInt(o.source_count, 10) || 0,
          water_scarcity: parseInt(o.scarcity_count, 10) || 0,
          canal_infrastructure: parseInt(o.canal_count, 10) || 0,
        },
      },
      calculatedAt: new Date().toISOString(),
    };
  }

  private mapObservationRow(r: any, requestingUser?: { id: string; role: string }): FieldObservation {
    const isAuthorized =
      !requestingUser ||
      requestingUser.role === 'ADMIN' ||
      requestingUser.role === 'CSP_MEMBER' ||
      requestingUser.id === r.created_by;

    return {
      id: r.id,
      villageId: r.village_id,
      villageName: r.village_name,
      mandal: r.mandal,
      district: r.district,
      farmerId: r.farmer_id || null,
      farmerName: r.farmer_name || null,
      farmerCode: r.farmer_code || null,
      plotId: r.plot_id || null,
      observationDate: r.observation_date instanceof Date ? r.observation_date.toISOString().split('T')[0] : String(r.observation_date).split('T')[0],
      category: r.category as ObservationCategory,
      title: r.title,
      caption: r.caption,
      photoStorageKey: isAuthorized ? r.photo_storage_key : '[PROTECTED]',
      photoUrl: `/api/v1/observations/${r.id}/photo`,
      fileSizeBytes: Number(r.file_size_bytes),
      mimeType: r.mime_type,
      surveyorName: r.surveyor_name || null,
      consentVerified: Boolean(r.consent_verified),
      consentMethod: isAuthorized ? (r.consent_method || null) : null,
      consentNotes: isAuthorized ? (r.consent_notes || null) : null,
      consentWithdrawn: Boolean(r.consent_withdrawn),
      consentWithdrawnAt: isAuthorized && r.consent_withdrawn_at ? (r.consent_withdrawn_at instanceof Date ? r.consent_withdrawn_at.toISOString() : String(r.consent_withdrawn_at)) : null,
      consentWithdrawnReason: isAuthorized ? (r.consent_withdrawn_reason || null) : null,
      isPublished: Boolean(r.is_published),
      createdBy: isAuthorized ? r.created_by : null,
      createdByName: r.created_by_name || null,
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
      updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at),
    };
  }
}

export const observationService = new ObservationService();
