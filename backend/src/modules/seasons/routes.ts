import { Router } from 'express';
import {
  listSeasons,
  getSeason,
  createSeason,
  refreshDraftSnapshot,
  activateSeason,
  completeSeason,
  getSeasonTimeline,
} from './controller.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';

const router = Router();

router.use(requireAuth);

router.get('/', asyncHandler(listSeasons));
router.post('/', requireRole('ADMIN', 'CSP_MEMBER'), asyncHandler(createSeason));
router.get('/:id', asyncHandler(getSeason));
router.post('/:id/refresh-draft', requireRole('ADMIN', 'CSP_MEMBER'), asyncHandler(refreshDraftSnapshot));
router.post('/:id/activate', requireRole('ADMIN', 'CSP_MEMBER'), asyncHandler(activateSeason));
router.post('/:id/complete', requireRole('ADMIN', 'CSP_MEMBER'), asyncHandler(completeSeason));
router.get('/:id/timeline', asyncHandler(getSeasonTimeline));

export default router;
