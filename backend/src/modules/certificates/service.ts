import crypto from 'crypto';
import { db, withTransaction } from '../../db/index.js';
import { analyticsService } from '../analytics/service.js';
import { snapshotService } from './SnapshotService.js';
import { pdfCertificateService } from './PdfCertificateService.js';
import {
  CertificateRecord,
  IssueCertificateRequest,
  VerificationResult,
} from './types.js';

export class CertificateService {
  /**
   * Generates a unique, human-friendly certificate code (e.g. JALAMITRA-2026-X8K9P).
   */
  private generateCertificateCode(year: number): string {
    const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // base32 Crockford style (no 0, 1, I, O)
    let randomPart = '';
    const bytes = crypto.randomBytes(5);
    for (let i = 0; i < 5; i++) {
      randomPart += chars[bytes[i] % chars.length];
    }
    return `JALAMITRA-${year}-${randomPart}`;
  }

  /**
   * Completes a season and issues an immutable, cryptographically sealed conservation certificate.
   */
  async issueCertificate(req: IssueCertificateRequest): Promise<CertificateRecord> {
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

    // Check if certificate already issued
    const existingCert = await db.query(
      `SELECT id, certificate_code FROM certificates WHERE season_id = $1`,
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

    // 3. Build Immutable Snapshot and SHA-256 Hash
    const snapshot = await snapshotService.buildSeasonSnapshot(
      seasonId,
      actualHarvestDate,
      yieldQuantity,
      yieldUnit
    );

    const sha256Hash = snapshotService.computeSha256(snapshot);
    const certificateCode = this.generateCertificateCode(season.season_year);
    const verificationToken = crypto.randomBytes(24).toString('hex');

    // 4. Atomic transaction: Save certificate and update season status to 'completed'
    let certificateRecord: CertificateRecord | null = null;

    await withTransaction(async (tx) => {
      // Insert Certificate Record
      const certRes = await tx.query(
        `INSERT INTO certificates (
          certificate_code, season_id, farmer_id, plot_id, crop_id,
          water_use_ratio, water_use_ratio_band, confidence_score, confidence_band,
          estimated_water_saved_litres, actual_harvest_date, yield_quantity, yield_unit,
          snapshot_data, sha256_hash, verification_token, created_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
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
          0, // baseline comparison saved litres
          actualHarvestDate,
          yieldQuantity || null,
          yieldUnit || null,
          JSON.stringify(snapshot),
          sha256Hash,
          verificationToken,
          userId || null,
        ]
      );

      // Update Season Status to completed
      await tx.query(
        `UPDATE seasons
         SET status = 'completed',
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

      const r = certRes.rows[0];
      certificateRecord = {
        id: r.id,
        certificateCode: r.certificate_code,
        seasonId: r.season_id,
        farmerId: r.farmer_id,
        plotId: r.plot_id,
        cropId: r.crop_id,
        waterUseRatio: Number(r.water_use_ratio),
        waterUseRatioBand: r.water_use_ratio_band,
        confidenceScore: Number(r.confidence_score),
        confidenceBand: r.confidence_band,
        estimatedWaterSavedLitres: Number(r.estimated_water_saved_litres),
        actualHarvestDate: r.actual_harvest_date instanceof Date ? r.actual_harvest_date.toISOString().split('T')[0] : String(r.actual_harvest_date).split('T')[0],
        yieldQuantity: r.yield_quantity ? Number(r.yield_quantity) : null,
        yieldUnit: r.yield_unit,
        snapshotData: typeof r.snapshot_data === 'string' ? JSON.parse(r.snapshot_data) : r.snapshot_data,
        sha256Hash: r.sha256_hash,
        pdfPath: r.pdf_path,
        verificationToken: r.verification_token,
        isRevoked: Boolean(r.is_revoked),
        revokedAt: r.revoked_at,
        revocationReason: r.revocation_reason,
        revokedBy: r.revoked_by,
        createdBy: r.created_by,
        createdAt: r.created_at,
      };
    });

    if (!certificateRecord) {
      throw new Error('Failed to create certificate record');
    }

    // 5. Generate and persist PDF file
    try {
      const pdfPath = await pdfCertificateService.saveCertificatePdf(certificateRecord);
      await db.query(`UPDATE certificates SET pdf_path = $1 WHERE id = $2`, [pdfPath, (certificateRecord as CertificateRecord).id]);
      (certificateRecord as CertificateRecord).pdfPath = pdfPath;
    } catch (err: any) {
      console.error('[PdfCertificateService] PDF generation warning:', err.message);
    }

    return certificateRecord;
  }

  /**
   * Retrieves a certificate by its unique database ID.
   */
  async getCertificateById(id: string): Promise<CertificateRecord | null> {
    const res = await db.query(`SELECT * FROM certificates WHERE id = $1`, [id]);
    if (res.rows.length === 0) return null;
    return this.mapCertificateRow(res.rows[0]);
  }

  /**
   * Retrieves a certificate for a given season.
   */
  async getCertificateBySeason(seasonId: string): Promise<CertificateRecord | null> {
    const res = await db.query(`SELECT * FROM certificates WHERE season_id = $1`, [seasonId]);
    if (res.rows.length === 0) return null;
    return this.mapCertificateRow(res.rows[0]);
  }

  /**
   * Lists certificates with optional village scoping and pagination.
   */
  async listCertificates(scopedVillages: string[] | null, options: { page?: number; limit?: number } = {}) {
    const page = Math.max(1, options.page || 1);
    const limit = Math.min(100, Math.max(1, options.limit || 20));
    const offset = (page - 1) * limit;

    let filterClause = '';
    const params: any[] = [];

    if (scopedVillages !== null) {
      if (scopedVillages.length === 0) {
        return { data: [], total: 0, page, limit, totalPages: 0 };
      }
      params.push(scopedVillages);
      filterClause = ` WHERE f.village_id = ANY($1)`;
    }

    const countRes = await db.query(
      `SELECT COUNT(*)::int as total
       FROM certificates c
       JOIN farmers f ON f.id = c.farmer_id
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
      data: listRes.rows.map(r => this.mapCertificateRow(r)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Public Verification Endpoint: Checks certificate validity, recalculates SHA-256
   * from the immutable snapshot, and asserts mathematical integrity.
   */
  async verifyCertificatePublic(codeOrToken: string): Promise<VerificationResult | null> {
    const res = await db.query(
      `SELECT c.*, f.full_name as farmer_name, v.name as village_name, v.mandal, v.district,
              cr.name as crop_name, cr.name_te as crop_name_te,
              s.season_year, s.season_type
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

    // Recalculate SHA-256 hash in real time to verify integrity
    const computedHash = snapshotService.computeSha256(snapshot);
    const hashMatches = computedHash === r.sha256_hash;
    const isRevoked = Boolean(r.is_revoked);
    const isValid = hashMatches && !isRevoked;

    return {
      isValid,
      isRevoked,
      certificateCode: r.certificate_code,
      issuedAt: r.created_at,
      revokedAt: r.revoked_at,
      revocationReason: r.revocation_reason,
      sha256Hash: r.sha256_hash,
      computedHash,
      hashMatches,
      tamperDetected: !hashMatches,
      farmerName: r.farmer_name,
      villageName: r.village_name,
      mandal: r.mandal,
      district: r.district,
      cropName: r.crop_name,
      cropNameTe: r.crop_name_te,
      seasonYear: r.season_year,
      seasonType: r.season_type,
      waterUseRatio: Number(r.water_use_ratio),
      ratioBand: r.water_use_ratio_band,
      confidenceScore: Number(r.confidence_score),
      confidenceBand: r.confidence_band,
      hasUnvalidatedAssumptions: Boolean(snapshot?.waterMetrics?.hasUnvalidatedAssumptions),
      unvalidatedAssumptionsList: snapshot?.waterMetrics?.unvalidatedAssumptionsList || [],
    };
  }

  /**
   * Revokes a certificate (Admin only).
   */
  async revokeCertificate(
    certificateId: string,
    reason: string,
    userId: string
  ): Promise<CertificateRecord> {
    const res = await db.query(
      `UPDATE certificates
       SET is_revoked = true,
           revocation_reason = $1,
           revoked_at = CURRENT_TIMESTAMP,
           revoked_by = $2
       WHERE id = $3
       RETURNING *`,
      [reason, userId, certificateId]
    );

    if (res.rows.length === 0) {
      throw new Error(`Certificate with ID ${certificateId} not found`);
    }

    return this.mapCertificateRow(res.rows[0]);
  }

  private mapCertificateRow(r: any): CertificateRecord {
    return {
      id: r.id,
      certificateCode: r.certificate_code,
      seasonId: r.season_id,
      farmerId: r.farmer_id,
      plotId: r.plot_id,
      cropId: r.crop_id,
      waterUseRatio: Number(r.water_use_ratio),
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
