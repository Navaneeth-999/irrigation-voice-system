import { Router } from 'express';
import { listCropProgress, createCropProgress } from './controller.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';

const router = Router();

router.use(requireAuth);

router.get('/seasons/:seasonId/crop-progress', asyncHandler(listCropProgress));
router.get('/', asyncHandler(listCropProgress));
router.post('/', requireRole('ADMIN', 'CSP_MEMBER'), asyncHandler(createCropProgress));

export default router;
