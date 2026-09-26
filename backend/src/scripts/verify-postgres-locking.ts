import pg from 'pg';
import { config } from '../config/index.js';

/**
 * Real PostgreSQL Concurrency & Row-Locking Verification Script
 * Validates the `FOR UPDATE SKIP LOCKED` pattern across multiple parallel database connections
 * against a real PostgreSQL instance (e.g. Supabase dev database).
 */
export async function verifyPostgresRowLocking(): Promise<boolean> {
  const dbUrl = config.DIRECT_DATABASE_URL || config.DATABASE_URL;

  const isConfigured = Boolean(
    dbUrl &&
    !dbUrl.includes('your-project') &&
    dbUrl.startsWith('postgres')
  );

  if (!isConfigured) {
    console.log('\n======================================================================');
    console.log('⚠️  POSTGRESQL ROW LOCKING VERIFICATION: SKIPPED (URL NOT PROVIDED)');
    console.log('======================================================================');
    console.log('Neither DIRECT_DATABASE_URL nor DATABASE_URL is currently set in backend/.env');
    console.log('Provide your Supabase dev database URL to execute this test against live PostgreSQL:');
    console.log('  DIRECT_DATABASE_URL=postgresql://postgres:[PASSWORD]@[HOST]:5432/postgres');
    console.log('Then run: npm run test:locking\n');
    return false;
  }

  console.log('\n======================================================================');
  console.log('🔒 VERIFYING FOR UPDATE SKIP LOCKED AGAINST REAL POSTGRESQL');
  console.log('======================================================================');

  const pool = new pg.Pool({
    connectionString: dbUrl,
    max: 5,
    connectionTimeoutMillis: 5000,
  });

  let client1: pg.PoolClient | null = null;
  let client2: pg.PoolClient | null = null;

  try {
    // 1. Establish two distinct physical connections
    client1 = await pool.connect();
    client2 = await pool.connect();
    console.log('✅ Two concurrent worker connections successfully established.');

    // 2. Set up a dedicated isolated concurrency test table
    await client1.query(`
      CREATE TABLE IF NOT EXISTS _concurrency_test_queue (
        id SERIAL PRIMARY KEY,
        item_name VARCHAR(50) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        locked_by VARCHAR(50),
        processed_at TIMESTAMPTZ
      );
      TRUNCATE TABLE _concurrency_test_queue;
      INSERT INTO _concurrency_test_queue (item_name, status)
      VALUES ('JOB_CALL_DISPATCH_001', 'pending'),
             ('JOB_WEATHER_FANOUT_002', 'pending'),
             ('JOB_ANALYTICS_CALC_003', 'pending');
    `);
    console.log('✅ Test queue seeded with 3 pending items.');

    // 3. Worker 1 initiates transaction and locks Row 1
    await client1.query('BEGIN');
    const res1 = await client1.query(`
      SELECT id, item_name 
      FROM _concurrency_test_queue 
      WHERE status = 'pending' 
      ORDER BY id ASC 
      LIMIT 1 
      FOR UPDATE SKIP LOCKED
    `);

    const row1 = res1.rows[0];
    console.log(`[Worker 1] Acquired lock on Row ID=${row1.id} (${row1.item_name})`);

    // 4. Worker 2 concurrently attempts to fetch a pending row with SKIP LOCKED
    await client2.query('BEGIN');
    const res2 = await client2.query(`
      SELECT id, item_name 
      FROM _concurrency_test_queue 
      WHERE status = 'pending' 
      ORDER BY id ASC 
      LIMIT 1 
      FOR UPDATE SKIP LOCKED
    `);

    const row2 = res2.rows[0];
    console.log(`[Worker 2] Concurrently acquired lock on Row ID=${row2.id} (${row2.item_name})`);

    // 5. Verification: Worker 2 MUST NOT have been blocked and MUST NOT have received Row 1
    if (row1.id === row2.id) {
      throw new Error(`❌ Concurrency Failure: Worker 2 obtained the same row (ID=${row1.id}) as Worker 1!`);
    }

    if (row2.id !== row1.id + 1) {
      throw new Error(`❌ Concurrency Failure: Worker 2 did not obtain the next available row! Got ID=${row2.id}`);
    }

    console.log('✅ VERIFIED: Worker 2 smoothly skipped Row 1 and acquired Row 2 without blocking.');

    // 6. Complete transactions
    await client1.query(
      `UPDATE _concurrency_test_queue SET status = 'completed', locked_by = 'worker_1', processed_at = NOW() WHERE id = $1`,
      [row1.id]
    );
    await client1.query('COMMIT');
    console.log('[Worker 1] Processed and committed Row 1.');

    await client2.query(
      `UPDATE _concurrency_test_queue SET status = 'completed', locked_by = 'worker_2', processed_at = NOW() WHERE id = $1`,
      [row2.id]
    );
    await client2.query('COMMIT');
    console.log('[Worker 2] Processed and committed Row 2.');

    // 7. Verify remaining row
    const finalCheck = await client1.query(`
      SELECT id, item_name, status, locked_by 
      FROM _concurrency_test_queue 
      ORDER BY id ASC
    `);

    console.log('\nFinal Queue State:');
    for (const r of finalCheck.rows) {
      console.log(`  Row ${r.id}: ${r.item_name} | status=${r.status} | worker=${r.locked_by || 'none'}`);
    }

    // Clean up test table
    await client1.query(`DROP TABLE IF EXISTS _concurrency_test_queue`);

    console.log('\n======================================================================');
    console.log('🎉 FOR UPDATE SKIP LOCKED VERIFICATION SUCCEEDED ON POSTGRESQL');
    console.log('======================================================================\n');
    return true;
  } catch (err: any) {
    console.error('❌ PostgreSQL concurrency verification failed:', err.message);
    if (client1) await client1.query('ROLLBACK').catch(() => {});
    if (client2) await client2.query('ROLLBACK').catch(() => {});
    return false;
  } finally {
    if (client1) client1.release();
    if (client2) client2.release();
    await pool.end();
  }
}

// Allow direct execution from CLI
if (process.argv[1] && process.argv[1].endsWith('verify-postgres-locking.ts')) {
  verifyPostgresRowLocking()
    .then((success) => {
      process.exit(success ? 0 : 1);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
