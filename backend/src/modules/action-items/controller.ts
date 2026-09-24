import { Request, Response } from 'express';
import { db } from '../../db/index.js';
import { AppError } from '../../middleware/errorHandler.js';
import { recordAudit } from '../../middleware/audit.js';
import { maskPhone } from '../../utils/phone.js';
import { getScopedVillageFilter } from '../../middleware/auth.js';
import { createActionItemSchema, updateActionItemSchema } from './schemas.js';

export async function listActionItems(req: Request, res: Response): Promise<void> {
  const { status, priority, type, farmer_id, season_id } = req.query;

  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  // Role-based village scoping
  const scopedVillages = getScopedVillageFilter(req.user);
  if (scopedVillages !== null) {
    if (scopedVillages.length === 0) {
      res.json({ data: [] });
      return;
    }
    conditions.push(`f.village_id = ANY($${paramIdx++})`);
    params.push(scopedVillages);
  }

  if (status) {
    conditions.push(`ai.status = $${paramIdx++}`);
    params.push(status);
  }
  if (priority) {
    conditions.push(`ai.priority = $${paramIdx++}`);
    params.push(priority);
  }
  if (type) {
    conditions.push(`ai.type = $${paramIdx++}`);
    params.push(type);
  }
  if (farmer_id) {
    conditions.push(`ai.farmer_id = $${paramIdx++}`);
    params.push(farmer_id);
  }
  if (season_id) {
    conditions.push(`ai.season_id = $${paramIdx++}`);
    params.push(season_id);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const query = `
    SELECT ai.*,
           f.full_name as farmer_name, c.phone_e164 as farmer_phone,
           v.name as village_name,
           u.name as assignee_name,
           s.season_code as season_name
    FROM action_items ai
    JOIN farmers f ON ai.farmer_id = f.id
    LEFT JOIN farmer_contacts c ON f.id = c.farmer_id AND c.type = 'primary' AND c.is_active = true
    LEFT JOIN villages v ON f.village_id = v.id
    LEFT JOIN users u ON ai.assignee_id = u.id
    LEFT JOIN seasons s ON ai.season_id = s.id
    ${whereClause}
    ORDER BY
      CASE ai.priority
        WHEN 'critical' THEN 1
        WHEN 'high' THEN 2
        WHEN 'medium' THEN 3
        WHEN 'low' THEN 4
        ELSE 5
      END,
      ai.created_at DESC
  `;

  const result = await db.query(query, params);
  const rows = result.rows.map((r: any) => ({
    ...r,
    farmer_phone: maskPhone(r.farmer_phone, req.user?.role || ''),
  }));

  res.json({ data: rows });
}

export async function getActionItem(req: Request, res: Response): Promise<void> {
  const { id } = req.params;

  const query = `
    SELECT ai.*,
           f.full_name as farmer_name, c.phone_e164 as farmer_phone,
           v.name as village_name,
           u.name as assignee_name,
           s.season_code as season_name
    FROM action_items ai
    JOIN farmers f ON ai.farmer_id = f.id
    LEFT JOIN farmer_contacts c ON f.id = c.farmer_id AND c.type = 'primary' AND c.is_active = true
    LEFT JOIN villages v ON f.village_id = v.id
    LEFT JOIN users u ON ai.assignee_id = u.id
    LEFT JOIN seasons s ON ai.season_id = s.id
    WHERE ai.id = $1
  `;

  const result = await db.query(query, [id]);
  if (result.rows.length === 0) {
    throw new AppError('Action item not found', 404, 'NOT_FOUND');
  }

  const item = result.rows[0];
  item.farmer_phone = maskPhone(item.farmer_phone, req.user?.role || '');

  res.json({ data: item });
}

export async function createActionItem(req: Request, res: Response): Promise<void> {
  const data = createActionItemSchema.parse(req.body);

  const resItem = await db.query(`
    INSERT INTO action_items (
      source, farmer_id, season_id, type, status, priority, referral_note, assignee_id
    )
    VALUES ($1, $2, $3, $4, 'open', $5, $6, $7)
    RETURNING *
  `, [
    data.source, data.farmer_id, data.season_id || null,
    data.type, data.priority, data.referral_note || null,
    data.assignee_id || null,
  ]);

  const item = resItem.rows[0];

  await recordAudit({
    userId: req.user?.id,
    action: 'ACTION_ITEM_CREATED',
    entityType: 'action_item',
    entityId: item.id,
    after: item,
    req,
  });

  res.status(201).json({ data: item });
}

export async function updateActionItem(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const data = updateActionItemSchema.parse(req.body);

  const existingRes = await db.query('SELECT * FROM action_items WHERE id = $1', [id]);
  if (existingRes.rows.length === 0) {
    throw new AppError('Action item not found', 404, 'NOT_FOUND');
  }
  const existing = existingRes.rows[0];

  const updates: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  if (data.status !== undefined) {
    updates.push(`status = $${paramIdx++}`);
    params.push(data.status);

    if (data.status === 'resolved' || data.status === 'closed') {
      updates.push(`closed_at = CURRENT_TIMESTAMP`);
    } else if (existing.status === 'resolved' || existing.status === 'closed') {
      updates.push(`closed_at = NULL`);
    }
  }

  if (data.priority !== undefined) {
    updates.push(`priority = $${paramIdx++}`);
    params.push(data.priority);
  }

  if (data.assignee_id !== undefined) {
    updates.push(`assignee_id = $${paramIdx++}`);
    params.push(data.assignee_id);
  }

  if (data.referral_note !== undefined) {
    updates.push(`referral_note = $${paramIdx++}`);
    params.push(data.referral_note);
  }

  if (updates.length === 0) {
    res.json({ data: existing });
    return;
  }

  params.push(id);
  const updateQuery = `
    UPDATE action_items
    SET ${updates.join(', ')}
    WHERE id = $${paramIdx}
    RETURNING *
  `;

  const updatedRes = await db.query(updateQuery, params);
  const updatedItem = updatedRes.rows[0];

  await recordAudit({
    userId: req.user?.id,
    action: 'ACTION_ITEM_UPDATED',
    entityType: 'action_item',
    entityId: id as string,
    before: existing,
    after: updatedItem,
    req,
  });

  res.json({ data: updatedItem });
}
