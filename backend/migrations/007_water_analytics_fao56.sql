-- ==============================================================================
-- Migration 007: Water Analytics, FAO-56 Engine, Paddy Model & Data Confidence
-- ==============================================================================

-- 1. Season Daily Water Balance (Daily FAO-56 / Ponding tracking per active season)
CREATE TABLE IF NOT EXISTS season_daily_water_balance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    season_id UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
    record_date DATE NOT NULL,
    das INTEGER NOT NULL, -- Days after sowing
    crop_stage_name VARCHAR(100) NOT NULL,
    stage_kc NUMERIC(4, 2) NOT NULL,
    kc_verified BOOLEAN NOT NULL DEFAULT FALSE,
    et0_mm NUMERIC(6, 2) NOT NULL DEFAULT 0,
    etc_mm NUMERIC(6, 2) NOT NULL DEFAULT 0,
    rainfall_mm NUMERIC(6, 2) NOT NULL DEFAULT 0,
    effective_rainfall_mm NUMERIC(6, 2) NOT NULL DEFAULT 0,
    irrigation_applied_mm NUMERIC(6, 2) NOT NULL DEFAULT 0,
    irrigation_applied_litres NUMERIC(14, 2) NOT NULL DEFAULT 0,
    percolation_mm NUMERIC(6, 2) NOT NULL DEFAULT 0,
    drainage_overflow_mm NUMERIC(6, 2) NOT NULL DEFAULT 0,
    ponding_depth_mm NUMERIC(6, 2) NOT NULL DEFAULT 0,
    soil_moisture_depletion_mm NUMERIC(6, 2) NOT NULL DEFAULT 0,
    assumptions_unvalidated BOOLEAN NOT NULL DEFAULT FALSE,
    unvalidated_params TEXT[] DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_season_daily_water_balance UNIQUE (season_id, record_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_water_season_date ON season_daily_water_balance(season_id, record_date);
CREATE INDEX IF NOT EXISTS idx_daily_water_das ON season_daily_water_balance(season_id, das);

-- 2. Season Cumulative Water Metrics & Data Confidence
CREATE TABLE IF NOT EXISTS season_water_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    season_id UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE UNIQUE,
    total_etc_mm NUMERIC(8, 2) NOT NULL DEFAULT 0,
    total_etc_m3 NUMERIC(12, 2) NOT NULL DEFAULT 0,
    total_effective_rain_mm NUMERIC(8, 2) NOT NULL DEFAULT 0,
    total_effective_rain_m3 NUMERIC(12, 2) NOT NULL DEFAULT 0,
    net_irrigation_demand_mm NUMERIC(8, 2) NOT NULL DEFAULT 0,
    net_irrigation_demand_m3 NUMERIC(12, 2) NOT NULL DEFAULT 0,
    gross_irrigation_demand_m3 NUMERIC(12, 2) NOT NULL DEFAULT 0,
    total_applied_litres NUMERIC(16, 2) NOT NULL DEFAULT 0,
    total_applied_m3 NUMERIC(12, 2) NOT NULL DEFAULT 0,
    total_applied_mm NUMERIC(8, 2) NOT NULL DEFAULT 0,
    water_use_ratio NUMERIC(6, 2) NOT NULL DEFAULT 1.0,
    ratio_band VARCHAR(50) NOT NULL CHECK (ratio_band IN ('below_estimate', 'near_estimate', 'above_estimate')),
    confidence_score INTEGER NOT NULL DEFAULT 0 CHECK (confidence_score >= 0 AND confidence_score <= 100),
    confidence_band VARCHAR(20) NOT NULL CHECK (confidence_band IN ('low', 'medium', 'high')),
    confidence_breakdown JSONB NOT NULL DEFAULT '{}',
    has_unvalidated_assumptions BOOLEAN NOT NULL DEFAULT FALSE,
    unvalidated_assumptions_list TEXT[] DEFAULT '{}',
    anomaly_flags TEXT[] DEFAULT '{}',
    calculated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_season_water_metrics_season ON season_water_metrics(season_id);
CREATE INDEX IF NOT EXISTS idx_season_water_metrics_ratio_band ON season_water_metrics(ratio_band);
CREATE INDEX IF NOT EXISTS idx_season_water_metrics_confidence ON season_water_metrics(confidence_score);

-- 3. Analytics Processing Queue (Worker queue using FOR UPDATE SKIP LOCKED)
CREATE TABLE IF NOT EXISTS analytics_processing_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    season_id UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
    job_type VARCHAR(50) NOT NULL CHECK (job_type IN ('daily_et_calc', 'anomaly_scan', 'water_balance_summary')),
    target_date DATE NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'failed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_analytics_queue_status_attempts ON analytics_processing_queue(status, attempts);

-- 4. Weather Alerts Notification Status column for concurrency locking
ALTER TABLE weather_alerts 
ADD COLUMN IF NOT EXISTS notification_status VARCHAR(50) NOT NULL DEFAULT 'completed' CHECK (notification_status IN ('pending', 'in_progress', 'completed', 'failed'));

CREATE INDEX IF NOT EXISTS idx_weather_alerts_notif_status ON weather_alerts(notification_status, is_active);

-- 5. Row Level Security (RLS) Deny by Default
ALTER TABLE season_daily_water_balance ENABLE ROW LEVEL SECURITY;
ALTER TABLE season_water_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_processing_queue ENABLE ROW LEVEL SECURITY;
