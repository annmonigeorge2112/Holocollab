import re
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from typing import List, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.db.engine import get_db
from app.db.schema import Session, Message, User
from app.routers.auth import get_current_user
from app.services.ai_service import ai_service
from app.realtime.socket import sio, room_state

router = APIRouter(prefix="/ai", tags=["ai"])

# Predefined part metadata for standard models
DEFAULT_MODEL_PARTS = [
    "Crankcase",
    "Cylinder",
    "Cylinder Head",
    "Connecting Rod",
    "Piston",
    "Spark Plug",
    "Head Stud",
    "Dowel Pin",
    "Rocker Arm",
    "Rocker Bracket",
    "Pushrod",
    "Valve",
    "Valve Spring",
    "Valve Spring Retainer",
]

class AIChatRequest(BaseModel):
    sessionId: str
    message: str = Field(..., min_length=1, max_length=1000)

class AIChatResponse(BaseModel):
    reply: str

class AISummaryRequest(BaseModel):
    sessionId: str

class AISummaryResponse(BaseModel):
    summary: str

class AIQuizRequest(BaseModel):
    sessionId: str
    topic: str = Field(..., min_length=1, max_length=200)
    count: int = Field(default=3, ge=1, le=10)

class QuizItem(BaseModel):
    question: str
    options: List[str]
    answer: str
    explanation: Optional[str] = ""

class AIQuizResponse(BaseModel):
    quiz: List[QuizItem]

def check_rate_limit(user_id: str):
    if not ai_service.rate_limiter.check_and_record(user_id):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={"detail": "You have exceeded the request limit (10 requests/minute). Please wait a moment before asking again.", "code": "rate_limited"},
        )

def standardize_ai_error(e: Exception) -> HTTPException:
    err_str = str(e).lower()
    if isinstance(e, ValueError) and "gemini_api_key is not configured" in err_str:
        return HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"detail": "Gemini API key is not configured in backend environment.", "code": "missing_key"},
        )
    if "404" in err_str or "not found" in err_str or "model" in err_str and ("invalid" in err_str or "unsupported" in err_str):
        return HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"detail": "Configured Gemini model is invalid or unsupported.", "code": "bad_model"},
        )
    if "429" in err_str or "quota" in err_str or "resource_exhausted" in err_str:
        return HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={"detail": "AI service is currently rate limited or busy. Please wait a few seconds and try again.", "code": "rate_limited"},
        )
    return HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail={"detail": f"Upstream Gemini error: {type(e).__name__}", "code": "upstream_error"},
    )

@router.post("/chat", response_model=AIChatResponse)
async def chat_with_ai(
    req: AIChatRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    check_rate_limit(current_user.id)

    # Fetch session
    stmt = select(Session).where(Session.id == req.sessionId)
    session = (await db.execute(stmt)).scalar_one_or_none()
    topic = session.topic if session else "General Science & Engineering"
    session_name = session.name if session else "AR Classroom"

    # Fetch last 15 chat messages from DB
    msg_stmt = (
        select(Message)
        .where(Message.session_id == req.sessionId)
        .order_by(Message.created_at.desc())
        .limit(15)
    )
    messages = (await db.execute(msg_stmt)).scalars().all()
    # Reverse to chronological
    messages = list(reversed(messages))
    chat_history_str = "\n".join([f"Participant: {m.content}" for m in messages])

    # Model and part metadata from room state
    current_room = room_state.get(req.sessionId, {})
    model_url = current_room.get("current_model_url") or "Mechanical_2CylinderEngine.glb"
    model_name = model_url.split("/")[-1]

    # Available parts for model
    part_list_str = ", ".join(DEFAULT_MODEL_PARTS)

    # Build session context capped at ~3000 chars
    context = (
        f"Session Name: {session_name}\n"
        f"Session Topic: {topic}\n"
        f"Active 3D Model: {model_name}\n"
        f"Available 3D Part Names for Highlight Tag: {part_list_str}\n"
        f"Recent Chat History:\n{chat_history_str}"
    )[:3000]

    # Check cache for identical query in this session
    cache_key = f"{req.sessionId}:{req.message}"
    cached_reply = ai_service.cache.get("chat", cache_key)
    if cached_reply:
        raw_reply = cached_reply
    else:
        try:
            raw_reply = await ai_service.chat(session_context=context, message=req.message)
            ai_service.cache.set("chat", cache_key, raw_reply)
        except Exception as e:
            raise standardize_ai_error(e)

    # AI command mode: check for [[HIGHLIGHT: part_name]]
    highlight_match = re.search(r"\[\[HIGHLIGHT:\s*([^\]]+)\]\]", raw_reply, re.IGNORECASE)
    cleaned_reply = re.sub(r"\[\[HIGHLIGHT:\s*[^\]]+\]\]", "", raw_reply).strip()

    if highlight_match:
        part_name = highlight_match.group(1).strip()
        # Emit highlight_object to the room
        await sio.emit(
            "highlight_object",
            {"name": part_name, "by": "Gemini AI"},
            room=req.sessionId,
        )

    return AIChatResponse(reply=cleaned_reply)

@router.post("/summary", response_model=AISummaryResponse)
async def generate_summary(
    req: AISummaryRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    check_rate_limit(current_user.id)

    stmt = select(Session).where(Session.id == req.sessionId)
    session = (await db.execute(stmt)).scalar_one_or_none()
    topic = session.topic if session else "General Session"

    # Fetch messages as transcript
    msg_stmt = (
        select(Message)
        .where(Message.session_id == req.sessionId)
        .order_by(Message.created_at.asc())
        .limit(50)
    )
    messages = (await db.execute(msg_stmt)).scalars().all()
    transcript = "\n".join([f"{m.user_id}: {m.content}" for m in messages])
    if not transcript:
        transcript = f"Interactive session on {topic} with 3D model exploration."

    try:
        summary_text = await ai_service.class_summary(transcript=transcript, topic=topic)
        return AISummaryResponse(summary=summary_text)
    except Exception as e:
        raise standardize_ai_error(e)

@router.post("/quiz", response_model=AIQuizResponse)
async def generate_quiz(
    req: AIQuizRequest,
    current_user: User = Depends(get_current_user),
):
    check_rate_limit(current_user.id)

    try:
        quiz_data = await ai_service.generate_quiz(topic=req.topic, count=req.count)
        return AIQuizResponse(quiz=quiz_data)
    except Exception as e:
        raise standardize_ai_error(e)

@router.get("/health")
async def ai_health(current_user: User = Depends(get_current_user)):
    try:
        await ai_service.generate_content("Reply with OK")
        return {"ok": True}
    except Exception as e:
        raise standardize_ai_error(e)
