import pg from 'pg';
import { PGlite } from '@electric-sql/pglite';
import { config } from '../config/index.js';
import path from 'path';

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
const effectiveDbUrl = config.DIRECT_DATABASE_URL || config.DATABASE_URL;
const isPostgresConfigured = Boolean(
  effectiveDbUrl &&
  !effectiveDbUrl.includes('your-project') &&
  effectiveDbUrl.startsWith('postgres')
);

if (isPostgresConfigured) {
  pool = new pg.Pool({
    connectionString: effectiveDbUrl,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
  console.log('📦 Database: Connected to PostgreSQL pool');
} else {
  // Initialize PGlite (WASM Postgres for local zero-dependency development/testing)
  const dataDir = process.env.NODE_ENV === 'test' 
    ? undefined // in-memory for tests
    : path.resolve(process.cwd(), '.pglite_data');
  
  pgliteInstance = new PGlite(dataDir);
  console.log(`📦 Database: Operating in Local PGlite mode (${dataDir ? 'persistent at .pglite_data' : 'in-memory'})`);
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
        rowCount: res.affectedRows ?? (res.rows ? res.rows.length : 0),
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

export async function closeDatabase(): Promise<void> {
  if (pool) {
    await pool.end();
  } else if (pgliteInstance) {
    await pgliteInstance.close();
  }
}
