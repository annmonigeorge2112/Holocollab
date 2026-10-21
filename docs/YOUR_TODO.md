# HoloCollab Production & Deployment Checklist

## Environment Variables
- **WHERE**: Vercel Dashboard -> Project -> Settings -> Environment Variables
  - `VITE_API_URL`: Render backend URL with NO trailing slash (`https://holocollab-backend.onrender.com`). WHY: Used for all REST API endpoints.
  - `VITE_SOCKET_URL`: Render backend URL with NO trailing slash (`https://holocollab-backend.onrender.com`). WHY: Used by SocketManager to establish WebSocket transport.
  - `VITE_TURN_URL`, `VITE_TURN_USERNAME`, `VITE_TURN_CREDENTIAL`: Optional coturn credentials. WHY: Relay WebRTC packets across symmetric NATs/firewalls.
- **WHERE**: Render Dashboard -> Web Service -> Environment
  - `FRONTEND_ORIGIN`: Vercel frontend URL (`https://holocollab-alpha.vercel.app`). WHY: Required for FastAPI CORS allow_origins.
  - `CORS_ORIGINS`: Comma-separated allowed origins (e.g., `https://holocollab-alpha.vercel.app,http://localhost:5173`). WHY: Socket.IO handshake validates client origin; if missing, returns HTTP 400.
  - `DATABASE_URL`: Async SQLAlchemy DB URL (`sqlite+aiosqlite:///./holocollab.db` or PostgreSQL). WHY: Persistent session and user storage.
  - `GEMINI_API_KEY`: Google Gemini API key. WHY: Powers AI assistant queries and summaries.
  - `SECRET_KEY`: Random 32+ char secret. WHY: Signs and verifies PyJWT auth tokens.

## Browser Permissions & Setup
- Camera and Microphone access must be allowed when prompted.
- Site must be served over HTTPS (or `localhost`) for WebRTC and MediaPipe wasm/camera APIs.
- In Brave Browser, disable "Brave Shields" for the site if MediaPipe WebAssembly is blocked.

## 6-Step Smoke Test
1. **Self-Test Diagnostics**: Visit `/dev/gesture`. Verify all checks pass (Secure context, Camera, MediaPipe wasm, Hand landmarker, Pinch zoom).
2. **Authentication**: Register or log in to obtain a valid JWT token stored in localStorage.
3. **Session Creation (Meet Mode)**: Host creates a room. Check that the UI defaults to full-screen video grid with no 3D canvas placeholder.
4. **AR Mode**: Host opens 3D Models drawer and selects a GLB model. Verify background switches to user camera with floating 3D model and participants move to right strip.
5. **Return to Meet Mode**: Host selects "No model (Meet Mode)". Verify room returns to full-screen responsive video grid for all participants.
6. **Screen Share**: Click "Share screen". Verify shared display appears in main viewport with "You are presenting" badge, and clicking "Stop sharing" restores the previous mode.

## 3-Item Failure Checklist
1. **Socket connection fails / stays 'connecting'**:
   - Check developer tools Network tab for `/socket.io/?EIO=4&transport=polling`.
   - If HTTP 400: Add Vercel URL to Render `CORS_ORIGINS`.
   - If 404 or connection refused: Verify `VITE_SOCKET_URL` has no trailing slash and Render backend is awake.
2. **Camera / Video grid black or denied**:
   - Check site permissions in browser address bar (lock icon -> Camera/Microphone allowed).
   - Ensure no other application (e.g., Zoom, Teams) has exclusive lock on webcam.
3. **Screen share button missing or fails**:
   - Verify browser supports `navigator.mediaDevices.getDisplayMedia` (desktop Chrome, Firefox, Edge, Safari 13+).
   - Ensure another participant is not already presenting unless you are the host.
