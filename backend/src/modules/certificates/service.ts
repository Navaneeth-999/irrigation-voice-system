import crypto from 'crypto';
import { db, withTransaction } from '../../db/index.js';
import { analyticsService } from '../analytics/service.js';
import { snapshotService } from './SnapshotService.js';
import { pdfCertificateService } from './PdfCertificateService.js';
import {
  CertificateRecord,
  IssueCertificateRequest,
  ReissueCertificateRequest,
  EligibilityCheckResult,
  SeasonReportRecord,
  PublicVerificationResult,
} from './types.js';

export class CertificateService {
  /**
   * Generates a unique, human-friendly certificate code (e.g. JALAMITRA-2026-X8K9P).
   */
  private generateCertificateCode(year: number, prefix: string = 'JALAMITRA'): string {
    const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // base32 Crockford style (no 0, 1, I, O)
    let randomPart = '';
    const bytes = crypto.randomBytes(5);
    for (let i = 0; i < 5; i++) {
      randomPart += chars[bytes[i] % chars.length];
    }
    return `${prefix}-${year}-${randomPart}`;
  }

  /**
   * Evaluates certificate eligibility gating based on configurable app_settings:
   * 1. Season status
   * 2. Minimum monitoring-cycle coverage percentage
   * 3. Minimum data-confidence band / score
   */
  async checkCertificateEligibility(seasonId: string, harvestDateOverride?: string): Promise<EligibilityCheckResult> {
    // 1. Fetch configurable threshold settings from app_settings
    const settingsRes = await db.query(
      `SELECT key, value FROM app_settings 
       WHERE key IN ('certificate_min_cycle_coverage_pct', 'certificate_min_confidence_score', 'certificate_min_confidence_band')`
    );
    const settingsMap: Record<string, any> = {};
    for (const row of settingsRes.rows) {
      if (typeof row.value === 'string') {
        try {
          settingsMap[row.key] = JSON.parse(row.value);
        } catch {
          settingsMap[row.key] = row.value;
        }
      } else {
        settingsMap[row.key] = row.value;
      }
    }

    const minCycleCoveragePct = Number(settingsMap['certificate_min_cycle_coverage_pct'] ?? 50);
    const minConfidenceScore = Number(settingsMap['certificate_min_confidence_score'] ?? 50);
    const minConfidenceBand = String(settingsMap['certificate_min_confidence_band'] ?? 'medium').toLowerCase();

    // 2. Fetch season dates and duration
    const seasonRes = await db.query(
      `SELECT sowing_date, expected_harvest_date, actual_harvest_date, status
       FROM seasons WHERE id = $1`,
      [seasonId]
    );

    if (seasonRes.rows.length === 0) {
      throw new Error(`Season with ID ${seasonId} not found`);
    }

    const s = seasonRes.rows[0];
    const harvestDateStr = harvestDateOverride || s.actual_harvest_date;
    const harvestDate = harvestDateStr ? new Date(harvestDateStr) : (s.expected_harvest_date ? new Date(s.expected_harvest_date) : new Date());

    // 3. Count total scheduled vs completed monitoring cycles up to harvest date
    const scheduleRes = await db.query(
      `SELECT COUNT(*)::int as total,
              COUNT(*) FILTER (WHERE status = 'completed')::int as completed
       FROM call_schedule
       WHERE season_id = $1 AND due_window_start <= $2`,
      [seasonId, harvestDateStr || s.expected_harvest_date || '9999-12-31']
    );

    let totalCycles = scheduleRes.rows[0]?.total || 0;
    let completedCycles = scheduleRes.rows[0]?.completed || 0;

    // Fallback: If no call_schedule rows exist (e.g. manual entry or test), compute based on fortnight duration
    if (totalCycles === 0) {
      const start = new Date(s.sowing_date);
      const durationDays = Math.max(14, Math.ceil((harvestDate.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
      totalCycles = Math.max(1, Math.floor(durationDays / 14));

      const fbRes = await db.query(
        `SELECT COUNT(DISTINCT cycle_number)::int as completed
         FROM farmer_feedback
         WHERE season_id = $1`,
        [seasonId]
      );
      completedCycles = fbRes.rows[0]?.completed || 0;
    }

    const monitoringCycleCoverage = Math.min(100, totalCycles > 0 ? (completedCycles / totalCycles) * 100 : 0);

    // 4. Calculate Data Confidence Score
    const metrics = await analyticsService.recalculateSeasonWaterMetrics(seasonId);
    const confidenceScore = Number(metrics.confidenceScore || 0);
    const confidenceBand = metrics.confidenceBand;

    // 5. Evaluate Eligibility Criteria
    const reasons: string[] = [];

    if (monitoringCycleCoverage < minCycleCoveragePct) {
      reasons.push(
        `Monitoring cycle coverage is ${monitoringCycleCoverage.toFixed(1)}% (${completedCycles}/${totalCycles} cycles completed), below required threshold of ${minCycleCoveragePct}%.`
      );
    }

    if (confidenceScore < minConfidenceScore) {
      reasons.push(
        `Data confidence score is ${Math.round(confidenceScore)}/100, below required threshold of ${minConfidenceScore}/100.`
      );
    }

    const bandRank: Record<string, number> = { low: 1, medium: 2, high: 3 };
    const requiredRank = bandRank[minConfidenceBand] || 2;
    const actualRank = bandRank[confidenceBand] || 1;

    if (actualRank < requiredRank) {
      reasons.push(
        `Data confidence band is ${confidenceBand.toUpperCase()}, below required tier of ${minConfidenceBand.toUpperCase()}.`
      );
    }

    const irrCountRes = await db.query(
      `SELECT COUNT(*)::int as count FROM irrigation_records WHERE season_id = $1`,
      [seasonId]
    );
    const irrCount = irrCountRes.rows[0]?.count || 0;
    if (irrCount === 0) {
      reasons.push(
        'No irrigation logs recorded for this season. Minimum recorded irrigation data is required for certificate eligibility.'
      );
    }

    return {
      isEligible: reasons.length === 0,
      monitoringCycleCoverage,
      completedCycles,
      totalCycles,
      confidenceScore,
      confidenceBand,
      reasons,
    };
  }

  /**
   * Completes a season and issues either:
   * - An accredited Conservation Certificate (if eligible)
   * - A Season Water Performance Summary Report (if ineligible)
   */
  async issueCertificate(req: IssueCertificateRequest): Promise<{
    eligible: boolean;
    certificate?: CertificateRecord;
    seasonReport?: SeasonReportRecord;
    ineligibilityReasons?: string[];
  }> {
    const { seasonId, actualHarvestDate, yieldQuantity, yieldUnit, completionNotes, userId } = req;

    // 1. Fetch and validate season state
    const seasonRes = await db.query(
      `SELECT s.id, s.season_code, s.season_type, s.season_year, s.sowing_date,
              s.expected_harvest_date, s.status, s.farmer_id, s.plot_id, s.crop_id
       FROM seasons s
       WHERE s.id = $1`,
      [seasonId]
    );

    if (seasonRes.rows.length === 0) {
      throw new Error(`Season with ID ${seasonId} not found`);
    }

    const season = seasonRes.rows[0];

    // Enforce closing rules
    if (season.status === 'draft') {
      throw new Error('Cannot issue certificate for a Draft season. Activate season first.');
    }
    if (season.status === 'cancelled') {
      throw new Error('Cannot issue certificate for a Cancelled season.');
    }

    // Check if active (unrevoked) certificate already issued
    const existingCert = await db.query(
      `SELECT id, certificate_code FROM certificates WHERE season_id = $1 AND is_revoked = false`,
      [seasonId]
    );
    if (existingCert.rows.length > 0) {
      throw new Error(`Certificate already issued for season ${seasonId} (${existingCert.rows[0].certificate_code})`);
    }

    const harvestDate = new Date(actualHarvestDate);
    const sowingDate = new Date(season.sowing_date);
    const today = new Date();
    today.setHours(23, 59, 59, 999);

    if (isNaN(harvestDate.getTime())) {
      throw new Error('Invalid harvest date provided');
    }
    if (harvestDate < sowingDate) {
      throw new Error(`Actual harvest date (${actualHarvestDate}) cannot be before sowing date (${season.sowing_date})`);
    }
    if (harvestDate > today) {
      throw new Error('Actual harvest date cannot be in the future');
    }

    // 2. Final recalculation of daily water balance and metrics up to harvest date
    await analyticsService.computeSeasonDailyBalance(seasonId, undefined, actualHarvestDate);
    const metrics = await analyticsService.recalculateSeasonWaterMetrics(seasonId);

    // 3. Build Immutable Snapshot
    const snapshot = await snapshotService.buildSeasonSnapshot(
      seasonId,
      actualHarvestDate,
      yieldQuantity,
      yieldUnit
    );

    // 4. Check Eligibility Gating
    const eligibility = await this.checkCertificateEligibility(seasonId, actualHarvestDate);

    if (!eligibility.isEligible) {
      // INELIGIBLE BRANCH: Create Season Report instead of Certificate
      const reportCode = this.generateCertificateCode(season.season_year, 'JALAMITRA-REPORT');

      let seasonReport: SeasonReportRecord | null = null;

      await withTransaction(async (tx) => {
        const reportRes = await tx.query(
          `INSERT INTO season_reports (
            report_code, season_id, farmer_id, plot_id, crop_id,
            actual_harvest_date, yield_quantity, yield_unit,
            monitoring_cycle_coverage, confidence_score, confidence_band,
            water_use_ratio, water_use_ratio_band, is_certificate_eligible,
            ineligibility_reasons, snapshot_data, created_by
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
          RETURNING *`,
          [
            reportCode,
            season.id,
            season.farmer_id,
            season.plot_id,
            season.crop_id,
            actualHarvestDate,
            yieldQuantity || null,
            yieldUnit || null,
            eligibility.monitoringCycleCoverage,
            metrics.confidenceScore,
            metrics.confidenceBand,
            metrics.waterUseRatio,
            metrics.ratioBand,
            false,
            JSON.stringify(eligibility.reasons),
            JSON.stringify(snapshot),
            userId || null,
          ]
        );

        // Update season to completed with ineligible certificate status
        await tx.query(
          `UPDATE seasons
           SET status = 'completed',
               certificate_status = 'ineligible',
               ineligibility_reasons = $1,
               actual_harvest_date = $2,
               actual_yield_quantity = $3,
               actual_yield_unit = $4,
               completion_notes = $5,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $6`,
          [
            JSON.stringify(eligibility.reasons),
            actualHarvestDate,
            yieldQuantity || null,
            yieldUnit || null,
            completionNotes || null,
            season.id,
          ]
        );

        const r = reportRes.rows[0];
        seasonReport = {
          id: r.id,
          reportCode: r.report_code,
          seasonId: r.season_id,
          farmerId: r.farmer_id,
          plotId: r.plot_id,
          cropId: r.crop_id,
          actualHarvestDate: r.actual_harvest_date instanceof Date ? r.actual_harvest_date.toISOString().split('T')[0] : String(r.actual_harvest_date).split('T')[0],
          yieldQuantity: r.yield_quantity ? Number(r.yield_quantity) : null,
          yieldUnit: r.yield_unit,
          monitoringCycleCoverage: Number(r.monitoring_cycle_coverage),
          confidenceScore: Number(r.confidence_score),
          confidenceBand: r.confidence_band,
          waterUseRatio: r.water_use_ratio !== null && r.water_use_ratio !== undefined ? Number(r.water_use_ratio) : null,
          waterUseRatioBand: r.water_use_ratio_band,
          isCertificateEligible: false,
          ineligibilityReasons: typeof r.ineligibility_reasons === 'string' ? JSON.parse(r.ineligibility_reasons) : r.ineligibility_reasons,
          snapshotData: typeof r.snapshot_data === 'string' ? JSON.parse(r.snapshot_data) : r.snapshot_data,
          pdfPath: null,
          createdBy: r.created_by,
          createdAt: r.created_at,
        };
      });

      if (!seasonReport) {
        throw new Error('Failed to generate seasonal report');
      }

      // Generate Season Report PDF
      try {
        const pdfPath = await pdfCertificateService.saveSeasonReportPdf(seasonReport);
        await db.query(`UPDATE season_reports SET pdf_path = $1 WHERE id = $2`, [pdfPath, (seasonReport as SeasonReportRecord).id]);
        (seasonReport as SeasonReportRecord).pdfPath = pdfPath;
      } catch (err: any) {
        console.error('[PdfCertificateService] Report PDF generation warning:', err.message);
      }

      return {
        eligible: false,
        seasonReport: seasonReport as SeasonReportRecord,
        ineligibilityReasons: eligibility.reasons,
      };
    }

    // ELIGIBLE BRANCH: Issue Accredited Conservation Certificate
    const sha256Hash = snapshotService.computeSha256(snapshot);
    const certificateCode = this.generateCertificateCode(season.season_year);
    const verificationToken = crypto.randomBytes(24).toString('hex');

    let certificateRecord: CertificateRecord | null = null;

    await withTransaction(async (tx) => {
      // Insert Certificate Record
      const certRes = await tx.query(
        `INSERT INTO certificates (
          certificate_code, season_id, farmer_id, plot_id, crop_id,
          water_use_ratio, water_use_ratio_band, confidence_score, confidence_band,
          estimated_water_saved_litres, actual_harvest_date, yield_quantity, yield_unit,
          snapshot_data, sha256_hash, verification_token, version, created_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, 1, $17)
        RETURNING *`,
        [
          certificateCode,
          season.id,
          season.farmer_id,
          season.plot_id,
          season.crop_id,
          metrics.waterUseRatio,
          metrics.ratioBand,
          metrics.confidenceScore,
          metrics.confidenceBand,
          Number(metrics.waterSavedLitres ?? 0),
          actualHarvestDate,
          yieldQuantity || null,
          yieldUnit || null,
          JSON.stringify(snapshot),
          sha256Hash,
          verificationToken,
          userId || null,
        ]
      );

      // Update Season Status to completed with issued certificate status
      await tx.query(
        `UPDATE seasons
         SET status = 'completed',
             certificate_status = 'issued',
             ineligibility_reasons = '[]'::jsonb,
             actual_harvest_date = $1,
             actual_yield_quantity = $2,
             actual_yield_unit = $3,
             completion_notes = $4,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $5`,
        [
          actualHarvestDate,
          yieldQuantity || null,
          yieldUnit || null,
          completionNotes || null,
          season.id,
        ]
      );

      // Record initial status in certificate_status_history
      await tx.query(
        `INSERT INTO certificate_status_history (
          certificate_id, previous_status, new_status, reason, changed_by
        ) VALUES ($1, 'draft', 'active', 'Initial certificate issuance', $2)`,
        [certRes.rows[0].id, userId || null]
      );

      certificateRecord = this.mapCertificateRow(certRes.rows[0]);
    });

    if (!certificateRecord) {
      throw new Error('Failed to create certificate record');
    }

    // Generate and persist PDF file
    try {
      const pdfPath = await pdfCertificateService.saveCertificatePdf(certificateRecord);
      await db.query(`UPDATE certificates SET pdf_path = $1 WHERE id = $2`, [pdfPath, (certificateRecord as CertificateRecord).id]);
      (certificateRecord as CertificateRecord).pdfPath = pdfPath;
    } catch (err: any) {
      console.error('[PdfCertificateService] PDF generation warning:', err.message);
    }

    return {
      eligible: true,
      certificate: certificateRecord as CertificateRecord,
    };
  }

  /**
   * Reissues a certificate:
   * 1. Revokes the existing certificate with reason: "Replaced by reissuance"
   * 2. Issues a new certificate version linked via `replaces_certificate_id` and increments `version`
   * 3. Sets `replaced_by_certificate_id` on the old certificate
   */
  async reissueCertificate(req: ReissueCertificateRequest): Promise<CertificateRecord> {
    const { oldCertificateId, reason, actualHarvestDate, yieldQuantity, yieldUnit, completionNotes, userId } = req;

    const oldCert = await this.getCertificateById(oldCertificateId);
    if (!oldCert) {
      throw new Error(`Certificate with ID ${oldCertificateId} not found`);
    }
    if (oldCert.replacedByCertificateId) {
      throw new Error(`Certificate ${oldCert.certificateCode} has already been replaced by a newer version`);
    }

    const seasonRes = await db.query(
      `SELECT s.* FROM seasons s WHERE s.id = $1`,
      [oldCert.seasonId]
    );
    if (seasonRes.rows.length === 0) {
      throw new Error(`Season with ID ${oldCert.seasonId} not found`);
    }
    const season = seasonRes.rows[0];

    const harvestDate = actualHarvestDate || oldCert.actualHarvestDate;
    const finalYieldQty = yieldQuantity !== undefined ? yieldQuantity : oldCert.yieldQuantity;
    const finalYieldUnit = yieldUnit !== undefined ? yieldUnit : oldCert.yieldUnit;

    // Recalculate metrics and new snapshot
    await analyticsService.computeSeasonDailyBalance(season.id, undefined, harvestDate);
    const metrics = await analyticsService.recalculateSeasonWaterMetrics(season.id);
    const snapshot = await snapshotService.buildSeasonSnapshot(
      season.id,
      harvestDate,
      finalYieldQty ?? undefined,
      finalYieldUnit ?? undefined
    );
    const sha256Hash = snapshotService.computeSha256(snapshot);
    const newCertificateCode = this.generateCertificateCode(season.season_year);
    const verificationToken = crypto.randomBytes(24).toString('hex');
    const newVersion = (oldCert.version || 1) + 1;

    let newCertRecord: CertificateRecord | null = null;

    await withTransaction(async (tx) => {
      // 1. Revoke old certificate first to ensure only one active cert per season
      await tx.query(
        `UPDATE certificates
         SET status = 'revoked',
             is_revoked = true,
             revocation_reason = $1,
             revoked_at = CURRENT_TIMESTAMP,
             revoked_by = $2
         WHERE id = $3`,
        [`Replaced by reissued certificate ${newCertificateCode}: ${reason}`, userId || null, oldCert.id]
      );

      // Record old certificate revocation in certificate_status_history
      await tx.query(
        `INSERT INTO certificate_status_history (
          certificate_id, previous_status, new_status, reason, changed_by
        ) VALUES ($1, $2, 'revoked', $3, $4)`,
        [oldCert.id, oldCert.status || 'active', `Replaced by reissued certificate ${newCertificateCode}: ${reason}`, userId || null]
      );

      // 2. Insert new certificate version
      const newCertRes = await tx.query(
        `INSERT INTO certificates (
          certificate_code, season_id, farmer_id, plot_id, crop_id,
          water_use_ratio, water_use_ratio_band, confidence_score, confidence_band,
          estimated_water_saved_litres, actual_harvest_date, yield_quantity, yield_unit,
          snapshot_data, sha256_hash, verification_token,
          replaces_certificate_id, version, status, created_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, 'active', $19)
        RETURNING *`,
        [
          newCertificateCode,
          season.id,
          season.farmer_id,
          season.plot_id,
          season.crop_id,
          metrics.waterUseRatio,
          metrics.ratioBand,
          metrics.confidenceScore,
          metrics.confidenceBand,
          Number(metrics.waterSavedLitres ?? 0),
          harvestDate,
          finalYieldQty || null,
          finalYieldUnit || null,
          JSON.stringify(snapshot),
          sha256Hash,
          verificationToken,
          oldCert.id,
          newVersion,
          userId || null,
        ]
      );

      const newId = newCertRes.rows[0].id;

      // Record new certificate issuance in certificate_status_history
      await tx.query(
        `INSERT INTO certificate_status_history (
          certificate_id, previous_status, new_status, reason, changed_by
        ) VALUES ($1, 'draft', 'active', $2, $3)`,
        [newId, `Reissuance replacing certificate ${oldCert.certificateCode}: ${reason}`, userId || null]
      );

      // 3. Link replaced_by on old certificate
      await tx.query(
        `UPDATE certificates SET replaced_by_certificate_id = $1 WHERE id = $2`,
        [newId, oldCert.id]
      );

      // 4. Update Season
      await tx.query(
        `UPDATE seasons
         SET actual_harvest_date = $1,
             actual_yield_quantity = $2,
             actual_yield_unit = $3,
             completion_notes = COALESCE($4, completion_notes),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $5`,
        [harvestDate, finalYieldQty || null, finalYieldUnit || null, completionNotes || null, season.id]
      );

      newCertRecord = this.mapCertificateRow(newCertRes.rows[0]);
    });

    if (!newCertRecord) {
      throw new Error('Failed to reissue certificate');
    }

    // Generate new PDF
    try {
      const pdfPath = await pdfCertificateService.saveCertificatePdf(newCertRecord);
      await db.query(`UPDATE certificates SET pdf_path = $1 WHERE id = $2`, [pdfPath, (newCertRecord as CertificateRecord).id]);
      (newCertRecord as CertificateRecord).pdfPath = pdfPath;
    } catch (err: any) {
      console.error('[PdfCertificateService] Reissued PDF generation warning:', err.message);
    }

    return newCertRecord;
  }

  /**
   * Regenerates a certificate's PDF:
   * Re-runs the PDF generation pipeline without changing the certificate's underlying data,
   * preserving the certificate number and issue date, incrementing the PDF version,
   * saving certificate-<code_v<ver>.pdf in storage, and updating the active version.
   */
  async regenerateCertificate(certificateId: string, userId?: string): Promise<CertificateRecord> {
    const cert = await this.getCertificateById(certificateId);
    if (!cert) {
      throw new Error(`Certificate with ID ${certificateId} not found`);
    }

    const currentVersion = cert.version || 1;
    const newVersion = currentVersion + 1;
    const updatedCert: CertificateRecord = { ...cert, version: newVersion };

    // Re-run PDF generation pipeline
    const pdfBuffer = await pdfCertificateService.generateCertificatePdf(updatedCert);
    const pdfPath = await pdfCertificateService.saveCertificatePdfBuffer(updatedCert, pdfBuffer);

    // Update version and pdf_path in database while preserving certificate code and issue date
    const res = await db.query(
      `UPDATE certificates 
       SET version = $1, pdf_path = $2
       WHERE id = $3
       RETURNING *`,
      [newVersion, pdfPath, cert.id]
    );

    return this.mapCertificateRow(res.rows[0]);
  }

  /**
   * Retrieves a certificate by its unique database ID or certificate code.
   */
  async getCertificateById(idOrCode: string): Promise<CertificateRecord | null> {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrCode);
    const query = `
      SELECT c.*,
             f.full_name as farmer_name, f.farmer_code,
             v.name as village_name,
             cr.name as crop_name, cr.name_te as crop_name_te,
             s.season_code, s.season_year, s.season_type
      FROM certificates c
      JOIN farmers f ON f.id = c.farmer_id
      JOIN villages v ON v.id = f.village_id
      JOIN crops cr ON cr.id = c.crop_id
      JOIN seasons s ON s.id = c.season_id
      WHERE ${isUuid ? 'c.id = $1' : 'c.certificate_code = $1'}
    `;
    const res = await db.query(query, [idOrCode]);
    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    return {
      ...this.mapCertificateRow(row),
      farmerName: row.farmer_name,
      farmerCode: row.farmer_code,
      villageName: row.village_name,
      cropName: row.crop_name,
      cropNameTe: row.crop_name_te,
      seasonCode: row.season_code,
      seasonYear: row.season_year,
      seasonType: row.season_type,
    } as any;
  }

  /**
   * Retrieves an active certificate for a given season.
   */
  async getCertificateBySeason(seasonId: string): Promise<CertificateRecord | null> {
    const res = await db.query(
      `SELECT * FROM certificates 
       WHERE season_id = $1 
       ORDER BY is_revoked ASC, version DESC 
       LIMIT 1`,
      [seasonId]
    );
    if (res.rows.length === 0) return null;
    return this.mapCertificateRow(res.rows[0]);
  }

  /**
   * Retrieves a season report for an ineligible season.
   */
  async getSeasonReportBySeason(seasonId: string): Promise<SeasonReportRecord | null> {
    const res = await db.query(`SELECT * FROM season_reports WHERE season_id = $1 ORDER BY created_at DESC LIMIT 1`, [seasonId]);
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      id: r.id,
      reportCode: r.report_code,
      seasonId: r.season_id,
      farmerId: r.farmer_id,
      plotId: r.plot_id,
      cropId: r.crop_id,
      actualHarvestDate: r.actual_harvest_date instanceof Date ? r.actual_harvest_date.toISOString().split('T')[0] : String(r.actual_harvest_date).split('T')[0],
      yieldQuantity: r.yield_quantity ? Number(r.yield_quantity) : null,
      yieldUnit: r.yield_unit,
      monitoringCycleCoverage: Number(r.monitoring_cycle_coverage),
      confidenceScore: Number(r.confidence_score),
      confidenceBand: r.confidence_band,
      waterUseRatio: r.water_use_ratio !== null && r.water_use_ratio !== undefined ? Number(r.water_use_ratio) : null,
      waterUseRatioBand: r.water_use_ratio_band,
      isCertificateEligible: Boolean(r.is_certificate_eligible),
      ineligibilityReasons: typeof r.ineligibility_reasons === 'string' ? JSON.parse(r.ineligibility_reasons) : r.ineligibility_reasons,
      snapshotData: typeof r.snapshot_data === 'string' ? JSON.parse(r.snapshot_data) : r.snapshot_data,
      pdfPath: r.pdf_path,
      createdBy: r.created_by,
      createdAt: r.created_at,
    };
  }

  /**
   * Lists certificates with optional village scoping, farmer filtering, and pagination.
   */
  async listCertificates(
    scopedVillages: string[] | null,
    options: { page?: number; limit?: number; farmerId?: string; search?: string } = {}
  ) {
    const page = Math.max(1, options.page || 1);
    const limit = Math.min(100, Math.max(1, options.limit || 20));
    const offset = (page - 1) * limit;

    const conditions: string[] = [];
    const params: any[] = [];
    let pIdx = 1;

    if (scopedVillages !== null) {
      if (scopedVillages.length === 0) {
        return { data: [], total: 0, page, limit, totalPages: 0 };
      }
      conditions.push(`f.village_id = ANY($${pIdx})`);
      params.push(scopedVillages);
      pIdx++;
    }

    if (options.farmerId) {
      conditions.push(`c.farmer_id = $${pIdx}`);
      params.push(options.farmerId);
      pIdx++;
    }

    if (options.search) {
      conditions.push(`(f.full_name ILIKE $${pIdx} OR f.farmer_code ILIKE $${pIdx} OR c.certificate_code ILIKE $${pIdx} OR v.name ILIKE $${pIdx})`);
      params.push(`%${options.search}%`);
      pIdx++;
    }

    const filterClause = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';

    const countRes = await db.query(
      `SELECT COUNT(*)::int as total
       FROM certificates c
       JOIN farmers f ON f.id = c.farmer_id
       JOIN villages v ON v.id = f.village_id
       ${filterClause}`,
      params
    );
    const total = countRes.rows[0]?.total || 0;

    const listParams = [...params, limit, offset];
    const limitParamIdx = params.length + 1;
    const offsetParamIdx = params.length + 2;

    const listRes = await db.query(
      `SELECT c.*, f.full_name as farmer_name, f.farmer_code,
              v.name as village_name, cr.name as crop_name, cr.name_te as crop_name_te,
              s.season_code, s.season_year, s.season_type
       FROM certificates c
       JOIN farmers f ON f.id = c.farmer_id
       JOIN villages v ON v.id = f.village_id
       JOIN crops cr ON cr.id = c.crop_id
       JOIN seasons s ON s.id = c.season_id
       ${filterClause}
       ORDER BY c.created_at DESC
       LIMIT $${limitParamIdx} OFFSET $${offsetParamIdx}`,
      listParams
    );

    return {
      data: listRes.rows.map(r => ({
        ...this.mapCertificateRow(r),
        farmerName: r.farmer_name,
        farmerCode: r.farmer_code,
        villageName: r.village_name,
        cropName: r.crop_name,
        cropNameTe: r.crop_name_te,
        seasonCode: r.season_code,
        seasonYear: r.season_year,
        seasonType: r.season_type,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Public Verification Endpoint: Checks certificate validity against canonical ledger.
   * STRICT PRIVACY FILTER: Returns ONLY:
   * 1. Certificate Number
   * 2. Season
   * 3. Crop
   * 4. Village
   * 5. Issue Date
   * 6. Valid / Revoked Status (+ revocation reason if revoked)
   * 
   * NEVER returns farmer names, plots, land identifiers, confidence scores, or private water metrics.
   */
  async verifyCertificatePublic(codeOrToken: string): Promise<PublicVerificationResult | null> {
    const res = await db.query(
      `SELECT c.certificate_code, c.created_at, c.is_revoked, c.revocation_reason,
              c.snapshot_data, c.sha256_hash,
              v.name as village_name,
              cr.name as crop_name, cr.name_te as crop_name_te,
              s.season_year, s.season_type, s.data_origin as season_origin,
              f.data_origin as farmer_origin
       FROM certificates c
       JOIN farmers f ON f.id = c.farmer_id
       JOIN villages v ON v.id = f.village_id
       JOIN crops cr ON cr.id = c.crop_id
       JOIN seasons s ON s.id = c.season_id
       WHERE c.certificate_code = $1 OR c.verification_token = $1`,
      [codeOrToken]
    );

    if (res.rows.length === 0) {
      return null;
    }

    const r = res.rows[0];
    const snapshot = typeof r.snapshot_data === 'string' ? JSON.parse(r.snapshot_data) : r.snapshot_data;

    // Verify SHA-256 hash mathematically against canonical snapshot
    const computedHash = snapshotService.computeSha256(snapshot);
    const hashMatches = computedHash === r.sha256_hash;
    const isRevoked = Boolean(r.is_revoked);
    const isValid = hashMatches && !isRevoked;
    const isDemo = r.season_origin === 'demo' || r.farmer_origin === 'demo' || r.certificate_code === 'JALAMITRA-2026-00001' || String(r.certificate_code).includes('DEMO');

    return {
      certificateNumber: r.certificate_code,
      season: `${String(r.season_type).toUpperCase()} ${r.season_year}`,
      crop: r.crop_name_te ? `${r.crop_name} (${r.crop_name_te})` : r.crop_name,
      village: r.village_name,
      issueDate: r.created_at instanceof Date ? r.created_at.toISOString().split('T')[0] : String(r.created_at).split('T')[0],
      status: isRevoked ? 'revoked' : (isValid ? 'valid' : 'revoked'),
      isValid,
      isRevoked,
      isDemo: Boolean(isDemo),
      revocationReason: isRevoked ? (r.revocation_reason || 'Administrative revocation') : null,
      sha256Validated: hashMatches,
    };
  }

  /**
   * Seals an active certificate (Admin only).
   * Freezes certificate against routine edits/reissuances.
   */
  async sealCertificate(
    certificateId: string,
    reason: string,
    userId: string
  ): Promise<CertificateRecord> {
    if (!reason || !reason.trim()) {
      throw new Error('Mandatory reason required to seal certificate');
    }

    const existing = await this.getCertificateById(certificateId);
    if (!existing) {
      throw new Error(`Certificate with ID ${certificateId} not found`);
    }

    if (existing.isRevoked || existing.status === 'revoked') {
      throw new Error('Cannot seal a revoked certificate');
    }

    if (existing.status === 'sealed') {
      return existing;
    }

    let updatedCert: CertificateRecord | null = null;

    await withTransaction(async (tx) => {
      const res = await tx.query(
        `UPDATE certificates
         SET status = 'sealed',
             sealed_at = CURRENT_TIMESTAMP,
             sealed_reason = $1,
             sealed_by = $2
         WHERE id = $3
         RETURNING *`,
        [reason, userId, certificateId]
      );

      await tx.query(
        `INSERT INTO certificate_status_history (
          certificate_id, previous_status, new_status, reason, changed_by
        ) VALUES ($1, $2, 'sealed', $3, $4)`,
        [certificateId, existing.status || 'active', reason, userId]
      );

      updatedCert = this.mapCertificateRow(res.rows[0]);
    });

    return updatedCert!;
  }

  /**
   * Revokes a certificate (Admin only).
   */
  async revokeCertificate(
    certificateId: string,
    reason: string,
    userId: string
  ): Promise<CertificateRecord> {
    if (!reason || !reason.trim()) {
      throw new Error('Mandatory reason required to revoke certificate');
    }

    const existing = await this.getCertificateById(certificateId);
    if (!existing) {
      throw new Error(`Certificate with ID ${certificateId} not found`);
    }

    let updatedCert: CertificateRecord | null = null;

    await withTransaction(async (tx) => {
      const res = await tx.query(
        `UPDATE certificates
         SET status = 'revoked',
             is_revoked = true,
             revocation_reason = $1,
             revoked_at = CURRENT_TIMESTAMP,
             revoked_by = $2
         WHERE id = $3
         RETURNING *`,
        [reason, userId, certificateId]
      );

      await tx.query(
        `INSERT INTO certificate_status_history (
          certificate_id, previous_status, new_status, reason, changed_by
        ) VALUES ($1, $2, 'revoked', $3, $4)`,
        [certificateId, existing.status || 'active', reason, userId]
      );

      updatedCert = this.mapCertificateRow(res.rows[0]);
    });

    return updatedCert!;
  }

  /**
   * Retrieves certificate status history audit trail.
   */
  async getCertificateHistory(certificateId: string): Promise<any[]> {
    const res = await db.query(
      `SELECT h.*, u.name as changed_by_name
       FROM certificate_status_history h
       LEFT JOIN users u ON u.id = h.changed_by
       WHERE h.certificate_id = $1
       ORDER BY h.created_at ASC`,
      [certificateId]
    );

    return res.rows.map((r) => ({
      id: r.id,
      certificateId: r.certificate_id,
      previousStatus: r.previous_status,
      newStatus: r.new_status,
      reason: r.reason,
      changedBy: r.changed_by,
      changedByName: r.changed_by_name || null,
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    }));
  }

  private mapCertificateRow(r: any): CertificateRecord {
    return {
      id: r.id,
      certificateCode: r.certificate_code,
      seasonId: r.season_id,
      farmerId: r.farmer_id,
      plotId: r.plot_id,
      cropId: r.crop_id,
      waterUseRatio: r.water_use_ratio !== null && r.water_use_ratio !== undefined ? Number(r.water_use_ratio) : null,
      waterUseRatioBand: r.water_use_ratio_band,
      confidenceScore: Number(r.confidence_score),
      confidenceBand: r.confidence_band,
      estimatedWaterSavedLitres: Number(r.estimated_water_saved_litres || 0),
      actualHarvestDate: r.actual_harvest_date instanceof Date ? r.actual_harvest_date.toISOString().split('T')[0] : String(r.actual_harvest_date).split('T')[0],
      yieldQuantity: r.yield_quantity ? Number(r.yield_quantity) : null,
      yieldUnit: r.yield_unit,
      snapshotData: typeof r.snapshot_data === 'string' ? JSON.parse(r.snapshot_data) : r.snapshot_data,
      sha256Hash: r.sha256_hash,
      pdfPath: r.pdf_path,
      verificationToken: r.verification_token,
      replacesCertificateId: r.replaces_certificate_id || null,
      replacedByCertificateId: r.replaced_by_certificate_id || null,
      version: Number(r.version || 1),
      status: (r.status || (r.is_revoked ? 'revoked' : 'active')) as any,
      sealedAt: r.sealed_at instanceof Date ? r.sealed_at.toISOString() : r.sealed_at || null,
      sealedReason: r.sealed_reason || null,
      sealedBy: r.sealed_by || null,
      isRevoked: Boolean(r.is_revoked),
      revokedAt: r.revoked_at,
      revocationReason: r.revocation_reason,
      revokedBy: r.revoked_by,
      createdBy: r.created_by,
      createdAt: r.created_at,
    };
  }
}

export const certificateService = new CertificateService();
