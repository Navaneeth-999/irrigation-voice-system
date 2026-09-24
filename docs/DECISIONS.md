# Architecture & Design Decisions Log (`docs/DECISIONS.md`)

This living document records significant technical and architectural decisions, the context behind them, alternatives considered, and the rationale.

---

## DECISION-001: Monorepo Structure & TypeScript Standard
- **Context:** Full-stack system with shared domain rules, schemas, and API contracts.
- **Decision:** Use a clean monorepo with `backend/` and `frontend/`, both utilizing TypeScript in strict mode.
- **Reason:** Enforces type safety across the boundary, eliminates common JavaScript runtime errors, and provides clear self-documenting code for student and CSP review.

---

## DECISION-002: Snapshot Rule for Historical Integrity
- **Context:** Plots, crop methods, and water sources may change over time, but historical seasons must preserve the exact state of cultivation and irrigation at the time of the season.
- **Decision:** 
  1. Plot area, irrigation method, and water sources (with pump HP and discharge rate) are snapshotted into `seasons` and `season_water_sources` at season creation (`Draft` state).
  2. While the season remains in `Draft`, snapshots are refreshable if plot details are updated.
  3. Once transitioned from `Draft` to `Active`, the snapshots are **strictly frozen** and immutable. Subsequent edits to plots or farmer records will never modify active, monitoring, or completed seasons.
- **Reason:** Maintains agricultural and analytical provenance. Any post-activation tampering would invalidate water consumption calculations and certificate credibility.

---

## DECISION-003: Database Driver & Dual-Mode Execution (PGlite + PostgreSQL)
- **Context:** The development machine runs Windows without Docker or local PostgreSQL service. However, the system must deploy to Supabase managed PostgreSQL and remain strictly compatible with standard SQL.
- **Decision:**
  1. Production & Supabase environments use standard `pg.Pool` with parameterized queries over `DATABASE_URL` and `DIRECT_DATABASE_URL` for migrations.
  2. For zero-dependency local development and unit tests where no live PostgreSQL is running, the database layer supports an embedded WASM PostgreSQL engine (`@electric-sql/pglite`) executing the exact same SQL migrations, triggers, UUID generation, and JSONB queries.
  3. Real PostgreSQL (via Supabase dev project) is strictly required for scheduler concurrency locking verification and final production sign-off.
- **Reason:** Enables immediate, friction-free local execution and automated unit testing without blocking the student on local Docker or PostgreSQL installation, while preserving 100% PostgreSQL SQL dialect compatibility.

---

## DECISION-004: Password Hashing Library Selection
- **Context:** `argon2` requires native C++ compilation tools (`node-gyp`, Visual Studio C++ build tools, Python) on Windows, which frequently fails or produces portability friction.
- **Decision:** Use `bcryptjs` (pure JavaScript, battle-tested bcrypt implementation) with 12 salt rounds for password hashing.
- **Reason:** Eliminates native compilation failures on Windows and across deployment hosts while providing robust security and standard bcrypt hash formats.

---

## DECISION-005: CSRF Protection & Cookie Strategy
- **Context:** Authentication is managed via secure, HttpOnly cookies. Cross-site request forgery must be defended.
- **Decision:** Implement a dual-token / custom-header CSRF defense. All mutating requests (`POST`, `PUT`, `PATCH`, `DELETE`) require a custom header `X-Requested-With: XMLHttpRequest` or `X-CSRF-Token`, verified by Express middleware. Cookies are set with `SameSite=Lax` (or `None` with `Secure` if cross-origin in development) and `HttpOnly`. Webhooks (`/api/v1/webhooks/*`) are exempted from CSRF because they authenticate via cryptographic signature verification (`X-Twilio-Signature`).
- **Reason:** Custom header verification is simple, stateless, and impervious to browser cross-site form submissions because modern browsers prevent cross-origin scripts from setting custom headers without explicit CORS preflight permission.

---

## DECISION-006: Row Level Security (RLS) Baseline
- **Context:** Supabase exposes an auto-generated PostgREST API with an anonymous key.
- **Decision:** Apply `ALTER TABLE <table_name> ENABLE ROW LEVEL SECURITY;` on all tables in Migration 001 with **no permissive public policies**.
- **Reason:** Denies direct access via the Supabase client using anon keys. The Node.js Express backend (connecting via PostgreSQL role/service connection) is the sole trusted orchestrator of business logic and data access.

---

## DECISION-007: Node Engine Pinning
- **Context:** Long-term reproducibility and runtime stability across Windows development, CI, and hosting environments.
- **Decision:** Pin Node engine in `package.json` to `>=20.0.0` (recommending LTS Node 20 or Node 22). Tested on local Node `v26.4.0`.
- **Reason:** Guarantees modern ESM, native crypto, and fetch features while supporting standard LTS hosting environments (Render, Railway, Vercel).

---

## DECISION-008: Telephony Voice Engine, Pure State Machine & Audio Gating
- **Context:** Voice calls to rural farmers in Telugu require predictable question flows, DTMF digit collection, skip branching (e.g. non-irrigated crops skip count/hours), retry policies, and regulatory compliance.
- **Decision:**
  1. Built `CallFlowEngine` as a pure, transport-neutral state machine completely independent of network or telephony SDKs.
  2. Implement an Adapter layer supporting `TwilioAdapter` (live PSTN/VoIP calls with TwiML and signature verification), `SimulatorAdapter` (interactive browser dialpad), and `MockTelephonyAdapter` (automated tests).
  3. **Regulatory Safety Gating:** All audio prompts track `review_status` (`draft`, `recorded`, `reviewed_agronomist`, `approved`, `rejected`). Real outbound Twilio calls strictly reject unapproved prompts (`ALLOW_UNREVIEWED_PROMPTS=true` is permitted solely in development/testing).
  4. **Opt-Out Rule:** Pressing 9 triggers opt-out **strictly and exclusively** during the Intro greeting or Goodbye prompt. In numeric entry questions (e.g., pump hours = 9), 9 represents the farmer's numeric response and never cancels the call.
  5. **Repeat Key:** Pressing `*` at any prompt replays the current question without incrementing the error retry count.
  6. **Webhook Idempotency:** All inbound Twilio events are recorded in `provider_webhook_events` with unique event IDs to prevent duplicate webhook processing.
- **Reason:** Decouples complex call logic from third-party vendor APIs, guarantees 100% testability offline, and prevents uncertified audio content from reaching farmers.

---

## DECISION-009: Fortnightly Feedback Cadence & Farmer Provenance
- **Context:** Field evaluation cycles must reflect agricultural realism.
- **Decision:**
  1. Feedback cycles run fortnightly (every 14 days), calculated as `sowing_date + cycle * 14 days`.
  2. When a season is activated, fortnightly call schedules are pre-generated in `call_schedule` table with due windows of $\pm 3$ days.
  3. Water volumes derived from farmer-reported pump hours $\times$ discharge rate are strictly categorized with `measurement_type = 'estimated'` and provenance `raw_unit = 'pump_hours'`, `calculation_method = 'pump_hours_x_discharge'`. They are never mislabeled as direct physical measurements.
- **Reason:** Reflects real agronomic intervals in Andhra Pradesh, prevents misleading claims about sensor-level precision, and maintains scientific integrity for the CSP community service evaluation.

---

## DECISION-010: 1-Based Digit Mappings, Total Hours Semantics & Dispatch Gating
- **Context:** User feedback and Phase 3 refinements required aligning digit options with approved design (1-based, no 0), clarifying pump hours as total hours for the period, supporting stage branching and voice notes, enforcing regulatory dispatch rules, and tracking scheduler locking.
- **Decision:**
  1. **Single Source of Truth (`QuestionnaireConfig.ts`):** Questionnaire options and prompt text are generated dynamically from a unified configuration. All options strictly use 1-based keypad digits (e.g. rain: 1=none, 2=light, 3=moderate, 4=heavy; water_problem: 1=none, 2=shortage, 3=pump_power, 4=source_unavailable; crop_problem: 1=none, 2=pests_disease, 3=yellowing_drying, 4=other).
  2. **Total Running Hours Semantics:** "hours" (Question 5) is defined as the **total pump running hours** for the entire fortnightly period (1-3 digits + #, up to 999). Irrigation volume is calculated directly as $\text{Volume (Litres)} = \text{total\_hours} \times \text{discharge\_rate\_lph}$.
  3. **Stage Branching & Voice Note:** Stage confirmation (Question 7) offers "1 = confirmed, 2 = different". Selecting 2 branches to sub-step 72 displaying crop-specific stages. Question 11 introduces an optional 30-second voice note recording (`<Record>`) with digit 1 to skip.
  4. **Dispatch Gating & Consecutive Failure Actions:** The call dispatch worker (`processDueCallSchedule`) verifies voice communication consent in `consents`, enforces a daily cap of 1 call attempt per farmer per day, restricts calls to 09:00–18:00 IST, and retries up to 3 attempts. When attempts are exhausted, it logs an SMS fallback. Two consecutive unreached cycles automatically generate a `repeated_missed_calls` action item for field officer follow-up.
  5. **Opt-Out Action:** Pressing 9 at Intro or Goodbye records `status = 'withdrawn'` in `consents`, cancels future pending call schedules (`status = 'cancelled'`), and sets the current schedule to `opted_out`.
  6. **Interactive Simulator Restriction:** Simulator calls are strictly restricted to demo farmers (`data_origin = 'demo'`). Real farmer records return HTTP 403 `SIMULATOR_DEMO_ONLY`.
  7. **Scheduler Locking on Real PostgreSQL:** Dual-mode database layer runs all unit tests in local PGlite. Scheduler concurrency locking verification against real PostgreSQL is held open pending the user's Supabase dev `DIRECT_DATABASE_URL`.

