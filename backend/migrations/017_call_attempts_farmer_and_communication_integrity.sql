-- Migration 017: Ensure farmer and season integrity on call_attempts and link fallback SMS

-- 1. Add direct farmer_id and season_id foreign keys to call_attempts
ALTER TABLE call_attempts ADD COLUMN IF NOT EXISTS farmer_id UUID REFERENCES farmers(id) ON DELETE SET NULL;
ALTER TABLE call_attempts ADD COLUMN IF NOT EXISTS season_id UUID REFERENCES seasons(id) ON DELETE SET NULL;
ALTER TABLE call_attempts ADD COLUMN IF NOT EXISTS communication_log_id UUID REFERENCES communication_logs(id) ON DELETE SET NULL;

-- 2. Indexes for fast lookups by farmer and season
CREATE INDEX IF NOT EXISTS idx_call_attempts_farmer ON call_attempts (farmer_id);
CREATE INDEX IF NOT EXISTS idx_call_attempts_season ON call_attempts (season_id);
CREATE INDEX IF NOT EXISTS idx_communication_logs_farmer ON communication_logs (farmer_id);
CREATE INDEX IF NOT EXISTS idx_communication_logs_created ON communication_logs (created_at DESC);

-- 3. Safe Backfill: Link existing call_attempts to farmer_id and season_id from call_schedule
UPDATE call_attempts ca
SET farmer_id = cs.farmer_id,
    season_id = cs.season_id
FROM call_schedule cs
WHERE ca.call_schedule_id = cs.id
  AND ca.farmer_id IS NULL;

-- 4. Safe Backfill: Link ad-hoc call_attempts to farmers via unambiguous phone match (only if phone belongs to exactly 1 farmer)
UPDATE call_attempts ca
SET farmer_id = fc.single_farmer_id
FROM (
  SELECT phone_e164, MIN(farmer_id::text)::uuid as single_farmer_id
  FROM farmer_contacts
  GROUP BY phone_e164
  HAVING COUNT(DISTINCT farmer_id) = 1
) fc
WHERE ca.phone_e164 = fc.phone_e164
  AND ca.farmer_id IS NULL;
