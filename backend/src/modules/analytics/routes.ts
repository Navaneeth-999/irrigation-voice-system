import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { analyticsController, getDashboardKPIs } from './controller.js';

const router = Router();

router.use(requireAuth);

router.get('/dashboard', getDashboardKPIs);

router.get(
  '/seasons/:seasonId',
  (req, res) => analyticsController.getSeasonAnalytics(req, res)
);

router.post(
  '/seasons/:seasonId/recalculate',
  requireRole('ADMIN', 'CSP_MEMBER', 'AGRI_PANCHAYAT'),
  (req, res) => analyticsController.recalculateSeason(req, res)
);

export default router;
