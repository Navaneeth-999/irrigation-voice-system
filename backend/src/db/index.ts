import pg from 'pg';
import { PGlite } from '@electric-sql/pglite';
import { config } from '../config/index.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, '../..');

export interface QueryResult<T = any> {
  rows: T[];
  rowCount: number;
}

export interface IDatabaseClient {
  query<T = any>(sql: string, params?: any[]): Promise<QueryResult<T>>;
  exec(sql: string): Promise<void>;
}

let pool: pg.Pool | null = null;
let pgliteInstance: PGlite | null = null;

// Determine connection strategy
const isTestEnv = process.env.NODE_ENV === 'test';
const testUrl = process.env.TEST_DATABASE_URL || config.TEST_DATABASE_URL;
const devUrl = config.DIRECT_DATABASE_URL || config.DATABASE_URL;

// When testing, prioritize TEST_DATABASE_URL if provided; if omitted, use in-memory PGlite
// to guarantee test isolation and prevent tests from mutating or failing on external databases.
const effectiveDbUrl = isTestEnv
  ? testUrl
  : devUrl;

const isPostgresConfigured = Boolean(
  effectiveDbUrl &&
  !effectiveDbUrl.includes('your-project') &&
  effectiveDbUrl.startsWith('postgres')
);

const isPgliteExplicitlyConfigured = Boolean(
  config.DATABASE_MODE === 'pglite' ||
  process.env.DATABASE_MODE === 'pglite' ||
  process.env.USE_PGLITE === 'true' ||
  effectiveDbUrl === 'pglite' ||
  effectiveDbUrl === 'local'
);

if (isTestEnv && !testUrl) {
  // Test isolation: in-memory PGlite (never touches cloud/persistent database)
  pgliteInstance = new PGlite();
  console.log('📦 Database: Operating in Local PGlite mode (in-memory test isolation)');
} else if (isPgliteExplicitlyConfigured) {
  // Explicitly configured local PGlite mode
  const dataDir = path.resolve(backendRoot, '.pglite_data');
  pgliteInstance = new PGlite(dataDir);
  console.log(`📦 Database: Operating in explicitly configured Local PGlite mode (${dataDir})`);
} else if (isPostgresConfigured) {
  // PostgreSQL configured
  const useTestSchema = isTestEnv && !testUrl;

  pool = new pg.Pool({
    connectionString: effectiveDbUrl,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  pool.on('error', (err) => {
    console.error('❌ Unexpected PostgreSQL pool error:', err.message);
  });

  if (useTestSchema) {
    pool.on('connect', async (client) => {
      await client.query('CREATE SCHEMA IF NOT EXISTS test_isolated;');
      await client.query('SET search_path TO test_isolated, public;');
    });
    console.log('📦 Database: Connected to PostgreSQL pool (TEST ISOLATION: schema test_isolated)');
  } else {
    console.log(`📦 Database: Connected to PostgreSQL pool${isTestEnv ? ' (Dedicated TEST DB)' : ''}`);
  }
} else {
  // Refuse silent fallback to empty database
  const errorMsg = [
    '',
    '❌ DATABASE CONFIGURATION ERROR:',
    'No PostgreSQL connection URL provided (DIRECT_DATABASE_URL or DATABASE_URL).',
    'The application will NOT silently fall back to an empty PGlite database.',
    'To connect to your cloud database (Supabase), verify that backend/.env defines DIRECT_DATABASE_URL.',
    'To explicitly run in local embedded PGlite mode, set DATABASE_MODE=pglite in your environment.',
    '',
  ].join('\n');
  console.error(errorMsg);
  throw new Error('Database configuration missing: DIRECT_DATABASE_URL is not set and DATABASE_MODE is not pglite.');
}

export const db: IDatabaseClient = {
  async query<T = any>(sql: string, params: any[] = []): Promise<QueryResult<T>> {
    if (pool) {
      const res = await pool.query(sql, params);
      return {
        rows: res.rows as T[],
        rowCount: res.rowCount ?? 0,
      };
    } else if (pgliteInstance) {
      const res = await pgliteInstance.query(sql, params);
      return {
        rows: (res.rows || []) as T[],
        rowCount: (res.rows && res.rows.length > 0)
          ? res.rows.length
          : (res.affectedRows ?? 0),
      };
    }
    throw new Error('Database driver not initialized');
  },

  async exec(sql: string): Promise<void> {
    if (pool) {
      await pool.query(sql);
    } else if (pgliteInstance) {
      await pgliteInstance.exec(sql);
    } else {
      throw new Error('Database driver not initialized');
    }
  }
};

export async function withTransaction<T>(
  callback: (client: IDatabaseClient) => Promise<T>
): Promise<T> {
  if (pool) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const clientWrapper: IDatabaseClient = {
        async query<R = any>(sql: string, params: any[] = []): Promise<QueryResult<R>> {
          const res = await client.query(sql, params);
          return { rows: res.rows as R[], rowCount: res.rowCount ?? 0 };
        },
        async exec(sql: string): Promise<void> {
          await client.query(sql);
        }
      };
      const result = await callback(clientWrapper);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } else if (pgliteInstance) {
    return await pgliteInstance.transaction(async (tx) => {
      const txWrapper: IDatabaseClient = {
        async query<R = any>(sql: string, params: any[] = []): Promise<QueryResult<R>> {
          const res = await tx.query(sql, params);
          return {
            rows: (res.rows || []) as R[],
            rowCount: res.affectedRows ?? (res.rows ? res.rows.length : 0),
          };
        },
        async exec(sql: string): Promise<void> {
          await tx.exec(sql);
        }
      };
      return await callback(txWrapper);
    });
  }
  throw new Error('Database driver not initialized');
}

export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    const res = await db.query('SELECT 1 as alive');
    return res.rows.length > 0 && res.rows[0].alive === 1;
  } catch (err) {
    console.error('Database health check failed:', err);
    return false;
  }
}

export async function verifyDatabaseConnection(): Promise<void> {
  if (pool) {
    try {
      const client = await pool.connect();
      try {
        await client.query('SELECT 1 as alive');
      } finally {
        client.release();
      }
      console.log('✅ PostgreSQL connection verified successfully.');
    } catch (err: any) {
      const errorMsg = [
        '',
        '❌ DATABASE CONNECTION FAILED:',
        `Could not connect to PostgreSQL database: ${err.message}`,
        'Please verify network connectivity and database credentials.',
        'The application will NOT silently switch to an alternative database.',
        '',
      ].join('\n');
      console.error(errorMsg);
      throw err;
    }
  } else if (pgliteInstance) {
    const res = await pgliteInstance.query('SELECT 1 as alive');
    if (!res.rows || res.rows.length === 0) {
      throw new Error('PGlite database instance is not responsive.');
    }
  } else {
    throw new Error('Database driver not initialized');
  }
}

export async function cleanTestDatabase(): Promise<void> {
  if (pool) {
    if (process.env.NODE_ENV === 'test' && !(process.env.TEST_DATABASE_URL || config.TEST_DATABASE_URL)) {
      await pool.query('DROP SCHEMA IF EXISTS test_isolated CASCADE; CREATE SCHEMA test_isolated;');
    } else {
      const tablesRes = await pool.query(`
        SELECT tablename FROM pg_tables
        WHERE schemaname = current_schema()
          AND tablename NOT IN ('spatial_ref_sys')
          AND tablename NOT LIKE '_legacy_%'
      `);
      if (tablesRes.rows.length > 0) {
        const tableNames = tablesRes.rows.map(r => `"${r.tablename}"`).join(', ');
        await pool.query(`TRUNCATE TABLE ${tableNames} RESTART IDENTITY CASCADE;`);
      }
    }
  }
}

export async function closeDatabase(): Promise<void> {
  if (pool) {
    await pool.end();
  } else if (pgliteInstance) {
    await pgliteInstance.close();
  }
}
