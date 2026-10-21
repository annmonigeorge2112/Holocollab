# HoloCollab EduMeet 5-Minute Live Demo Script

1. **Step 1: Diagnostic Self-Test (0:00 - 0:30)**
   - Open `/dev/gesture`. Verify all 6 links pass (Secure Context, Browser, MediaPipe Wasm, Task, Detection, Pinch).
   - *Fallback:* If camera access fails, click the address bar lock icon to allow webcam access.

2. **Step 2: Session Launch & Meet Mode (0:30 - 1:15)**
   - Educator logs in and creates a room. Join from a second device (or incognito window) with the 6-character room code.
   - Observe full-screen responsive Google Meet video grid with speaker highlight and media icons.
   - *Fallback:* If socket shows "Connecting…", check that Render backend is awake and CORS_ORIGINS includes the domain.

3. **Step 3: AR Mode & 3D Model Inspection (1:15 - 2:30)**
   - Host clicks 3D Models drawer and selects "2-Cylinder Engine".
   - Background switches to user camera with the floating 3D engine; participants move to right overlay strip.
   - Click a component (e.g., Piston or Crankshaft) to inspect part metadata and name.
   - *Fallback:* If WebGL stutters, select "Wireframe" or "Realistic" from model filters to refresh shader cache.

4. **Step 4: Glowing Neon Gestures & Air Drawing (2:30 - 3:30)**
   - Raise hand to show color-coded neon overlay (Pinch=magenta, Point=green, Open=blue, Fist=orange).
   - Pinch with thumb & index to smoothly zoom model from 0.2x to 4x.
   - Point index finger in the right drawing zone to write air notes; hold fist for 1 second to clear.
   - *Fallback:* Ensure hand is fully inside the camera frame in decent lighting.

5. **Step 5: Whiteboard & AI Tutor (3:30 - 4:15)**
   - Open Whiteboard to annotate diagrams over the scene with pen and shape recognition.
   - Open Gemini Assistant and ask: *"Where is the crankcase and what is its purpose?"*
   - Observe Gemini reply and the automatic `[[HIGHLIGHT: Crankcase]]` trigger highlighting the physical component.
   - *Fallback:* If AI rate limits, wait 5 seconds or click the pre-filled quick questions.

6. **Step 6: Screen Share, End & AI Summary Report (4:15 - 5:00)**
   - Click "Share screen" to demonstrate slides or docs in presenter mode, then stop sharing.
   - Host clicks "End session for everyone".
   - View Session Report Page with attendance, engagement timeline, and Gemini AI-generated session summary.
   - *Fallback:* If summary shows sparse data, refresh to fetch cached summary from session activity log.
