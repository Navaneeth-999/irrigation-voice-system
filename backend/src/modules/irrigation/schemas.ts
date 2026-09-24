import { z } from 'zod';

export const createIrrigationRecordSchema = z.object({
  season_id: z.string().uuid(),
  period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date format must be YYYY-MM-DD'),
  period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date format must be YYYY-MM-DD'),
  event_count: z.number().int().min(1).default(1),
  raw_value: z.number().positive('Raw value must be positive'),
  raw_unit: z.enum(['pump_hours', 'drip_hours', 'depth_mm', 'litres']),
  source: z.enum(['call', 'admin_entry', 'field_visit', 'sensor']).default('admin_entry'),
  notes: z.string().optional().nullable(),
});
