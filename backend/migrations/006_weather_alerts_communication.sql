-- Migration 006: Weather, Alerts & Communication Engine
-- Village-level weather records, alert rules, deduplicated weather alerts, message templates, and communication logs.

-- 1. Weather Records (Daily village-level observed and forecast data)
CREATE TABLE IF NOT EXISTS weather_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    village_id UUID NOT NULL REFERENCES villages(id) ON DELETE CASCADE,
    record_date DATE NOT NULL,
    temp_max_c NUMERIC(5, 2),
    temp_min_c NUMERIC(5, 2),
    precipitation_sum_mm NUMERIC(6, 2) NOT NULL DEFAULT 0.0,
    precipitation_probability_max INT CHECK (precipitation_probability_max IS NULL OR (precipitation_probability_max >= 0 AND precipitation_probability_max <= 100)),
    weather_code INT,
    et0_fao_evapotranspiration NUMERIC(6, 2),
    source VARCHAR(50) NOT NULL DEFAULT 'openmeteo' CHECK (source IN ('openmeteo', 'mock', 'manual', 'sensor')),
    is_forecast BOOLEAN NOT NULL DEFAULT true,
    is_demo BOOLEAN NOT NULL DEFAULT false,
    raw_payload JSONB DEFAULT '{}',
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_weather_village_date_forecast UNIQUE (village_id, record_date, is_forecast)
);

CREATE INDEX IF NOT EXISTS idx_weather_records_village_date ON weather_records(village_id, record_date);
CREATE INDEX IF NOT EXISTS idx_weather_records_date ON weather_records(record_date);

-- 2. Alert Rules (Configurable meteorological and hydrological threshold criteria)
CREATE TABLE IF NOT EXISTS alert_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(150) NOT NULL,
    description TEXT,
    alert_type VARCHAR(50) NOT NULL CHECK (alert_type IN ('rain_expected', 'heavy_rain', 'thunderstorm', 'high_temperature', 'dry_spell', 'custom_advisory')),
    severity VARCHAR(20) NOT NULL DEFAULT 'advisory' CHECK (severity IN ('advisory', 'warning', 'critical')),
    threshold_config JSONB NOT NULL DEFAULT '{}',
    cooldown_hours INT NOT NULL DEFAULT 24,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Seed Standard IMD and Agronomic Alert Rules
INSERT INTO alert_rules (rule_code, name, description, alert_type, severity, threshold_config, cooldown_hours)
VALUES 
    ('RULE_RAIN_EXPECTED', 'Rain Expected Advisory', 'Precipitation probability >= 60% and rain >= 2.5mm within next 24-48 hours', 'rain_expected', 'advisory', '{"min_probability": 60, "min_rain_mm": 2.5, "lookahead_days": 2}', 24),
    ('RULE_HEAVY_RAIN', 'Heavy Rainfall Warning', 'IMD heavy rainfall threshold >= 64.5mm in 24 hours', 'heavy_rain', 'warning', '{"min_rain_mm": 64.5, "lookahead_days": 1}', 24),
    ('RULE_THUNDERSTORM', 'Thunderstorm Warning', 'Forecast weather code indicates thunderstorm (WMO 95, 96, 99)', 'thunderstorm', 'warning', '{"weather_codes": [95, 96, 99], "lookahead_days": 1}', 24),
    ('RULE_HIGH_TEMP', 'High Temperature Advisory', 'Maximum temperature >= 40.0 C threshold advisory', 'high_temperature', 'advisory', '{"temp_max_threshold_c": 40.0, "lookahead_days": 1}', 24),
    ('RULE_DRY_SPELL', 'Dry Spell Advisory', '14+ dry days (< 2.5mm) and next 7 days forecast < 2.5mm total rain', 'dry_spell', 'warning', '{"dry_days_lookback": 14, "max_forecast_rain_mm": 2.5}', 48)
ON CONFLICT (rule_code) DO NOTHING;

-- 3. Weather Alerts (Generated alerts with composite deduplication key)
CREATE TABLE IF NOT EXISTS weather_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    village_id UUID NOT NULL REFERENCES villages(id) ON DELETE CASCADE,
    rule_id UUID REFERENCES alert_rules(id) ON DELETE SET NULL,
    alert_type VARCHAR(50) NOT NULL,
    severity VARCHAR(20) NOT NULL DEFAULT 'advisory' CHECK (severity IN ('advisory', 'warning', 'critical')),
    dedup_key VARCHAR(150) UNIQUE NOT NULL, -- Format: village_id:rule_code:target_date
    target_date DATE NOT NULL,
    headline_en TEXT NOT NULL,
    headline_te TEXT NOT NULL,
    message_en TEXT NOT NULL,
    message_te TEXT NOT NULL,
    suggested_action_en TEXT,
    suggested_action_te TEXT,
    source VARCHAR(50) NOT NULL DEFAULT 'system' CHECK (source IN ('system', 'manual')),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    valid_until TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_weather_alerts_village_target ON weather_alerts(village_id, target_date);
CREATE INDEX IF NOT EXISTS idx_weather_alerts_active ON weather_alerts(is_active);

-- 4. Message Templates (Bilingual SMS and notification templates with DLT compliance)
CREATE TABLE IF NOT EXISTS message_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_code VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(150) NOT NULL,
    channel VARCHAR(50) NOT NULL CHECK (channel IN ('sms', 'voice')),
    content_english TEXT NOT NULL,
    content_telugu TEXT,
    dlt_template_id VARCHAR(100),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Seed Default SMS Templates
INSERT INTO message_templates (template_code, name, channel, content_english, content_telugu, dlt_template_id)
VALUES
    (
        'SMS_WEATHER_ALERT',
        'Weather Alert SMS',
        'sms',
        'CSP IRRIGATION: Weather Alert for {village_name}: {headline_en}. Action: {action_en}. Reply STOP to opt out.',
        'రైతు హెచ్చరిక ({village_name}): {headline_te}. సూచన: {action_te}. నిలిపివేయడానికి 9 నొక్కండి.',
        'DLT_CSP_WEATHER_001'
    ),
    (
        'SMS_CALL_REMINDER',
        'Fortnightly Call Reminder',
        'sms',
        'CSP IRRIGATION: Namaskaram {farmer_name}. You will receive a voice call shortly from our irrigation service regarding your {crop_name} crop.',
        'నమస్కారం {farmer_name} గారు, మీ {crop_name} పంట నీటిపారుదల వివరాల కొరకు త్వరలో మా ఆటోమేటెడ్ కాల్ వస్తుంది.',
        'DLT_CSP_CALL_REM_002'
    ),
    (
        'SMS_CALL_FALLBACK',
        'Call Fallback SMS',
        'sms',
        'CSP IRRIGATION: We tried to reach you for your fortnightly irrigation feedback but could not connect. Please contact your village volunteer or office.',
        'నమస్కారం {farmer_name} గారు, మీ పంట వివరాల సేకరణకు చేసిన కాల్ కలవలేదు. దయచేసి గ్రామ వ్యవసాయ వాలంటీర్‌ను సంప్రదించండి.',
        'DLT_CSP_FALLBACK_003'
    ),
    (
        'SMS_MANUAL_ADVISORY',
        'Agricultural Officer Advisory',
        'sms',
        'CSP ADVISORY: {headline_en}. Note: {message_en}. - Agri Office',
        'వ్యవసాయ సూచన: {headline_te}. వివరాలు: {message_te}. - వ్యవసాయ అధికారి కార్యాలయం',
        'DLT_CSP_MANUAL_004'
    )
ON CONFLICT (template_code) DO NOTHING;

-- 5. Communication Logs (Append-only audit trail for all outbound transmissions)
CREATE TABLE IF NOT EXISTS communication_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    farmer_id UUID NOT NULL REFERENCES farmers(id) ON DELETE CASCADE,
    channel VARCHAR(50) NOT NULL CHECK (channel IN ('sms', 'voice')),
    purpose VARCHAR(50) NOT NULL CHECK (purpose IN ('weather_alert', 'feedback_call', 'manual_advisory', 'call_reminder', 'call_fallback', 'system_notice')),
    recipient_phone VARCHAR(30) NOT NULL,
    message_body TEXT,
    template_id UUID REFERENCES message_templates(id) ON DELETE SET NULL,
    related_alert_id UUID REFERENCES weather_alerts(id) ON DELETE SET NULL,
    provider VARCHAR(50) NOT NULL DEFAULT 'mock_sms' CHECK (provider IN ('mock_sms', 'twilio_sms', 'twilio_voice', 'simulator', 'mock')),
    provider_message_id VARCHAR(100),
    status VARCHAR(50) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'delivered', 'failed', 'blocked')),
    error_reason TEXT,
    is_simulated BOOLEAN NOT NULL DEFAULT false,
    triggered_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    delivered_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_communication_logs_farmer ON communication_logs(farmer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_communication_logs_status ON communication_logs(status);
CREATE INDEX IF NOT EXISTS idx_communication_logs_channel_date ON communication_logs(channel, created_at);

-- Row Level Security (RLS) Deny by Default
ALTER TABLE weather_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE weather_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE communication_logs ENABLE ROW LEVEL SECURITY;
