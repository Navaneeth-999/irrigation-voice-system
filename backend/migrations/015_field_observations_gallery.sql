-- ==============================================================================
-- Migration 015: Community Survey & Field Observations Gallery
-- Creates field_observations table with consent tracking, randomized storage keys,
-- village scoping, and role authorization indexes.
-- ==============================================================================

DO $$
BEGIN
    CREATE TABLE IF NOT EXISTS field_observations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        village_id UUID NOT NULL REFERENCES villages(id) ON DELETE CASCADE,
        observation_date DATE NOT NULL,
        category VARCHAR(50) NOT NULL CHECK (
            category IN ('farmer_interview', 'irrigation_source', 'water_scarcity', 'canal_infrastructure')
        ),
        title VARCHAR(255) NOT NULL,
        caption TEXT NOT NULL,
        photo_storage_key VARCHAR(255) NOT NULL UNIQUE,
        file_size_bytes INTEGER NOT NULL,
        mime_type VARCHAR(100) NOT NULL CHECK (
            mime_type IN ('image/jpeg', 'image/png', 'image/webp')
        ),
        surveyor_name VARCHAR(200),
        consent_verified BOOLEAN NOT NULL DEFAULT FALSE,
        consent_method VARCHAR(50) CHECK (
            consent_method IN ('written_form', 'audio_recorded', 'verbal_panchayat_witness', 'not_applicable')
        ),
        consent_notes TEXT,
        consent_withdrawn BOOLEAN NOT NULL DEFAULT FALSE,
        consent_withdrawn_at TIMESTAMPTZ,
        consent_withdrawn_reason TEXT,
        is_published BOOLEAN NOT NULL DEFAULT TRUE,
        created_by UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_field_obs_village ON field_observations(village_id);
    CREATE INDEX IF NOT EXISTS idx_field_obs_category ON field_observations(category);
    CREATE INDEX IF NOT EXISTS idx_field_obs_date ON field_observations(observation_date);
    CREATE INDEX IF NOT EXISTS idx_field_obs_consent ON field_observations(consent_verified, consent_withdrawn);
    CREATE INDEX IF NOT EXISTS idx_field_obs_created_by ON field_observations(created_by);
END $$;
