import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { settingsController } from './controller.js';

const router = Router();

router.use(requireAuth);

router.get('/', asyncHandler(settingsController.getSettings));
router.put('/:key', requireRole('ADMIN'), asyncHandler(settingsController.updateSetting));

export default router;
