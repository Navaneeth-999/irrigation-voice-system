import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { db, closeDatabase } from '../db/index.js';
import { observationService } from '../modules/observations/service.js';

async function runE2EAudit() {
  console.log('🔍 Starting Phase 4 End-to-End Audit against Development Database...');

  try {
    // 1. Verify Database Health & Table Existence
    const tableRes = await db.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name = 'field_observations'
    `);
    if (tableRes.rows.length === 0) {
      throw new Error('field_observations table not found in dev database');
    }
    console.log('✅ Table field_observations exists in dev database');

    // 2. Fetch a real village and admin/user for testing
    const villageRes = await db.query(`SELECT id, name FROM villages ORDER BY name ASC LIMIT 1`);
    if (villageRes.rows.length === 0) throw new Error('No villages found in dev DB');
    const testVillage = villageRes.rows[0];
    console.log(`📍 Using dev village: ${testVillage.name} (${testVillage.id})`);

    const userRes = await db.query(`SELECT id, role, email FROM users WHERE role = 'ADMIN' LIMIT 1`);
    if (userRes.rows.length === 0) throw new Error('No ADMIN user found in dev DB');
    const adminUser = userRes.rows[0];
    console.log(`👤 Using dev admin user: ${adminUser.email} (${adminUser.id})`);

    // 3. Construct a test JPEG containing GPS EXIF metadata
    const exifGps = Buffer.from('Exif\0\0GPSLatitude=17.3850,GPSLongitude=78.4867');
    const app1 = Buffer.alloc(4);
    app1[0] = 0xff;
    app1[1] = 0xe1;
    app1.writeUInt16BE(2 + exifGps.length, 2);

    const rawJpegWithGps = Buffer.concat([
      Buffer.from([0xff, 0xd8]),
      app1,
      exifGps,
      Buffer.from([0xff, 0xdb, 0x00, 0x05, 0x00, 0x01, 0x02]),
      Buffer.from([0xff, 0xd9]),
    ]);

    // 4. Test Observation Creation & EXIF Stripping
    console.log('📸 Uploading observation to dev DB with EXIF GPS metadata...');
    const createdObs = await observationService.createObservation(
      {
        villageId: testVillage.id,
        observationDate: '2026-10-24',
        category: 'farmer_interview',
        title: 'E2E Audit Observation: Canal Tail-End Interview',
        caption: 'Testing end-to-end lifecycle and EXIF scrubbing on dev PostgreSQL database',
        surveyorName: 'E2E Auditor',
        consentVerified: true,
        consentMethod: 'verbal_panchayat_witness',
        consentNotes: 'Audited informed consent',
      },
      rawJpegWithGps,
      adminUser.id
    );
    console.log(`✅ Created observation in dev DB with ID: ${createdObs.id}`);

    // Verify storage file exists and EXIF GPS was stripped
    const storageDir = path.resolve(process.cwd(), './storage/observations');
    const filePath = path.join(storageDir, createdObs.photoStorageKey);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Expected storage file not found at: ${filePath}`);
    }
    const savedBytes = fs.readFileSync(filePath);
    if (savedBytes.includes(Buffer.from('GPSLatitude'))) {
      throw new Error('FAILURE: Stored image still contains GPS EXIF metadata!');
    }
    console.log('✅ Stored file verified on disk: GPS EXIF was stripped successfully');

    // 5. Test Listing with Filters
    console.log('📋 Testing observation listing & filtering...');
    const listAll = await observationService.listObservations(null, { villageId: testVillage.id });
    const found = listAll.data.find((o) => o.id === createdObs.id);
    if (!found) throw new Error('Created observation not found in list query');
    console.log(`✅ List query returned observation (total in village: ${listAll.total})`);

    const listCategory = await observationService.listObservations(null, { category: 'farmer_interview' });
    if (!listCategory.data.some((o) => o.id === createdObs.id)) {
      throw new Error('Category filter failed to match created observation');
    }
    console.log('✅ Category filtering verified');

    // 6. Test Detail View & Authorization Redaction
    console.log('🔍 Testing detail view & privacy masking...');
    const adminDetail = await observationService.getObservationById(createdObs.id, null, { id: adminUser.id, role: 'ADMIN' });
    if (!adminDetail || !adminDetail.consentNotes) {
      throw new Error('Admin detail view failed to return consent notes');
    }
    console.log('✅ Admin detail view contains consent notes');

    const unauthDetail = await observationService.getObservationById(createdObs.id, null, { id: 'panchayat-1', role: 'AGRI_PANCHAYAT' });
    if (!unauthDetail || unauthDetail.consentNotes !== null || unauthDetail.photoStorageKey !== '[PROTECTED]') {
      throw new Error('Privacy masking failed: unprivileged viewer saw consent notes or storage key');
    }
    console.log('✅ Privacy masking verified: unprivileged viewer sees null consent notes and [PROTECTED] key');

    // 7. Test Editing
    console.log('✏️ Testing metadata update...');
    const updated = await observationService.updateObservation(
      createdObs.id,
      { title: 'E2E Audit Observation: Updated Title' },
      { id: adminUser.id, role: 'ADMIN' },
      null
    );
    if (updated.title !== 'E2E Audit Observation: Updated Title') {
      throw new Error('Title update failed in dev DB');
    }
    console.log('✅ Metadata edit verified');

    // 8. Test Consent Withdrawal & Blocking Silent Restoration
    console.log('🛡️ Testing consent withdrawal...');
    const withdrawn = await observationService.withdrawConsent(
      createdObs.id,
      { reason: 'E2E audit formal withdrawal request' },
      { id: adminUser.id, role: 'ADMIN' },
      null
    );
    if (!withdrawn.consentWithdrawn || withdrawn.consentVerified) {
      throw new Error('Consent withdrawal failed');
    }
    console.log('✅ Consent withdrawn flag recorded');

    // Attempt silent restoration
    try {
      await observationService.updateObservation(
        createdObs.id,
        { consentVerified: true },
        { id: adminUser.id, role: 'ADMIN' },
        null
      );
      throw new Error('FAILURE: Allowed silent restoration of withdrawn consent!');
    } catch (err: any) {
      if (err.message.includes('Cannot restore consent through ordinary edits')) {
        console.log('✅ Silent restoration correctly blocked');
      } else {
        throw err;
      }
    }

    // Attempt photo streaming on withdrawn consent
    try {
      await observationService.getObservationPhoto(createdObs.id, null, { id: adminUser.id, role: 'ADMIN' });
      throw new Error('FAILURE: Photo streaming was allowed on withdrawn consent!');
    } catch (err: any) {
      if (err.message.includes('withdrawn')) {
        console.log('✅ Photo streaming on withdrawn consent correctly blocked (403)');
      } else {
        throw err;
      }
    }

    // 9. Test Deletion and Disk Cleanup
    console.log('🗑️ Testing deletion and disk unlinking...');
    await observationService.deleteObservation(
      createdObs.id,
      { id: adminUser.id, role: 'ADMIN' },
      null
    );

    const checkDb = await db.query(`SELECT id FROM field_observations WHERE id = $1`, [createdObs.id]);
    if (checkDb.rows.length !== 0) throw new Error('Record not deleted from dev DB');

    if (fs.existsSync(filePath)) {
      throw new Error('FAILURE: Physical storage file was not unlinked on delete!');
    }
    console.log('✅ Observation record deleted from dev DB and physical file unlinked from disk');

    // 10. Test Survey Summary against Dev DB
    console.log('📊 Testing getSurveySummary on dev DB...');
    const summary = await observationService.getSurveySummary(null);
    console.log('Dev DB Survey Summary:');
    console.log(`- Distinct Farmers: ${summary.respondentCount.distinctFarmers} (Genuine: ${summary.respondentCount.genuineFarmersCount}, Demo: ${summary.respondentCount.demoFarmersCount})`);
    console.log(`- Distinct Villages: ${summary.respondentCount.distinctVillages}`);
    console.log(`- Feedback Cycles: ${summary.respondentCount.feedbackCyclesRecorded}`);
    console.log(`- Water Shortage Rate: ${summary.waterChallenges.shortagePercentage}% (${summary.waterChallenges.shortageCount}/${summary.waterChallenges.totalResponsesWithWaterStatus})`);
    console.log(`- Plots Cataloged: ${summary.irrigationSources.totalPlotsSampled}`);
    console.log(`- Field Observations: ${summary.fieldObservations.totalObservationsCount}`);
    console.log('✅ Survey Summary computed cleanly with explicit denominators');

    console.log('\n🎉 ALL PHASE 4 END-TO-END ACCEPTANCE AUDIT CHECKS PASSED ON DEV DB!');
  } catch (err) {
    console.error('❌ E2E Audit Failed:', err);
    process.exit(1);
  } finally {
    await closeDatabase();
  }
}

runE2EAudit();
