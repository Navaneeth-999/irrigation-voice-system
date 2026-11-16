import { closeDatabase } from '../db/index.js';
import { runMigrations } from './migrate.js';
import { seedReferenceData } from './seed-reference.js';
import { seedDemoData } from './seed-demo.js';

export async function resetDemoEnvironment() {
  console.log('\n======================================================================');
  console.log('🔄 INITIATING CSP IRRIGATION SYSTEM DEMO RESET');
  console.log('======================================================================');
  console.log('Ensuring database schema, reference tables, Telugu voice prompts,');
  console.log('and rich demonstration datasets are restored to pristine benchmark state...\n');

  // Step 1: Migrations
  await runMigrations();

  // Step 2: Reference Data & Telugu Prompts
  await seedReferenceData();

  // Step 3: Demo Data (Users, Farmers, Seasons, Certificates, Weather)
  await seedDemoData();

  console.log('======================================================================');
  console.log('✅ DEMO ENVIRONMENT SUCCESSFULLY RESET AND READY FOR EVALUATION');
  console.log('======================================================================\n');
}

// Direct execution
if (process.argv[1] && process.argv[1].endsWith('demo-reset.ts')) {
  resetDemoEnvironment()
    .then(async () => {
      await closeDatabase();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('❌ Demo reset failed:', err);
      await closeDatabase();
      process.exit(1);
    });
}
