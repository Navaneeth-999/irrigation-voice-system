# Project Development Progress (`docs/PROGRESS.md`)

## Status Overview
- Current Phase: **PHASE 1: Foundation (COMPLETED & VERIFIED)**
- Next Phase: **PHASE 2: Seasons, Records, Feedback & Actions**
- Last Updated: 2026-09-24

---

### Phase Summary & Status

| Phase | Description | Status | Verification & Deliverables |
|---|---|---|---|
| **Pre-Flight** | Environment inspection, secrets scan, safe archiving | **DONE** | Node 26, Git initialized, `.gitignore` strictly enforced, secrets safely isolated. |
| **Phase 1** | Foundation, RBAC, Auth with CSRF, Farmers, Plots, Ref Data, Dashboard Shell | **DONE** | Migrations 001-003 applied, 19/19 automated tests passed, frontend built in 2.28s, committed. |
| **Phase 2** | Seasons, Snapshots, Irrigation Records, Feedback, Action Queue | PENDING | Lifecycle states, frozen snapshots, volume calculation service. |
| **Phase 3** | Call System, Telugu IVR, CallFlowEngine, Twilio Spike & Simulator | PENDING | Data-driven questionnaire, DTMF state machine, phone simulator. |
| **Phase 4** | Weather Service, Open-Meteo Adapter, Alert Engine, SMS | PENDING | Village forecasts, IMD alert rules, deduplication, NotificationService. |
| **Phase 5** | Water Analytics, FAO-56 Engine, Paddy Model, Data Confidence | PENDING | Kc stage tracking, water-use ratio, anomaly rules, Recharts dashboard. |
| **Phase 6** | Reports, Certificates, Immutable Snapshots, QR Verification | PENDING | PDFKit/Chromium with Noto Sans Telugu, public verification page. |
| **Phase 7** | Hardening, Playwright E2E 22-Step Demo, Deployment Runbooks | PENDING | Full test suite, demo reset script, deployment guides for Vercel/Render. |

---

### Phase 1 Deliverables & Verifications

#### Backend Deliverables:
1. **Migrations Framework & Core Schema:**
   - `001_access_and_system.sql`: `users`, `user_scopes`, `audit_logs` (with append-only trigger), `app_settings`.
   - `002_reference_data.sql`: `villages`, `crops`, `crop_stages`, `crop_model_parameters`, `water_source_types`, `irrigation_method_types`, `offices`.
   - `003_farmer_domain.sql`: `farmers`, `farmer_contacts`, `consents`, `plots`, `plot_water_sources`.
   - **RLS Baseline:** Row Level Security enabled on all 16 tables with deny-by-default for anonymous access.
2. **Database Engine Dual-Mode (`backend/src/db/index.ts`):**
   - Connects to Supabase / remote PostgreSQL via `DATABASE_URL`.
   - Zero-dependency local fallback via `@electric-sql/pglite` (persistent WASM PostgreSQL engine) ensuring full local operability without Docker.
3. **Authentication & RBAC:**
   - Secure HttpOnly cookie + JWT session.
   - Password hashing via `bcryptjs` (salt rounds 12).
   - Roles supported: `ADMIN`, `CSP_MEMBER`, `AGRI_PANCHAYAT`.
   - Scoped village filtering for `AGRI_PANCHAYAT`.
   - Phone number privacy masking (`+91 ****** 1234` for Panchayat role, unmasked with audit log for Admin/CSP).
4. **Security & CSRF Protection:**
   - Centralized `csrfProtection` middleware checking `X-Requested-With: XMLHttpRequest` or `X-CSRF-Token` on all mutating routes (`POST`, `PUT`, `PATCH`, `DELETE`).
   - `helmet` security headers, strict CORS, rate-limiting, and `errorHandler` with request correlation IDs.
5. **Farmer & Plot Domain Services:**
   - CRUD for farmers, primary contact normalization via `libphonenumber-js` (E.164).
   - Consents audit tracking (voice and SMS channels).
   - Plot management with multiple water sources, pump HP, and discharge rate (L/hr).
   - CSV bulk import with dry-run validation preview and row-level error reporting.
6. **Storage Provider:**
   - Interface `StorageProvider` with `LocalStorageAdapter` and `SupabaseStorageAdapter`.

#### Frontend Deliverables:
1. **Branded Agricultural Theme:**
   - Built on Tailwind CSS with forest greens, soil/amber accents, and water blue.
   - Noto Sans Telugu typography support integrated for bilingual clarity.
2. **Navigation & Application Shell (`AppLayout`):**
   - Sidebar navigation, demo banner, user role badge, and session logout.
   - Protected routes with role-based restrictions.
3. **Screens Implemented:**
   - `/login`: Branded login form with pre-filled local development credentials.
   - `/dashboard`: Live aggregated KPIs (farmers, active status, cultivated acres, water metrics) and recent farmers list.
   - `/farmers`: Searchable, filterable directory by village and status; Register Farmer modal; CSV bulk import modal with dry-run preview.
   - `/farmers/:id`: Comprehensive tabbed profile (Personal, Contacts, Plots, Consents, Audit history) with inline Add Plot modal.
   - `/plots`: Global parcels view showing area, soil type, tenure, and water source breakdown with pump specs.

---

### Real vs Mock Status

| Component | Current State | Notes |
|---|---|---|
| **Database** | Real (PGlite local WASM / PostgreSQL Supabase) | Real PostgreSQL syntax, migrations, JSONB, and triggers in both modes. |
| **Authentication** | Real (bcryptjs + JWT HttpOnly Cookie + CSRF protection) | Fully implemented server-side. |
| **Farmers & Plots** | Real | Stored in PostgreSQL/PGlite tables with foreign keys and constraints. |
| **Storage** | Local disk adapter active / Supabase Storage adapter configured | Audio, PDFs, and voice notes stored with proper access tiers. |
| **Open-Meteo Weather** | Verified live network access | Real live API tested for AP coordinates (16.5, 80.6). Scheduled for Phase 4. |
| **Telephony / Twilio** | Mock Adapter active / Twilio Adapter configured | Early live spike scheduled for Phase 3. |
| **SMS** | Mock Adapter active | Indian DLT compliance documented; mock for college demo. |

---

### How to Run and Test Phase 1

#### 1. Backend:
```bash
cd backend

# Run typecheck
npm run typecheck

# Run automated tests (19/19 tests)
npm test

# Run migrations and seed reference data manually if needed
npm run migrate
npm run seed:reference
npm run create-admin

# Start backend development server
npm run dev
# Server boots on http://localhost:4000
# Health check: http://localhost:4000/healthz
# Readiness check: http://localhost:4000/readyz
```

#### 2. Frontend:
```bash
cd frontend

# Build frontend
npm run build

# Start frontend development server
npm run dev
# Frontend boots on http://localhost:5173
```

#### 3. Default Credentials:
- **Email:** `admin@csp-irrigation.org`
- **Password:** `ChangeMeAdmin123!`
- **Role:** `ADMIN`
