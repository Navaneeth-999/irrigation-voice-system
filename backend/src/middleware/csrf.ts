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

  // Enforce custom CSRF header check on all mutating requests
  const requestedWith = req.headers['x-requested-with'];
  const csrfToken = req.headers['x-csrf-token'];

  if (requestedWith === 'XMLHttpRequest' || csrfToken) {
    return next();
  }

  // Only allowed to skip in test environment if explicitly flagged
  if (process.env.NODE_ENV === 'test' && req.headers['x-skip-csrf-test'] === 'true') {
    return next();
  }

  throw new AppError('CSRF protection validation failed. Missing X-Requested-With header.', 403, 'CSRF_ERROR');
}
