import { db, IDatabaseClient } from '../../db/index.js';

export async function computeExpectedStage(
  cropId: string,
  sowingDate: string,
  observedOn: string,
  client: IDatabaseClient = db
): Promise<string | null> {
  const sowing = new Date(sowingDate);
  const observed = new Date(observedOn);
  const diffTime = observed.getTime() - sowing.getTime();
  const das = Math.max(0, Math.floor(diffTime / (1000 * 60 * 60 * 24))); // Days After Sowing

  const stagesRes = await client.query(`
    SELECT id, stage_order, name, start_das, end_das
    FROM crop_stages
    WHERE crop_id = $1
    ORDER BY stage_order ASC
  `, [cropId]);

  if (stagesRes.rows.length === 0) return null;

  for (const stage of stagesRes.rows) {
    if (das >= stage.start_das && das < stage.end_das) {
      return stage.id;
    }
  }

  // If past final stage end_das, return the final stage
  return stagesRes.rows[stagesRes.rows.length - 1].id;
}
