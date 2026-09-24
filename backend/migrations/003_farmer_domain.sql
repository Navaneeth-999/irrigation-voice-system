-- ==============================================================================
-- Migration 003: Farmer Domain Tables
-- ==============================================================================

-- 1. Farmers
CREATE TABLE IF NOT EXISTS farmers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    farmer_code VARCHAR(50) NOT NULL UNIQUE,
    full_name VARCHAR(255) NOT NULL,
    village_id UUID NOT NULL REFERENCES villages(id) ON DELETE RESTRICT,
    address TEXT,
    gram_panchayat VARCHAR(255),
    preferred_language VARCHAR(10) NOT NULL DEFAULT 'te',
    call_window_start TIME NOT NULL DEFAULT '09:00:00',
    call_window_end TIME NOT NULL DEFAULT '18:00:00',
    status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    data_source VARCHAR(50) NOT NULL DEFAULT 'survey' CHECK (data_source IN ('panchayat', 'survey', 'csp_team', 'farmer_self')),
    data_origin VARCHAR(50) NOT NULL DEFAULT 'real' CHECK (data_origin IN ('real', 'demo')),
    notes TEXT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_farmers_village_id ON farmers(village_id);
CREATE INDEX IF NOT EXISTS idx_farmers_status ON farmers(status);
CREATE INDEX IF NOT EXISTS idx_farmers_data_origin ON farmers(data_origin);

-- 2. Farmer Contacts
CREATE TABLE IF NOT EXISTS farmer_contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    farmer_id UUID NOT NULL REFERENCES farmers(id) ON DELETE CASCADE,
    phone_e164 VARCHAR(30) NOT NULL,
    type VARCHAR(50) NOT NULL DEFAULT 'primary' CHECK (type IN ('primary', 'alternate')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    is_verified BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_farmer_contacts_farmer_id ON farmer_contacts(farmer_id);
CREATE INDEX IF NOT EXISTS idx_farmer_contacts_phone ON farmer_contacts(phone_e164);

-- 3. Consents (Audit history of communication consent)
CREATE TABLE IF NOT EXISTS consents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    farmer_id UUID NOT NULL REFERENCES farmers(id) ON DELETE CASCADE,
    channel VARCHAR(50) NOT NULL CHECK (channel IN ('voice', 'sms')),
    status VARCHAR(50) NOT NULL CHECK (status IN ('granted', 'withdrawn')),
    method VARCHAR(50) NOT NULL DEFAULT 'verbal' CHECK (method IN ('verbal', 'written', 'ivr', 'sms_reply', 'other')),
    recorded_by UUID REFERENCES users(id) ON DELETE SET NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_consents_farmer_channel ON consents(farmer_id, channel, recorded_at DESC);

-- 4. Plots
CREATE TABLE IF NOT EXISTS plots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    farmer_id UUID NOT NULL REFERENCES farmers(id) ON DELETE CASCADE,
    label VARCHAR(100) NOT NULL,
    survey_number VARCHAR(100),
    area_acres NUMERIC(8, 2) NOT NULL CHECK (area_acres > 0),
    latitude NUMERIC(9, 6),
    longitude NUMERIC(9, 6),
    soil_type VARCHAR(100),
    tenure VARCHAR(50) NOT NULL DEFAULT 'owned' CHECK (tenure IN ('owned', 'leased')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_plots_farmer_id ON plots(farmer_id);

-- 5. Plot Water Sources (Multiple per plot with pump specs)
CREATE TABLE IF NOT EXISTS plot_water_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plot_id UUID NOT NULL REFERENCES plots(id) ON DELETE CASCADE,
    water_source_type_id UUID NOT NULL REFERENCES water_source_types(id) ON DELETE RESTRICT,
    pump_hp NUMERIC(5, 2),
    discharge_lph NUMERIC(10, 2), -- Litres per hour
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_plot_water_sources_plot_id ON plot_water_sources(plot_id);

-- ==============================================================================
-- Row Level Security (RLS) Baseline
-- ==============================================================================
ALTER TABLE farmers ENABLE ROW LEVEL SECURITY;
ALTER TABLE farmer_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE plots ENABLE ROW LEVEL SECURITY;
ALTER TABLE plot_water_sources ENABLE ROW LEVEL SECURITY;
