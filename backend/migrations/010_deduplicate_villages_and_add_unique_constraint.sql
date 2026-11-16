-- ==============================================================================
-- Migration 010: Deduplicate Villages & Add UNIQUE(name, mandal) Constraint
-- ==============================================================================

DO $$
BEGIN
  -- Add unique constraint on (name, mandal) to prevent duplicate seeding
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_villages_name_mandal'
  ) THEN
    ALTER TABLE villages ADD CONSTRAINT uq_villages_name_mandal UNIQUE (name, mandal);
  END IF;
END $$;
