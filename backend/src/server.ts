import { createApp } from './app.js';
import { config } from './config/index.js';
import { runMigrations } from './scripts/migrate.js';
import { seedReferenceData } from './scripts/seed-reference.js';
import { createAdminUser } from './scripts/create-admin.js';

async function bootstrap() {
  console.log('🌱 Starting Irrigation Management Backend...');

  // Auto-run migrations in development or on bootstrap
  try {
    await runMigrations();
    await seedReferenceData();
    await createAdminUser();
  } catch (err) {
    console.error('Warning during startup migrations/seed:', err);
  }

  const app = createApp();
  const port = config.PORT;

  const server = app.listen(port, () => {
    console.log(`🚀 Server listening on port ${port} in ${config.NODE_ENV} mode`);
    console.log(`📡 Base API URL: http://localhost:${port}/api/v1`);
    console.log(`💚 Health Check: http://localhost:${port}/healthz`);
  });

  const shutdown = async () => {
    console.log('Gracefully stopping server...');
    server.close(() => {
      console.log('HTTP server closed.');
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

bootstrap().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
