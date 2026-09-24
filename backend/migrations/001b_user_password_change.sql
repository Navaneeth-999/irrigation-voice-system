-- ==============================================================================
-- Migration 001b: Add must_change_password flag to users
-- ==============================================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;
