-- ==============================================================================
-- Migration 008: Seasonal Conservation Certificates & Immutable Snapshots
-- ==============================================================================

-- 1. Certificates Table
CREATE TABLE IF NOT EXISTS certificates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    certificate_code VARCHAR(50) NOT NULL UNIQUE,
    season_id UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
    farmer_id UUID NOT NULL REFERENCES farmers(id) ON DELETE CASCADE,
    plot_id UUID NOT NULL REFERENCES plots(id) ON DELETE CASCADE,
    crop_id UUID NOT NULL REFERENCES crops(id) ON DELETE CASCADE,
    water_use_ratio NUMERIC(5, 2) NOT NULL,
    water_use_ratio_band VARCHAR(50) NOT NULL,
    confidence_score NUMERIC(5, 2) NOT NULL,
    confidence_band VARCHAR(20) NOT NULL,
    estimated_water_saved_litres NUMERIC(14, 2) NOT NULL DEFAULT 0,
    actual_harvest_date DATE NOT NULL,
    yield_quantity NUMERIC(10, 2),
    yield_unit VARCHAR(50),
    snapshot_data JSONB NOT NULL,
    sha256_hash VARCHAR(64) NOT NULL,
    pdf_path TEXT,
    verification_token VARCHAR(64) NOT NULL UNIQUE,
    is_revoked BOOLEAN NOT NULL DEFAULT FALSE,
    revoked_at TIMESTAMPTZ,
    revocation_reason TEXT,
    revoked_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_certificate_season UNIQUE (season_id)
);

CREATE INDEX IF NOT EXISTS idx_certificates_code ON certificates(certificate_code);
CREATE INDEX IF NOT EXISTS idx_certificates_farmer ON certificates(farmer_id);
CREATE INDEX IF NOT EXISTS idx_certificates_season ON certificates(season_id);
CREATE INDEX IF NOT EXISTS idx_certificates_token ON certificates(verification_token);
CREATE INDEX IF NOT EXISTS idx_certificates_sha256 ON certificates(sha256_hash);

-- 2. Add harvest & yield columns to seasons if not already present
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'seasons' AND column_name = 'actual_harvest_date'
    ) THEN
        ALTER TABLE seasons ADD COLUMN actual_harvest_date DATE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'seasons' AND column_name = 'actual_yield_quantity'
    ) THEN
        ALTER TABLE seasons ADD COLUMN actual_yield_quantity NUMERIC(10, 2);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'seasons' AND column_name = 'actual_yield_unit'
    ) THEN
        ALTER TABLE seasons ADD COLUMN actual_yield_unit VARCHAR(50);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'seasons' AND column_name = 'completion_notes'
    ) THEN
        ALTER TABLE seasons ADD COLUMN completion_notes TEXT;
    END IF;
END $$;

-- 3. Row Level Security: Deny-by-default for public keys
ALTER TABLE certificates ENABLE ROW LEVEL SECURITY;
