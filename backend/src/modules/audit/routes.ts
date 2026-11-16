import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { auditController } from './controller.js';

const router = Router();

// Only authenticated ADMIN users may access the audit log trail
router.use(requireAuth);
router.use(requireRole('ADMIN'));

router.get('/', asyncHandler(auditController.listAuditLogs));
router.get('/stats', asyncHandler(auditController.getAuditStats));
router.get('/integrity', asyncHandler(auditController.verifyIntegrity));

export default router;
