import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import { db } from '../db/index.js';
import { AppError } from './errorHandler.js';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: 'ADMIN' | 'CSP_MEMBER' | 'AGRI_PANCHAYAT' | 'FARMER';
  scopes: { scope_type: string; scope_value: string }[];
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function generateToken(user: { id: string; email: string; role: string }): string {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    config.JWT_SECRET,
    { expiresIn: '8h' }
  );
}

export async function authenticateToken(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const token = req.cookies?.token || req.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    return next();
  }

  try {
    const payload = jwt.verify(token, config.JWT_SECRET) as { id: string; email: string; role: string };

    const userRes = await db.query(`
      SELECT id, name, email, role, is_active
      FROM users
      WHERE id = $1
    `, [payload.id]);

    if (userRes.rows.length === 0 || !userRes.rows[0].is_active) {
      return next();
    }

    const u = userRes.rows[0];

    // Fetch scopes if AGRI_PANCHAYAT
    let scopes: { scope_type: string; scope_value: string }[] = [];
    if (u.role === 'AGRI_PANCHAYAT') {
      const scopeRes = await db.query(`
        SELECT scope_type, scope_value
        FROM user_scopes
        WHERE user_id = $1
      `, [u.id]);
      scopes = scopeRes.rows;
    }

    req.user = {
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      scopes,
    };

    next();
  } catch (_err) {
    // Invalid/expired token
    next();
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) {
    throw new AppError('Authentication required. Please sign in.', 401, 'UNAUTHORIZED');
  }
  next();
}

export function requireRole(...allowedRoles: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw new AppError('Authentication required.', 401, 'UNAUTHORIZED');
    }

    if (!allowedRoles.includes(req.user.role)) {
      throw new AppError('Forbidden: You do not have permission to access this resource.', 403, 'FORBIDDEN');
    }

    next();
  };
}

export function getScopedVillageFilter(user?: AuthUser): string[] | null {
  if (!user || user.role === 'ADMIN' || user.role === 'CSP_MEMBER') {
    return null; // No restriction
  }

  if (user.role === 'AGRI_PANCHAYAT') {
    return user.scopes
      .filter(s => s.scope_type === 'village')
      .map(s => s.scope_value);
  }

  return [];
}
