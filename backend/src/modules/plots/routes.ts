import { Router } from 'express';
import {
  listPlots,
  getPlot,
  createPlot,
  updatePlot,
  addPlotWaterSource,
  deletePlotWaterSource,
} from './controller.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';

const router = Router();

router.use(requireAuth);

router.get('/', asyncHandler(listPlots));
router.post('/', requireRole('ADMIN', 'CSP_MEMBER'), asyncHandler(createPlot));
router.get('/:id', asyncHandler(getPlot));
router.patch('/:id', requireRole('ADMIN', 'CSP_MEMBER'), asyncHandler(updatePlot));
router.post('/:id/water-sources', requireRole('ADMIN', 'CSP_MEMBER'), asyncHandler(addPlotWaterSource));
router.delete('/water-sources/:id', requireRole('ADMIN', 'CSP_MEMBER'), asyncHandler(deletePlotWaterSource));

export default router;
