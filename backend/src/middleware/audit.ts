import { Request } from 'express';
import { db } from '../db/index.js';

export interface AuditParams {
  userId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: any;
  after?: any;
  req?: Request;
}

export async function recordAudit(params: AuditParams): Promise<void> {
  const ip = params.req?.ip || params.req?.socket?.remoteAddress || null;
  const userAgent = params.req?.headers['user-agent'] || null;
  const userId = params.userId || (params.req as any)?.user?.id || null;

  try {
    await db.query(`
      INSERT INTO audit_logs (user_id, action, entity_type, entity_id, before, after, ip, user_agent)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [
      userId,
      params.action,
      params.entityType,
      params.entityId || null,
      params.before ? JSON.stringify(params.before) : null,
      params.after ? JSON.stringify(params.after) : null,
      ip,
      userAgent,
    ]);
  } catch (err) {
    console.error('Failed to write audit log:', err);
    // Note: Do not throw here so audit failures don't crash the main business transaction,
    // but log visibly.
  }
}
