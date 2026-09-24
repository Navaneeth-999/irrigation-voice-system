-- ==============================================================================
-- Migration 004: Seasons, Irrigation Records, Crop Progress, Feedback, Actions
-- ==============================================================================

-- 1. Seasons Table
CREATE TABLE IF NOT EXISTS seasons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    season_code VARCHAR(50) NOT NULL UNIQUE,
    farmer_id UUID NOT NULL REFERENCES farmers(id) ON DELETE RESTRICT,
    plot_id UUID NOT NULL REFERENCES plots(id) ON DELETE RESTRICT,
    season_type VARCHAR(50) NOT NULL CHECK (season_type IN ('kharif', 'rabi', 'summer')),
    season_year INTEGER NOT NULL,
    crop_id UUID NOT NULL REFERENCES crops(id) ON DELETE RESTRICT,
    variety VARCHAR(100),
    sowing_date DATE NOT NULL,
    expected_harvest_date DATE NOT NULL,
    actual_harvest_date DATE,
    irrigation_method_type_id UUID NOT NULL REFERENCES irrigation_method_types(id) ON DELETE RESTRICT,
    area_acres_snapshot NUMERIC(8, 2) NOT NULL CHECK (area_acres_snapshot > 0),
    yield_value NUMERIC(10, 2),
    yield_unit VARCHAR(50) CHECK (yield_unit IN ('kg', 'quintal', 'tonne')),
    harvest_notes TEXT,
    status VARCHAR(50) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'monitoring', 'harvest', 'completed', 'cancelled')),
    completed_at TIMESTAMPTZ,
    data_origin VARCHAR(50) NOT NULL DEFAULT 'real' CHECK (data_origin IN ('real', 'demo')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_seasons_farmer_id ON seasons(farmer_id);
CREATE INDEX IF NOT EXISTS idx_seasons_plot_id ON seasons(plot_id);
CREATE INDEX IF NOT EXISTS idx_seasons_crop_id ON seasons(crop_id);
CREATE INDEX IF NOT EXISTS idx_seasons_status ON seasons(status);

-- 2. Season Water Sources (Snapshot at creation/activation)
CREATE TABLE IF NOT EXISTS season_water_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    season_id UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
    water_source_type_id UUID NOT NULL REFERENCES water_source_types(id) ON DELETE RESTRICT,
    share_percent NUMERIC(5, 2) NOT NULL DEFAULT 100.00,
    pump_hp_snapshot NUMERIC(5, 2),
    discharge_lph_snapshot NUMERIC(10, 2),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_season_water_sources_season ON season_water_sources(season_id);

-- 3. Farmer Feedback (Recorded via Voice IVR, Call Simulator, or Manual Entry)
CREATE TABLE IF NOT EXISTS farmer_feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    season_id UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
    cycle_number INTEGER NOT NULL,
    call_attempt_id UUID,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    rainfall_class VARCHAR(50) NOT NULL CHECK (rainfall_class IN ('none', 'light', 'moderate', 'heavy')),
    irrigated BOOLEAN NOT NULL,
    irrigation_count INTEGER NOT NULL DEFAULT 0,
    pump_hours NUMERIC(6, 2) NOT NULL DEFAULT 0,
    crop_condition VARCHAR(50) NOT NULL CHECK (crop_condition IN ('good', 'average', 'poor')),
    stage_confirmed BOOLEAN NOT NULL DEFAULT TRUE,
    reported_stage_id UUID REFERENCES crop_stages(id) ON DELETE SET NULL,
    water_problem VARCHAR(50) NOT NULL DEFAULT 'none' CHECK (water_problem IN ('none', 'shortage', 'pump_power', 'source_unavailable')),
    crop_problem VARCHAR(50) NOT NULL DEFAULT 'none' CHECK (crop_problem IN ('none', 'pest_disease', 'yellowing_drying', 'other')),
    callback_requested BOOLEAN NOT NULL DEFAULT FALSE,
    voice_note_path TEXT,
    source VARCHAR(50) NOT NULL DEFAULT 'manual' CHECK (source IN ('ivr', 'manual', 'simulator')),
    is_simulated BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_farmer_feedback_season ON farmer_feedback(season_id, cycle_number);

-- 4. Irrigation Records (Volume Estimation Engine)
CREATE TABLE IF NOT EXISTS irrigation_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    season_id UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    event_count INTEGER NOT NULL DEFAULT 1,
    raw_value NUMERIC(10, 2) NOT NULL,
    raw_unit VARCHAR(50) NOT NULL CHECK (raw_unit IN ('pump_hours', 'drip_hours', 'depth_mm', 'litres')),
    calculation_method VARCHAR(50) NOT NULL CHECK (calculation_method IN ('pump_hours_x_discharge', 'depth_x_area', 'direct_litres', 'manual_estimate')),
    estimated_volume_l NUMERIC(14, 2) NOT NULL,
    estimated_depth_mm NUMERIC(8, 2),
    measurement_type VARCHAR(50) NOT NULL DEFAULT 'estimated' CHECK (measurement_type IN ('farmer_reported', 'estimated', 'measured')),
    source VARCHAR(50) NOT NULL DEFAULT 'admin_entry' CHECK (source IN ('call', 'admin_entry', 'field_visit', 'sensor')),
    feedback_id UUID REFERENCES farmer_feedback(id) ON DELETE SET NULL,
    is_simulated BOOLEAN NOT NULL DEFAULT FALSE,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_irrigation_records_season ON irrigation_records(season_id);
CREATE INDEX IF NOT EXISTS idx_irrigation_records_dates ON irrigation_records(period_start, period_end);

-- 5. Crop Progress Observations
CREATE TABLE IF NOT EXISTS crop_progress (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    season_id UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
    observed_on DATE NOT NULL,
    reported_stage_id UUID REFERENCES crop_stages(id) ON DELETE SET NULL,
    expected_stage_id UUID REFERENCES crop_stages(id) ON DELETE SET NULL,
    condition VARCHAR(50) NOT NULL CHECK (condition IN ('good', 'average', 'poor')),
    source VARCHAR(50) NOT NULL DEFAULT 'admin_entry' CHECK (source IN ('call', 'admin_entry', 'field_visit')),
    notes TEXT,
    is_simulated BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_crop_progress_season ON crop_progress(season_id, observed_on DESC);

-- 6. Action Items Queue
CREATE TABLE IF NOT EXISTS action_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source VARCHAR(50) NOT NULL CHECK (source IN ('call', 'weather', 'anomaly', 'manual', 'system')),
    farmer_id UUID NOT NULL REFERENCES farmers(id) ON DELETE CASCADE,
    season_id UUID REFERENCES seasons(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL CHECK (type IN (
        'water_shortage', 'pump_power_problem', 'source_unavailable',
        'crop_pest_disease', 'crop_condition_poor', 'callback_requested',
        'repeated_missed_calls', 'suspicious_data', 'other_field_issue'
    )),
    status VARCHAR(50) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'assigned', 'in_progress', 'resolved', 'closed')),
    assignee_id UUID REFERENCES users(id) ON DELETE SET NULL,
    referral_note TEXT,
    priority VARCHAR(20) NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'critical')),
    related_feedback_id UUID REFERENCES farmer_feedback(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    closed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_action_items_farmer ON action_items(farmer_id);
CREATE INDEX IF NOT EXISTS idx_action_items_status ON action_items(status);
CREATE INDEX IF NOT EXISTS idx_action_items_type ON action_items(type);

-- 7. Rule-Based Anomaly Flags (Auditable flags)
CREATE TABLE IF NOT EXISTS anomaly_flags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    season_id UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
    rule_code VARCHAR(100) NOT NULL,
    severity VARCHAR(20) NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    details JSONB NOT NULL,
    detected_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMPTZ,
    action_item_id UUID REFERENCES action_items(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_anomaly_flags_season ON anomaly_flags(season_id);

-- ==============================================================================
-- Row Level Security (RLS) Baseline
-- ==============================================================================
ALTER TABLE seasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE season_water_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE farmer_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE irrigation_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE crop_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE action_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE anomaly_flags ENABLE ROW LEVEL SECURITY;
