import { z } from 'zod';

export const createCropProgressSchema = z.object({
  season_id: z.string().uuid(),
  observed_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date format must be YYYY-MM-DD'),
  reported_stage_id: z.string().uuid().optional().nullable(),
  condition: z.enum(['good', 'average', 'poor']),
  source: z.enum(['call', 'admin_entry', 'field_visit']).default('admin_entry'),
  notes: z.string().optional().nullable(),
});
