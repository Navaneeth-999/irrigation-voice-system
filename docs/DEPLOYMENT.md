# Jalamitra — Production Deployment & Operations Runbook

This guide describes the complete, production-grade deployment procedures for the **Jalamitra Voice-Driven Intelligent Irrigation Management & Seasonal Conservation Analytic System (B.Tech CSP)**.

---

## 1. System Architecture Overview

```
                      +-----------------------------+
                      |   Farmers & Telephony       |
                      |   (PSTN / Mobile Network)   |
                      +--------------+--------------+
                                     |
                                     | Voice / DTMF / SMS
                                     v
                            +-----------------+
                            | Twilio Telecom  |
                            +--------+--------+
                                     |
                                     | HTTPS Webhooks
                                     v
+-----------------------+   +------------------------------------+
|  Frontend Application |   |  Backend API & Telephony Engine    |
|  (Vercel / Netlify)   +-->+  (Render / Fly.io / AWS ECS)       |
|  React 18 + Vite SPA  |   |  Node.js / Express / TypeScript    |
+-----------------------+   +-----------------+------------------+
                                              |
                                              | TLS / Connection Pool
                                              v
                            +------------------------------------+
                            |  Supabase Managed PostgreSQL       |
                            |  (Session Pooler: Port 5432)       |
                            +------------------------------------+
```

---

## 2. Database Infrastructure (Supabase Managed PostgreSQL)

### 2.1 Pooler Host & IPv4 Architecture
Supabase direct connection hosts (`db.<project-ref>.supabase.co:5432`) only resolve via IPv6. Production Node.js container environments (and many cloud VPCs) require IPv4 connectivity.
Always connect through the **Supabase Session Pooler host**:

- **Host**: `aws-0-<region>.pooler.supabase.com`
- **Port**: `5432`
- **Database**: `postgres`
- **Username**: `postgres.<project-ref>`
- **Password**: `<YOUR_DATABASE_PASSWORD>`
- **SSL**: Enabled (`ssl: { rejectUnauthorized: false }`)

### 2.2 Connection String Matrix
| Variable | Environment | Example / Value | Purpose |
| :--- | :--- | :--- | :--- |
| `DATABASE_URL` | Production / Staging | `postgresql://postgres.<ref>:<pass>@aws-0-<region>.pooler.supabase.com:5432/postgres` | Primary application pool |
| `DIRECT_DATABASE_URL` | Migrations / CLI | `postgresql://postgres.<ref>:<pass>@aws-0-<region>.pooler.supabase.com:5432/postgres` | Direct connection for schema migrations |

### 2.3 Running Database Migrations
Migrations are managed in `backend/migrations/` (migrations `001` through `009`).
Execute migrations prior to starting application pods:
```bash
npm run migrate --prefix backend
```
The migration runner checks the `schema_migrations` audit table and idempotently applies new migration files in strict sequential order.

### 2.4 Restoring Baseline Demo Data
To reset or re-seed the standard demonstration dataset for evaluation:
```bash
npm run demo:reset --prefix backend
```

---

## 3. Backend Deployment (Render / Fly.io / AWS ECS)

### 3.1 Node Engine & Build
- **Node.js Version**: `>= 20.0.0`
- **Build Command**: `npm run build` (runs `tsc`)
- **Start Command**: `npm run start` (runs `node dist/server.js`)

### 3.2 Required Production Environment Variables
Set the following environment variables in your hosting provider's dashboard:

```env
# Runtime
NODE_ENV=production
PORT=4000
TZ=Asia/Kolkata
LOG_LEVEL=info

# Database
DATABASE_URL=postgresql://postgres.<ref>:<pass>@aws-0-<region>.pooler.supabase.com:5432/postgres
DIRECT_DATABASE_URL=postgresql://postgres.<ref>:<pass>@aws-0-<region>.pooler.supabase.com:5432/postgres

# Security & Sessions
JWT_SECRET=super_secret_production_key_minimum_32_characters_random
JWT_EXPIRES_IN=8h
COOKIE_SECURE=true
COOKIE_SAMESITE=lax
CORS_ALLOWED_ORIGINS=https://jalamitra.yourdomain.org,https://app.jalamitra.org
PUBLIC_BASE_URL=https://api.jalamitra.org
PUBLIC_FRONTEND_URL=https://jalamitra.yourdomain.org

# Bootstrap Admin
ADMIN_BOOTSTRAP_EMAIL=admin@csp-irrigation.org
ADMIN_BOOTSTRAP_PASSWORD=StrongAdminPassword2026!

# Operational Modes
DEMO_MODE=false
ALLOW_DEMO_ENDPOINTS=false
COMMUNICATIONS_ENABLED=true
DRY_RUN=false

# Telephony (Twilio Production)
TELEPHONY_PROVIDER=twilio
SMS_PROVIDER=twilio
TWILIO_ACCOUNT_SID=ACXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
TWILIO_AUTH_TOKEN=your_twilio_auth_token_here
TWILIO_PHONE_NUMBER=+1XXXXXXXXXX
```

> [!CAUTION]
> **Production Fail-Fast Check**: When `NODE_ENV=production`, the application immediately halts on startup if `JWT_SECRET` is missing or equal to the development default, or if `ADMIN_BOOTSTRAP_PASSWORD` uses the default development password.

### 3.3 Health & Liveness Probes
Configure container orchestrators (Kubernetes, AWS ECS, Fly.io, or Render) with:
- **Liveness Probe**: `GET /healthz` (checks process uptime)
- **Readiness Probe**: `GET /readyz` (verifies live PostgreSQL connectivity with `SELECT 1`)
- **Monitoring Alias**: `GET /api/v1/health`

---

## 4. Frontend Deployment (Vercel / Netlify / Cloudflare Pages)

### 4.1 Build Configuration
- **Framework Preset**: Vite
- **Root Directory**: `frontend`
- **Build Command**: `npm run build` (executes `tsc && vite build`)
- **Output Directory**: `dist`
- **Node Version**: `20.x`

### 4.2 Single Page Application (SPA) Routing Configuration
For Vercel (`frontend/vercel.json`):
```json
{
  "rewrites": [
    {
      "source": "/api/:path*",
      "destination": "https://api.jalamitra.org/api/:path*"
    },
    {
      "source": "/storage/:path*",
      "destination": "https://api.jalamitra.org/storage/:path*"
    },
    {
      "source": "/(.*)",
      "destination": "/index.html"
    }
  ]
}
```

For Netlify (`frontend/netlify.toml`):
```toml
[[redirects]]
  from = "/api/*"
  to = "https://api.jalamitra.org/api/:splat"
  status = 200
  force = true

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

---

## 5. Telephony & Webhook Configuration (Twilio)

### 5.1 Voice Webhook URLs
In the [Twilio Console](https://console.twilio.com) under **Phone Numbers > Manage > Active Numbers**:

1. **A Call Comes In**:
   - Webhook: `HTTP POST`
   - URL: `https://api.jalamitra.org/api/v1/telephony/twiml/incoming`
2. **Call Status Changes (Call Status Callback)**:
   - Webhook: `HTTP POST`
   - URL: `https://api.jalamitra.org/api/v1/telephony/twiml/status`
   - Events: `initiated`, `ringing`, `answered`, `completed`

### 5.2 India TRAI / DLT Regulations for SMS
- In compliance with Indian telecom regulations (TRAI), transactional SMS messages dispatched to Indian farmers (+91) must be registered with a Distributed Ledger Technology (DLT) platform (e.g., Vilpower, PingConnect).
- In the `message_templates` database table, verify `dlt_template_id` matches your registered DLT header and template ID before enabling `SMS_PROVIDER=twilio`.

---

## 6. Cryptographic Certificate System & Verification

### 6.1 Public Verification Endpoint
- Public route: `/verify/:code` (e.g. `https://jalamitra.yourdomain.org/verify/JALAMITRA-2026-00001`)
- **Zero-PII Compliance**: Per the project data protection audit, this page displays **only**:
  1. Certificate Code
  2. Cultivation Season
  3. Crop Name
  4. Village Name
  5. Issue Date
  6. Status (VALID / REVOKED)
- Under no circumstances does this endpoint render farmer full name, phone number, land survey coordinates, or raw sensor telemetry.

### 6.2 SHA-256 Immutability Check
The backend verifies the tamper-evident integrity of any certificate snapshot using:
```bash
GET /api/v1/certificates/verify/:code
```
This recomputes the SHA-256 digest of the canonical snapshot JSON and compares it against the stored `sha256_hash`.

---

## 7. Operational Troubleshooting & Runbook Commands

| Action | Command / Procedure |
| :--- | :--- |
| **Verify PostgreSQL Concurrency Locking** | `npm run test:locking --prefix backend` |
| **Check Database Connection** | `curl -f https://api.jalamitra.org/readyz` |
| **Reset Demo Database to Benchmark** | `npm run demo:reset --prefix backend` |
| **Run Backend Unit & Integration Tests** | `npm test --prefix backend` |
| **Run E2E Playwright Suite** | `npm run test:e2e --prefix frontend` |
| **Generate Production Build** | `npm run build --prefix backend && npm run build --prefix frontend` |
