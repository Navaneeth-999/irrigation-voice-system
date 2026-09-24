import { z } from 'zod';

export const createActionItemSchema = z.object({
  farmer_id: z.string().uuid(),
  season_id: z.string().uuid().optional().nullable(),
  source: z.enum(['call', 'weather', 'anomaly', 'manual', 'system']).default('manual'),
  type: z.enum([
    'water_shortage',
    'pump_power_problem',
    'source_unavailable',
    'crop_pest_disease',
    'crop_condition_poor',
    'callback_requested',
    'repeated_missed_calls',
    'suspicious_data',
    'other_field_issue',
  ]),
  priority: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
  referral_note: z.string().optional().nullable(),
  assignee_id: z.string().uuid().optional().nullable(),
});

export const updateActionItemSchema = z.object({
  status: z.enum(['open', 'assigned', 'in_progress', 'resolved', 'closed']).optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  assignee_id: z.string().uuid().optional().nullable(),
  referral_note: z.string().optional().nullable(),
});
