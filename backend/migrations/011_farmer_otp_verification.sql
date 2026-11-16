-- ==============================================================================
-- Migration 011: Farmer Phone OTP Verification & Live/Sim Telephony Tracking
-- ==============================================================================

-- 1. Add OTP verification fields to farmers
ALTER TABLE farmers ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE farmers ADD COLUMN IF NOT EXISTS otp_code_hash VARCHAR(64);
ALTER TABLE farmers ADD COLUMN IF NOT EXISTS otp_expires_at TIMESTAMPTZ;
ALTER TABLE farmers ADD COLUMN IF NOT EXISTS otp_attempts INT NOT NULL DEFAULT 0;

-- Demo farmers are marked verified by default so demo workflows operate smoothly
UPDATE farmers SET phone_verified = TRUE WHERE data_origin = 'demo';

-- 2. Ensure call_attempts tracks error details for telephony live mode
ALTER TABLE call_attempts ADD COLUMN IF NOT EXISTS error_message TEXT;
ALTER TABLE call_attempts ADD COLUMN IF NOT EXISTS fallback_sms_sent BOOLEAN DEFAULT FALSE;
ALTER TABLE call_attempts ADD COLUMN IF NOT EXISTS fallback_sms_sid VARCHAR(100);
ALTER TABLE call_attempts ADD COLUMN IF NOT EXISTS phone_e164 VARCHAR(30);
ALTER TABLE call_attempts ALTER COLUMN call_schedule_id DROP NOT NULL;
ALTER TABLE call_attempts ALTER COLUMN attempt_number SET DEFAULT 1;

-- 3. Allow 'otp_sms' and 'otp_voice' in communication_logs
DO $$
BEGIN
  ALTER TABLE communication_logs DROP CONSTRAINT IF EXISTS communication_logs_purpose_check;
  ALTER TABLE communication_logs ADD CONSTRAINT communication_logs_purpose_check CHECK (
    purpose IN ('weather_alert', 'feedback_call', 'manual_advisory', 'call_reminder', 'call_fallback', 'system_notice', 'otp_sms', 'otp_voice')
  );
EXCEPTION
  WHEN OTHERS THEN NULL;
END $$;
