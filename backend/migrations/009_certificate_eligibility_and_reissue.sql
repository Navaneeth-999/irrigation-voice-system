-- ==============================================================================
-- Migration 009: Certificate Eligibility Gating, Reissue Versioning & Season Reports
-- ==============================================================================

-- 1. Allow Multiple Certificate Versions & Link Replacement Hierarchy
ALTER TABLE certificates DROP CONSTRAINT IF EXISTS uq_certificate_season;

ALTER TABLE certificates ADD COLUMN IF NOT EXISTS replaces_certificate_id UUID REFERENCES certificates(id) ON DELETE SET NULL;
ALTER TABLE certificates ADD COLUMN IF NOT EXISTS replaced_by_certificate_id UUID REFERENCES certificates(id) ON DELETE SET NULL;
ALTER TABLE certificates ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;

-- Ensure at most ONE active, unrevoked certificate exists per season
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_certificate_per_season ON certificates (season_id) WHERE is_revoked = false;

-- 2. Season Reports Table for Ineligible & Audit Reporting
CREATE TABLE IF NOT EXISTS season_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_code VARCHAR(50) NOT NULL UNIQUE,
    season_id UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
    farmer_id UUID NOT NULL REFERENCES farmers(id) ON DELETE CASCADE,
    plot_id UUID NOT NULL REFERENCES plots(id) ON DELETE CASCADE,
    crop_id UUID NOT NULL REFERENCES crops(id) ON DELETE CASCADE,
    actual_harvest_date DATE NOT NULL,
    yield_quantity NUMERIC(10, 2),
    yield_unit VARCHAR(50),
    monitoring_cycle_coverage NUMERIC(5, 2) NOT NULL,
    confidence_score NUMERIC(5, 2) NOT NULL,
    confidence_band VARCHAR(20) NOT NULL,
    water_use_ratio NUMERIC(5, 2) NOT NULL,
    water_use_ratio_band VARCHAR(50) NOT NULL,
    is_certificate_eligible BOOLEAN NOT NULL DEFAULT FALSE,
    ineligibility_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
    snapshot_data JSONB NOT NULL,
    pdf_path TEXT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_season_reports_season ON season_reports(season_id);
CREATE INDEX IF NOT EXISTS idx_season_reports_farmer ON season_reports(farmer_id);
CREATE INDEX IF NOT EXISTS idx_season_reports_code ON season_reports(report_code);

ALTER TABLE season_reports ENABLE ROW LEVEL SECURITY;

-- 3. Enhance Seasons Table with Eligibility Tracking
ALTER TABLE seasons ADD COLUMN IF NOT EXISTS certificate_status VARCHAR(50) DEFAULT 'none';
ALTER TABLE seasons ADD COLUMN IF NOT EXISTS ineligibility_reasons JSONB DEFAULT '[]'::jsonb;

-- 4. Seed Configurable Eligibility Rules in app_settings
INSERT INTO app_settings (key, value, description)
VALUES 
  ('certificate_min_cycle_coverage_pct', '50'::jsonb, 'Minimum percentage of scheduled monitoring cycles with farmer responses required for certificate eligibility'),
  ('certificate_min_confidence_score', '50'::jsonb, 'Minimum data confidence score (0-100) required for certificate eligibility'),
  ('certificate_min_confidence_band', '"medium"'::jsonb, 'Minimum data confidence band ("medium" or "high") required for certificate eligibility')
ON CONFLICT (key) DO NOTHING;
