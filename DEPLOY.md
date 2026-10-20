# HoloCollab EduMeet: Free-Tier Deployment Guide

This guide walks you through deploying the complete HoloCollab EduMeet application on 100% free-tier cloud infrastructure:
- **Backend**: Render Free Web Service (Python / FastAPI / Socket.IO ASGI)
- **Database**: Neon Serverless Postgres
- **Storage**: Supabase Storage (Public bucket for 3D `.glb` assets)
- **Frontend**: Vercel Free Hobby Tier (React / Vite SPA)
- **WebRTC TURN**: Open Relay / Metered.ca (Free TURN relay)
- **Keep-Alive**: UptimeRobot (Free ping to prevent Render cold-start sleeps)

---

## Environment Variables Reference Table

| Variable Name | Service | Example Value (Fake) | Is Secret? | Description |
|---|---|---|---|---|
| `ENVIRONMENT` | Render | `production` | No | Enables production guards (strict JWT, stack-trace masking) |
| `DATABASE_URL` | Render | `postgresql+asyncpg://neondb_owner:npg_xY81Ab@ep-dry-pond-12345.us-east-2.aws.neon.tech/neondb?ssl=require` | **YES** | Asyncpg Neon Postgres connection string with `ssl=require` |
| `JWT_SECRET` | Render | `8f219c0b1e4a39d84f0923e47a284615b8d2348a129034ef81726a0912345678` | **YES** | Secret key for signing participant auth tokens (min 32 chars) |
| `GEMINI_API_KEY` | Render | `AIzaSyB_fakeApiKeyExampleForGeminiAI481` | **YES** | Google AI Studio Gemini API key (kept strictly server-side) |
| `GEMINI_MODEL` | Render | `gemini-2.5-flash` | No | Gemini model name |
| `STORAGE_BACKEND` | Render | `supabase` | No | Switches file uploads from local disk to Supabase |
| `SUPABASE_URL` | Render | `https://abcdefghijklm.supabase.co` | No | Supabase project REST URL |
| `SUPABASE_KEY` | Render | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.fakeServiceRoleKey...` | **YES** | Supabase `service_role` secret API key for storage uploads |
| `SUPABASE_BUCKET` | Render | `models` | No | Public Supabase storage bucket name |
| `CORS_ORIGINS` | Render | `https://holocollab.vercel.app` | No | Comma-separated list of allowed frontend domain(s) |
| `FRONTEND_ORIGIN` | Render | `https://holocollab.vercel.app` | No | Primary frontend URL |
| `BASE_URL` | Render | `https://holocollab-backend.onrender.com` | No | Public backend URL on Render |
| `VITE_API_URL` | Vercel | `https://holocollab-backend.onrender.com` | No | Backend API root URL |
| `VITE_SOCKET_URL` | Vercel | `https://holocollab-backend.onrender.com` | No | Backend WebSocket root URL |
| `VITE_TURN_URL` | Vercel | `turn:openrelay.metered.ca:80` | No | WebRTC STUN/TURN server URL |
| `VITE_TURN_USER` | Vercel | `openrelayproject` | No | TURN authentication username |
| `VITE_TURN_PASS` | Vercel | `openrelayproject` | **YES** | TURN authentication credential |

---

## Step 1: Database Setup (Neon Serverless Postgres)

1. Sign up or log in at [Neon Console](https://console.neon.tech).
2. Click **Create Project**.
   - Project Name: `holocollab-db`
   - Region: Select the region closest to your Render service (e.g. `US East (Ohio)` or `US West (Oregon)`).
   - Postgres version: Default (16 or 15).
3. On the project dashboard, locate the **Connection Details** box.
4. Select the **Connection string** tab, and toggle the dropdown to **Connection string**.
5. Copy the URL string. It looks like:
   ```
   postgresql://alex:AbCd1234EfGh@ep-cool-fog-123456.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```
6. **IMPORTANT - Asyncpg URL Adjustment**:
   Change the prefix and SSL parameter:
   - Replace `postgresql://` with `postgresql+asyncpg://`
   - Replace `sslmode=require` with `ssl=require` (`asyncpg` rejects `sslmode=require`)
   Example formatted URL:
   ```
   postgresql+asyncpg://alex:AbCd1234EfGh@ep-cool-fog-123456.us-east-2.aws.neon.tech/neondb?ssl=require
   ```
   *(HoloCollab automatically normalizes `sslmode=require` to `ssl=require` if pasted directly).*

---

## Step 2: Storage Setup (Supabase Storage)

1. Sign up or log in at [Supabase](https://supabase.com).
2. Click **New Project**:
   - Name: `holocollab-storage`
   - Set a strong database password (store safely).
   - Region: Same or closest region.
3. Open the **Storage** section from the left sidebar navigation.
4. Click **New Bucket**:
   - Bucket Name: `models` (must match `SUPABASE_BUCKET`).
   - Toggle **Public bucket** to **ON** (allows browser direct GLTF downloading).
   - Click **Save**.
5. Go to **Project Settings** (gear icon) -> **API**:
   - Copy **Project URL** (e.g. `https://xxxx.supabase.co`) -> this is `SUPABASE_URL`.
   - Under **Project API keys**, copy the **`service_role` secret key** -> this is `SUPABASE_KEY`.

---

## Step 3: Backend Deployment (Render Free Web Service)

1. Sign up or log in at [Render](https://render.com).
2. Click **New +** -> **Web Service**.
3. Connect your GitHub repository containing the HoloCollab project.
4. Configure service settings:
   - **Name**: `holocollab-backend`
   - **Region**: Oregon or Ohio (closest to Neon & Supabase).
   - **Root Directory**: `backend`
   - **Runtime**: `Python 3`
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `uvicorn app.main:sio_app --host 0.0.0.0 --port $PORT`
   - **Instance Type**: `Free`
5. Open **Advanced** -> **Health Check Path**:
   - Enter: `/health`
6. Add the following **Environment Variables**:
   - `ENVIRONMENT`: `production`
   - `DATABASE_URL`: `postgresql+asyncpg://...` (from Step 1)
   - `JWT_SECRET`: Click "Generate" or paste a random 64-char string.
   - `GEMINI_API_KEY`: Paste your Google AI Studio API key.
   - `GEMINI_MODEL`: `gemini-2.5-flash`
   - `STORAGE_BACKEND`: `supabase`
   - `SUPABASE_URL`: `https://xxxx.supabase.co` (from Step 2)
   - `SUPABASE_KEY`: Supabase `service_role` key (from Step 2)
   - `SUPABASE_BUCKET`: `models`
   - `CORS_ORIGINS`: Temporary placeholder: `https://localhost:5173` (update in Step 5 after Vercel URL is known).
   - `FRONTEND_ORIGIN`: Same as above.
   - `BASE_URL`: `https://holocollab-backend.onrender.com` (your Render service URL).
7. Click **Create Web Service**. Wait for the build and initial health check to pass.

---

## Step 4: WebRTC TURN Server (Open Relay / Metered.ca)

1. Sign up at [Metered.ca Open Relay](https://www.metered.ca/tools/openrelay/).
2. On your dashboard, retrieve free TURN credentials:
   - Server URL: `turn:openrelay.metered.ca:80`
   - Username: `openrelayproject`
   - Password: `openrelayproject`
3. These values populate `VITE_TURN_URL`, `VITE_TURN_USER`, and `VITE_TURN_PASS` in the frontend.

---

## Step 5: Frontend Deployment (Vercel)

1. Sign up or log in at [Vercel](https://vercel.com).
2. Click **Add New...** -> **Project**.
3. Import your GitHub repository.
4. Configure project settings:
   - **Framework Preset**: `Vite`
   - **Root Directory**: Click "Edit" and choose `frontend`.
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
5. Expand **Environment Variables** and add:
   - `VITE_API_URL`: Your Render backend URL (e.g. `https://holocollab-backend.onrender.com`)
   - `VITE_SOCKET_URL`: Your Render backend URL (e.g. `https://holocollab-backend.onrender.com`)
   - `VITE_TURN_URL`: `turn:openrelay.metered.ca:80`
   - `VITE_TURN_USER`: `openrelayproject`
   - `VITE_TURN_PASS`: `openrelayproject`
6. Click **Deploy**.
7. Once deployed, copy your production domain (e.g., `https://holocollab-edu.vercel.app`).
8. **Update Render CORS**:
   - Go back to your Render Dashboard -> `holocollab-backend` -> **Environment**.
   - Update `CORS_ORIGINS` to `https://holocollab-edu.vercel.app`.
   - Update `FRONTEND_ORIGIN` to `https://holocollab-edu.vercel.app`.
   - Save changes (Render will trigger a quick zero-downtime redeploy).

---

## Step 6: Keep-Alive Ping (UptimeRobot)

Render free instances spin down after 15 minutes of inactivity. To prevent annoying 50-second cold starts during classes:

1. Sign up for free at [UptimeRobot](https://uptimerobot.com).
2. Click **Add New Monitor**:
   - Monitor Type: `HTTP(s)`
   - Friendly Name: `HoloCollab Render Health`
   - URL (or IP): `https://holocollab-backend.onrender.com/health`
   - Monitoring Interval: `Every 5 minutes`
3. Click **Create Monitor**. Render will now remain warm and responsive.

---

## Step 7: Smoke Test Checklist

- [ ] **Health Check**: Open `https://holocollab-backend.onrender.com/health` in your browser. Expect `{"status":"ok"}`.
- [ ] **SPA Routing**: Visit `https://holocollab-edu.vercel.app/login` directly and press browser Refresh. It should NOT 404.
- [ ] **User Registration & Login**: Register a new educator account and log in. JWT token should be returned without stack trace leakage.
- [ ] **Session Creation**: Create a session from Educator dashboard. Room code (6 characters) should be generated.
- [ ] **Realtime Socket.IO Connection**: Join the session lobby. Top bar should show green "Connected" status chip.
- [ ] **Single Camera & AR Rendering**: Turn on camera. Verify AR scene renders without permission errors and only 1 camera track is acquired.
- [ ] **GLTF Upload**: Upload a `.glb` model. Verify that:
  - Valid `.glb` files are saved to Supabase bucket `models`.
  - Fake `.glb` files without `glTF` magic header are rejected with a 400 error.
- [ ] **Collaborative Whiteboard & Chat**: Send a message and draw a stroke. Open in an incognito window as a guest and verify realtime synchronization.
- [ ] **Session Report**: End the session as the educator and view `/session/:id/report`. Verify attendance, rating, and AI insight render cleanly.

---

## Known Free-Tier Limits & Workarounds

| Service | Free-Tier Limit | Real-World Impact | Workaround |
|---|---|---|---|
| **Render Web Service** | Spins down after 15 mins idle; 750 free instance hours/month | Initial request takes 30-60s to wake up | UptimeRobot pings `/health` every 5 minutes. |
| **Neon Postgres** | 0.5 GB storage, autosuspends compute after 5 mins idle | Takes ~2 seconds to wake compute on first query | Keep alive queries or accept 2s connection latency. |
| **Supabase Storage** | 1 GB total storage, 2 GB bandwidth / month | Sufficient for ~50 complex 3D GLB models | Uploads capped at 25MB each with strict `.glb` magic byte validation. |
| **Google Gemini Free Tier** | 15 Requests Per Minute (RPM), 1500 RPD | Can hit 429 during large simultaneous class tests | In-memory 10-req/min rate limiter and cached report insights prevent quota exhaustion. |
