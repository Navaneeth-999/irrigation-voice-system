import { Request, Response } from 'express';
import { observationService } from './service.js';
import { getScopedVillageFilter } from '../../middleware/auth.js';
import { ObservationCategory, ConsentMethod } from './types.js';

export class ObservationController {
  /**
   * GET /api/v1/observations
   * Lists observations with village scoping and category filtering.
   */
  async listObservations(req: Request, res: Response): Promise<void> {
    try {
      const scopedVillages = getScopedVillageFilter(req.user);
      const category = req.query.category as ObservationCategory | undefined;
      const villageId = req.query.villageId as string | undefined;
      const search = req.query.search as string | undefined;
      const onlyWithConsent = req.query.onlyWithConsent === 'true';
      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;

      const requestingUser = req.user ? { id: req.user.id, role: req.user.role } : undefined;

      const result = await observationService.listObservations(
        scopedVillages,
        {
          category,
          villageId,
          search,
          onlyWithConsent,
          page,
          limit,
        },
        requestingUser
      );

      res.status(200).json({ success: true, ...result });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  /**
   * GET /api/v1/observations/survey-summary
   * Aggregated community survey and field statistics.
   */
  async getSurveySummary(req: Request, res: Response): Promise<void> {
    try {
      const scopedVillages = getScopedVillageFilter(req.user);
      const summary = await observationService.getSurveySummary(scopedVillages);
      res.status(200).json({ success: true, data: summary });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  /**
   * GET /api/v1/observations/:id
   * Retrieves single observation details.
   */
  async getObservation(req: Request, res: Response): Promise<void> {
    try {
      const id = req.params.id as string;
      const scopedVillages = getScopedVillageFilter(req.user);
      const requestingUser = req.user ? { id: req.user.id, role: req.user.role } : undefined;
      const observation = await observationService.getObservationById(id, scopedVillages, requestingUser);

      if (!observation) {
        res.status(404).json({ success: false, error: `Observation ${id} not found` });
        return;
      }

      res.status(200).json({ success: true, data: observation });
    } catch (err: any) {
      const status = err.message.includes('Forbidden') ? 403 : 500;
      res.status(status).json({ success: false, error: err.message });
    }
  }

  /**
   * GET /api/v1/observations/:id/photo
   * Authenticated, village-scoped streaming of private observation photographs.
   */
  async getObservationPhoto(req: Request, res: Response): Promise<void> {
    try {
      const id = req.params.id as string;
      const scopedVillages = getScopedVillageFilter(req.user);
      const requestingUser = req.user ? { id: req.user.id, role: req.user.role } : undefined;

      const photo = await observationService.getObservationPhoto(id, scopedVillages, requestingUser);

      res.setHeader('Content-Type', photo.mimeType);
      res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Disposition', `inline; filename="${photo.filename}"`);
      res.status(200).send(photo.buffer);
    } catch (err: any) {
      if (
        err.message.includes('Forbidden') ||
        err.message.includes('restricted') ||
        err.message.includes('withdrawn') ||
        err.message.includes('consent')
      ) {
        res.status(403).json({ success: false, error: err.message });
      } else if (err.message.includes('not found')) {
        res.status(404).json({ success: false, error: err.message });
      } else {
        res.status(400).json({ success: false, error: err.message });
      }
    }
  }

  /**
   * POST /api/v1/observations
   * Uploads genuine field photograph and records observation metadata.
   */
  async createObservation(req: Request, res: Response): Promise<void> {
    try {
      const file = req.file;
      if (!file) {
        res.status(400).json({ success: false, error: 'Photo file is required (JPEG, PNG, or WebP)' });
        return;
      }

      const {
        villageId,
        farmerId,
        plotId,
        observationDate,
        category,
        title,
        caption,
        surveyorName,
        consentVerified,
        consentMethod,
        consentNotes,
      } = req.body;

      if (!villageId) {
        res.status(400).json({ success: false, error: 'villageId is required' });
        return;
      }
      if (!observationDate) {
        res.status(400).json({ success: false, error: 'observationDate is required' });
        return;
      }
      if (!category) {
        res.status(400).json({ success: false, error: 'category is required' });
        return;
      }
      if (!title || !title.trim()) {
        res.status(400).json({ success: false, error: 'title is required' });
        return;
      }
      if (!caption || !caption.trim()) {
        res.status(400).json({ success: false, error: 'caption is required' });
        return;
      }

      // Check village scoping for AGRI_PANCHAYAT / scoped users
      const scopedVillages = getScopedVillageFilter(req.user);
      if (scopedVillages !== null && !scopedVillages.includes(villageId)) {
        res.status(403).json({ success: false, error: 'Forbidden: Cannot upload observations for unassigned village' });
        return;
      }

      const observation = await observationService.createObservation(
        {
          villageId,
          farmerId: farmerId || null,
          plotId: plotId || null,
          observationDate,
          category: category as ObservationCategory,
          title,
          caption,
          surveyorName,
          consentVerified: consentVerified === 'true' || consentVerified === true,
          consentMethod: consentMethod as ConsentMethod | undefined,
          consentNotes,
        },
        file.buffer,
        req.user?.id
      );

      res.status(201).json({ success: true, data: observation });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  }

  /**
   * PUT /api/v1/observations/:id
   * Updates observation metadata. Enforces ownership: ADMIN or authoring CSP member.
   */
  async updateObservation(req: Request, res: Response): Promise<void> {
    try {
      const id = req.params.id as string;
      const scopedVillages = getScopedVillageFilter(req.user);
      if (!req.user) {
        res.status(401).json({ success: false, error: 'Authentication required' });
        return;
      }

      const {
        title,
        caption,
        category,
        observationDate,
        surveyorName,
        consentVerified,
        consentMethod,
        consentNotes,
        isPublished,
      } = req.body;

      const updated = await observationService.updateObservation(
        id,
        {
          title,
          caption,
          category,
          observationDate,
          surveyorName,
          consentVerified: consentVerified !== undefined ? (consentVerified === 'true' || consentVerified === true) : undefined,
          consentMethod,
          consentNotes,
          isPublished: isPublished !== undefined ? (isPublished === 'true' || isPublished === true) : undefined,
        },
        { id: req.user.id, role: req.user.role },
        scopedVillages
      );

      res.status(200).json({ success: true, data: updated });
    } catch (err: any) {
      const status = err.message.includes('Forbidden') ? 403 : 400;
      res.status(status).json({ success: false, error: err.message });
    }
  }

  /**
   * POST /api/v1/observations/:id/withdraw-consent
   * Logs withdrawal of participant consent and immediately disables photo display.
   */
  async withdrawConsent(req: Request, res: Response): Promise<void> {
    try {
      const id = req.params.id as string;
      const { reason } = req.body;
      const scopedVillages = getScopedVillageFilter(req.user);

      if (!reason || !reason.trim()) {
        res.status(400).json({ success: false, error: 'Withdrawal reason is required' });
        return;
      }
      if (!req.user) {
        res.status(401).json({ success: false, error: 'Authentication required' });
        return;
      }

      const updated = await observationService.withdrawConsent(
        id,
        { reason },
        { id: req.user.id, role: req.user.role },
        scopedVillages
      );

      res.status(200).json({ success: true, data: updated });
    } catch (err: any) {
      const status = err.message.includes('Forbidden') ? 403 : 400;
      res.status(status).json({ success: false, error: err.message });
    }
  }

  /**
   * DELETE /api/v1/observations/:id
   * Deletes observation and cleans up physical storage file.
   */
  async deleteObservation(req: Request, res: Response): Promise<void> {
    try {
      const id = req.params.id as string;
      const scopedVillages = getScopedVillageFilter(req.user);
      if (!req.user) {
        res.status(401).json({ success: false, error: 'Authentication required' });
        return;
      }

      await observationService.deleteObservation(
        id,
        { id: req.user.id, role: req.user.role },
        scopedVillages
      );

      res.status(200).json({ success: true, message: 'Observation deleted successfully' });
    } catch (err: any) {
      const status = err.message.includes('Forbidden') ? 403 : 400;
      res.status(status).json({ success: false, error: err.message });
    }
  }
}

export const observationController = new ObservationController();
