import { Request, Response } from 'express';
import { weatherService } from './service.js';
import { alertEngine } from './AlertEngine.js';

export async function getVillageWeather(req: Request, res: Response) {
  try {
    const villageId = req.params.villageId as string;
    const forceRefresh = req.query.refresh === 'true';

    const result = await weatherService.getVillageWeather(villageId, forceRefresh);
    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err: any) {
    if (err.message.includes('not found')) {
      return res.status(404).json({ success: false, error: err.message });
    }
    return res.status(500).json({ success: false, error: err.message });
  }
}

export async function refreshVillageWeather(req: Request, res: Response) {
  try {
    const villageId = req.params.villageId as string;
    const result = await weatherService.getVillageWeather(villageId, true);
    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

export async function listAlerts(req: Request, res: Response) {
  try {
    const villageId = req.query.villageId as string | undefined;
    const isActive = req.query.isActive !== undefined ? req.query.isActive === 'true' : undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;

    const alerts = await alertEngine.listAlerts({ villageId, isActive, limit });
    return res.status(200).json({
      success: true,
      data: alerts,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

export async function createManualAdvisory(req: Request, res: Response) {
  try {
    const {
      villageId,
      headlineEn,
      headlineTe,
      messageEn,
      messageTe,
      suggestedActionEn,
      suggestedActionTe,
      severity,
      validHours,
      notifyFarmers,
    } = req.body;

    if (!villageId || !headlineEn || !headlineTe || !messageEn || !messageTe) {
      return res.status(400).json({
        success: false,
        error: 'Missing required advisory fields (villageId, headlines, messages).',
      });
    }

    const user = (req as any).user;
    if (user?.role === 'AGRI_PANCHAYAT') {
      const isAssigned = user.scopes?.some(
        (s: any) => (s.scope_type === 'village' && s.scope_value === villageId) || s.scope_type === 'all'
      );
      if (!isAssigned) {
        return res.status(403).json({
          success: false,
          error: 'Forbidden: You are not assigned to this village.',
        });
      }
    }

    const userId = user?.id;

    const alert = await alertEngine.createManualAdvisory({
      villageId,
      headlineEn,
      headlineTe,
      messageEn,
      messageTe,
      suggestedActionEn,
      suggestedActionTe,
      severity: severity || 'advisory',
      validHours: validHours ? Number(validHours) : 24,
      notifyFarmers: notifyFarmers !== false,
      userId,
    });

    return res.status(201).json({
      success: true,
      data: alert,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

export async function refreshAllVillages(req: Request, res: Response) {
  try {
    const summary = await weatherService.refreshAllActiveVillages();
    return res.status(200).json({
      success: true,
      data: summary,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
