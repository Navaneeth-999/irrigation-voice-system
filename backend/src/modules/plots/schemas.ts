import { z } from 'zod';

export const waterSourceInputSchema = z.object({
  water_source_type_id: z.string().uuid(),
  pump_hp: z.number().positive().optional().nullable(),
  discharge_lph: z.number().positive().optional().nullable(),
  is_primary: z.boolean().default(false),
  notes: z.string().optional().nullable(),
});

export const createPlotSchema = z.object({
  farmer_id: z.string().uuid(),
  label: z.string().min(1, 'Plot label is required (e.g. North Acre, Plot 1)'),
  survey_number: z.string().optional().nullable(),
  area_acres: z.number().positive('Area must be greater than 0 acres'),
  latitude: z.number().optional().nullable(),
  longitude: z.number().optional().nullable(),
  soil_type: z.string().optional().nullable(),
  tenure: z.enum(['owned', 'leased']).default('owned'),
  water_sources: z.array(waterSourceInputSchema).min(1, 'Plot must have at least one water source'),
});

export const updatePlotSchema = z.object({
  label: z.string().min(1).optional(),
  survey_number: z.string().optional().nullable(),
  area_acres: z.number().positive().optional(),
  latitude: z.number().optional().nullable(),
  longitude: z.number().optional().nullable(),
  soil_type: z.string().optional().nullable(),
  tenure: z.enum(['owned', 'leased']).optional(),
});
