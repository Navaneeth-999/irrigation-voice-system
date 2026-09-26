import { Request, Response } from 'express';
import fs from 'fs';
import { certificateService } from './service.js';
import { pdfCertificateService } from './PdfCertificateService.js';
import { getScopedVillageFilter } from '../../middleware/auth.js';
import { db } from '../../db/index.js';

export class CertificateController {
  /**
   * POST /api/v1/certificates/seasons/:seasonId/issue
   * Issues a conservation certificate upon harvest completion.
   */
  async issueCertificate(req: Request, res: Response): Promise<void> {
    try {
      const seasonId = req.params.seasonId as string;
      const actualHarvestDate = req.body.actualHarvestDate || req.body.actual_harvest_date;
      const yieldQuantity = req.body.yieldQuantity !== undefined ? req.body.yieldQuantity : req.body.yield_value;
      const yieldUnit = req.body.yieldUnit || req.body.yield_unit;
      const completionNotes = req.body.completionNotes || req.body.harvest_notes;

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

      const certificate = await certificateService.issueCertificate({
        seasonId,
        actualHarvestDate,
        yieldQuantity,
        yieldUnit,
        completionNotes,
        userId: req.user?.id,
      });

      res.status(201).json({ success: true, data: certificate });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  }

  /**
   * GET /api/v1/certificates
   * Lists certificates with village scoping.
   */
  async listCertificates(req: Request, res: Response): Promise<void> {
    try {
      const scopedVillages = getScopedVillageFilter(req.user);
      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;

      const result = await certificateService.listCertificates(scopedVillages, { page, limit });
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
      if (cert.pdfPath && fs.existsSync(cert.pdfPath)) {
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${cert.certificateCode}.pdf"`);
        fs.createReadStream(cert.pdfPath).pipe(res);
      } else {
        const buffer = await pdfCertificateService.generateCertificatePdf(cert);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${cert.certificateCode}.pdf"`);
        res.send(buffer);
      }
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  /**
   * GET /api/v1/certificates/verify/:code
   * PUBLIC: Verifies certificate authenticity and SHA-256 integrity without authentication.
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
}

export const certificateController = new CertificateController();
