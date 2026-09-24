import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import crypto from 'crypto';

import { config } from './config/index.js';
import { checkDatabaseHealth } from './db/index.js';
import { errorHandler } from './middleware/errorHandler.js';
import { authenticateToken } from './middleware/auth.js';
import { csrfProtection } from './middleware/csrf.js';

// Route modules
import authRoutes from './modules/auth/routes.js';
import usersRoutes from './modules/users/routes.js';
import farmersRoutes from './modules/farmers/routes.js';
import plotsRoutes from './modules/plots/routes.js';
import referenceRoutes from './modules/reference/routes.js';
import analyticsRoutes from './modules/analytics/routes.js';
import seasonsRoutes from './modules/seasons/routes.js';
import irrigationRoutes from './modules/irrigation/routes.js';
import cropProgressRoutes from './modules/crop-progress/routes.js';
import feedbackRoutes from './modules/feedback/routes.js';
import actionItemsRoutes from './modules/action-items/routes.js';
import { telephonyRouter, twilioWebhookRouter } from './modules/telephony/routes.js';

export function createApp(): express.Application {
  const app = express();

  // Basic security and hardening
  app.use(helmet({
    contentSecurityPolicy: false, // allow local dev and vite embeds
  }));

  const allowedOrigins = config.CORS_ALLOWED_ORIGINS.split(',').map(s => s.trim());
  app.use(cors({
    origin: (origin, callback) => {
      // allow requests with no origin (like mobile apps, curl, server-to-server)
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(null, true); // Permissive in dev if needed, or callback(new Error('CORS not allowed'))
      }
    },
    credentials: true,
  }));

  app.use(cookieParser());
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' })); // for Twilio webhooks

  // Request correlation ID
  app.use((req, res, next) => {
    const reqId = (req.headers['x-request-id'] as string) || crypto.randomUUID();
    res.setHeader('X-Request-Id', reqId);
    next();
  });

  // Local storage static route
  const storageDir = path.resolve(process.cwd(), config.STORAGE_LOCAL_DIR);
  app.use('/storage', express.static(storageDir));

  // Health and Readiness probes
  app.get('/healthz', (_req, res) => {
    res.json({
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/readyz', async (_req, res) => {
    const isDbAlive = await checkDatabaseHealth();
    if (!isDbAlive) {
      res.status(503).json({ status: 'error', message: 'Database connection unavailable' });
      return;
    }
    res.json({ status: 'ready', database: 'connected' });
  });

  // Global Auth Token Extraction
  app.use(authenticateToken);

  // CSRF Protection on mutating routes
  app.use(csrfProtection);

  // Mount API v1 Routers
  const apiRouter = express.Router();
  apiRouter.use('/auth', authRoutes);
  apiRouter.use('/users', usersRoutes);
  apiRouter.use('/farmers', farmersRoutes);
  apiRouter.use('/plots', plotsRoutes);
  apiRouter.use('/reference', referenceRoutes);
  apiRouter.use('/analytics', analyticsRoutes);
  apiRouter.use('/seasons', seasonsRoutes);
  apiRouter.use('/irrigation', irrigationRoutes);
  apiRouter.use('/crop-progress', cropProgressRoutes);
  apiRouter.use('/feedback', feedbackRoutes);
  apiRouter.use('/action-items', actionItemsRoutes);
  apiRouter.use('/telephony', telephonyRouter);
  apiRouter.use('/webhooks/twilio', twilioWebhookRouter);

  app.use('/api/v1', apiRouter);

  // Centralized Error Handler
  app.use(errorHandler);

  return app;
}
