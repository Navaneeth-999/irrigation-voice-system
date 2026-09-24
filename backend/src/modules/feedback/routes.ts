import { Router } from 'express';
import { listFeedback, createFeedback } from './controller.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';

const router = Router();

router.use(requireAuth);

router.get('/', asyncHandler(listFeedback));
router.post('/', requireRole('ADMIN', 'CSP_MEMBER'), asyncHandler(createFeedback));

export default router;
