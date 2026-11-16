import express from 'express';
import multer from 'multer';
import { observationController } from './controller.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';

const router = express.Router();

// Configure Multer for memory storage with 5MB limit
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB limit
  },
});

// Multer error handling wrapper
const handleUpload = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  upload.single('photo')(req, res, (err: any) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        res.status(400).json({ success: false, error: 'File size exceeds maximum limit of 5MB' });
        return;
      }
      res.status(400).json({ success: false, error: `Upload error: ${err.message}` });
      return;
    } else if (err) {
      res.status(400).json({ success: false, error: err.message });
      return;
    }
    next();
  });
};

// 1. Survey Summary (must be registered before /:id)
router.get('/survey-summary', requireAuth, (req, res) => {
  observationController.getSurveySummary(req, res);
});

// 2. List Observations
router.get('/', requireAuth, (req, res) => {
  observationController.listObservations(req, res);
});

// 3. Get Single Observation Metadata
router.get('/:id', requireAuth, (req, res) => {
  observationController.getObservation(req, res);
});

// 4. Authenticated Photo Streaming (Village-scoped & private)
router.get('/:id/photo', requireAuth, (req, res) => {
  observationController.getObservationPhoto(req, res);
});

// 5. Create New Field Observation (ADMIN & CSP_MEMBER only)
router.post(
  '/',
  requireAuth,
  requireRole('ADMIN', 'CSP_MEMBER'),
  handleUpload,
  (req, res) => {
    observationController.createObservation(req, res);
  }
);

// 6. Update Observation Metadata
router.put(
  '/:id',
  requireAuth,
  requireRole('ADMIN', 'CSP_MEMBER'),
  (req, res) => {
    observationController.updateObservation(req, res);
  }
);

// 7. Withdraw Participant Consent
router.post(
  '/:id/withdraw-consent',
  requireAuth,
  requireRole('ADMIN', 'CSP_MEMBER'),
  (req, res) => {
    observationController.withdrawConsent(req, res);
  }
);

// 8. Delete Observation & Storage File
router.delete(
  '/:id',
  requireAuth,
  requireRole('ADMIN', 'CSP_MEMBER'),
  (req, res) => {
    observationController.deleteObservation(req, res);
  }
);

export default router;
