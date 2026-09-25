import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import {
  listCommunicationLogs,
  sendDirectSms,
  fanOutAlert,
} from './controller.js';

const router = Router();

router.use(requireAuth);

router.get('/logs', listCommunicationLogs);
router.post('/sms/send', requireRole('ADMIN', 'CSP_MEMBER'), sendDirectSms);
router.post('/alerts/:alertId/fan-out', requireRole('ADMIN', 'CSP_MEMBER'), fanOutAlert);

export default router;
