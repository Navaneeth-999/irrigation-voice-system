import { Request, Response, NextFunction } from 'express';
import { AppError } from './errorHandler.js';

export function csrfProtection(req: Request, _res: Response, next: NextFunction): void {
  // Safe HTTP methods do not mutate state
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  // Exempt external provider webhooks (they use cryptographic signature verification)
  if (req.path.startsWith('/webhooks/') || req.path.startsWith('/api/v1/webhooks/')) {
    return next();
  }

  // Exempt public verification or auth endpoints that do not yet have a session if needed,
  // but requiring X-Requested-With on all frontend calls is standard and protects against CSRF
  const requestedWith = req.headers['x-requested-with'];
  const csrfToken = req.headers['x-csrf-token'];

  if (requestedWith === 'XMLHttpRequest' || csrfToken) {
    return next();
  }

  // In test environment, allow if specifically bypassed
  if (process.env.NODE_ENV === 'test' && !req.headers['x-enforce-csrf']) {
    return next();
  }

  throw new AppError('CSRF protection validation failed. Missing X-Requested-With header.', 403, 'CSRF_ERROR');
}
