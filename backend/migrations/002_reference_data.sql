-- ==============================================================================
-- Migration 002: Reference Data Tables
-- ==============================================================================

-- 1. Villages
CREATE TABLE IF NOT EXISTS villages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    mandal VARCHAR(255) NOT NULL,
    district VARCHAR(255) NOT NULL,
    gram_panchayat VARCHAR(255),
    latitude NUMERIC(9, 6),
    longitude NUMERIC(9, 6),
    is_demo BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_villages_name ON villages(name);
CREATE INDEX IF NOT EXISTS idx_villages_mandal ON villages(mandal);

-- 2. Crops
CREATE TABLE IF NOT EXISTS crops (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL UNIQUE,
    name_te VARCHAR(255) NOT NULL,
    category VARCHAR(100) NOT NULL,
    default_duration_days INTEGER NOT NULL,
    water_model VARCHAR(50) NOT NULL CHECK (water_model IN ('kc_standard', 'paddy_ponding')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 3. Crop Stages
CREATE TABLE IF NOT EXISTS crop_stages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    crop_id UUID NOT NULL REFERENCES crops(id) ON DELETE CASCADE,
    stage_order INTEGER NOT NULL,
    name VARCHAR(100) NOT NULL,
    name_te VARCHAR(255) NOT NULL,
    start_das INTEGER NOT NULL, -- Days after sowing
    end_das INTEGER NOT NULL,
    kc NUMERIC(4, 2) NOT NULL,
    kc_source TEXT NOT NULL,
    kc_verified BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_crop_stages_crop_order ON crop_stages(crop_id, stage_order);

-- 4. Crop Model Parameters (Paddy percolation, puddling water, etc.)
CREATE TABLE IF NOT EXISTS crop_model_parameters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    crop_id UUID NOT NULL REFERENCES crops(id) ON DELETE CASCADE,
    key VARCHAR(100) NOT NULL,
    value_numeric NUMERIC(10, 2) NOT NULL,
    unit VARCHAR(50) NOT NULL,
    source TEXT NOT NULL,
    verified BOOLEAN NOT NULL DEFAULT FALSE,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_crop_model_params_crop_key ON crop_model_parameters(crop_id, key);

-- 5. Water Source Types
CREATE TABLE IF NOT EXISTS water_source_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    name_te VARCHAR(255) NOT NULL,
    requires_pump BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 6. Irrigation Method Types
CREATE TABLE IF NOT EXISTS irrigation_method_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    name_te VARCHAR(255) NOT NULL,
    typical_efficiency NUMERIC(3, 2) NOT NULL CHECK (typical_efficiency > 0 AND typical_efficiency <= 1.0),
    efficiency_source TEXT NOT NULL,
    efficiency_verified BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 7. Offices Directory (Optional reference data)
CREATE TABLE IF NOT EXISTS offices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type VARCHAR(100) NOT NULL,
    name VARCHAR(255) NOT NULL,
    area VARCHAR(255) NOT NULL,
    contact VARCHAR(255) NOT NULL,
    verified BOOLEAN NOT NULL DEFAULT FALSE,
    source TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ==============================================================================
-- Row Level Security (RLS) Baseline
-- ==============================================================================
ALTER TABLE villages ENABLE ROW LEVEL SECURITY;
ALTER TABLE crops ENABLE ROW LEVEL SECURITY;
ALTER TABLE crop_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE crop_model_parameters ENABLE ROW LEVEL SECURITY;
ALTER TABLE water_source_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE irrigation_method_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE offices ENABLE ROW LEVEL SECURITY;
