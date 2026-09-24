# Telephony & Telugu Voice Engine Setup Guide (`docs/TELEPHONY_SETUP.md`)

This guide explains the architecture, configuration, testing, and operational procedures for the Voice Driven Intelligent Irrigation Management System's IVR subsystem.

---

## 1. Subsystem Architecture

The telephony subsystem delivers automated, interactive voice calls to rural farmers across Andhra Pradesh. It collects bi-weekly (fortnightly) field conditions in Telugu and translates farmer DTMF keypad entries into structured database records.

```
                           ┌───────────────────────────────┐
                           │   Active Agricultural Season   │
                           │ (Sowing Date + Fortnight Cycle│
                           └───────────────┬───────────────┘
                                           │ Auto-Schedule
                                           ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           `call_schedule` Queue Table                           │
│  - Scheduled Date (Fortnightly)                                                 │
│  - Due Window (±3 days)                                                         │
│  - Allowed Calling Window: 09:00 - 18:00 IST                                    │
│  - Status: scheduled | in_progress | completed | failed | opted_out             │
└──────────────────────────────────────────┬──────────────────────────────────────┘
                                           │ `FOR UPDATE SKIP LOCKED`
                                           ▼
                            ┌──────────────────────────────┐
                            │    Telephony Dispatcher      │
                            └──────────────┬───────────────┘
                                           │
                    ┌──────────────────────┴──────────────────────┐
                    │                                             │
                    ▼                                             ▼
       ┌────────────────────────┐                    ┌────────────────────────┐
       │   Simulator Adapter    │                    │     Twilio Adapter     │
       │ (Browser /demo/sim)    │                    │ (Live PSTN Outbound)   │
       └────────────┬───────────┘                    └────────────┬───────────┘
                    │                                             │
                    └──────────────────────┬──────────────────────┘
                                           │
                                           ▼
                        ┌─────────────────────────────────────┐
                        │      `CallFlowEngine` State Machine │
                        │  - Pure, deterministic, provider-   │
                        │    neutral state engine             │
                        │  - Handles 10 Telugu questions      │
                        │  - Skip branching & opt-out rules   │
                        └──────────────────┬──────────────────┘
                                           │ Call Completed
                                           ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        Atomic Downstream Record Creation                        │
│ 1. `farmer_feedback`: source = 'ivr' | 'simulator', rainfall, condition, issues │
│ 2. `irrigation_records`: estimated volume = pump hours × discharge rate (Litres)│
│ 3. `action_items`: deduplicated open items (shortage, pest outbreak, callback)  │
│ 4. `call_schedule`: marked as 'completed'                                       │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Environment Variables & Safe Credential Protocol

To protect personal and institutional Twilio accounts, **zero raw secrets must be committed or printed in logs**. The system inspects environment variables and reports only `present` or `absent`.

Configure `backend/.env`:

```env
# Twilio Voice API Credentials
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token_here
TWILIO_PHONE_NUMBER=+1xxxxxxxxxx
VERIFIED_TEST_NUMBER=+91xxxxxxxxxx

# Safety Gating: If false, unapproved audio prompts cannot be dispatched on real lines
ALLOW_UNREVIEWED_PROMPTS=false
```

---

## 3. Early Twilio Spike (Real Call via ngrok)

The repository includes a dedicated spike script to verify end-to-end PSTN voice calling through Twilio and an ngrok tunnel. As mandated by the CSP guidelines, **no mock is ever substituted for this spike**.

### How to Run:
```bash
# 1. Ensure your Twilio credentials and verified number are in backend/.env
# 2. Run the spike command
npm run twilio:spike --prefix backend
```

### Pre-Flight Behavior:
1. If any credential is missing, the script halts and honestly reports the blocker:
   ```text
   ====================================================
     Early Twilio Telephony Spike: Pre-Flight Check    
   ====================================================
   Environment Credential Status:
     TWILIO_ACCOUNT_SID   : absent
     TWILIO_AUTH_TOKEN     : absent
     TWILIO_PHONE_NUMBER   : absent
     VERIFIED_TEST_NUMBER  : absent
   ----------------------------------------------------
   ❌ BLOCKER DETECTED (Honest Reporting):
   Missing required Twilio environment variables.
   As instructed by the master prompt, NO mock will be substituted for this spike.
   ```
2. When all credentials are present:
   - Starts an internal HTTP server on port 4005.
   - Spawns an `ngrok` tunnel to create a public HTTPS URL.
   - Triggers `client.calls.create` to call `VERIFIED_TEST_NUMBER`.
   - Serves Telugu TwiML with `<Say language="te-IN">` and logs call status callbacks.
   - Automatically kills the ngrok process and cleans up on completion.

---

## 4. The 10-Question Telugu Questionnaire Specification

All 10 steps are implemented in `backend/src/modules/telephony/CallFlowEngine.ts` and seeded in `005_telephony_voice_engine.sql`:

| Step | Code | Telugu Voice Prompt | English Meaning | Valid Inputs | Branching / Notes |
|---|---|---|---|---|---|
| 1 | `intro` | నమస్కారం! మీ పంట నీటిపారుదల సమాచారం కొరకు ఈ కాల్. కాల్ కొనసాగించడానికి ఏదైనా అంకె నొక్కండి. భవిష్యత్తులో కాల్స్ ఆపడానికి 9 నొక్కండి. | Greeting! Irrigation feedback call. Press any key to continue. Press 9 to stop calls. | `0-9`, `*` | Pressing `9` initiates immediate opt-out. `*` repeats. Any other key advances to Step 2. |
| 2 | `rain` | గత 14 రోజులలో మీ పొలంలో వర్షం ఎలా కురిసింది? వర్షం లేకపోతే 0, స్వల్ప వర్షం అయితే 1, మోస్తరు వర్షం అయితే 2, భారీ వర్షం అయితే 3 నొక్కండి. | How was rainfall in the last 14 days? 0=none, 1=light, 2=moderate, 3=heavy. | `0, 1, 2, 3` | Maps to `none`, `light`, `moderate`, `heavy`. `*` repeats. |
| 3 | `irrigated` | గత 14 రోజులలో మీరు పొలానికి నీరు పెట్టారా? అవును అయితే 1, లేదు అయితే 2 నొక్కండి. | Did you irrigate your field in the last 14 days? 1=Yes, 2=No. | `1, 2` | **Skip Rule:** If `2` (No), skips Steps 4 & 5 directly to Step 6! Sets pump hours to 0. |
| 4 | `irrigation_count` | గత 14 రోజులలో ఎన్ని సార్లు నీరు పెట్టారు? సంఖ్యను నొక్కి # నొక్కండి. | How many times did you irrigate? Enter number and press #. | `1-30` + `#` | Range 1 to 30. |
| 5 | `hours` | ఒక్కో తడికి సగటున మోటార్ ఎన్ని గంటలు నడిపారు? గంటల సంఖ్యను నొక్కి # నొక్కండి. | How many hours did the pump run per irrigation? Enter hours and press #. | `1-99` + `#` | **Opt-Out Rule:** 9 here means 9 pump hours, **NEVER** an opt-out. |
| 6 | `crop_condition` | మీ ప్రస్తుత పంట పరిస్థితి ఎలా ఉంది? బాగుంటే 1, సాధారణంగా ఉంటే 2, బాగోలేకపోతే 3 నొక్కండి. | Current crop condition: 1=Good, 2=Average, 3=Poor. | `1, 2, 3` | If `3` (poor), triggers `crop_condition_poor` action item. |
| 7 | `stage_confirmation` | వ్యవసాయ శాఖ అంచనా ప్రకారం మీ పంట ప్రస్తుతం పెరుగుదల దశలో ఉంది. ఇది సరైనదేనా? అవును అయితే 1, కాదు అయితే 2 నొక్కండి. | Is the crop in the expected growth stage? 1=Yes, 2=No. | `1, 2` | Records stage confirmation. |
| 8 | `water_problem` | నీటి లభ్యతలో ఏమైనా సమస్య ఉందా? సమస్య లేకపోతే 0, నీటి కొరత అయితే 1, మోటార్ లేదా కరెంట్ సమస్య అయితే 2, నీటి వనరు ఎండిపోతే 3 నొక్కండి. | Any water problems? 0=none, 1=shortage, 2=motor/power, 3=source dry. | `0, 1, 2, 3` | Non-zero values trigger `water_shortage`, `pump_power_problem`, or `source_unavailable` action items. |
| 9 | `crop_problem` | పంటలో ఏమైనా ఇతర సమస్యలు ఉన్నాయా? సమస్య లేకపోతే 0, తెగుళ్లు లేదా పురుగు అయితే 1, ఆకులు పసుపుపచ్చగా మారడం లేదా ఎండిపోవడం అయితే 2, ఇతర సమస్య అయితే 3 నొక్కండి. | Any crop problems? 0=none, 1=pests/disease, 2=yellowing/drying, 3=other. | `0, 1, 2, 3` | Non-zero values trigger `crop_pest_disease` action items. |
| 10 | `callback_requested` | వ్యవసాయ అధికారి లేదా వాలంటీర్ మీతో మాట్లాడాలని కోరుకుంటున్నారా? అవును అయితే 1, లేదు అయితే 2 నొక్కండి. | Would you like an agronomist or volunteer to call you back? 1=Yes, 2=No. | `1, 2` | If `1`, triggers `callback_requested` action item. |
| 99 | `goodbye` | మీ అమూల్యమైన సమాచారానికి ధన్యవాదాలు. మీ వివరాలు నమోదు చేయబడ్డాయి. భవిష్యత్తులో కాల్స్ ఆపడానికి 9 నొక్కండి. శుభం! | Thank you for your feedback. Recorded. Press 9 to opt out. Goodbye! | `9` (opt-out) or hang up | Terminates call and persists all records. |

---

## 5. Regulatory Safety Gating for Audio Prompts

To prevent unverified or inappropriate audio content from reaching farmers, the system enforces a strict certification gate:
1. Every prompt in `audio_prompts` table has a `review_status` column:
   - `draft` (initial script or TTS placeholder)
   - `recorded` (voice talent audio file attached)
   - `reviewed_agronomist` (verified by agronomist for agricultural terminology)
   - `approved` (certified by admin for outbound broadcast)
   - `rejected` (requires revision)
2. `TwilioAdapter.assertApprovedPrompts(promptCodes)`:
   - Unless `ALLOW_UNREVIEWED_PROMPTS=true` is explicitly set in development, any attempt to dispatch real outbound phone calls containing unapproved prompts throws:
     `AUDIO_PROMPT_NOT_APPROVED: Prompt '...' has status 'draft'. Real calls require 'approved' status.`
3. Authorized staff (`ADMIN` or `CSP_MEMBER`) can certify prompts directly from the **Audio Prompts & Review Console** tab on the Call Simulator page or via `POST /api/v1/telephony/prompts/:promptCode/review`.

---

## 6. Interactive Browser Call Simulator (`/demo/call-simulator`)

For faculty presentations, student CSP demonstrations, and offline testing without consuming Twilio telephony credits, the application provides an interactive mobile phone interface:
- **Location:** Accessible at `http://localhost:5173/demo/call-simulator`
- **Features:**
  - Select any active farmer season and phone number.
  - Realistic dialpad with 12 buttons (`0-9`, `*`, `#`).
  - Active audio pulsing animation when the system speaks Telugu.
  - Live bilingual display of current Telugu script and English translation.
  - "Simulate Timeout" button to verify silence retry behavior.
  - Real-time conversation transcript and DTMF key log.
  - Live inspection banner confirming generated `farmer_feedback`, `irrigation_records`, and `action_items`.

---

## 7. Webhook Security & Idempotency

When configured with live Twilio phone numbers:
1. **Voice URL:** Set Twilio Voice webhook to `https://your-domain.com/api/v1/webhooks/twilio/voice` (HTTP POST).
2. **Status Callback:** Set Twilio Call Status Callback to `https://your-domain.com/api/v1/webhooks/twilio/status` (HTTP POST).
3. **Signature Verification:** Requests outside `NODE_ENV=test` are validated using `twilio.validateRequest(authToken, signature, fullUrl, req.body)` against the `X-Twilio-Signature` header.
4. **Idempotency:** Inbound callbacks are recorded in `provider_webhook_events` with unique event IDs. Duplicate webhooks sent by Twilio are immediately recognized and safely acknowledged with HTTP 200 without duplicate processing.

---

## 8. Scheduler Concurrency with `FOR UPDATE SKIP LOCKED`

The dispatch job processes scheduled calls in batches:
```sql
SELECT id, season_id, farmer_id, phone_e164, cycle_number, attempt_count, max_attempts
FROM call_schedule
WHERE status = 'scheduled'
  AND scheduled_date <= CURRENT_DATE
  AND attempt_count < max_attempts
ORDER BY scheduled_date ASC
LIMIT 10
FOR UPDATE SKIP LOCKED;
```
- In multi-worker or cloud production environments, `FOR UPDATE SKIP LOCKED` guarantees that no two workers ever dial the same farmer simultaneously.
- If a call fails 2 consecutive times across cycles, an action item `consecutive_call_failure` is automatically generated for field volunteer follow-up.
