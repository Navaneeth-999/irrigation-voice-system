import { z } from 'zod';

export const createFarmerSchema = z.object({
  full_name: z.string().min(2, 'Name must be at least 2 characters'),
  village_id: z.string().uuid('Valid village ID is required'),
  address: z.string().optional(),
  gram_panchayat: z.string().optional(),
  preferred_language: z.string().default('te'),
  call_window_start: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Time format must be HH:MM or HH:MM:SS').default('09:00:00'),
  call_window_end: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Time format must be HH:MM or HH:MM:SS').default('18:00:00'),
  phone: z.string().min(10, 'Phone number must have at least 10 digits'),
  data_origin: z.enum(['real', 'demo']).default('real'),
  data_source: z.enum(['panchayat', 'survey', 'csp_team', 'farmer_self']).default('survey'),
  voice_consent: z.boolean().default(true),
  sms_consent: z.boolean().default(true),
  notes: z.string().optional(),
});

export const updateFarmerSchema = z.object({
  full_name: z.string().min(2).optional(),
  village_id: z.string().uuid().optional(),
  address: z.string().optional(),
  gram_panchayat: z.string().optional(),
  preferred_language: z.string().optional(),
  call_window_start: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
  call_window_end: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
  notes: z.string().optional(),
});

export const createContactSchema = z.object({
  phone: z.string().min(10),
  type: z.enum(['primary', 'alternate']).default('alternate'),
  is_verified: z.boolean().default(false),
});

export const recordConsentSchema = z.object({
  channel: z.enum(['voice', 'sms']),
  status: z.enum(['granted', 'withdrawn']),
  method: z.enum(['verbal', 'written', 'ivr', 'sms_reply', 'other']).default('verbal'),
  note: z.string().optional(),
});

export const importFarmersRowSchema = z.object({
  full_name: z.string().min(2),
  village_name: z.string().min(2),
  phone: z.string().min(10),
  address: z.string().optional(),
  gram_panchayat: z.string().optional(),
  call_window_start: z.string().optional(),
  call_window_end: z.string().optional(),
  voice_consent: z.boolean().default(true),
  sms_consent: z.boolean().default(true),
});
