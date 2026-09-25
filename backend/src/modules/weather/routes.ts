import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import {
  getVillageWeather,
  refreshVillageWeather,
  listAlerts,
  createManualAdvisory,
  refreshAllVillages,
} from './controller.js';

const router = Router();

router.use(requireAuth);

router.get('/villages/:villageId', getVillageWeather);
router.post('/villages/:villageId/refresh', refreshVillageWeather);
router.get('/alerts', listAlerts);
router.post('/alerts/manual', requireRole('ADMIN', 'CSP_MEMBER'), createManualAdvisory);
router.post('/refresh-all', requireRole('ADMIN', 'CSP_MEMBER'), refreshAllVillages);

export default router;
