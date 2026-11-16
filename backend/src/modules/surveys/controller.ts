import { Request, Response } from 'express';
import { surveyService } from './service.js';
import { getScopedVillageFilter } from '../../middleware/auth.js';
import { CreateSurveyDTO, UpdateSurveyDTO } from './types.js';

export class SurveyController {
  /**
   * GET /api/v1/surveys
   */
  async listSurveys(req: Request, res: Response): Promise<void> {
    try {
      const scopedVillages = getScopedVillageFilter(req.user);
      const {
        farmerId,
        villageId,
        seasonId,
        startDate,
        endDate,
        dataOrigin,
        page,
        limit,
      } = req.query;

      const result = await surveyService.listSurveys(
        {
          farmerId: farmerId as string | undefined,
          villageId: villageId as string | undefined,
          seasonId: seasonId as string | undefined,
          startDate: startDate as string | undefined,
          endDate: endDate as string | undefined,
          dataOrigin: dataOrigin as string | undefined,
          page: page ? parseInt(page as string, 10) : undefined,
          limit: limit ? parseInt(limit as string, 10) : undefined,
        },
        scopedVillages
      );

      res.status(200).json({ success: true, ...result });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  /**
   * GET /api/v1/surveys/:id
   */
  async getSurvey(req: Request, res: Response): Promise<void> {
    try {
      const id = req.params.id as string;
      const scopedVillages = getScopedVillageFilter(req.user);
      const survey = await surveyService.getSurveyById(id, scopedVillages);

      if (!survey) {
        res.status(404).json({ success: false, error: `Survey ${id} not found` });
        return;
      }

      res.status(200).json({ success: true, data: survey });
    } catch (err: any) {
      const status = err.message.includes('Forbidden') ? 403 : 500;
      res.status(status).json({ success: false, error: err.message });
    }
  }

  /**
   * POST /api/v1/surveys
   */
  async createSurvey(req: Request, res: Response): Promise<void> {
    try {
      const {
        farmerId,
        villageId,
        plotId,
        seasonId,
        surveyDate,
        surveyPeriod,
        cropId,
        cropStageId,
        areaAcres,
        soilType,
        waterSourceTypeId,
        irrigationMethodTypeId,
        irrigationFrequencyDays,
        irrigationDurationHours,
        pumpDischargeLps,
        pumpHoursPerEvent,
        irrigationDepthMm,
        appliedWaterVolumeM3,
        appliedWaterLitres,
        rainfallMm,
        rainfallSource,
        waterAvailabilityStatus,
        cropCondition,
        cropYieldQuantity,
        cropYieldUnit,
        cropSalePricePerUnit,
        cultivationExpensesInr,
        farmerRemarks,
        surveyorName,
        measurementSource,
        dataOrigin,
      } = req.body;

      if (!farmerId) {
        res.status(400).json({ success: false, error: 'farmerId is required' });
        return;
      }

      if (!surveyDate) {
        res.status(400).json({ success: false, error: 'surveyDate is required (YYYY-MM-DD)' });
        return;
      }

      const scopedVillages = getScopedVillageFilter(req.user);

      const survey = await surveyService.createSurvey(
        {
          farmerId,
          villageId,
          plotId,
          seasonId,
          surveyDate,
          surveyPeriod,
          cropId,
          cropStageId,
          areaAcres: areaAcres !== undefined ? Number(areaAcres) : undefined,
          soilType,
          waterSourceTypeId,
          irrigationMethodTypeId,
          irrigationFrequencyDays: irrigationFrequencyDays !== undefined ? Number(irrigationFrequencyDays) : undefined,
          irrigationDurationHours: irrigationDurationHours !== undefined ? Number(irrigationDurationHours) : undefined,
          pumpDischargeLps: pumpDischargeLps !== undefined ? Number(pumpDischargeLps) : undefined,
          pumpHoursPerEvent: pumpHoursPerEvent !== undefined ? Number(pumpHoursPerEvent) : undefined,
          irrigationDepthMm: irrigationDepthMm !== undefined ? Number(irrigationDepthMm) : undefined,
          appliedWaterVolumeM3: appliedWaterVolumeM3 !== undefined ? Number(appliedWaterVolumeM3) : undefined,
          appliedWaterLitres: appliedWaterLitres !== undefined ? Number(appliedWaterLitres) : undefined,
          rainfallMm: rainfallMm !== undefined ? Number(rainfallMm) : undefined,
          rainfallSource,
          waterAvailabilityStatus,
          cropCondition,
          cropYieldQuantity: cropYieldQuantity !== undefined ? Number(cropYieldQuantity) : undefined,
          cropYieldUnit,
          cropSalePricePerUnit: cropSalePricePerUnit !== undefined ? Number(cropSalePricePerUnit) : undefined,
          cultivationExpensesInr: cultivationExpensesInr !== undefined ? Number(cultivationExpensesInr) : undefined,
          farmerRemarks,
          surveyorName: surveyorName || req.user?.name,
          measurementSource,
          dataOrigin,
        },
        req.user,
        scopedVillages
      );

      res.status(201).json({ success: true, data: survey });
    } catch (err: any) {
      console.error('CREATE SURVEY CONTROLLER ERROR STACK:', err);
      const status = err.message.includes('Forbidden') ? 403 : 400;
      res.status(status).json({ success: false, error: err.message });
    }
  }

  /**
   * PUT /api/v1/surveys/:id
   */
  async correctSurvey(req: Request, res: Response): Promise<void> {
    try {
      const id = req.params.id as string;
      const { correctionReason } = req.body;

      if (!req.user) {
        res.status(401).json({ success: false, error: 'Authentication required' });
        return;
      }

      if (!correctionReason || !correctionReason.trim()) {
        res.status(400).json({ success: false, error: 'correctionReason is required for survey modifications' });
        return;
      }

      const scopedVillages = getScopedVillageFilter(req.user);
      const updated = await surveyService.correctSurvey(
        id,
        req.body as UpdateSurveyDTO,
        req.user,
        scopedVillages
      );

      res.status(200).json({ success: true, data: updated });
    } catch (err: any) {
      const status = err.message.includes('Forbidden') ? 403 : err.message.includes('not found') ? 404 : 400;
      res.status(status).json({ success: false, error: err.message });
    }
  }

  /**
   * GET /api/v1/surveys/:id/audit-logs
   */
  async getSurveyAuditLogs(req: Request, res: Response): Promise<void> {
    try {
      const id = req.params.id as string;
      const logs = await surveyService.getSurveyAuditLogs(id);
      res.status(200).json({ success: true, data: logs });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  /**
   * GET /api/v1/surveys/compare?id1=...&id2=...
   */
  async compareSurveys(req: Request, res: Response): Promise<void> {
    try {
      const id1 = req.query.id1 as string;
      const id2 = req.query.id2 as string;

      if (!id1 || !id2) {
        res.status(400).json({ success: false, error: 'Both id1 and id2 query parameters are required for comparison' });
        return;
      }

      const scopedVillages = getScopedVillageFilter(req.user);
      const comparison = await surveyService.compareSurveys(id1, id2, scopedVillages);
      res.status(200).json({ success: true, data: comparison });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  }
}

export const surveyController = new SurveyController();
