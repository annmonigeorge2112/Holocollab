# HoloCollab Deployment Runbook & Operational Guide

## 1. Environment Variables Checklist

### Frontend (`frontend/.env.production` or Vercel / Render / Cloudflare Pages Dashboard)
| Variable | Expected Value / Format | Purpose |
| :--- | :--- | :--- |
| `VITE_API_URL` | `https://<backend-host>/api` or `https://<backend-host>` | REST API Base URL. |
| `VITE_SOCKET_URL` | `https://<backend-host>` (omit path; never `localhost`) | Socket.IO endpoint. SocketManager automatically connects with path `/socket.io` and transports `['websocket', 'polling']`. |

### Backend (`backend/.env` or Render / Fly.io / Railway Dashboard)
| Variable | Expected Value / Format | Purpose |
| :--- | :--- | :--- |
| `JWT_SECRET` | 32+ character random string | Signs user authentication tokens. |
| `CORS_ORIGINS` | Comma-separated client URLs (e.g. `https://holocollab.vercel.app,http://localhost:5173`) | Used for both FastAPI REST and python-socketio CORS origins. |
| `DATABASE_URL` | `postgresql+asyncpg://...` or default `sqlite+aiosqlite:///./holocollab.db` | Async SQLAlchemy database URI. |
| `GEMINI_API_KEY` | Google Gemini API Key | AI session summaries & quiz generation. |
| `ENVIRONMENT` | `production` (or `development` / `test`) | Environment selector. |

---

## 2. Render & Vercel Deployment Settings

### Render (Backend Web Service)
- **Runtime**: Python 3.11+
- **Build Command**: `pip install -r requirements.txt`
- **Start Command**: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- **Health Check Path**: `/health` or `/`
- **CORS Notice**: Set `CORS_ORIGINS` to your production frontend Vercel URL (e.g. `https://holocollab.vercel.app`).

### Vercel (Frontend Static / SPA)
- **Framework Preset**: Vite
- **Root Directory**: `frontend`
- **Build Command**: `npm run build`
- **Output Directory**: `dist`
- **SPA Rewrites (`vercel.json`)**: Ensure client routing rewrites all routes to `/index.html`:
```json
{
  "rewrites": [
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```

---

## 3. CORS & WebSocket Headers Configuration

- FastAPi CORS middleware and `socketio.AsyncServer(cors_allowed_origins=...)` share the same `CORS_ORIGINS` environment variable.
- Ensure your hosting provider or reverse proxy (Nginx / Cloudflare) allows WebSocket upgrade headers:
  - `Upgrade: websocket`
  - `Connection: Upgrade`

---

## 4. Browser Setup & Permissions

- **HTTPS Required**: Browsers (`getUserMedia`) require secure origins (`https://` or `localhost`).
- **Camera & Mic**: Grant browser camera and microphone permissions when prompted.
- **Hardware Acceleration**: Enable hardware acceleration in browser settings for optimal MediaPipe HandLandmarker performance.

---

## 5. 6-Step Verification Smoke Test

1. **Health Check**: Open `https://<backend-domain>/health` (or `/docs`) to confirm the backend is live.
2. **Authentication**: Register or log in to generate a valid JWT token.
3. **Session Creation**: From the dashboard, create a new collaborative session and enter the room.
4. **Socket & Status Chips**: Verify that the status chip transitions to `"Connected"` with the green indicator. If disconnected, verify the `"Can't reach the server. Retrying…"` banner and Retry button.
5. **Local Video**: Verify your local video feed renders in the bottom-left camera tile with the glowing hand overlay.
6. **3D AR Sync & Gestures**: Move your hand to test pointing/pinch gestures or rotate the 3D model, and confirm peer synchronization in real time.

---

## 6. Failure Debugging & Troubleshooting

- **Socket Reconnecting / Disconnected**:
  - Open DevTools Console and check for `[SocketManager] Connection error: ...`.
  - Confirm `VITE_SOCKET_URL` does not point to `localhost` and matches the backend domain exactly without trailing slashes.
  - Verify `CORS_ORIGINS` on the backend includes the frontend domain.
- **Camera Tile Black or Missing**:
  - Check browser permissions for Camera/Mic (`chrome://settings/content/camera`).
  - Verify `MediaStream` track statuses in DevTools (`stream.getVideoTracks()[0].enabled`).
- **Hand Tracking Failed (`failed` / `off`)**:
  - Verify browser network access to `@mediapipe/tasks-vision` CDN and Google Cloud storage WASM/task models.
