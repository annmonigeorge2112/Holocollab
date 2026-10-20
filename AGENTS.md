# HoloCollab EduMeet: Agent Rules and Architecture Guidelines

## Architecture Overview
- `backend/`: Python 3.11, FastAPI, python-socketio (ASGI mounted at `/socket.io`), SQLAlchemy 2 async (SQLite fallback `sqlite+aiosqlite:///./holocollab.db`), Google GenAI, PyJWT, bcrypt.
- `frontend/`: React 18, Vite, TypeScript (strict), Tailwind CSS, react-router-dom, Three.js, MediaPipe Tasks-Vision, socket.io-client.
- `docs/CONTRACT.md`: Source of truth for REST endpoints, WebSocket events, and data models.

## Rules
1. Follow `docs/CONTRACT.md` strictly. Update contract first if changes are needed.
2. Only touch files within the requested module.
3. Secrets loaded via environment variables (`config.py` in backend, `import.meta.env` in frontend). Keep `.env.example` synced.
4. TypeScript strict mode; strictly typed socket payloads in `frontend/src/types/events.ts`.
5. Keep code concise and readable. No unnecessary comments.
6. Do NOT launch servers or run E2E browser tests unless explicitly asked. Unit tests & type checks are allowed.
7. Reply with at most 5 lines on completion.
