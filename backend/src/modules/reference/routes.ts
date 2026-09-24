import { Router } from 'express';
import { getVillages, getCrops, getWaterSourceTypes, getIrrigationMethodTypes } from './controller.js';
import { requireAuth } from '../../middleware/auth.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';

const router = Router();

router.use(requireAuth);

router.get('/villages', asyncHandler(getVillages));
router.get('/crops', asyncHandler(getCrops));
router.get('/water-source-types', asyncHandler(getWaterSourceTypes));
router.get('/irrigation-method-types', asyncHandler(getIrrigationMethodTypes));

export default router;
