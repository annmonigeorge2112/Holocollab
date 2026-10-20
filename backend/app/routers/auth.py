from datetime import datetime, timedelta, timezone
from typing import Optional, Callable, Dict, List
import os
import time
import jwt
import bcrypt
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.config import settings
from app.db.engine import get_db
from app.db.schema import User
from app.schemas.auth import RegisterRequest, LoginRequest, GuestRequest, AuthResponse, UserOut

router = APIRouter(prefix="", tags=["auth"])
security = HTTPBearer()

# IP-based rate limiting for /auth routes (max 10 requests / minute per IP)
auth_request_history: Dict[str, List[float]] = {}
AUTH_RATE_LIMIT = 10
AUTH_WINDOW_SECONDS = 60.0

def check_auth_rate_limit(request: Request):
    # In test mode or when running pytest, bypass rate limit
    if settings.ENVIRONMENT == "test" or "PYTEST_CURRENT_TEST" in os.environ:
        return
    client_ip = request.headers.get("x-forwarded-for") or (request.client.host if request.client else "unknown")
    if "," in client_ip:
        client_ip = client_ip.split(",")[0].strip()
    
    now = time.time()
    timestamps = auth_request_history.get(client_ip, [])
    valid_timestamps = [t for t in timestamps if now - t < AUTH_WINDOW_SECONDS]
    if len(valid_timestamps) >= AUTH_RATE_LIMIT:
        auth_request_history[client_ip] = valid_timestamps
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many authentication requests. Please try again in 1 minute."
        )
    valid_timestamps.append(now)
    auth_request_history[client_ip] = valid_timestamps

def hash_password(password: str) -> str:
    pwd_bytes = password.encode("utf-8")
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(pwd_bytes, salt).decode("utf-8")

def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))
    except Exception:
        return False

def create_access_token(user_id: str, role: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(hours=24)
    payload = {
        "sub": user_id,
        "role": role,
        "exp": expire,
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm="HS256")

def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.JWT_SECRET, algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except jwt.PyJWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )

async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: AsyncSession = Depends(get_db)
) -> User:
    token = credentials.credentials
    payload = decode_token(token)
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload")
    stmt = select(User).where(User.id == user_id)
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user

def require_role(*allowed_roles: str) -> Callable:
    async def role_checker(current_user: User = Depends(get_current_user)) -> User:
        if current_user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Operation not permitted. Required roles: {allowed_roles}",
            )
        return current_user
    return role_checker

@router.post("/auth/register", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
async def register(
    req: RegisterRequest,
    _: None = Depends(check_auth_rate_limit),
    db: AsyncSession = Depends(get_db)
):
    stmt = select(User).where(User.email == req.email.lower())
    result = await db.execute(stmt)
    if result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")

    user = User(
        name=req.name,
        email=req.email.lower(),
        password_hash=hash_password(req.password),
        role=req.role,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    token = create_access_token(user.id, user.role)
    return AuthResponse(token=token, user=UserOut.model_validate(user))

@router.post("/auth/login", response_model=AuthResponse)
async def login(
    req: LoginRequest,
    _: None = Depends(check_auth_rate_limit),
    db: AsyncSession = Depends(get_db)
):
    stmt = select(User).where(User.email == req.email.lower())
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()
    if not user or not user.password_hash or not verify_password(req.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")

    token = create_access_token(user.id, user.role)
    return AuthResponse(token=token, user=UserOut.model_validate(user))

@router.post("/auth/guest", response_model=AuthResponse)
async def guest(
    req: GuestRequest,
    _: None = Depends(check_auth_rate_limit),
    db: AsyncSession = Depends(get_db)
):
    user = User(
        name=req.name,
        email=None,
        password_hash=None,
        role="guest",
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    token = create_access_token(user.id, user.role)
    return AuthResponse(token=token, user=UserOut.model_validate(user))

@router.get("/me", response_model=UserOut)
async def me(current_user: User = Depends(get_current_user)):
    return UserOut.model_validate(current_user)
