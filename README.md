# HoloCollab EduMeet

Web-based AI + AR collaborative learning platform. Teachers host sessions, students join with a 6-character room code, and everyone manipulates the same 3D model in real time via webcam hand gestures, with a Gemini-powered assistant, whiteboard overlay, and post-session analytics.

---

## Prerequisites

- **Python 3.11+**
- **Node.js 18+** & `npm`

---

## Getting Started

### 1. Backend Setup

```bash
cd backend
python -m venv venv
# On Windows:
.\venv\Scripts\activate
# On Linux/macOS:
# source venv/bin/activate

pip install -r requirements.txt
cp .env.example .env
```

To run the backend development server:
```bash
uvicorn app.main:sio_app --reload --port 8000
```
Verify health:
- `http://localhost:8000/health` -> `{"status":"ok"}`
- Socket.IO endpoint mounted at `/socket.io`

---

### 2. Frontend Setup

```bash
cd frontend
npm install
cp .env.example .env
```

To run the frontend development server:
```bash
npm run dev
```
Open `http://localhost:5173` in your browser.

---

## Contract & Specifications

See [docs/CONTRACT.md](docs/CONTRACT.md) for full REST endpoints, Socket.IO event payloads, and data models.
