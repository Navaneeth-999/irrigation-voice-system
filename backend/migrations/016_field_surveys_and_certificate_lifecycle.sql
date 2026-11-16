-- ==============================================================================
-- Migration 016: Field Surveys, Observations Farmer Link & Certificate Lifecycle
-- Supports:
-- 1. Associating Field Observations with Farmers & Plots
-- 2. Dedicated Field Surveys table with provenance, repeated monthly visits, and audit logs
-- 3. Certificate Sealing, Revocation, and Status History Audit Trail
-- ==============================================================================

DO $$
BEGIN
    -- 1. Associate Field Observations with Farmers & Plots
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'field_observations' AND column_name = 'farmer_id'
    ) THEN
        ALTER TABLE field_observations ADD COLUMN farmer_id UUID REFERENCES farmers(id) ON DELETE SET NULL;
        CREATE INDEX IF NOT EXISTS idx_field_obs_farmer ON field_observations(farmer_id);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'field_observations' AND column_name = 'plot_id'
    ) THEN
        ALTER TABLE field_observations ADD COLUMN plot_id UUID REFERENCES plots(id) ON DELETE SET NULL;
        CREATE INDEX IF NOT EXISTS idx_field_obs_plot ON field_observations(plot_id);
    END IF;

    -- 2. Create Field Surveys Table (Repeated visits, Provenance, Seasonal Metrics)
    CREATE TABLE IF NOT EXISTS field_surveys (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        farmer_id UUID NOT NULL REFERENCES farmers(id) ON DELETE CASCADE,
        village_id UUID NOT NULL REFERENCES villages(id) ON DELETE RESTRICT,
        plot_id UUID REFERENCES plots(id) ON DELETE SET NULL,
        season_id UUID REFERENCES seasons(id) ON DELETE SET NULL,
        survey_date DATE NOT NULL,
        survey_period VARCHAR(50) NOT NULL DEFAULT 'monthly',
        crop_id UUID REFERENCES crops(id) ON DELETE SET NULL,
        crop_stage_id UUID REFERENCES crop_stages(id) ON DELETE SET NULL,
        area_acres NUMERIC(8, 2) CHECK (area_acres > 0),
        soil_type VARCHAR(100),
        water_source_type_id UUID REFERENCES water_source_types(id) ON DELETE SET NULL,
        irrigation_method_type_id UUID REFERENCES irrigation_method_types(id) ON DELETE SET NULL,
        irrigation_frequency_days INTEGER CHECK (irrigation_frequency_days >= 0),
        irrigation_duration_hours NUMERIC(6, 2) CHECK (irrigation_duration_hours >= 0),
        pump_discharge_lps NUMERIC(8, 2) CHECK (pump_discharge_lps >= 0),
        pump_hours_per_event NUMERIC(6, 2) CHECK (pump_hours_per_event >= 0),
        irrigation_depth_mm NUMERIC(8, 2) CHECK (irrigation_depth_mm >= 0),
        applied_water_volume_m3 NUMERIC(12, 2) CHECK (applied_water_volume_m3 >= 0),
        applied_water_litres NUMERIC(16, 2) CHECK (applied_water_litres >= 0),
        rainfall_mm NUMERIC(8, 2) CHECK (rainfall_mm >= 0),
        rainfall_source VARCHAR(50) NOT NULL DEFAULT 'farmer_reported' CHECK (
            rainfall_source IN ('farmer_reported', 'rain_gauge_measured', 'external_station', 'unavailable')
        ),
        water_availability_status VARCHAR(50) NOT NULL DEFAULT 'adequate' CHECK (
            water_availability_status IN ('adequate', 'moderate_shortage', 'severe_scarcity')
        ),
        crop_condition VARCHAR(50) NOT NULL DEFAULT 'good' CHECK (
            crop_condition IN ('good', 'average', 'poor')
        ),
        crop_yield_quantity NUMERIC(10, 2) CHECK (crop_yield_quantity >= 0),
        crop_yield_unit VARCHAR(50) CHECK (crop_yield_unit IN ('kg', 'quintal', 'tonne')),
        crop_sale_price_per_unit NUMERIC(10, 2) CHECK (crop_sale_price_per_unit >= 0),
        cultivation_expenses_inr NUMERIC(12, 2) CHECK (cultivation_expenses_inr >= 0),
        farmer_remarks TEXT,
        surveyor_name VARCHAR(255),
        measurement_source VARCHAR(50) NOT NULL DEFAULT 'fieldwork_measured' CHECK (
            measurement_source IN ('fieldwork_measured', 'farmer_reported', 'external_station', 'estimated', 'unavailable')
        ),
        data_origin VARCHAR(50) NOT NULL DEFAULT 'real' CHECK (
            data_origin IN ('real', 'demo')
        ),
        version INTEGER NOT NULL DEFAULT 1,
        is_correction BOOLEAN NOT NULL DEFAULT FALSE,
        corrected_survey_id UUID REFERENCES field_surveys(id) ON DELETE SET NULL,
        correction_reason TEXT,
        created_by UUID REFERENCES users(id) ON DELETE SET NULL,
        updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_field_surveys_farmer ON field_surveys(farmer_id, survey_date DESC);
    CREATE INDEX IF NOT EXISTS idx_field_surveys_season ON field_surveys(season_id);
    CREATE INDEX IF NOT EXISTS idx_field_surveys_village ON field_surveys(village_id);
    CREATE INDEX IF NOT EXISTS idx_field_surveys_date ON field_surveys(survey_date);
    CREATE INDEX IF NOT EXISTS idx_field_surveys_origin ON field_surveys(data_origin);

    -- 3. Create Field Survey Audit Logs Table (For trackable corrections and historical changes)
    CREATE TABLE IF NOT EXISTS field_survey_audit_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        survey_id UUID NOT NULL REFERENCES field_surveys(id) ON DELETE CASCADE,
        action VARCHAR(50) NOT NULL CHECK (action IN ('create', 'update', 'correction')),
        changed_by UUID REFERENCES users(id) ON DELETE SET NULL,
        reason TEXT,
        previous_data JSONB,
        new_data JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_field_survey_audit_survey ON field_survey_audit_logs(survey_id);

    -- 4. Extend Certificates with Sealing and explicit Lifecycle Status
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'certificates' AND column_name = 'status'
    ) THEN
        ALTER TABLE certificates ADD COLUMN status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'sealed', 'revoked'));
        CREATE INDEX IF NOT EXISTS idx_certificates_status ON certificates(status);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'certificates' AND column_name = 'sealed_at'
    ) THEN
        ALTER TABLE certificates ADD COLUMN sealed_at TIMESTAMPTZ;
        ALTER TABLE certificates ADD COLUMN sealed_reason TEXT;
        ALTER TABLE certificates ADD COLUMN sealed_by UUID REFERENCES users(id) ON DELETE SET NULL;
    END IF;

    -- 5. Create Certificate Status History Table
    CREATE TABLE IF NOT EXISTS certificate_status_history (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        certificate_id UUID NOT NULL REFERENCES certificates(id) ON DELETE CASCADE,
        previous_status VARCHAR(50) NOT NULL,
        new_status VARCHAR(50) NOT NULL,
        reason TEXT NOT NULL,
        changed_by UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_cert_status_history_cert ON certificate_status_history(certificate_id, created_at DESC);

END $$;
