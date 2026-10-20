import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import socketio
from app.config import settings
from app.db.engine import init_db
from app.routers.auth import router as auth_router
from app.routers.sessions import router as sessions_router
from app.routers.assets import router as assets_router
from app.routers.ai import router as ai_router
from app.realtime.socket import sio

import logging
from fastapi.responses import JSONResponse

logger = logging.getLogger("holocollab")

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Ensure local uploads dir exists for fallback
    os.makedirs(settings.UPLOADS_DIR, exist_ok=True)
    await init_db()
    yield

app = FastAPI(title="HoloCollab EduMeet API", lifespan=lifespan)

# Global exception handler: sanitize unexpected errors to prevent stack traces leaking in production
@app.exception_handler(Exception)
async def global_exception_handler(request, exc: Exception):
    import traceback
    err_str = f"{type(exc).__name__}: {str(exc)}\n{traceback.format_exc()}"
    logger.error("Unhandled internal server error: %s", err_str)
    return JSONResponse(
        status_code=500,
        content={"detail": err_str}
    )

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Static file serving for local uploads fallback
os.makedirs(settings.UPLOADS_DIR, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=settings.UPLOADS_DIR), name="uploads")

app.include_router(auth_router)
app.include_router(sessions_router)
app.include_router(assets_router)
app.include_router(ai_router)

@app.get("/health")
async def health():
    return {"status": "ok"}

sio_asgi = socketio.ASGIApp(socketio_server=sio, other_asgi_app=app, socketio_path="socket.io")
sio_app = CORSMiddleware(
    app=sio_asgi,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
