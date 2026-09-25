import { Request, Response } from 'express';
import { notificationService } from './NotificationService.js';

export async function listCommunicationLogs(req: Request, res: Response) {
  try {
    const farmerId = req.query.farmerId as string | undefined;
    const channel = req.query.channel as string | undefined;
    const status = req.query.status as string | undefined;
    const purpose = req.query.purpose as string | undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
    const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;

    const data = await notificationService.listLogs({
      farmerId,
      channel,
      status,
      purpose,
      limit,
      offset,
    });

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

export async function sendDirectSms(req: Request, res: Response) {
  try {
    const { farmerId, phone, message, purpose } = req.body;

    if (!farmerId || !phone || !message) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields (farmerId, phone, message).',
      });
    }

    const userId = (req as any).user?.id;

    const result = await notificationService.sendSms({
      farmerId,
      phone,
      message,
      purpose: purpose || 'manual_advisory',
      triggeredBy: userId,
    });

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

export async function fanOutAlert(req: Request, res: Response) {
  try {
    const alertId = req.params.alertId as string;
    const summary = await notificationService.fanOutWeatherAlert(alertId);

    return res.status(200).json({
      success: true,
      data: summary,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
