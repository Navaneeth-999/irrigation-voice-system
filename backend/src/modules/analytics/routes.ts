import { Router } from 'express';
import { getDashboardKPIs } from './controller.js';
import { requireAuth } from '../../middleware/auth.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';

const router = Router();

router.use(requireAuth);

router.get('/dashboard', asyncHandler(getDashboardKPIs));

export default router;
