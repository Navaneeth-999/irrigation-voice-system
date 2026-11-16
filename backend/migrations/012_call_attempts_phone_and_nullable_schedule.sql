-- Migration 012: Allow phone_e164 and nullable call_schedule_id on call_attempts for ad-hoc / live calls
ALTER TABLE call_attempts ADD COLUMN IF NOT EXISTS phone_e164 VARCHAR(30);
ALTER TABLE call_attempts ALTER COLUMN call_schedule_id DROP NOT NULL;
ALTER TABLE call_attempts ALTER COLUMN attempt_number SET DEFAULT 1;
