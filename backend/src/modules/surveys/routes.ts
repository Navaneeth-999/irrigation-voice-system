import express from 'express';
import { surveyController } from './controller.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';

const router = express.Router();

// 1. Comparison endpoint (must be before /:id)
router.get('/compare', requireAuth, (req, res) => {
  surveyController.compareSurveys(req, res);
});

// 2. List surveys
router.get('/', requireAuth, (req, res) => {
  surveyController.listSurveys(req, res);
});

// 3. Single survey
router.get('/:id', requireAuth, (req, res) => {
  surveyController.getSurvey(req, res);
});

// 4. Survey audit logs
router.get('/:id/audit-logs', requireAuth, (req, res) => {
  surveyController.getSurveyAuditLogs(req, res);
});

// 5. Create new survey (CSP Member or Admin)
router.post('/', requireAuth, requireRole('ADMIN', 'CSP_MEMBER'), (req, res) => {
  surveyController.createSurvey(req, res);
});

// 6. Correct/Update survey with mandatory reason (CSP Member or Admin)
router.put('/:id', requireAuth, requireRole('ADMIN', 'CSP_MEMBER'), (req, res) => {
  surveyController.correctSurvey(req, res);
});

export default router;
