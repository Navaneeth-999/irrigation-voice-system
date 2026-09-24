import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { db, withTransaction, closeDatabase } from '../db/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runMigrations() {
  console.log('🚀 Running database migrations...');

  // Ensure migration tracking table exists
  await db.exec(`
    CREATE TABLE IF NOT EXISTS _schema_migrations (
      name VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const migrationsDir = path.resolve(__dirname, '../../migrations');
  if (!fs.existsSync(migrationsDir)) {
    console.error(`❌ Migrations directory not found at ${migrationsDir}`);
    return;
  }

  const files = fs.readdirSync(migrationsDir)
    .filter(file => file.endsWith('.sql'))
    .sort();

  const res = await db.query('SELECT name FROM _schema_migrations');
  const applied = new Set(res.rows.map((r: { name: string }) => r.name));

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`⏩ Skipping already applied migration: ${file}`);
      continue;
    }

    console.log(`Applying migration: ${file}...`);
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');

    await withTransaction(async (tx) => {
      await tx.exec(sql);
      await tx.query('INSERT INTO _schema_migrations (name) VALUES ($1)', [file]);
    });

    console.log(`✅ Applied migration: ${file}`);
  }

  console.log('✨ All migrations applied successfully.');
}

// Allow direct execution
if (process.argv[1] && process.argv[1].endsWith('migrate.ts')) {
  runMigrations()
    .then(async () => {
      await closeDatabase();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('❌ Migration failed:', err);
      await closeDatabase();
      process.exit(1);
    });
}
