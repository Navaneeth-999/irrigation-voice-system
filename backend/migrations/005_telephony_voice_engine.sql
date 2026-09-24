-- Migration 005: Telephony & Voice Engine Domain
-- Tables for question sets, questions, audio prompts (review workflow), call schedule, attempts, responses, and webhook idempotency.

-- 1. Call Question Sets
CREATE TABLE IF NOT EXISTS call_question_sets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(150) NOT NULL,
    language_code VARCHAR(10) NOT NULL DEFAULT 'te',
    version INT NOT NULL DEFAULT 1,
    is_active BOOLEAN NOT NULL DEFAULT true,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Call Questions (Individual questionnaire steps)
CREATE TABLE IF NOT EXISTS call_questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    question_set_id UUID NOT NULL REFERENCES call_question_sets(id) ON DELETE CASCADE,
    step_number INT NOT NULL,
    code VARCHAR(50) NOT NULL,
    question_text_telugu TEXT NOT NULL,
    question_text_english TEXT NOT NULL,
    expected_input_type VARCHAR(20) NOT NULL DEFAULT 'single_digit',
    valid_digits VARCHAR(50),
    min_digits INT NOT NULL DEFAULT 1,
    max_digits INT NOT NULL DEFAULT 1,
    finish_on_key VARCHAR(5) DEFAULT '#',
    timeout_seconds INT NOT NULL DEFAULT 5,
    repeat_key VARCHAR(5) NOT NULL DEFAULT '*',
    opt_out_key VARCHAR(5) DEFAULT NULL,
    skip_rule JSONB DEFAULT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_question_set_step UNIQUE (question_set_id, step_number),
    CONSTRAINT uq_question_set_code UNIQUE (question_set_id, code)
);

-- 3. Audio Prompts with Agronomist / CSP Review Workflow
CREATE TABLE IF NOT EXISTS audio_prompts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    question_id UUID REFERENCES call_questions(id) ON DELETE SET NULL,
    prompt_code VARCHAR(100) UNIQUE NOT NULL,
    language_code VARCHAR(10) NOT NULL DEFAULT 'te',
    prompt_type VARCHAR(30) NOT NULL DEFAULT 'question', -- question, invalid_input, timeout, goodbye, opt_out_confirm
    text_content TEXT NOT NULL,
    english_meaning TEXT NOT NULL,
    audio_url TEXT,
    audio_storage_key VARCHAR(255),
    review_status VARCHAR(30) NOT NULL DEFAULT 'draft' CHECK (review_status IN ('draft', 'recorded', 'reviewed_agronomist', 'approved', 'rejected')),
    reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    review_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Call Schedule (Fortnightly scheduled call queue)
CREATE TABLE IF NOT EXISTS call_schedule (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    season_id UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
    cycle_number INT NOT NULL,
    question_set_id UUID NOT NULL REFERENCES call_question_sets(id),
    farmer_id UUID NOT NULL REFERENCES farmers(id) ON DELETE CASCADE,
    phone_e164 VARCHAR(20) NOT NULL,
    scheduled_date DATE NOT NULL,
    due_window_start DATE NOT NULL,
    due_window_end DATE NOT NULL,
    preferred_time_window VARCHAR(20) NOT NULL DEFAULT '09:00-18:00',
    status VARCHAR(30) NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'in_progress', 'completed', 'failed', 'cancelled', 'opted_out')),
    attempt_count INT NOT NULL DEFAULT 0,
    max_attempts INT NOT NULL DEFAULT 3,
    last_attempt_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_call_schedule_season_cycle UNIQUE (season_id, cycle_number)
);

-- 5. Call Attempts
CREATE TABLE IF NOT EXISTS call_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    call_schedule_id UUID NOT NULL REFERENCES call_schedule(id) ON DELETE CASCADE,
    attempt_number INT NOT NULL,
    provider VARCHAR(30) NOT NULL DEFAULT 'simulator' CHECK (provider IN ('twilio', 'simulator', 'mock')),
    provider_call_sid VARCHAR(100) UNIQUE,
    status VARCHAR(30) NOT NULL DEFAULT 'initiated' CHECK (status IN ('initiated', 'ringing', 'in_progress', 'completed', 'busy', 'no_answer', 'failed', 'cancelled')),
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    answered_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    duration_seconds INT,
    recording_url TEXT,
    failure_reason TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Call Responses (Farmer DTMF digits captured)
CREATE TABLE IF NOT EXISTS call_responses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    call_attempt_id UUID NOT NULL REFERENCES call_attempts(id) ON DELETE CASCADE,
    question_id UUID NOT NULL REFERENCES call_questions(id),
    step_number INT NOT NULL,
    prompt_code VARCHAR(100) NOT NULL,
    raw_digits VARCHAR(50),
    parsed_value VARCHAR(100),
    confidence_score NUMERIC(4,2) DEFAULT 1.00,
    is_valid BOOLEAN NOT NULL DEFAULT true,
    attempt_within_question INT NOT NULL DEFAULT 1,
    skipped BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. Provider Webhook Events (Twilio webhook idempotency)
CREATE TABLE IF NOT EXISTS provider_webhook_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider VARCHAR(30) NOT NULL,
    event_id VARCHAR(150) UNIQUE NOT NULL,
    event_type VARCHAR(50) NOT NULL,
    payload JSONB NOT NULL,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_call_schedule_status_date ON call_schedule (status, scheduled_date);
CREATE INDEX IF NOT EXISTS idx_call_schedule_season ON call_schedule (season_id);
CREATE INDEX IF NOT EXISTS idx_call_schedule_farmer ON call_schedule (farmer_id);
CREATE INDEX IF NOT EXISTS idx_call_attempts_schedule ON call_attempts (call_schedule_id);
CREATE INDEX IF NOT EXISTS idx_call_attempts_sid ON call_attempts (provider_call_sid);
CREATE INDEX IF NOT EXISTS idx_call_responses_attempt ON call_responses (call_attempt_id);
CREATE INDEX IF NOT EXISTS idx_audio_prompts_code ON audio_prompts (prompt_code);
CREATE INDEX IF NOT EXISTS idx_audio_prompts_status ON audio_prompts (review_status);
