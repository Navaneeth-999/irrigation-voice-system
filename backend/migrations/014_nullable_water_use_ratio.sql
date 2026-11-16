-- ==============================================================================
-- Migration 014: Make water_use_ratio Nullable for Zero/Rainfed Demand
-- Prevents division by zero or artificial clamping when net agronomic demand is zero.
-- ==============================================================================

DO $$
BEGIN
    -- 1. Make water_use_ratio nullable in season_water_metrics
    ALTER TABLE season_water_metrics ALTER COLUMN water_use_ratio DROP NOT NULL;

    -- 2. Make water_use_ratio nullable in certificates
    ALTER TABLE certificates ALTER COLUMN water_use_ratio DROP NOT NULL;

    -- 3. Make water_use_ratio nullable in season_reports
    ALTER TABLE season_reports ALTER COLUMN water_use_ratio DROP NOT NULL;

    -- 4. Correct existing artificially clamped WUR values (e.g. 720.00) where demand was zero
    UPDATE season_water_metrics 
    SET water_use_ratio = NULL 
    WHERE (net_irrigation_demand_m3 <= 0 OR net_irrigation_demand_m3 IS NULL) AND water_use_ratio >= 100;

    UPDATE certificates 
    SET water_use_ratio = NULL 
    WHERE water_use_ratio >= 700;

    UPDATE season_reports 
    SET water_use_ratio = NULL 
    WHERE water_use_ratio >= 700;
END $$;
