import { z } from 'zod';

export const createSeasonSchema = z.object({
  farmer_id: z.string().uuid('Valid farmer ID is required'),
  plot_id: z.string().uuid('Valid plot ID is required'),
  season_type: z.enum(['kharif', 'rabi', 'summer']),
  season_year: z.number().int().min(2020).max(2040),
  crop_id: z.string().uuid('Valid crop ID is required'),
  variety: z.string().optional().nullable(),
  sowing_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date format must be YYYY-MM-DD'),
  expected_harvest_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date format must be YYYY-MM-DD'),
  irrigation_method_type_id: z.string().uuid('Valid irrigation method is required'),
  data_origin: z.enum(['real', 'demo']).default('real'),
});

export const updateSeasonSchema = z.object({
  variety: z.string().optional().nullable(),
  sowing_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  expected_harvest_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  irrigation_method_type_id: z.string().uuid().optional(),
});

export const completeSeasonSchema = z.object({
  actual_harvest_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date format must be YYYY-MM-DD'),
  yield_value: z.number().positive('Yield value must be greater than zero').optional().nullable(),
  yield_unit: z.enum(['kg', 'quintal', 'tonne']).default('quintal'),
  harvest_notes: z.string().optional().nullable(),
});
