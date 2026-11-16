import { Request, Response } from 'express';
import fs from 'fs';
import { certificateService } from './service.js';
import { pdfCertificateService } from './PdfCertificateService.js';
import { getScopedVillageFilter } from '../../middleware/auth.js';
import { db } from '../../db/index.js';

export class CertificateController {
  /**
   * GET /api/v1/certificates/seasons/:seasonId/eligibility
   * Checks certificate eligibility gating before or after completion.
   */
  async checkEligibility(req: Request, res: Response): Promise<void> {
    try {
      const seasonId = req.params.seasonId as string;
      const eligibility = await certificateService.checkCertificateEligibility(seasonId);
      res.status(200).json({ success: true, data: eligibility });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  }

  /**
   * POST /api/v1/certificates/seasons/:seasonId/issue
   * Completes a season and issues either a Conservation Certificate (if eligible)
   * or a Season Water Performance Summary Report (if ineligible).
   */
  async issueCertificate(req: Request, res: Response): Promise<void> {
    try {
      const seasonId = (req.params.seasonId || req.body.seasonId || req.body.season_id) as string;
      const actualHarvestDate = req.body.actualHarvestDate || req.body.actual_harvest_date;
      const yieldQuantity = req.body.yieldQuantity !== undefined ? req.body.yieldQuantity : req.body.yield_value;
      const yieldUnit = req.body.yieldUnit || req.body.yield_unit;
      const completionNotes = req.body.completionNotes || req.body.harvest_notes;

      if (!seasonId) {
        res.status(400).json({ success: false, error: 'seasonId is required' });
        return;
      }

      if (!actualHarvestDate) {
        res.status(400).json({ success: false, error: 'actualHarvestDate is required' });
        return;
      }

      // Check village scoping for AGRI_PANCHAYAT
      const scopedVillages = getScopedVillageFilter(req.user);
      if (scopedVillages !== null) {
        const seasonRes = await db.query(
          `SELECT f.village_id 
           FROM seasons s 
           JOIN farmers f ON f.id = s.farmer_id 
           WHERE s.id = $1`,
          [seasonId]
        );
        if (seasonRes.rows.length === 0) {
          res.status(404).json({ success: false, error: `Season ${seasonId} not found` });
          return;
        }
        if (!scopedVillages.includes(seasonRes.rows[0].village_id)) {
          res.status(403).json({ success: false, error: 'Forbidden: Access to season outside assigned village scope' });
          return;
        }
      }

      const result = await certificateService.issueCertificate({
        seasonId,
        actualHarvestDate,
        yieldQuantity,
        yieldUnit,
        completionNotes,
        userId: req.user?.id,
      });

      if (result.eligible && result.certificate) {
        res.status(201).json({
          success: true,
          eligible: true,
          data: result.certificate,
        });
      } else {
        res.status(200).json({
          success: true,
          eligible: false,
          data: result.seasonReport,
          ineligibilityReasons: result.ineligibilityReasons,
        });
      }
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  }

  /**
   * POST /api/v1/certificates/:id/reissue
   * Reissues a certificate, creating a new version and linking replaces_certificate_id.
   */
  async reissueCertificate(req: Request, res: Response): Promise<void> {
    try {
      const oldCertificateId = req.params.id as string;
      const { reason, actualHarvestDate, yieldQuantity, yieldUnit, completionNotes } = req.body;

      if (!reason) {
        res.status(400).json({ success: false, error: 'Reissuance reason is required' });
        return;
      }

      const cert = await certificateService.getCertificateById(oldCertificateId);
      if (!cert) {
        res.status(404).json({ success: false, error: `Certificate ${oldCertificateId} not found` });
        return;
      }

      // Check village scoping
      const scopedVillages = getScopedVillageFilter(req.user);
      if (scopedVillages !== null) {
        const farmerRes = await db.query(`SELECT village_id FROM farmers WHERE id = $1`, [cert.farmerId]);
        if (farmerRes.rows.length === 0 || !scopedVillages.includes(farmerRes.rows[0].village_id)) {
          res.status(403).json({ success: false, error: 'Forbidden: Access outside assigned village scope' });
          return;
        }
      }

      const newCert = await certificateService.reissueCertificate({
        oldCertificateId,
        reason,
        actualHarvestDate,
        yieldQuantity,
        yieldUnit,
        completionNotes,
        userId: req.user?.id,
      });

      res.status(201).json({ success: true, data: newCert });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  }

  /**
   * GET /api/v1/certificates
   * Lists certificates with village scoping, farmer filtering, and search.
   */
  async listCertificates(req: Request, res: Response): Promise<void> {
    try {
      const scopedVillages = getScopedVillageFilter(req.user);
      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
      const farmerId = (req.query.farmerId || req.query.farmer_id) as string | undefined;
      const search = req.query.search as string | undefined;

      const result = await certificateService.listCertificates(scopedVillages, { page, limit, farmerId, search });
      res.status(200).json({ success: true, ...result });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  /**
   * GET /api/v1/certificates/:id
   * Retrieves certificate details.
   */
  async getCertificate(req: Request, res: Response): Promise<void> {
    try {
      const id = req.params.id as string;
      const cert = await certificateService.getCertificateById(id);

      if (!cert) {
        res.status(404).json({ success: false, error: `Certificate with ID ${id} not found` });
        return;
      }

      // Check village scoping
      const scopedVillages = getScopedVillageFilter(req.user);
      if (scopedVillages !== null) {
        const farmerRes = await db.query(`SELECT village_id FROM farmers WHERE id = $1`, [cert.farmerId]);
        if (farmerRes.rows.length === 0 || !scopedVillages.includes(farmerRes.rows[0].village_id)) {
          res.status(403).json({ success: false, error: 'Forbidden: Certificate outside assigned village scope' });
          return;
        }
      }

      res.status(200).json({ success: true, data: cert });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  /**
   * GET /api/v1/certificates/seasons/:seasonId/report
   * Retrieves season report for an ineligible season.
   */
  async getSeasonReport(req: Request, res: Response): Promise<void> {
    try {
      const seasonId = req.params.seasonId as string;
      const report = await certificateService.getSeasonReportBySeason(seasonId);

      if (!report) {
        res.status(404).json({ success: false, error: `Season report for season ${seasonId} not found` });
        return;
      }

      res.status(200).json({ success: true, data: report });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  /**
   * GET /api/v1/certificates/reports/:id/pdf
   * Downloads or streams the season report PDF for an ineligible season.
   */
  async downloadReportPdf(req: Request, res: Response): Promise<void> {
    try {
      const reportId = req.params.id as string;
      const resQuery = await db.query(`SELECT * FROM season_reports WHERE id = $1`, [reportId]);
      if (resQuery.rows.length === 0) {
        res.status(404).json({ success: false, error: `Season report ${reportId} not found` });
        return;
      }

      const r = resQuery.rows[0];
      const report = {
        id: r.id,
        reportCode: r.report_code,
        seasonId: r.season_id,
        farmerId: r.farmer_id,
        plotId: r.plot_id,
        cropId: r.crop_id,
        actualHarvestDate: String(r.actual_harvest_date).split('T')[0],
        yieldQuantity: r.yield_quantity ? Number(r.yield_quantity) : null,
        yieldUnit: r.yield_unit,
        monitoringCycleCoverage: Number(r.monitoring_cycle_coverage),
        confidenceScore: Number(r.confidence_score),
        confidenceBand: r.confidence_band,
        waterUseRatio: Number(r.water_use_ratio),
        waterUseRatioBand: r.water_use_ratio_band,
        isCertificateEligible: Boolean(r.is_certificate_eligible),
        ineligibilityReasons: typeof r.ineligibility_reasons === 'string' ? JSON.parse(r.ineligibility_reasons) : r.ineligibility_reasons,
        snapshotData: typeof r.snapshot_data === 'string' ? JSON.parse(r.snapshot_data) : r.snapshot_data,
        pdfPath: r.pdf_path,
        createdBy: r.created_by,
        createdAt: r.created_at,
      };

      if (report.pdfPath && fs.existsSync(report.pdfPath)) {
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${report.reportCode}.pdf"`);
        fs.createReadStream(report.pdfPath).pipe(res);
      } else {
        const buffer = await pdfCertificateService.generateSeasonReportPdf(report);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${report.reportCode}.pdf"`);
        res.send(buffer);
      }
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  /**
   * GET /api/v1/certificates/seasons/:seasonId/report/pdf
   * Downloads or streams the season report PDF for a given season.
   */
  async downloadReportPdfBySeason(req: Request, res: Response): Promise<void> {
    try {
      const seasonId = req.params.seasonId as string;
      const report = await certificateService.getSeasonReportBySeason(seasonId);
      if (!report) {
        res.status(404).json({ success: false, error: `Season report for season ${seasonId} not found` });
        return;
      }

      if (report.pdfPath && fs.existsSync(report.pdfPath)) {
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${report.reportCode}.pdf"`);
        fs.createReadStream(report.pdfPath).pipe(res);
      } else {
        const buffer = await pdfCertificateService.generateSeasonReportPdf(report);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${report.reportCode}.pdf"`);
        res.send(buffer);
      }
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  /**
   * GET /api/v1/certificates/:id/pdf
   * Downloads or streams the certificate PDF.
   */
  async downloadPdf(req: Request, res: Response): Promise<void> {
    try {
      const id = req.params.id as string;
      const cert = await certificateService.getCertificateById(id);

      if (!cert) {
        res.status(404).json({ success: false, error: `Certificate with ID ${id} not found` });
        return;
      }

      // Check scoping
      const scopedVillages = getScopedVillageFilter(req.user);
      if (scopedVillages !== null) {
        const farmerRes = await db.query(`SELECT village_id FROM farmers WHERE id = $1`, [cert.farmerId]);
        if (farmerRes.rows.length === 0 || !scopedVillages.includes(farmerRes.rows[0].village_id)) {
          res.status(403).json({ success: false, error: 'Forbidden: Certificate outside assigned village scope' });
          return;
        }
      }

      // Stream existing PDF or generate on demand
      const filename = `certificate-${cert.certificateCode}-v${cert.version || 1}.pdf`;
      if (cert.pdfPath && fs.existsSync(cert.pdfPath)) {
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
        fs.createReadStream(cert.pdfPath).pipe(res);
      } else {
        const buffer = await pdfCertificateService.generateCertificatePdf(cert);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
        res.send(buffer);
      }
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  /**
   * GET /api/v1/certificates/verify/:code
   * PUBLIC: Verifies certificate authenticity and SHA-256 integrity without authentication.
   * Returns STRICTLY limited privacy-preserving fields.
   */
  async verifyPublic(req: Request, res: Response): Promise<void> {
    try {
      const code = req.params.code as string;
      const verification = await certificateService.verifyCertificatePublic(code);

      if (!verification) {
        res.status(404).json({ success: false, error: 'Certificate not found or invalid' });
        return;
      }

      res.status(200).json({ success: true, data: verification });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  /**
   * POST /api/v1/certificates/:id/seal
   * Admin-only sealing of a certificate to lock its state permanently.
   */
  async sealCertificate(req: Request, res: Response): Promise<void> {
    try {
      const id = req.params.id as string;
      const { reason } = req.body;

      if (!reason || !reason.trim()) {
        res.status(400).json({ success: false, error: 'Sealing reason is required' });
        return;
      }

      const sealed = await certificateService.sealCertificate(id, reason, req.user?.id || 'admin');
      res.status(200).json({ success: true, data: sealed });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  }

  /**
   * GET /api/v1/certificates/:id/history
   * Retrieves status history audit trail for a certificate.
   */
  async getCertificateHistory(req: Request, res: Response): Promise<void> {
    try {
      const id = req.params.id as string;
      const history = await certificateService.getCertificateHistory(id);
      res.status(200).json({ success: true, data: history });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  /**
   * POST /api/v1/certificates/:id/revoke
   * Admin-only revocation of a compromised or invalid certificate.
   */
  async revokeCertificate(req: Request, res: Response): Promise<void> {
    try {
      const id = req.params.id as string;
      const { reason } = req.body;

      if (!reason) {
        res.status(400).json({ success: false, error: 'Revocation reason is required' });
        return;
      }

      const revoked = await certificateService.revokeCertificate(id, reason, req.user?.id || 'admin');
      res.status(200).json({ success: true, data: revoked });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  }

  /**
   * POST /api/v1/certificates/:id/regenerate
   * Admin-only re-generation of certificate PDF preserving code, issue date and data.
   */
  async regenerateCertificate(req: Request, res: Response): Promise<void> {
    try {
      const id = req.params.id as string;
      const cert = await certificateService.regenerateCertificate(id, req.user?.id);
      res.status(200).json({ success: true, data: cert });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  }
}

export const certificateController = new CertificateController();
