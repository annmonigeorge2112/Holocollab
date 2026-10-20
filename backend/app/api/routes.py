import random
import string
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.models import User, Room, RoomAnalytics
from app.auth import (
    hash_password,
    verify_password,
    create_access_token,
    get_current_user,
    get_current_teacher,
)
from app.schemas import (
    UserRegister,
    UserLogin,
    AuthResponse,
    UserResponse,
    RoomCreate,
    RoomResponse,
    RoomAnalyticsResponse,
    AIAskRequest,
    AIAskResponse,
)
from app.services.gemini import ask_gemini

router = APIRouter(prefix="/api")

def generate_room_code(length: int = 6) -> str:
    return "".join(random.choices(string.ascii_uppercase + string.digits, k=length))

# --- Auth Routes ---
@router.post("/auth/register", response_model=AuthResponse)
async def register(user_data: UserRegister, db: AsyncSession = Depends(get_db)):
    stmt = select(User).where(User.email == user_data.email)
    existing = (await db.execute(stmt)).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already registered")

    user = User(
        email=user_data.email,
        name=user_data.name,
        role=user_data.role,
        password_hash=hash_password(user_data.password),
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    token = create_access_token({"sub": user.id, "role": user.role, "name": user.name})
    return AuthResponse(
        token=token,
        user=UserResponse(id=user.id, email=user.email, name=user.name, role=user.role),
    )

@router.post("/auth/login", response_model=AuthResponse)
async def login(credentials: UserLogin, db: AsyncSession = Depends(get_db)):
    stmt = select(User).where(User.email == credentials.email)
    user = (await db.execute(stmt)).scalar_one_or_none()
    if not user or not verify_password(credentials.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")

    token = create_access_token({"sub": user.id, "role": user.role, "name": user.name})
    return AuthResponse(
        token=token,
        user=UserResponse(id=user.id, email=user.email, name=user.name, role=user.role),
    )

# --- Room Routes ---
@router.post("/rooms", response_model=RoomResponse)
async def create_room(
    room_data: RoomCreate,
    current_user: User = Depends(get_current_teacher),
    db: AsyncSession = Depends(get_db),
):
    code = generate_room_code()
    room = Room(
        code=code,
        title=room_data.title,
        model_url=room_data.model_url or "",
        host_id=current_user.id,
    )
    analytics = RoomAnalytics(room_code=code)
    db.add(room)
    db.add(analytics)
    await db.commit()
    await db.refresh(room)

    return RoomResponse(
        code=room.code,
        title=room.title,
        host_id=room.host_id,
        created_at=room.created_at.isoformat(),
    )

@router.get("/rooms/{code}", response_model=RoomResponse)
async def get_room(code: str, db: AsyncSession = Depends(get_db)):
    stmt = select(Room).where(Room.code == code.upper())
    room = (await db.execute(stmt)).scalar_one_or_none()
    if not room:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found")
    return RoomResponse(
        code=room.code,
        title=room.title,
        host_id=room.host_id,
        model_url=room.model_url,
        is_active=room.is_active,
    )

@router.get("/rooms/{code}/analytics", response_model=RoomAnalyticsResponse)
async def get_room_analytics(code: str, db: AsyncSession = Depends(get_db)):
    stmt = select(RoomAnalytics).where(RoomAnalytics.room_code == code.upper())
    analytics = (await db.execute(stmt)).scalar_one_or_none()
    if not analytics:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Analytics not found for room")
    return RoomAnalyticsResponse(
        room_code=analytics.room_code,
        duration_seconds=analytics.duration_seconds,
        participant_count=analytics.participant_count,
        gemini_queries_count=analytics.gemini_queries_count,
        summary=analytics.summary or "No summary recorded.",
    )

# --- AI Assistant Route ---
@router.post("/ai/ask", response_model=AIAskResponse)
async def ask_ai(req: AIAskRequest):
    answer = await ask_gemini(req.prompt, req.context)
    return AIAskResponse(answer=answer)
