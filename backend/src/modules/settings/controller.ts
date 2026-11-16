import { Request, Response } from 'express';
import { db } from '../../db/index.js';
import { z } from 'zod';
import { recordAudit } from '../../middleware/audit.js';

const updateSettingSchema = z.object({
  value: z.any(),
});

export const settingsController = {
  async getSettings(_req: Request, res: Response) {
    const result = await db.query(
      `SELECT key, value, description, updated_at FROM app_settings ORDER BY key ASC`
    );
    res.json({
      success: true,
      data: result.rows,
    });
  },

  async updateSetting(req: Request, res: Response) {
    const { key } = req.params;
    const { value } = updateSettingSchema.parse(req.body);

    const check = await db.query(`SELECT key FROM app_settings WHERE key = $1`, [key]);
    if (check.rowCount === 0) {
      return res.status(404).json({
        success: false,
        error: { message: `Setting with key '${key}' not found` },
      });
    }

    const updated = await db.query(
      `UPDATE app_settings 
       SET value = $1::jsonb, updated_at = CURRENT_TIMESTAMP 
       WHERE key = $2 
       RETURNING key, value, description, updated_at`,
      [JSON.stringify(value), key]
    );

    const settingKey = Array.isArray(key) ? key[0] : key;

    await recordAudit({
      userId: req.user?.id,
      action: 'UPDATE_SETTING',
      entityType: 'app_settings',
      entityId: settingKey,
      before: check.rows[0],
      after: updated.rows[0],
      req,
    });

    res.json({
      success: true,
      message: `Setting '${key}' updated successfully`,
      data: updated.rows[0],
    });
  },
};
