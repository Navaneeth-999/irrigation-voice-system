import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { certificateController } from './controller.js';

const router = Router();

// ==============================================================================
// PUBLIC ROUTE (No Auth Required)
// ==============================================================================
router.get(
  '/verify/:code',
  (req, res) => certificateController.verifyPublic(req, res)
);

// ==============================================================================
// AUTHENTICATED ROUTES
// ==============================================================================
router.use(requireAuth);

router.get(
  '/',
  (req, res) => certificateController.listCertificates(req, res)
);

router.get(
  '/seasons/:seasonId/eligibility',
  (req, res) => certificateController.checkEligibility(req, res)
);

router.get(
  '/seasons/:seasonId/report',
  (req, res) => certificateController.getSeasonReport(req, res)
);

router.get(
  '/seasons/:seasonId/report/pdf',
  (req, res) => certificateController.downloadReportPdfBySeason(req, res)
);

router.get(
  '/reports/:id/pdf',
  (req, res) => certificateController.downloadReportPdf(req, res)
);

router.get(
  '/:id',
  (req, res) => certificateController.getCertificate(req, res)
);

router.get(
  '/:id/pdf',
  (req, res) => certificateController.downloadPdf(req, res)
);

router.post(
  '/seasons/:seasonId/issue',
  requireRole('ADMIN', 'CSP_MEMBER', 'AGRI_PANCHAYAT'),
  (req, res) => certificateController.issueCertificate(req, res)
);

router.post(
  '/:id/reissue',
  requireRole('ADMIN', 'AGRI_PANCHAYAT'),
  (req, res) => certificateController.reissueCertificate(req, res)
);

router.post(
  '/:id/revoke',
  requireRole('ADMIN'),
  (req, res) => certificateController.revokeCertificate(req, res)
);

export default router;
