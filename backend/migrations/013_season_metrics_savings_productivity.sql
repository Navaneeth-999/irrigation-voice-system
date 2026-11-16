-- ==============================================================================
-- Migration 013: Season Water Savings, Productivity & Economics
-- Adds missing seasonal metrics columns for water saved, savings percentage,
-- water productivity, and profit metrics.
-- ==============================================================================

DO $$
BEGIN
    -- 1. Add water savings, productivity and economics columns to season_water_metrics
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'season_water_metrics' AND column_name = 'gross_recommended_m3'
    ) THEN
        ALTER TABLE season_water_metrics ADD COLUMN gross_recommended_m3 NUMERIC(12, 2) DEFAULT 0;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'season_water_metrics' AND column_name = 'gross_recommended_litres'
    ) THEN
        ALTER TABLE season_water_metrics ADD COLUMN gross_recommended_litres NUMERIC(16, 2) DEFAULT 0;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'season_water_metrics' AND column_name = 'water_saved_m3'
    ) THEN
        ALTER TABLE season_water_metrics ADD COLUMN water_saved_m3 NUMERIC(12, 2) DEFAULT 0;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'season_water_metrics' AND column_name = 'water_saved_litres'
    ) THEN
        ALTER TABLE season_water_metrics ADD COLUMN water_saved_litres NUMERIC(16, 2) DEFAULT 0;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'season_water_metrics' AND column_name = 'water_saved_percentage'
    ) THEN
        ALTER TABLE season_water_metrics ADD COLUMN water_saved_percentage NUMERIC(6, 2);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'season_water_metrics' AND column_name = 'water_productivity_kg_per_m3'
    ) THEN
        ALTER TABLE season_water_metrics ADD COLUMN water_productivity_kg_per_m3 NUMERIC(10, 3);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'season_water_metrics' AND column_name = 'net_profit_inr'
    ) THEN
        ALTER TABLE season_water_metrics ADD COLUMN net_profit_inr NUMERIC(12, 2);
    END IF;

    -- 2. Add pricing and cultivation expense columns to seasons table
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'seasons' AND column_name = 'crop_sale_price_per_unit'
    ) THEN
        ALTER TABLE seasons ADD COLUMN crop_sale_price_per_unit NUMERIC(10, 2);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'seasons' AND column_name = 'cultivation_expense_inr'
    ) THEN
        ALTER TABLE seasons ADD COLUMN cultivation_expense_inr NUMERIC(12, 2);
    END IF;
END $$;
