import { z } from 'zod';

export const createFeedbackSchema = z.object({
  season_id: z.string().uuid(),
  cycle_number: z.number().int().min(1),
  period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date format must be YYYY-MM-DD'),
  period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date format must be YYYY-MM-DD'),
  rainfall_class: z.enum(['none', 'light', 'moderate', 'heavy']),
  irrigated: z.boolean(),
  irrigation_count: z.number().int().min(0).default(0),
  pump_hours: z.number().min(0).default(0),
  crop_condition: z.enum(['good', 'average', 'poor']),
  stage_confirmed: z.boolean().default(true),
  reported_stage_id: z.string().uuid().optional().nullable(),
  water_problem: z.enum(['none', 'shortage', 'pump_power', 'source_unavailable']).default('none'),
  crop_problem: z.enum(['none', 'pest_disease', 'yellowing_drying', 'other']).default('none'),
  callback_requested: z.boolean().default(false),
  voice_note_path: z.string().optional().nullable(),
  source: z.enum(['ivr', 'manual', 'simulator']).default('manual'),
  is_simulated: z.boolean().default(false),
});
