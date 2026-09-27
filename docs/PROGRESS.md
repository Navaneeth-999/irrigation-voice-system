# Project Development Progress (`docs/PROGRESS.md`)

## Status Overview
- Current Phase: **PHASE 6: Reports, Certificates, Immutable Snapshots, QR Verification (COMPLETED & VERIFIED)**
- Next Phase: **PHASE 7: System Hardening, Playwright E2E 22-Step Demo Script & Production Deployment Runbooks**
- Last Updated: 2026-09-26

---

### Phase Summary & Status

| Phase | Description | Status | Verification & Deliverables |
|---|---|---|---|
| **Pre-Flight** | Environment inspection, secrets scan, safe archiving | **DONE** | Node 26, Git initialized, `.gitignore` strictly enforced, secrets safely isolated. |
| **Phase 1** | Foundation, RBAC, Auth with CSRF, Farmers, Plots, Ref Data, Dashboard Shell | **DONE** | Migrations 001-003 applied, 24/24 automated tests passed, frontend built cleanly. |
| **Phase 2** | Seasons, Snapshots, Irrigation Records, Feedback, Action Queue | **DONE** | Migration 004 applied, frozen snapshot rule verified by mutation test, 18/18 tests passed. |
| **Phase 3** | Call System, Telugu IVR, CallFlowEngine, Twilio Spike & Simulator | **DONE** | Migration 005 applied, 10 Telugu questions, pure state machine, audio gating, 24/24 tests passed (66/66 total). |
| **Phase 4** | Weather Service, Open-Meteo Adapter, Alert Engine, Voice & SMS Alerts | **DONE** | Migration 006 applied, Open-Meteo live API, composite deduplication, NotificationService guardrails (voice + SMS, strict opt-in consent, 09:00-18:00 voice quiet hours, max 1 call/day cap, possibility language, AGRI_PANCHAYAT scoping), 19/19 tests passed (85/85 total). |
| **Phase 5** | Water Analytics, FAO-56 Engine, Paddy Model, Data Confidence | **DONE** | Migration 007 applied, FAO-56 engine, configurable USDA-SCS effective rainfall, paddy ponding balance, indicative qualitative WUR bands (no leaderboards), 336-hour fortnight anomaly reasoning, 4-pillar data confidence scoring, Recharts balance graph, 19/19 tests passed (104/104 total). |
| **Phase 6** | Reports, Certificates, Immutable Snapshots, QR Verification | **DONE** | Migrations 008-009 applied, canonical JSON serialization, deterministic SHA-256 hash, PDFKit with Noto Sans Telugu, QR code with PUBLIC_FRONTEND_URL, strict 6-field privacy-filtered public verification portal, eligibility gating with ineligible season reports, and certificate reissuance hierarchy, 15/15 tests passed (119/119 total). |
| **Phase 7** | Hardening, Playwright E2E 22-Step Demo, Deployment Runbooks | PENDING | Full test suite, demo reset script, deployment guides for Vercel/Render. |

---

### Phase 3 Deliverables & Verifications

#### Backend Deliverables:
1. **Telephony & Voice Tables Migration (`005_telephony_voice_engine.sql`):**
   - `call_question_sets`: Versioned, localized questionnaire configurations.
   - `call_questions`: 10-step sequence with Telugu text, English meaning, expected digit constraints, repeat keys, and skip rules.
   - `audio_prompts`: Prompts with agronomist certification workflow (`review_status`: `draft`, `recorded`, `reviewed_agronomist`, `approved`, `rejected`).
   - `call_schedule`: Fortnightly queue pre-generated at season activation with $\pm 3$ days due windows.
   - `call_attempts`: Provider call records with Call SID, timestamps, duration, and status.
   - `call_responses`: Farmer DTMF digit captures with raw digits, parsed values, confidence scores, and skip flags.
   - `provider_webhook_events`: Idempotency tracking table preventing duplicate webhook execution.
2. **`CallFlowEngine` Pure State Machine (`modules/telephony/CallFlowEngine.ts`):**
   - Pure, transport-neutral state engine independent of any network or telephony library.
   - Full 10-question flow implemented: Intro, Rain, Irrigated, Count, Hours, Crop condition, Stage confirmation, Water problem, Crop problem, Callback requested, Goodbye.
   - **Skip Branching Rule:** If Question 3 (`irrigated`) is `2` (No), automatically skips Question 4 (`irrigation_count`) and Question 5 (`hours`), marking them skipped with 0 hours, and jumps directly to Question 6 (`crop_condition`).
   - **Opt-Out Rule:** 9 triggers opt-out **strictly** at Intro or Goodbye prompts. On Question 5 (`hours`), 9 represents 9 pump running hours and never terminates the call.
   - **Repeat Key:** `*` immediately repeats the current question.
   - **Retry & Timeout Handling:** Enforces maximum of 2 invalid or timeout retries before graceful termination.
3. **Telephony Adapters Layer (`modules/telephony/adapters/`):**
   - `TwilioAdapter`: Generates valid TwiML (`<Say language="te-IN">` and `<Gather>`), validates `X-Twilio-Signature`, and enforces prompt approval gating.
   - `SimulatorAdapter`: Drives the browser-based interactive mobile dialpad.
   - `MockTelephonyAdapter`: Supports headless unit testing.
4. **Regulatory Audio Gating:**
   - Unless `ALLOW_UNREVIEWED_PROMPTS=true` is explicitly set in development, any outbound Twilio call containing unapproved prompts is rejected with `AUDIO_PROMPT_NOT_APPROVED`.
   - Agronomist prompt review API implemented: `GET /api/v1/telephony/prompts` and `POST /api/v1/telephony/prompts/:promptCode/review`.
5. **Early Twilio Spike Script (`scripts/twilio-spike.ts`):**
   - Verifies Twilio account SID, auth token, caller ID, and verified recipient number.
   - Honestly reports missing environment variables without mock substitution.
   - Spins up local webhook server and ngrok tunnel to execute real outbound calls.
6. **Fortnightly Automated Scheduling & Concurrency Queue:**
   - Season activation automatically schedules fortnightly calls across the entire season duration.
   - Queue processor uses `FOR UPDATE SKIP LOCKED` inside transactions, safe from multi-worker race conditions.

#### Frontend Deliverables:
1. **Interactive Mobile Phone Call Simulator (`/demo/call-simulator`):**
   - Realistic mobile phone device with audio waves indicator, time display, and call duration timer.
   - Full 12-button keypad (`0-9`, `*`, `#`) with active DTMF dispatching.
   - Dual-language display: Large Telugu voice prompt with English translation underneath.
   - Real-time conversation transcript and DTMF log.
   - Live inspection cards detailing the automatically generated `farmer_feedback`, `irrigation_records`, and `action_items`.
   - Quick navigation links directly into Season Details and Action Queue.
2. **Audio Prompts & Agronomist Review Console:**
   - Review tab showing all 10 questions and system prompts with current review status.
   - Modal interface allowing agronomists and admins to certify prompts with review notes.

---

### Phase 4 Deliverables & Verifications

#### Backend Deliverables:
1. **Weather & Alerts Migration (`006_weather_alerts_communication.sql`):**
   - `weather_records`: Village-level observed and forecast daily records (`temp_max_c`, `precipitation_sum_mm`, `precipitation_probability_max`, `weather_code`, `et0_fao_evapotranspiration`, `source`, `is_forecast`, `is_demo`). Unique constraint: `(village_id, record_date, is_forecast)`.
   - `alert_rules`: Configurable IMD and agronomic rules with JSONB thresholds (`RULE_RAIN_EXPECTED`, `RULE_HEAVY_RAIN`, `RULE_THUNDERSTORM`, `RULE_HIGH_TEMP`, `RULE_DRY_SPELL`).
   - `weather_alerts`: Generated alerts with composite deduplication key (`dedup_key = village_id:rule_code:target_date`), bilingual headlines, and suggested actions.
   - `message_templates`: DLT-compliant bilingual templates (`SMS_WEATHER_ALERT`, `SMS_CALL_REMINDER`, `SMS_CALL_FALLBACK`, `SMS_MANUAL_ADVISORY`).
   - `communication_logs`: Append-only audit table logging every outbound SMS and voice attempt (`channel` in `'voice'`, `'sms'`).
   - Row-level security (RLS) enabled deny-by-default across all 5 tables.
2. **Meteorological Adapters (`modules/weather/adapters/`):**
   - `OpenMeteoAdapter`: Live forecast from Open-Meteo REST API (`Asia/Kolkata` timezone, FAO-56 reference $ET_0$, temperature, precipitation sum & probability, WMO code) with 8s abort timeout and archive fallback.
   - `MockWeatherAdapter`: Deterministic mock adapter for offline testing and demo mode tagged with `is_demo=true`, `source='mock'`.
3. **`WeatherService` In-Database Caching (`modules/weather/service.ts`):**
   - Caching layer obeying configurable `WEATHER_CACHE_TTL_MINUTES` (default 360 min = 6h).
   - Serves cached forecasts immediately when fresh, upserts fresh records, and auto-triggers `AlertEngine`.
4. **`AlertEngine` & Composite Deduplication (`modules/weather/AlertEngine.ts`):**
   - Evaluates forecast days against active threshold rules.
   - Idempotency guaranteed via composite key: `${village_id}:${rule_code}:${target_date}` with `ON CONFLICT (dedup_key) DO NOTHING`.
   - **Possibility Language:** All headlines and advisories enforce strict probabilistic wording ("expected / possible / అవకాశం") rather than certainty.
   - **Dry-Spell Scope:** Evaluates meteorological village dry spell (14+ dry days < 2.5mm + next 7 days forecast < 2.5mm); crop-stage agronomic moisture stress deferred to Phase 5 FAO-56 engine per DECISION-012.
   - Manual agricultural officer advisory publishing endpoint (`POST /api/v1/weather/alerts/manual`) strictly scoped to officer's assigned villages (`user_scopes`).
5. **`NotificationService` & Communication Guardrails (`modules/communication/NotificationService.ts`):**
   - **Voice Alerts:** Pre-recorded Telugu voice alerts dispatched via `sendVoiceAlert` with DTMF acknowledgement and logged as `channel='voice'`.
   - **Targeted Fan-Out:** Scoped strictly to farmers with an `active` season, an active primary contact, and explicit opt-in channel consent (`status = 'granted'`).
   - **Opt-In Requirement:** Absence of consent record or withdrawn consent blocks transmission (`error_reason: 'NO_CONSENT'`).
   - **Kill Switch:** Obeys `COMMUNICATIONS_ENABLED` (status: `blocked`, error: `KILL_SWITCH_ACTIVE`).
   - **Quiet Hours:** Restricts SMS to 07:00–21:00 IST; restricts voice calls to 09:00–18:00 IST (status: `blocked`, error: `QUIET_HOURS`).
   - **Daily Caps:** Restricts outbound SMS to max 2/day, and voice calls to max 1 call attempt per farmer per calendar day (status: `blocked`, error: `DAILY_CAP_EXCEEDED`).
   - **Dry-Run Mode:** Supports `DRY_RUN=true` without calling third-party APIs.

#### Frontend Deliverables:
1. **Interactive Weather & Alerts Hub (`/weather`):**
   - Village selector dropdown with live coordinate mapping.
   - Provider transparency badge: Open-Meteo Live API (Modelled) vs Mock Engine (DEMO).
   - 7-Day interactive forecast cards displaying max/min temps, rainfall amount, precipitation probability, weather icons, and FAO-56 reference $ET_0$.
   - Active village alerts list with bilingual Telugu/English headlines, severity badges, and actionable guidance.
   - Modal dialog for Agricultural Officers and Admins to publish custom bilingual advisories with immediate farmer broadcast.
   - Live append-only communication audit table showing status badges (`Sent`, `Delivered`, `Blocked`, `Failed`), channel (`Voice`, `SMS`), reasons, recipient phone, and timestamps.

---

### Phase 5 Deliverables & Verifications

#### Backend Deliverables:
1. **Water Analytics & Balance Schema Migration (`007_water_analytics_fao56.sql`):**
   - `season_daily_water_balance`: Daily water balances tracking stage $K_c$, reference $ET_0$, crop evapotranspiration $ET_c$, effective precipitation $P_{\text{eff}}$, farmer-reported applied water, percolation loss, ponding water depth, and unvalidated parameter flags.
   - `season_water_metrics`: Seasonal aggregates tracking total theoretical irrigation demand (L and mm), applied irrigation (L and mm), rainfall received, Water Use Ratio ($WUR$), indicative qualitative band (`below_estimate`, `near_estimate`, `above_estimate`), 4-pillar data confidence score (0–100), active anomaly flags, and serialized list of unvalidated assumptions.
   - `analytics_processing_queue`: Batch calculation queue with `FOR UPDATE SKIP LOCKED` row locking for multi-worker safety.
   - Added `notification_status` column and index on `weather_alerts` for high-throughput alert fan-out locking.
   - Row-level security (RLS) enabled deny-by-default on all new tables.
2. **Configurable Effective Rainfall Service (`modules/analytics/EffectiveRainfallService.ts`):**
   - Evaluates effective rainfall $P_{\text{eff}}$ using standard USDA Soil Conservation Service formula, loaded dynamically from `app_settings` (`effective_rainfall_method`).
   - Never hard-coded; falls back gracefully to USDA-SCS method if settings are unconfigured.
3. **FAO-56 Evapotranspiration Engine (`modules/analytics/Fao56Engine.ts`):**
   - Computes crop evapotranspiration $ET_c = K_c \times ET_0$.
   - Implements linear interpolation of $K_c$ across developmental crop stages.
   - Enforces parameter verification transparency: any unverified $K_c$ coefficient flags `verified = false` and appends an unvalidated assumption notice.
4. **Paddy Ponding Model (`modules/analytics/PaddyPondingModel.ts`):**
   - Flooded rice ponding water balance: $h_t = h_{t-1} + P_{\text{eff}} + I_t - ET_c - SP - D$ where $h_t$ is ponding depth, $SP$ is soil percolation/seepage, and $D$ is surface drainage overflow over bund height (typically 75mm).
   - Accounts for pre-saturation / puddling water requirements at transplanting.
5. **Indicative Qualitative Water Use Ratio (`modules/analytics/WaterUseRatioEngine.ts`):**
   - Calculates $WUR = \text{Total Applied Volume} / \text{Total Estimated Net Demand}$.
   - Classifies strictly into non-competitive qualitative bands: `below_estimate` ($WUR < 0.85$), `near_estimate` ($0.85 \le WUR \le 1.25$), `above_estimate` ($WUR > 1.25$).
   - **Zero Leaderboards / No Competitive Ranking:** System strictly forbids numerical ranking or "best farmer" leaderboards per DECISION-013.
6. **14-Day Fortnight Anomaly Reasoning (`modules/analytics/AnomalyEngine.ts`):**
   - **336-Hour Cycle Ceiling:** Evaluates cumulative pump running hours over the full 14-day cycle ($14 \times 24 = 336$ max physical hours across all pumps on plot). Flags `implausible_pump_hours` if reported hours exceed the operational ceiling of 280 hours.
   - **Rain-Irrigation Conflict:** Detects reported irrigation $>40\,\text{mm}$ on dates where observed rainfall exceeded $50\,\text{mm}$, flagging `rain_irrigation_conflict`.
   - Automatically routes unresolved anomalies to `action_items` as `type = 'suspicious_data'`.
7. **4-Pillar Data Confidence Scoring (`modules/analytics/DataConfidenceService.ts`):**
   - Multi-factor confidence score (0–100): Response Coverage (40%), Data Completeness (30%), Field Evidence (15%), Anomaly Consistency (15%).
   - Surfaced to users as a weighted breakdown with an overall confidence rating (`High`, `Moderate`, `Low`).
8. **PostgreSQL Row-Locking Test Harness (`scripts/verify-postgres-locking.ts`):**
   - Script runnable via `npm run test:locking` to verify concurrency safety of `FOR UPDATE SKIP LOCKED` against real PostgreSQL databases.

#### Frontend Deliverables:
1. **Water Analytics Dashboard (`/analytics?seasonId=...`):**
   - Season selector dropdown with quick season switcher.
   - **Unvalidated Assumptions Banner:** Highly visible amber warning banner prominently surfacing unverified agronomic assumptions to users and officers.
   - Indicative Water Use Ratio summary card with contextual qualitative band badges (`near_estimate`, `below_estimate`, `above_estimate`).
   - 4-Pillar Data Confidence scorecard with animated progress bars for each dimension.
   - Interactive daily and cumulative water balance chart (Recharts) visualizing $ET_c$ crop demand vs farmer-applied irrigation vs effective rainfall.
   - Flagged anomalies list linking to open action items.
   - Recalculate button triggering instantaneous on-demand recalculation.
2. **Deep-linking from Season Details:**
   - Added direct "Water Analytics (నీటి లెక్కలు)" navigation button to `SeasonDetailPage` header.

---

### Phase 6 Deliverables & Verifications

#### Backend Deliverables:
1. **Conservation Certificates Schema Migration (`008_conservation_certificates.sql`):**
   - `certificates` table: `id`, `certificate_code` (`JALAMITRA-YYYY-XXXXX`), `season_id`, `farmer_id`, `plot_id`, `crop_id`, `water_use_ratio`, `water_use_ratio_band`, `confidence_score`, `confidence_band`, `estimated_water_saved_litres`, `actual_harvest_date`, `yield_quantity`, `yield_unit`, `snapshot_data JSONB`, `sha256_hash`, `pdf_path`, `verification_token`, `is_revoked`, `revocation_reason`, `created_at`.
   - Enhanced `seasons` table with harvest completion tracking (`actual_harvest_date`, `actual_yield_quantity`, `actual_yield_unit`, `completion_notes`).
   - Row-level security (RLS) enabled deny-by-default on `certificates`.
2. **Deterministic Cryptographic Snapshot Service (`modules/certificates/SnapshotService.ts`):**
   - Constructs canonical JSON snapshots across farmer, plot, crop, weather, daily balances, water metrics, and unvalidated assumptions.
   - Recursive key sorting ensures identical deterministic output regardless of database serialization order.
   - Computes deterministic SHA-256 hash with tamper verification (`verifyIntegrity`).
3. **Bilingual PDFKit Certificate Generator (`modules/certificates/PdfCertificateService.ts`):**
   - Generates landscape A4 bilingual conservation certificates.
   - Embedded standalone TrueType Telugu fonts (`NotoSansTelugu-Regular.ttf` and `NotoSansTelugu-Bold.ttf`) in `backend/assets/fonts/`.
   - Embeds QR code pointing directly to public verification URL `/verify/:code`.
   - Displays Water Use Ratio qualitative band, 4-pillar data confidence score, SHA-256 seal, and prominent unvalidated assumptions disclosure box.
4. **Certificate Service & Harvest Closing Rules (`modules/certificates/service.ts`):**
   - Enforces strict season closing rules: cannot complete draft or cancelled seasons; harvest date cannot be future or prior to sowing date.
   - Executes final water balance recalculation and seals immutable snapshot.
   - Updates season state to `completed`.
   - Implements administrative revocation with mandatory audit rationale.
5. **Public & Authenticated Endpoints (`modules/certificates/routes.ts`):**
   - Public: `GET /api/v1/certificates/verify/:code` (open to public without auth, returns strictly 6 non-sensitive fields: certificate number, season, crop, village, issue date, valid/revoked status).
   - Authenticated: `GET /api/v1/certificates` (with AGRI_PANCHAYAT village scoping), `GET /:id`, `GET /:id/pdf`, `POST /seasons/:seasonId/issue`, `POST /:id/reissue`, `POST /:id/revoke` (ADMIN only), `GET /seasons/:seasonId/eligibility`, `GET /seasons/:seasonId/report`, `GET /seasons/:seasonId/report/pdf`.
6. **Certificate Eligibility Gating & Ineligible Season Reports (`season_reports`):**
   - Evaluates coverage $\ge 50\%$ and data confidence score $\ge 50$ (tier MEDIUM/HIGH), configured via `app_settings`.
   - Ineligible seasons produce a Seasonal Water Summary Report (`season_reports`), marking `seasons.certificate_status = 'ineligible'` and rendering an audit report PDF without awarding a Conservation Certificate.
7. **Certificate Reissuance Hierarchy (`replaces_certificate_id`):**
   - Tracks replacement lineage and increments versions (`v1`, `v2`, etc.).
   - Revokes prior certificates and links `replaces_certificate_id` and `replaced_by_certificate_id`. Partial unique index guarantees at most one active certificate per season.

#### Frontend Deliverables:
1. **Public Verification Portal (`/verify/:code`):**
   - Publicly accessible page with zero authentication required.
   - Green verified checkmark badge with certificate number.
   - Tamper-evident cryptographic SHA-256 validation badge.
   - Strictly limited to non-sensitive fields: Certificate Number, Season, Crop, Village, Issue Date, and Valid/Revoked Status.
   - Complete exclusion of farmer names, plot surveys, GPS coordinates, pump hours, or private confidence data.
2. **Authenticated Certificates Hub (`/certificates`):**
   - KPI metrics cards: Total Issued, Near Estimate Ratio, Avg Confidence, Active vs Revoked.
   - Search and filter bar by code, farmer, village, or status.
   - Certificate table with PDF download and public verification link.
   - Admin-only Revocation Modal with mandatory reason requirement.
3. **Harvest Completion & Ineligibility Handling (`/seasons/:id`):**
   - Harvest completion modal collects actual harvest date, yield, and completion notes.
   - If eligible: transitions season to `completed` and issues accredited Conservation Certificate.
   - If ineligible: transitions season to `completed`, shows prominent amber Ineligibility Banner detailing failing reasons, and offers immediate Seasonal Water Summary Report PDF download.

---

### Real vs Mock Status

| Component | Current State | Notes |
|---|---|---|
| **Database** | Real (PGlite local WASM / PostgreSQL Supabase) | Standard PostgreSQL syntax, migrations, JSONB, triggers, and row locking. |
| **Authentication & CSRF** | Real (bcryptjs + JWT HttpOnly Cookie + CSRF protection) | Fully implemented server-side with forced first-login password change. |
| **Farmers, Plots & Seasons** | Real | Stored in PostgreSQL/PGlite tables with frozen snapshot rules. |
| **CallFlowEngine & State Machine** | Real | Pure deterministic state machine covering 10 questions and skip rules. |
| **Browser Phone Simulator** | Real | Full interactive keypad with real-time feedback and downstream persistence. |
| **Twilio Live Telephony** | Real Adapter + Spike Ready | Real adapter with TwiML and signature verification; runnable via `npm run twilio:spike`. |
| **Weather Forecasts** | Real Open-Meteo Live API + Mock Fallback | Live Open-Meteo API with Asia/Kolkata timezone and FAO-56 ET0; deterministic mock fallback. |
| **Alert Engine & Deduplication** | Real | Rule evaluation against IMD thresholds with composite key deduplication. |
| **Communication, Voice & SMS** | Real NotificationService + Telephony/SMS Adapters | Pre-recorded Telugu voice alerts + SMS; full guardrails (opt-in consent, quiet hours, daily caps, kill switch). |
| **Water Balance & FAO-56 Engine** | Real | FAO-56 dual/single Kc, USDA-SCS effective rainfall, paddy ponding balance model, and confidence scoring. |
| **Row Locking & Concurrency Queue**| Real PostgreSQL Pattern | `FOR UPDATE SKIP LOCKED` across call dispatch, weather alerts, and analytics queue (`npm run test:locking`). |
| **Conservation Certificates** | Real | Immutable snapshots, canonical JSON SHA-256 seal, PDFKit with Noto Sans Telugu, PUBLIC_FRONTEND_URL QR codes, privacy filtering, eligibility gating, season reports, and reissuance hierarchy. |

---

### How to Run and Test Phase 6

#### 1. Backend Automated Tests (119/119 tests passing across all 6 phases):
```bash
cd backend
npm test
```

#### 2. Verify PostgreSQL Row Locking (against real Supabase / Postgres):
```bash
DIRECT_DATABASE_URL="postgres://..." npm run test:locking --prefix backend
```

#### 3. Start Application:
```bash
# Terminal 1: Backend
npm run dev --prefix backend

# Terminal 2: Frontend
npm run dev --prefix frontend
```
Navigate to:
- `http://localhost:5173/certificates` to view issued conservation certificates and download PDFs.
- `http://localhost:5173/verify/JALAMITRA-2026-00001` to test the public verification portal.

