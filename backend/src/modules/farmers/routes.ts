import { Router } from 'express';
import {
  listFarmers,
  getFarmer,
  createFarmer,
  updateFarmer,
  deactivateFarmer,
  reactivateFarmer,
  getFarmerHistory,
  addContact,
  recordConsent,
  importFarmers,
} from './controller.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';

const router = Router();

router.use(requireAuth);

router.get('/', asyncHandler(listFarmers));
router.post('/', requireRole('ADMIN', 'CSP_MEMBER'), asyncHandler(createFarmer));
router.post('/import', requireRole('ADMIN', 'CSP_MEMBER'), asyncHandler(importFarmers));
router.get('/:id', asyncHandler(getFarmer));
router.patch('/:id', requireRole('ADMIN', 'CSP_MEMBER'), asyncHandler(updateFarmer));
router.post('/:id/deactivate', requireRole('ADMIN', 'CSP_MEMBER'), asyncHandler(deactivateFarmer));
router.post('/:id/reactivate', requireRole('ADMIN', 'CSP_MEMBER'), asyncHandler(reactivateFarmer));
router.get('/:id/history', asyncHandler(getFarmerHistory));
router.post('/:id/contacts', requireRole('ADMIN', 'CSP_MEMBER'), asyncHandler(addContact));
router.post('/:id/consents', requireRole('ADMIN', 'CSP_MEMBER'), asyncHandler(recordConsent));

export default router;
