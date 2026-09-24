import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { db } from '../../db/index.js';
import { config } from '../../config/index.js';
import { generateToken } from '../../middleware/auth.js';
import { AppError } from '../../middleware/errorHandler.js';
import { recordAudit } from '../../middleware/audit.js';
import { loginSchema, changePasswordSchema } from './schemas.js';

export async function login(req: Request, res: Response): Promise<void> {
  const { email, password } = loginSchema.parse(req.body);

  const userRes = await db.query(`
    SELECT id, name, email, password_hash, role, is_active, failed_login_count, locked_until, must_change_password
    FROM users
    WHERE email = $1
  `, [email.toLowerCase().trim()]);

  if (userRes.rows.length === 0) {
    throw new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
  }

  const user = userRes.rows[0];

  // Check lockout
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    throw new AppError('Account is temporarily locked due to multiple failed login attempts. Please try again later.', 403, 'ACCOUNT_LOCKED');
  }

  if (!user.is_active) {
    throw new AppError('Account is deactivated. Please contact your system administrator.', 403, 'ACCOUNT_INACTIVE');
  }

  const isMatch = await bcrypt.compare(password, user.password_hash);

  if (!isMatch) {
    const nextFailed = (user.failed_login_count || 0) + 1;
    let lockUntil: Date | null = null;

    if (nextFailed >= config.LOGIN_RATE_LIMIT_MAX) {
      lockUntil = new Date(Date.now() + 15 * 60 * 1000); // 15 min lock
    }

    await db.query(`
      UPDATE users
      SET failed_login_count = $1, locked_until = $2
      WHERE id = $3
    `, [nextFailed, lockUntil, user.id]);

    await recordAudit({
      userId: user.id,
      action: 'LOGIN_FAILED',
      entityType: 'users',
      entityId: user.id,
      before: null,
      after: { email, reason: 'Invalid password' },
      req,
    });

    throw new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
  }

  // Login successful: reset failed logins and update last_login_at
  await db.query(`
    UPDATE users
    SET failed_login_count = 0, locked_until = NULL, last_login_at = CURRENT_TIMESTAMP
    WHERE id = $1
  `, [user.id]);

  const token = generateToken({
    id: user.id,
    email: user.email,
    role: user.role,
  });

  // Set secure HttpOnly cookie - the sole session carrier
  res.cookie('token', token, {
    httpOnly: true,
    secure: config.COOKIE_SECURE,
    sameSite: config.COOKIE_SAMESITE as 'lax' | 'strict' | 'none',
    maxAge: 8 * 60 * 60 * 1000, // 8 hours
    domain: config.COOKIE_DOMAIN || undefined,
  });

  await recordAudit({
    userId: user.id,
    action: 'LOGIN_SUCCESS',
    entityType: 'users',
    entityId: user.id,
    before: null,
    after: { email: user.email, role: user.role },
    req,
  });

  // Never expose token in JSON body; cookie is the sole session carrier
  res.json({
    data: {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        must_change_password: Boolean(user.must_change_password),
      },
    },
  });
}

export async function changePassword(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
  }

  const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);

  const userRes = await db.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
  if (userRes.rows.length === 0) {
    throw new AppError('User not found', 404, 'NOT_FOUND');
  }

  const isMatch = await bcrypt.compare(currentPassword, userRes.rows[0].password_hash);
  if (!isMatch) {
    throw new AppError('Current password does not match.', 400, 'PASSWORD_MISMATCH');
  }

  const newHash = await bcrypt.hash(newPassword, 12);

  await db.query(`
    UPDATE users
    SET password_hash = $1, must_change_password = false, updated_at = CURRENT_TIMESTAMP
    WHERE id = $2
  `, [newHash, req.user.id]);

  await recordAudit({
    userId: req.user.id,
    action: 'PASSWORD_CHANGED',
    entityType: 'users',
    entityId: req.user.id,
    req,
  });

  res.json({
    data: {
      message: 'Password changed successfully.',
    },
  });
}

export async function logout(req: Request, res: Response): Promise<void> {
  if (req.user) {
    await recordAudit({
      userId: req.user.id,
      action: 'LOGOUT',
      entityType: 'users',
      entityId: req.user.id,
      req,
    });
  }

  res.clearCookie('token', {
    httpOnly: true,
    secure: config.COOKIE_SECURE,
    sameSite: config.COOKIE_SAMESITE as 'lax' | 'strict' | 'none',
    domain: config.COOKIE_DOMAIN || undefined,
  });

  res.json({
    data: {
      message: 'Logged out successfully',
    },
  });
}

export async function getCurrentUser(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw new AppError('Not authenticated', 401, 'UNAUTHORIZED');
  }

  const userRes = await db.query('SELECT must_change_password FROM users WHERE id = $1', [req.user.id]);
  const mustChange = userRes.rows[0]?.must_change_password || false;

  res.json({
    data: {
      user: {
        ...req.user,
        must_change_password: Boolean(mustChange),
      },
    },
  });
}
