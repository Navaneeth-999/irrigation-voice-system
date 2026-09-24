import { Router } from 'express';
import {
  listActionItems,
  getActionItem,
  createActionItem,
  updateActionItem,
} from './controller.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';

const router = Router();

router.use(requireAuth);

router.get('/', asyncHandler(listActionItems));
router.post('/', requireRole('ADMIN', 'CSP_MEMBER'), asyncHandler(createActionItem));
router.get('/:id', asyncHandler(getActionItem));
router.patch('/:id', requireRole('ADMIN', 'CSP_MEMBER', 'AGRI_PANCHAYAT'), asyncHandler(updateActionItem));

export default router;
