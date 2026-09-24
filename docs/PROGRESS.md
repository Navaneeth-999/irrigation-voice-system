# Project Development Progress (`docs/PROGRESS.md`)

## Status Overview
- Current Phase: **PHASE 3: Call System, Telugu IVR, CallFlowEngine & Simulator (COMPLETED & VERIFIED)**
- Next Phase: **PHASE 4: Weather, Alerts & Communication**
- Last Updated: 2026-09-24

---

### Phase Summary & Status

| Phase | Description | Status | Verification & Deliverables |
|---|---|---|---|
| **Pre-Flight** | Environment inspection, secrets scan, safe archiving | **DONE** | Node 26, Git initialized, `.gitignore` strictly enforced, secrets safely isolated. |
| **Phase 1** | Foundation, RBAC, Auth with CSRF, Farmers, Plots, Ref Data, Dashboard Shell | **DONE** | Migrations 001-003 applied, 24/24 automated tests passed, frontend built cleanly. |
| **Phase 2** | Seasons, Snapshots, Irrigation Records, Feedback, Action Queue | **DONE** | Migration 004 applied, frozen snapshot rule verified by mutation test, 18/18 tests passed. |
| **Phase 3** | Call System, Telugu IVR, CallFlowEngine, Twilio Spike & Simulator | **DONE** | Migration 005 applied, 10 Telugu questions, pure state machine, audio gating, 18/18 tests passed (60/60 total). |
| **Phase 4** | Weather Service, Open-Meteo Adapter, Alert Engine, SMS | PENDING | Village forecasts, IMD alert rules, deduplication, NotificationService. |
| **Phase 5** | Water Analytics, FAO-56 Engine, Paddy Model, Data Confidence | PENDING | Kc stage tracking, water-use ratio, anomaly rules, Recharts dashboard. |
| **Phase 6** | Reports, Certificates, Immutable Snapshots, QR Verification | PENDING | PDFKit with Noto Sans Telugu, SHA-256 hash, public verification page. |
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

### Real vs Mock Status

| Component | Current State | Notes |
|---|---|---|
| **Database** | Real (PGlite local WASM / PostgreSQL Supabase) | Standard PostgreSQL syntax, migrations, JSONB, triggers, and row locking. |
| **Authentication & CSRF** | Real (bcryptjs + JWT HttpOnly Cookie + CSRF protection) | Fully implemented server-side with forced first-login password change. |
| **Farmers, Plots & Seasons** | Real | Stored in PostgreSQL/PGlite tables with frozen snapshot rules. |
| **CallFlowEngine & State Machine** | Real | Pure deterministic state machine covering 10 questions and skip rules. |
| **Browser Phone Simulator** | Real | Full interactive keypad with real-time feedback and downstream persistence. |
| **Twilio Live Telephony** | Real Adapter + Spike Ready | Real adapter with TwiML and signature verification; runnable via `npm run twilio:spike`. |
| **Weather & Alerts** | Verified live network access | Scheduled for Phase 4. |

---

### How to Run and Test Phase 3

#### 1. Backend Automated Tests (60/60 tests passing):
```bash
cd backend
npm test
```

#### 2. Twilio Spike Pre-Flight Check:
```bash
npm run twilio:spike --prefix backend
```

#### 3. Interactive Browser Call Simulator:
1. Start backend: `npm run dev --prefix backend` (port 4000)
2. Start frontend: `npm run dev --prefix frontend` (port 5173)
3. Open browser at `http://localhost:5173/demo/call-simulator`
4. Select active season, click "Start Telugu Voice Call", and use the dialpad to step through questions.
