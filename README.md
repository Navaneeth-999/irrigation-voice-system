# Voice-Driven Intelligent Irrigation Management & Seasonal Conservation Analytics System (JalaVani)

An end-to-end automated agro-climatic advisory and seasonal conservation analytics platform designed for smallholder farmers in Andhra Pradesh. The system computes daily crop water requirements using FAO-56 Penman-Monteith evapotranspiration calculations and real-time Open-Meteo forecasts, places automated Telugu voice calls to farmers' phones via Twilio, captures responses reliably via DTMF keypresses, and awards verifiable Water Conservation Certificates upon season completion.

---

## Architecture

| Layer | Technology | Rationale |
|---|---|---|
| **Frontend** | React (Vite) + Tailwind CSS | Fast, responsive dashboard with real-time calling feedback |
| **Backend** | Node.js + Express (ES Modules) | Robust Twilio Node SDK and TwiML VoiceResponse generation |
| **Database** | PostgreSQL (Supabase) + In-Memory Fallback | Direct Postgres relational schema with seamless local fallback |
| **Calling** | Twilio Programmable Voice | Reliable telephony with DTMF keypress capture (`<Gather>`) |
| **Telugu Voice** | Pre-generated Audio Files (`/public/audio/*.mp3`) | Zero-latency, reliable regional voice delivery over cellular voice |
| **Weather** | Open-Meteo API | Free, zero-setup real-time rainfall and FAO-56 Penman-Monteith $ET_0$ |
| **Water Logic** | FAO-56 $K_c \times ET_0$ (`cropWaterCalc.js`) | Defensible, textbook agricultural engineering formula |
| **Certificates**| PDFKit (`pdfService.js`) | Official Water Conservation Excellence PDF certificate generation |

---

## 5-Minute Faculty Demo Script

1. **Dashboard & Farmer Profile (0:00 – 0:45)**:
   - Open the dashboard at `http://localhost:3000`.
   - Show the active farmers list (Rice in Tenali, Chili in Guntur, Cotton in Mangalagiri).
   - Click **"Register Farmer"** to add a new farmer live with land area and verified phone number.

2. **FAO-56 Crop Water Requirement Logic (0:45 – 1:45)**:
   - Explain the calculation column:
     - Reference Evapotranspiration ($ET_0$) from Open-Meteo.
     - Crop coefficient ($K_c$) calibrated for Andhra Pradesh crop stages.
     - Crop Water Requirement ($ET_c = K_c \times ET_0$).
     - Effective Rainfall deduction ($I_{\text{net}} = \max(0, ET_c - P_{\text{forecast}})$).
     - Volumetric conversion: $1\text{ mm on } 1\text{ acre} = 4,046.86\text{ Liters}$.
   - Show the decision: If rain is forecast, irrigation is withheld to prevent waterlogging and conserve water.

3. **Live Outbound Phone Call (1:45 – 3:15) — The Highlight**:
   - Click **"Call Farmer"** next to your verified phone number.
   - Let your phone ring live in front of the faculty.
   - Answer the call: Listen to the clear Telugu advisory streamed from `/public/audio/irrigate_today.mp3`.
   - Press **`1`** on your keypad when prompted.
   - The call says "ధన్యవాదాలు" (Thank you) and hangs up.
   - The dashboard updates in real-time to show `Done (Pressed: 1)`.

4. **Seasonal Conservation Analytics & PDF Certificate (3:15 – 4:30)**:
   - Click **"Close Season"** on an active crop.
   - Switch to the **"Conservation Analytics"** tab.
   - Highlight the **Water Consumption Comparison Bar Chart** (Recommended vs Actual).
   - Click **"PDF Certificate"** to download and display the high-resolution, signed **Certificate of Water Conservation**.

5. **Future Roadmap & Q&A (4:30 – 5:00)**:
   - Explain the DTMF architectural decision: Open-ended ASR in regional dialects is prone to high error rates and latency in 2G rural networks; DTMF keypress provides 100% deterministic reliability today.
   - Roadmap: Phase 2 will introduce Telugu speech recognition via Bhashini / Google Cloud Speech-to-Text and SMS fallback.

---

## Quick Setup & Running Guide

### 1. Prerequisites
- Node.js (v18+)
- (Optional) Twilio Account & Phone Number
- (Optional) Supabase Project

### 2. Backend Setup
```bash
cd backend
npm install
node scripts/generate_audio.js
npm run test-calc # Runs automated test suite
npm start
```
The backend will run on `http://localhost:5000`.

### 3. Frontend Setup
```bash
cd frontend
npm install
npm run dev
```
The frontend will open on `http://localhost:3000`.

### 4. Setting up Real Phone Calling with Twilio & ngrok
1. In `backend/.env`, set your Twilio credentials:
   ```env
   TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   TWILIO_AUTH_TOKEN=yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy
   TWILIO_PHONE_NUMBER=+1xxxxxxxxxx
   ```
2. Start ngrok on port 5000:
   ```bash
   ngrok http 5000
   ```
3. Copy your forwarding URL (e.g. `https://xxxx-xx-xx.ngrok-free.app`) and set:
   ```env
   PUBLIC_BASE_URL=https://xxxx-xx-xx.ngrok-free.app
   ```
4. In the Twilio Console, ensure your mobile number is listed under **Verified Caller IDs**.
5. Register that number in the dashboard and click **"Call Farmer"**!
