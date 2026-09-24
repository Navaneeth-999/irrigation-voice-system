import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { db, withTransaction } from '../../db/index.js';
import { AppError } from '../../middleware/errorHandler.js';
import { recordAudit } from '../../middleware/audit.js';

const createUserSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6),
  role: z.enum(['ADMIN', 'CSP_MEMBER', 'AGRI_PANCHAYAT']),
});

const updateUserSchema = z.object({
  name: z.string().min(2).optional(),
  role: z.enum(['ADMIN', 'CSP_MEMBER', 'AGRI_PANCHAYAT']).optional(),
  is_active: z.boolean().optional(),
});

const setScopesSchema = z.object({
  scopes: z.array(z.object({
    scope_type: z.enum(['village', 'mandal', 'district']),
    scope_value: z.string().min(1),
  })),
});

export async function listUsers(_req: Request, res: Response): Promise<void> {
  const usersRes = await db.query(`
    SELECT u.id, u.name, u.email, u.role, u.is_active, u.last_login_at, u.created_at,
           COALESCE(json_agg(json_build_object('scope_type', s.scope_type, 'scope_value', s.scope_value)) 
           FILTER (WHERE s.id IS NOT NULL), '[]') as scopes
    FROM users u
    LEFT JOIN user_scopes s ON u.id = s.user_id
    GROUP BY u.id
    ORDER BY u.created_at DESC
  `);

  res.json({ data: usersRes.rows });
}

export async function createUser(req: Request, res: Response): Promise<void> {
  const data = createUserSchema.parse(req.body);
  const passwordHash = await bcrypt.hash(data.password, 12);

  try {
    const resUser = await db.query(`
      INSERT INTO users (name, email, password_hash, role, is_active)
      VALUES ($1, $2, $3, $4, true)
      RETURNING id, name, email, role, is_active, created_at
    `, [data.name, data.email.toLowerCase().trim(), passwordHash, data.role]);

    const created = resUser.rows[0];

    await recordAudit({
      userId: req.user?.id,
      action: 'USER_CREATED',
      entityType: 'users',
      entityId: created.id,
      after: { email: created.email, role: created.role },
      req,
    });

    res.status(201).json({ data: created });
  } catch (err: any) {
    if (err.code === '23505') {
      throw new AppError('A user with this email address already exists.', 409, 'EMAIL_EXISTS');
    }
    throw err;
  }
}

export async function updateUser(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;
  const updates = updateUserSchema.parse(req.body);

  const existingRes = await db.query('SELECT * FROM users WHERE id = $1', [id]);
  if (existingRes.rows.length === 0) {
    throw new AppError('User not found', 404, 'NOT_FOUND');
  }
  const before = existingRes.rows[0];

  const name = updates.name ?? before.name;
  const role = updates.role ?? before.role;
  const isActive = updates.is_active ?? before.is_active;

  const resUser = await db.query(`
    UPDATE users
    SET name = $1, role = $2, is_active = $3, updated_at = CURRENT_TIMESTAMP
    WHERE id = $4
    RETURNING id, name, email, role, is_active, updated_at
  `, [name, role, isActive, id]);

  const after = resUser.rows[0];

  await recordAudit({
    userId: req.user?.id,
    action: 'USER_UPDATED',
    entityType: 'users',
    entityId: id,
    before: { name: before.name, role: before.role, is_active: before.is_active },
    after: { name: after.name, role: after.role, is_active: after.is_active },
    req,
  });

  res.json({ data: after });
}

export async function setUserScopes(req: Request, res: Response): Promise<void> {
  const userId = req.params.id as string;
  const { scopes } = setScopesSchema.parse(req.body);

  await withTransaction(async (tx) => {
    await tx.query('DELETE FROM user_scopes WHERE user_id = $1', [userId]);

    for (const s of scopes) {
      await tx.query(`
        INSERT INTO user_scopes (user_id, scope_type, scope_value)
        VALUES ($1, $2, $3)
      `, [userId, s.scope_type, s.scope_value]);
    }
  });

  await recordAudit({
    userId: req.user?.id,
    action: 'USER_SCOPES_UPDATED',
    entityType: 'user_scopes',
    entityId: userId,
    after: { scopes },
    req,
  });

  res.json({ data: { message: 'Scopes updated successfully', scopes } });
}
