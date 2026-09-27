import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4000),
  TZ: z.string().default('Asia/Kolkata'),
  LOG_LEVEL: z.string().default('info'),

  // Database
  DATABASE_URL: z.string().optional(),
  DIRECT_DATABASE_URL: z.string().optional(),
  SUPABASE_URL: z.string().optional(),
  SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),

  // Auth & Security
  JWT_SECRET: z.string().min(16).default('development_jwt_secret_must_be_over_16_chars_long'),
  JWT_EXPIRES_IN: z.string().default('8h'),
  COOKIE_SECURE: z.coerce.boolean().default(false),
  COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  COOKIE_DOMAIN: z.string().optional(),
  CORS_ALLOWED_ORIGINS: z.string().default('http://localhost:5173,http://localhost:3000'),
  PUBLIC_BASE_URL: z.string().default('http://localhost:4000'),
  PUBLIC_FRONTEND_URL: z.string().default('http://localhost:5173'),
  ADMIN_BOOTSTRAP_EMAIL: z.string().email().default('admin@csp-irrigation.org'),
  ADMIN_BOOTSTRAP_PASSWORD: z.string().min(8).default('ChangeMeAdmin123!'),

  // Operational modes
  DEMO_MODE: z.coerce.boolean().default(true),
  ALLOW_DEMO_ENDPOINTS: z.coerce.boolean().default(true),
  COMMUNICATIONS_ENABLED: z.coerce.boolean().default(true),
  DRY_RUN: z.coerce.boolean().default(false),

  // Telephony & SMS
  TELEPHONY_PROVIDER: z.enum(['mock', 'twilio']).default('mock'),
  SMS_PROVIDER: z.enum(['mock', 'twilio']).default('mock'),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_PHONE_NUMBER: z.string().optional(),
  DEMO_LIVE_TEST_NUMBERS: z.string().default(''),
  ALLOW_UNREVIEWED_PROMPTS: z.coerce.boolean().default(true),
  MAX_CONCURRENT_CALLS: z.coerce.number().default(3),
  MAX_CALLS_PER_DAY: z.coerce.number().default(200),
  MAX_SMS_PER_DAY: z.coerce.number().default(200),
  CALL_MAX_ATTEMPTS: z.coerce.number().default(3),
  CALL_RETRY_INTERVAL_MINUTES: z.coerce.number().default(120),

  // Weather
  WEATHER_PROVIDER: z.enum(['mock', 'openmeteo']).default('mock'),
  OPEN_METEO_BASE_URL: z.string().default('https://api.open-meteo.com/v1'),
  OPEN_METEO_ARCHIVE_URL: z.string().default('https://archive-api.open-meteo.com/v1'),
  WEATHER_CACHE_TTL_MINUTES: z.coerce.number().default(180),

  // Scheduler
  SCHEDULER_ENABLED: z.coerce.boolean().default(false),

  // Storage
  STORAGE_PROVIDER: z.enum(['local', 'supabase']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('./storage'),
  STORAGE_BUCKET_AUDIO: z.string().default('audio-prompts'),
  STORAGE_BUCKET_DOCUMENTS: z.string().default('seasonal-reports'),
  STORAGE_BUCKET_VOICE_NOTES: z.string().default('voice-notes'),

  // Rate Limiting
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(900000),
  RATE_LIMIT_MAX: z.coerce.number().default(300),
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().default(10),

  // Optional AI
  LLM_PROVIDER: z.enum(['none', 'gemini', 'openai']).default('none'),
}).superRefine((data, ctx) => {
  if (data.NODE_ENV === 'production') {
    const isDefaultJwt = !process.env.JWT_SECRET || data.JWT_SECRET === 'development_jwt_secret_must_be_over_16_chars_long';
    if (isDefaultJwt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_SECRET'],
        message: 'FATAL: In production (NODE_ENV=production), JWT_SECRET must be explicitly set to a unique cryptographically random secret and cannot use the development default value.',
      });
    }

    const isDefaultAdminPassword = !process.env.ADMIN_BOOTSTRAP_PASSWORD || data.ADMIN_BOOTSTRAP_PASSWORD === 'ChangeMeAdmin123!';
    if (isDefaultAdminPassword) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ADMIN_BOOTSTRAP_PASSWORD'],
        message: 'FATAL: In production (NODE_ENV=production), ADMIN_BOOTSTRAP_PASSWORD must be explicitly set and cannot use the default value.',
      });
    }

    if (!data.DIRECT_DATABASE_URL && !data.DATABASE_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DATABASE_URL'],
        message: 'FATAL: In production, DATABASE_URL or DIRECT_DATABASE_URL must be provided. In-memory PGlite is disabled for production deployments.',
      });
    }
  }
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Environment configuration validation failed:');
  console.error(JSON.stringify(parsed.error.format(), null, 2));
  process.exit(1);
}

export const config = parsed.data;
