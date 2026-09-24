import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { db, closeDatabase } from '../db/index.js';
import { config } from '../config/index.js';

export async function createAdminUser() {
  console.log('👤 Bootstrapping admin user...');

  const email = config.ADMIN_BOOTSTRAP_EMAIL;
  let password = process.env.ADMIN_BOOTSTRAP_PASSWORD;

  if (!password) {
    if (config.NODE_ENV === 'production') {
      throw new Error('ADMIN_BOOTSTRAP_PASSWORD environment variable must be provided in production.');
    }
    // Generate secure temporary random password if none was supplied
    password = crypto.randomBytes(16).toString('hex');
    console.log('Generated initial bootstrap password.');
  }

  const name = 'CSP System Administrator';
  const role = 'ADMIN';

  const passwordHash = await bcrypt.hash(password, 12);

  // Check if admin already exists
  const existing = await db.query('SELECT id, must_change_password FROM users WHERE email = $1', [email.toLowerCase().trim()]);

  if (existing.rows.length === 0) {
    const res = await db.query(`
      INSERT INTO users (name, email, password_hash, role, is_active, must_change_password)
      VALUES ($1, $2, $3, $4, true, true)
      RETURNING id, name, email, role, must_change_password
    `, [name, email.toLowerCase().trim(), passwordHash, role]);

    console.log(`✅ Admin user created: ${res.rows[0].email} (Must change password on first login)`);
  } else {
    console.log(`ℹ️ Admin user already exists: ${email}`);
  }
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
