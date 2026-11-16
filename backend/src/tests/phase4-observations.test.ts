import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { createApp } from '../app.js';
import { db, closeDatabase } from '../db/index.js';
import { runMigrations } from '../scripts/migrate.js';
import { seedReferenceData } from '../scripts/seed-reference.js';
import { generateToken } from '../middleware/auth.js';
import { observationService } from '../modules/observations/service.js';

describe('Phase 4: Community Survey & Field Observations Gallery Tests', () => {
  let app: any;
  const testRunSuffix = Math.random().toString(36).substring(2, 8);

  // Test users
  let adminUser: { id: string; email: string; token: string };
  let cspMember1: { id: string; email: string; token: string };
  let cspMember2: { id: string; email: string; token: string };
  let panchayatUser: { id: string; email: string; token: string };

  // Villages
  let village1Id: string;
  let village2Id: string;

  // Sample image buffers
  // Valid JPEG: FF D8 FF E0 00 10 4A 46 49 46
  const validJpegBuffer = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x60,
    0x00, 0x60, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08,
    0xff, 0xd9,
  ]);

  // Valid PNG: 89 50 4E 47 0D 0A 1A 0A
  const validPngBuffer = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  ]);

  // Valid WebP: RIFF ... WEBP
  const validWebpBuffer = Buffer.from([
    0x52, 0x49, 0x46, 0x46, 0x18, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20,
    0x0c, 0x00, 0x00, 0x00, 0x30, 0x01, 0x00, 0x9d, 0x01, 0x2a, 0x01, 0x00, 0x01, 0x00, 0x02, 0x00,
  ]);

  // Fake executable / text buffer disguised as image
  const fakePayloadBuffer = Buffer.from('MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff\x00\x00');

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await runMigrations();
    await seedReferenceData();

    app = createApp();

    // 1. Fetch test villages
    const vRes = await db.query(`SELECT id, name FROM villages ORDER BY name ASC LIMIT 2`);
    if (vRes.rows.length < 2) {
      throw new Error('Expected at least 2 villages for scoping tests');
    }
    village1Id = vRes.rows[0].id;
    village2Id = vRes.rows[1].id;

    // 2. Setup Test Users
    const pwdHash = await bcrypt.hash('TestPass123!', 4);

    // Admin
    const adminRes = await db.query(
      `INSERT INTO users (name, email, password_hash, role, is_active, must_change_password)
       VALUES ($1, $2, $3, $4, true, false)
       RETURNING id, email, role`,
      [`Test Admin ${testRunSuffix}`, `admin_${testRunSuffix}@test.org`, pwdHash, 'ADMIN']
    );
    adminUser = {
      id: adminRes.rows[0].id,
      email: adminRes.rows[0].email,
      token: generateToken({ id: adminRes.rows[0].id, email: adminRes.rows[0].email, role: 'ADMIN' }),
    };

    // CSP Member 1
    const csp1Res = await db.query(
      `INSERT INTO users (name, email, password_hash, role, is_active, must_change_password)
       VALUES ($1, $2, $3, $4, true, false)
       RETURNING id, email, role`,
      [`CSP Surveyor One ${testRunSuffix}`, `csp1_${testRunSuffix}@test.org`, pwdHash, 'CSP_MEMBER']
    );
    cspMember1 = {
      id: csp1Res.rows[0].id,
      email: csp1Res.rows[0].email,
      token: generateToken({ id: csp1Res.rows[0].id, email: csp1Res.rows[0].email, role: 'CSP_MEMBER' }),
    };

    // CSP Member 2
    const csp2Res = await db.query(
      `INSERT INTO users (name, email, password_hash, role, is_active, must_change_password)
       VALUES ($1, $2, $3, $4, true, false)
       RETURNING id, email, role`,
      [`CSP Surveyor Two ${testRunSuffix}`, `csp2_${testRunSuffix}@test.org`, pwdHash, 'CSP_MEMBER']
    );
    cspMember2 = {
      id: csp2Res.rows[0].id,
      email: csp2Res.rows[0].email,
      token: generateToken({ id: csp2Res.rows[0].id, email: csp2Res.rows[0].email, role: 'CSP_MEMBER' }),
    };

    // Agri Panchayat (scoped only to village1)
    const panchayatRes = await db.query(
      `INSERT INTO users (name, email, password_hash, role, is_active, must_change_password)
       VALUES ($1, $2, $3, $4, true, false)
       RETURNING id, email, role`,
      [`Panchayat Officer ${testRunSuffix}`, `panchayat_${testRunSuffix}@test.org`, pwdHash, 'AGRI_PANCHAYAT']
    );
    const pId = panchayatRes.rows[0].id;
    await db.query(
      `INSERT INTO user_scopes (user_id, scope_type, scope_value)
       VALUES ($1, 'village', $2)`,
      [pId, village1Id]
    );
    panchayatUser = {
      id: pId,
      email: panchayatRes.rows[0].email,
      token: generateToken({ id: pId, email: panchayatRes.rows[0].email, role: 'AGRI_PANCHAYAT' }),
    };
  });

  afterAll(async () => {
    await closeDatabase();
  });

  describe('1. Binary Magic Bytes & Image Content Validation', () => {
    it('accepts valid JPEG, PNG, and WebP signatures in ObservationService', () => {
      const jpegResult = observationService.validateImageBuffer(validJpegBuffer, 'image/jpeg');
      expect(jpegResult.isValid).toBe(true);
      expect(jpegResult.detectedMime).toBe('image/jpeg');
      expect(jpegResult.extension).toBe('.jpg');

      const pngResult = observationService.validateImageBuffer(validPngBuffer, 'image/png');
      expect(pngResult.isValid).toBe(true);
      expect(pngResult.detectedMime).toBe('image/png');
      expect(pngResult.extension).toBe('.png');

      const webpResult = observationService.validateImageBuffer(validWebpBuffer, 'image/webp');
      expect(webpResult.isValid).toBe(true);
      expect(webpResult.detectedMime).toBe('image/webp');
      expect(webpResult.extension).toBe('.webp');
    });

    it('rejects fake executable or non-image payloads disguised as image files', () => {
      expect(() => {
        observationService.validateImageBuffer(fakePayloadBuffer, 'image/jpeg');
      }).toThrow(/File signature does not match supported image formats/i);
    });

    it('rejects files exceeding 5MB maximum limit', () => {
      const largeBuffer = Buffer.alloc(5 * 1024 * 1024 + 10);
      largeBuffer[0] = 0xff;
      largeBuffer[1] = 0xd8;
      largeBuffer[2] = 0xff;

      expect(() => {
        observationService.validateImageBuffer(largeBuffer, 'image/jpeg');
      }).toThrow(/exceeds maximum permitted limit/i);
    });
  });

  describe('2. Upload Authorization & RBAC Enforcement', () => {
    it('rejects unauthenticated upload requests with 401', async () => {
      const res = await request(app)
        .post('/api/v1/observations')
        .set('X-Requested-With', 'XMLHttpRequest')
        .attach('photo', validJpegBuffer, 'field.jpg')
        .field('villageId', village1Id)
        .field('observationDate', '2026-10-24')
        .field('category', 'irrigation_source')
        .field('title', 'Unauthenticated upload attempt')
        .field('caption', 'Should fail due to missing auth');

      expect(res.status).toBe(401);
    });

    it('rejects upload requests by AGRI_PANCHAYAT role with 403 Forbidden', async () => {
      const res = await request(app)
        .post('/api/v1/observations')
        .set('Authorization', `Bearer ${panchayatUser.token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .attach('photo', validJpegBuffer, 'field.jpg')
        .field('villageId', village1Id)
        .field('observationDate', '2026-10-24')
        .field('category', 'irrigation_source')
        .field('title', 'Panchayat upload attempt')
        .field('caption', 'Should fail due to insufficient role');

      expect(res.status).toBe(403);
    });

    it('allows CSP_MEMBER to successfully upload genuine field photograph', async () => {
      const res = await request(app)
        .post('/api/v1/observations')
        .set('Authorization', `Bearer ${cspMember1.token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .attach('photo', validJpegBuffer, 'borewell.jpg')
        .field('villageId', village1Id)
        .field('observationDate', '2026-10-24')
        .field('category', 'irrigation_source')
        .field('title', 'Deep Borewell Flow Inspection')
        .field('caption', 'Yield rate tested at 120 LPM with stable groundwater column')
        .field('surveyorName', 'CSP Field Agent 1')
        .field('consentVerified', 'true')
        .field('consentMethod', 'not_applicable');

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBeDefined();
      expect(res.body.data.title).toBe('Deep Borewell Flow Inspection');
      expect(res.body.data.photoStorageKey).toMatch(/^obs_[a-f0-9-]+\.jpg$/);
      // Ensure physical server file path is NOT exposed in the API response
      expect(res.body.data.filePath).toBeUndefined();
      expect(res.body.data.photoUrl).toBe(`/api/v1/observations/${res.body.data.id}/photo`);
    });

    it('rejects fake executable upload with 400 Bad Request', async () => {
      const res = await request(app)
        .post('/api/v1/observations')
        .set('Authorization', `Bearer ${cspMember1.token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .attach('photo', fakePayloadBuffer, 'malicious.jpg')
        .field('villageId', village1Id)
        .field('observationDate', '2026-10-24')
        .field('category', 'irrigation_source')
        .field('title', 'Fake Image Test')
        .field('caption', 'Attempting upload with disguised binary');

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/File signature does not match/i);
    });

    it('strips EXIF and GPS metadata before storing uploaded photographs', async () => {
      // Construct a JPEG containing APP1 EXIF segment with GPS coordinates
      const exifGpsPayload = Buffer.from('Exif\0\0GPSLatitude=17.3850,GPSLongitude=78.4867');
      const app1Header = Buffer.alloc(4);
      app1Header[0] = 0xff;
      app1Header[1] = 0xe1;
      app1Header.writeUInt16BE(2 + exifGpsPayload.length, 2);

      const jpegWithGps = Buffer.concat([
        Buffer.from([0xff, 0xd8]),
        app1Header,
        exifGpsPayload,
        validJpegBuffer.subarray(2),
      ]);

      expect(jpegWithGps.includes(Buffer.from('GPSLatitude'))).toBe(true);

      const res = await request(app)
        .post('/api/v1/observations')
        .set('Authorization', `Bearer ${cspMember1.token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .attach('photo', jpegWithGps, 'gps_field_photo.jpg')
        .field('villageId', village1Id)
        .field('observationDate', '2026-10-24')
        .field('category', 'irrigation_source')
        .field('title', 'Borewell with GPS EXIF')
        .field('caption', 'Uploaded with raw camera EXIF GPS metadata');

      expect(res.status).toBe(201);
      const obsId = res.body.data.id;

      // Stream back the photo and verify GPS metadata has been completely stripped
      const photoRes = await request(app)
        .get(`/api/v1/observations/${obsId}/photo`)
        .set('Authorization', `Bearer ${adminUser.token}`);

      expect(photoRes.status).toBe(200);
      expect(photoRes.body.includes(Buffer.from('GPSLatitude'))).toBe(false);
      expect(photoRes.body.includes(Buffer.from('GPSLongitude'))).toBe(false);
    });
  });

  describe('3. Private Storage & Direct Access Prevention', () => {
    it('blocks direct static access to /storage/observations with 403 Forbidden', async () => {
      const res = await request(app).get('/storage/observations/obs_any_secret.jpg');
      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/forbidden/i);
    });
  });

  describe('4. Village Scoping Enforcement', () => {
    let village1ObsId: string;
    let village2ObsId: string;

    beforeAll(async () => {
      // Create observation in Village 1 by Admin
      const obs1 = await observationService.createObservation(
        {
          villageId: village1Id,
          observationDate: '2026-10-20',
          category: 'water_scarcity',
          title: 'Village 1 Tail-End Channel Dry',
          caption: 'Tail-end distributary canal completely dry during critical flowering stage',
          consentVerified: true,
          consentMethod: 'not_applicable',
        },
        validJpegBuffer,
        adminUser.id
      );
      village1ObsId = obs1.id;

      // Create observation in Village 2 by Admin
      const obs2 = await observationService.createObservation(
        {
          villageId: village2Id,
          observationDate: '2026-10-21',
          category: 'canal_infrastructure',
          title: 'Village 2 Sluice Gate Siltation',
          caption: 'Sluice gate head regulator choked with silt and weeds',
          consentVerified: true,
          consentMethod: 'not_applicable',
        },
        validJpegBuffer,
        adminUser.id
      );
      village2ObsId = obs2.id;
    });

    it('AGRI_PANCHAYAT can list and view observation belonging to their assigned village', async () => {
      const listRes = await request(app)
        .get('/api/v1/observations')
        .set('Authorization', `Bearer ${panchayatUser.token}`);

      expect(listRes.status).toBe(200);
      const ids = listRes.body.data.map((o: any) => o.id);
      expect(ids).toContain(village1ObsId);
      expect(ids).not.toContain(village2ObsId);

      const detailRes = await request(app)
        .get(`/api/v1/observations/${village1ObsId}`)
        .set('Authorization', `Bearer ${panchayatUser.token}`);
      expect(detailRes.status).toBe(200);
      expect(detailRes.body.data.villageId).toBe(village1Id);
    });

    it('AGRI_PANCHAYAT is forbidden from accessing details or photo of cross-village observation', async () => {
      const detailRes = await request(app)
        .get(`/api/v1/observations/${village2ObsId}`)
        .set('Authorization', `Bearer ${panchayatUser.token}`);
      expect(detailRes.status).toBe(403);

      const photoRes = await request(app)
        .get(`/api/v1/observations/${village2ObsId}/photo`)
        .set('Authorization', `Bearer ${panchayatUser.token}`);
      expect(photoRes.status).toBe(403);
    });

    it('ADMIN can access observations across all villages without restriction', async () => {
      const detailRes1 = await request(app)
        .get(`/api/v1/observations/${village1ObsId}`)
        .set('Authorization', `Bearer ${adminUser.token}`);
      expect(detailRes1.status).toBe(200);

      const detailRes2 = await request(app)
        .get(`/api/v1/observations/${village2ObsId}`)
        .set('Authorization', `Bearer ${adminUser.token}`);
      expect(detailRes2.status).toBe(200);
    });
  });

  describe('5. Informed Consent Tracking & Withdrawal', () => {
    let interviewObsId: string;

    beforeAll(async () => {
      const obs = await observationService.createObservation(
        {
          villageId: village1Id,
          observationDate: '2026-10-22',
          category: 'farmer_interview',
          title: 'Groundwater Advisory Adoption Interview',
          caption: 'Farmer reported 20% reduction in pump runtime after following daily IVR voice advisories',
          surveyorName: 'K. Varma',
          consentVerified: true,
          consentMethod: 'verbal_panchayat_witness',
          consentNotes: 'Verbal consent verified in presence of gram panchayat sarpanch',
        },
        validJpegBuffer,
        cspMember1.id
      );
      interviewObsId = obs.id;
    });

    it('streams photo when consent is verified and active', async () => {
      const res = await request(app)
        .get(`/api/v1/observations/${interviewObsId}/photo`)
        .set('Authorization', `Bearer ${adminUser.token}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('image/jpeg');
      expect(res.headers['cache-control']).toContain('no-store');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.body.length).toBeGreaterThan(0);
    });

    it('allows authoring CSP surveyor to withdraw consent with reason', async () => {
      const withdrawRes = await request(app)
        .post(`/api/v1/observations/${interviewObsId}/withdraw-consent`)
        .set('Authorization', `Bearer ${cspMember1.token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ reason: 'Participant formally requested image withholding during follow-up visit' });

      expect(withdrawRes.status).toBe(200);
      expect(withdrawRes.body.success).toBe(true);
      expect(withdrawRes.body.data.consentWithdrawn).toBe(true);
      expect(withdrawRes.body.data.consentVerified).toBe(false);
      expect(withdrawRes.body.data.consentWithdrawnReason).toContain('Participant formally requested');
    });

    it('immediately blocks photo streaming once consent is withdrawn', async () => {
      const res = await request(app)
        .get(`/api/v1/observations/${interviewObsId}/photo`)
        .set('Authorization', `Bearer ${adminUser.token}`);

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/Participant consent has been withdrawn/i);
    });

    it('rejects ordinary edits that attempt to restore consent after it was formally withdrawn', async () => {
      const res = await request(app)
        .put(`/api/v1/observations/${interviewObsId}`)
        .set('Authorization', `Bearer ${adminUser.token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          title: 'Attempted restoration of withdrawn consent',
          consentVerified: true,
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/Cannot restore consent through ordinary edits/i);
    });

    it('redacts consent notes and internal storage keys from unauthorized / non-admin viewers', async () => {
      // Create a fresh active observation in village 1
      const activeObs = await observationService.createObservation(
        {
          villageId: village1Id,
          observationDate: '2026-10-24',
          category: 'farmer_interview',
          title: 'Audited Consent Privacy Test',
          caption: 'Interview with farmer regarding drip system efficiency',
          surveyorName: 'CSP Inspector',
          consentVerified: true,
          consentMethod: 'verbal_panchayat_witness',
          consentNotes: 'CONFIDENTIAL: Farmer disclosed health and private debt constraints',
        },
        validJpegBuffer,
        cspMember1.id
      );

      // Scoped Panchayat officer retrieves observation
      const panchayatRes = await request(app)
        .get(`/api/v1/observations/${activeObs.id}`)
        .set('Authorization', `Bearer ${panchayatUser.token}`);

      expect(panchayatRes.status).toBe(200);
      expect(panchayatRes.body.data.consentNotes).toBeNull();
      expect(panchayatRes.body.data.photoStorageKey).toBe('[PROTECTED]');

      // Admin retrieves observation
      const adminRes = await request(app)
        .get(`/api/v1/observations/${activeObs.id}`)
        .set('Authorization', `Bearer ${adminUser.token}`);

      expect(adminRes.status).toBe(200);
      expect(adminRes.body.data.consentNotes).toContain('CONFIDENTIAL');
      expect(adminRes.body.data.photoStorageKey).toMatch(/^obs_[a-f0-9-]+\.jpg$/);
    });
  });

  describe('6. Ownership & Authorization on Update and Delete', () => {
    let ownedObsId: string;
    let storageKey: string;

    beforeAll(async () => {
      const obs = await observationService.createObservation(
        {
          villageId: village1Id,
          observationDate: '2026-10-23',
          category: 'canal_infrastructure',
          title: 'Canal Breach Near Field 12',
          caption: 'Minor bund breach requiring immediate repair to prevent plot waterlogging',
          consentVerified: true,
          consentMethod: 'not_applicable',
        },
        validJpegBuffer,
        cspMember1.id
      );
      ownedObsId = obs.id;
      storageKey = obs.photoStorageKey;
    });

    it('prevents another CSP member from updating or deleting an observation they did not author', async () => {
      const putRes = await request(app)
        .put(`/api/v1/observations/${ownedObsId}`)
        .set('Authorization', `Bearer ${cspMember2.token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ title: 'Unauthorized title update' });
      expect(putRes.status).toBe(403);

      const delRes = await request(app)
        .delete(`/api/v1/observations/${ownedObsId}`)
        .set('Authorization', `Bearer ${cspMember2.token}`)
        .set('X-Requested-With', 'XMLHttpRequest');
      expect(delRes.status).toBe(403);
    });

    it('allows authoring CSP member to update their own observation', async () => {
      const putRes = await request(app)
        .put(`/api/v1/observations/${ownedObsId}`)
        .set('Authorization', `Bearer ${cspMember1.token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          title: 'Canal Bund Breach - Reinforced with Sandbags',
          caption: 'Updated: Sandbags deployed by water user association; water flow normalized',
        });

      expect(putRes.status).toBe(200);
      expect(putRes.body.data.title).toBe('Canal Bund Breach - Reinforced with Sandbags');
    });

    it('allows ADMIN to delete any observation and verifies physical file is unlinked', async () => {
      const storageDir = path.resolve(process.cwd(), './storage/observations');
      const filePath = path.join(storageDir, storageKey);

      // Verify file exists on disk prior to deletion
      expect(fs.existsSync(filePath)).toBe(true);

      const delRes = await request(app)
        .delete(`/api/v1/observations/${ownedObsId}`)
        .set('Authorization', `Bearer ${adminUser.token}`)
        .set('X-Requested-With', 'XMLHttpRequest');

      expect(delRes.status).toBe(200);
      expect(delRes.body.success).toBe(true);

      // Verify record is removed from database
      const dbCheck = await db.query(`SELECT id FROM field_observations WHERE id = $1`, [ownedObsId]);
      expect(dbCheck.rows.length).toBe(0);

      // Verify physical disk file was unlinked
      expect(fs.existsSync(filePath)).toBe(false);
    });
  });

  describe('7. Aggregated Community Survey Findings Calculations', () => {
    it('returns calculated metrics with explicit denominators and without PII', async () => {
      const res = await request(app)
        .get('/api/v1/observations/survey-summary')
        .set('Authorization', `Bearer ${adminUser.token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const summary = res.body.data;
      expect(summary).toBeDefined();

      // 1. Respondent counts
      expect(typeof summary.respondentCount.distinctFarmers).toBe('number');
      expect(typeof summary.respondentCount.distinctVillages).toBe('number');
      expect(summary.respondentCount.distinctFarmers).toBeGreaterThanOrEqual(0);
      expect(summary.respondentCount.distinctVillages).toBeGreaterThanOrEqual(0);

      // 2. Irrigation source breakdown
      expect(Array.isArray(summary.irrigationSources.breakdown)).toBe(true);
      expect(typeof summary.irrigationSources.totalPlotsSampled).toBe('number');

      // 3. Water challenges reported with explicit denominator
      expect(typeof summary.waterChallenges.totalResponsesWithWaterStatus).toBe('number');
      if (summary.waterChallenges.totalResponsesWithWaterStatus > 0) {
        expect(summary.waterChallenges.shortagePercentage).not.toBeNull();
        expect(summary.waterChallenges.adequatePercentage).not.toBeNull();
        // Percentages should be mathematical calculations based on the exact denominator
        const calculatedShortagePct = Math.round(
          (summary.waterChallenges.shortageCount / summary.waterChallenges.totalResponsesWithWaterStatus) * 1000
        ) / 10;
        expect(summary.waterChallenges.shortagePercentage).toBe(calculatedShortagePct);
      }

      // 4. Field observations metrics
      expect(typeof summary.fieldObservations.totalObservationsCount).toBe('number');
      expect(typeof summary.fieldObservations.withVerifiedConsentCount).toBe('number');
      expect(summary.fieldObservations.byCategory.irrigation_source).toBeGreaterThanOrEqual(0);
      expect(summary.fieldObservations.byCategory.canal_infrastructure).toBeGreaterThanOrEqual(0);

      // 5. Verification: zero PII in survey summary response
      const jsonStr = JSON.stringify(summary);
      expect(jsonStr).not.toContain('phone');
      expect(jsonStr).not.toContain('farmerName');
      expect(jsonStr).not.toContain('surveyorPhone');
    });
  });
});
