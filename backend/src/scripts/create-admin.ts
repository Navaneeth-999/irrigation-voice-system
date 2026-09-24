import bcrypt from 'bcryptjs';
import { db, closeDatabase } from '../db/index.js';
import { config } from '../config/index.js';

export async function createAdminUser() {
  console.log('👤 Bootstrapping admin user...');

  const email = config.ADMIN_BOOTSTRAP_EMAIL;
  const password = config.ADMIN_BOOTSTRAP_PASSWORD;
  const name = 'CSP System Administrator';
  const role = 'ADMIN';

  const passwordHash = await bcrypt.hash(password, 12);

  const res = await db.query(`
    INSERT INTO users (name, email, password_hash, role, is_active)
    VALUES ($1, $2, $3, $4, true)
    ON CONFLICT (email) DO UPDATE SET
      password_hash = EXCLUDED.password_hash,
      role = EXCLUDED.role,
      is_active = true
    RETURNING id, name, email, role
  `, [name, email, passwordHash, role]);

  console.log(`✅ Admin user ready: ${res.rows[0].email} (${res.rows[0].id})`);
}

if (process.argv[1] && process.argv[1].endsWith('create-admin.ts')) {
  createAdminUser()
    .then(async () => {
      await closeDatabase();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('❌ Failed bootstrapping admin:', err);
      await closeDatabase();
      process.exit(1);
    });
}
