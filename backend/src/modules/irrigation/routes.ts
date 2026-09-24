import { Router } from 'express';
import { listIrrigationRecords, createIrrigationRecord } from './controller.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';

const router = Router();

router.use(requireAuth);

router.get('/seasons/:seasonId/irrigation-records', asyncHandler(listIrrigationRecords));
router.get('/', asyncHandler(listIrrigationRecords));
router.post('/', requireRole('ADMIN', 'CSP_MEMBER'), asyncHandler(createIrrigationRecord));

export default router;
