import secrets
from datetime import datetime, timezone
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.db.engine import get_db
from app.db.schema import Session, User
from app.routers.auth import get_current_user, require_role
from app.schemas.sessions import SessionCreate, SessionOut, SessionEndOut, SessionReportOut

router = APIRouter(prefix="/sessions", tags=["sessions"])

# Exclude ambiguous characters: 0, O, 1, I
UNAMBIGUOUS_CHARS = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"

async def generate_unique_room_code(db: AsyncSession) -> str:
    for _ in range(10):
        code = "".join(secrets.choice(UNAMBIGUOUS_CHARS) for _ in range(6))
        stmt = select(Session).where(Session.room_code == code)
        result = await db.execute(stmt)
        if not result.scalar_one_or_none():
            return code
    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="Could not generate unique room code. Please try again."
    )

@router.post("", response_model=SessionOut, status_code=status.HTTP_201_CREATED)
async def create_session(
    data: SessionCreate,
    current_user: User = Depends(require_role("educator")),
    db: AsyncSession = Depends(get_db),
):
    room_code = await generate_unique_room_code(db)
    session = Session(
        name=data.name,
        topic=data.topic,
        room_code=room_code,
        external_link=data.externalLink,
        host_id=current_user.id,
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return session

@router.get("", response_model=List[SessionOut])
async def list_my_sessions(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Session).where(Session.host_id == current_user.id).order_by(Session.created_at.desc())
    result = await db.execute(stmt)
    return result.scalars().all()

@router.get("/by-code/{code}", response_model=SessionOut)
async def get_session_by_code(
    code: str,
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Session).where(Session.room_code == code.upper())
    result = await db.execute(stmt)
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    return session

@router.get("/{id}", response_model=SessionOut)
async def get_session_by_id(
    id: str,
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Session).where(Session.id == id)
    result = await db.execute(stmt)
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    return session

from app.db.schema import Session, User, Participant, Message, EngagementSample, Quiz
from app.routers.auth import get_current_user, require_role
from app.schemas.sessions import (
    SessionCreate,
    SessionOut,
    SessionEndOut,
    SessionReportOut,
    AttendanceRecord,
    EngagementBucket,
    QuizScore,
)
from app.realtime.socket import room_activity_counts
from app.services.ai_service import ai_service

# Documented rating thresholds
EXCELLENT_THRESHOLD = 0.75  # 75% or more
GOOD_THRESHOLD = 0.50       # 50% to 74%
# Below 50% is 'Fair'

# Cache for AI insight per session: session_id -> insight_text
ai_insight_cache: dict[str, str] = {}

def compute_overall_rating(avg_engagement: float) -> str:
    """Compute overall rating from average engagement percentage."""
    if avg_engagement >= EXCELLENT_THRESHOLD:
        return "Excellent"
    if avg_engagement >= GOOD_THRESHOLD:
        return "Good"
    return "Fair"

@router.post("/{id}/end", response_model=SessionEndOut)
async def end_session(
    id: str,
    current_user: User = Depends(require_role("educator")),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Session).where(Session.id == id)
    result = await db.execute(stmt)
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    if session.host_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only host educator can end this session")

    now = datetime.now(timezone.utc)
    session.ended_at = now

    # Close any open participant records
    stmt_open = select(Participant).where(Participant.session_id == id, Participant.left_at.is_(None))
    open_parts = (await db.execute(stmt_open)).scalars().all()
    for p in open_parts:
        p.left_at = now

    await db.commit()
    return SessionEndOut(id=session.id, status="ended", endedAt=now)

@router.get("/{id}/report", response_model=SessionReportOut)
async def get_session_report(
    id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Session).where(Session.id == id)
    result = await db.execute(stmt)
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")

    # Host only check (403 for others)
    if session.host_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only host educator can access the session report")

    # Determine session time boundaries
    created_at = session.created_at
    if created_at and created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=timezone.utc)
    end_time = session.ended_at or datetime.now(timezone.utc)
    if end_time.tzinfo is None:
        end_time = end_time.replace(timezone.utc)

    duration = max(0, int((end_time - created_at).total_seconds())) if created_at else 0

    # 1. Fetch participants and users
    parts_stmt = select(Participant).where(Participant.session_id == id)
    participants = (await db.execute(parts_stmt)).scalars().all()

    # Distinct users in session
    user_ids = list(set([p.user_id for p in participants] + [session.host_id]))
    users_stmt = select(User).where(User.id.in_(user_ids))
    users_by_id = {u.id: u for u in (await db.execute(users_stmt)).scalars().all()}

    # 2. Fetch engagement samples
    samples_stmt = select(EngagementSample).where(EngagementSample.session_id == id).order_by(EngagementSample.timestamp.asc())
    samples = (await db.execute(samples_stmt)).scalars().all()

    # User -> samples
    user_samples: dict[str, list[EngagementSample]] = {}
    for s in samples:
        user_samples.setdefault(s.user_id, []).append(s)

    # 3. Fetch chat message counts from DB
    msgs_stmt = select(Message).where(Message.session_id == id)
    messages = (await db.execute(msgs_stmt)).scalars().all()
    user_db_chats: dict[str, int] = {}
    for m in messages:
        user_db_chats[m.user_id] = user_db_chats.get(m.user_id, 0) + 1

    # In-memory activity counters fallback/supplement
    mem_counts = room_activity_counts.get(id, {})

    # Compute attendance per participant
    # If someone joined multiple times, sum durations
    user_parts: dict[str, list[Participant]] = {}
    for p in participants:
        user_parts.setdefault(p.user_id, []).append(p)

    attendance_list: list[AttendanceRecord] = []
    user_engagement_pcts: dict[str, float] = {}

    for uid, p_list in user_parts.items():
        user = users_by_id.get(uid)
        uname = user.name if user else "Participant"
        # Sort by joined_at
        p_list_sorted = sorted(p_list, key=lambda x: x.joined_at)
        first_joined = p_list_sorted[0].joined_at
        if first_joined.tzinfo is None:
            first_joined = first_joined.replace(tzinfo=timezone.utc)
        
        last_left = p_list_sorted[-1].left_at
        if last_left and last_left.tzinfo is None:
            last_left = last_left.replace(tzinfo=timezone.utc)

        total_dur = 0
        for p in p_list:
            j_time = p.joined_at.replace(tzinfo=timezone.utc) if p.joined_at.tzinfo is None else p.joined_at
            l_time = (p.left_at or end_time)
            if l_time.tzinfo is None:
                l_time = l_time.replace(tzinfo=timezone.utc)
            total_dur += max(0, int((l_time - j_time).total_seconds()))

        u_s = user_samples.get(uid, [])
        if u_s:
            active_cnt = sum(1 for s in u_s if s.is_active)
            eng_pct = round(active_cnt / len(u_s), 2)
        else:
            eng_pct = 1.0  # Default to 100% active if present but no pings
        user_engagement_pcts[uid] = eng_pct

        mem_user = mem_counts.get(uid, {})
        chat_cnt = max(user_db_chats.get(uid, 0), mem_user.get("chat", 0))
        gesture_cnt = mem_user.get("gestures", 0)
        stroke_cnt = mem_user.get("strokes", 0)

        attendance_list.append(AttendanceRecord(
            userId=uid,
            name=uname,
            joinedAt=first_joined,
            leftAt=last_left,
            durationSeconds=total_dur,
            engagementPct=eng_pct,
            chatCount=chat_cnt,
            gestureCount=gesture_cnt,
            strokeCount=stroke_cnt,
        ))

    # Overall average engagement
    if user_engagement_pcts:
        avg_engagement = round(sum(user_engagement_pcts.values()) / len(user_engagement_pcts), 2)
    elif samples:
        active_cnt = sum(1 for s in samples if s.is_active)
        avg_engagement = round(active_cnt / len(samples), 2)
    else:
        avg_engagement = 1.0

    rating = compute_overall_rating(avg_engagement)

    # 4. Engagement series: per participant, the percentage of active pings per 1-minute bucket
    # Bucket samples by minute offset from session start
    engagement_series: list[EngagementBucket] = []
    if created_at and samples:
        # Group by minute bucket
        bucket_data: dict[int, dict[str, list[bool]]] = {}
        for s in samples:
            s_time = s.timestamp.replace(tzinfo=timezone.utc) if s.timestamp.tzinfo is None else s.timestamp
            diff_mins = max(0, int((s_time - created_at).total_seconds() // 60))
            if diff_mins not in bucket_data:
                bucket_data[diff_mins] = {}
            bucket_data[diff_mins].setdefault(s.user_id, []).append(s.is_active)

        for b_min in sorted(bucket_data.keys()):
            time_label = f"{b_min:02d}:00"
            active_pcts: dict[str, float] = {}
            for uid, actives in bucket_data[b_min].items():
                u_obj = users_by_id.get(uid)
                u_name = u_obj.name if u_obj else uid
                pct = round((sum(1 for a in actives if a) / len(actives)) * 100, 1)
                active_pcts[u_name] = pct
            engagement_series.append(EngagementBucket(timeLabel=time_label, activePercentages=active_pcts))

    # 5. Low engagement participants (< 40%)
    low_eng_names = [
        att.name for att in attendance_list if att.engagementPct < 0.40
    ]

    # 6. AI insight paragraph (cached per session)
    if id in ai_insight_cache:
        ai_insight = ai_insight_cache[id]
    else:
        prompt_data = (
            f"Session: '{session.name}', Topic: '{session.topic}', Duration: {duration}s, "
            f"Overall engagement: {int(avg_engagement * 100)}% ({rating}). "
            f"Total participants: {len(attendance_list)}. "
            f"Participants below 40% engagement: {', '.join(low_eng_names) if low_eng_names else 'None'}."
        )
        default_fallback = (
            f"The session had an overall engagement rating of {rating} ({int(avg_engagement * 100)}%) across "
            f"{len(attendance_list)} participants over {duration // 60} minutes. "
            + (f"Attention was lowest for {', '.join(low_eng_names)}, who participated below 40% active time." if low_eng_names else "All attendees maintained healthy engagement throughout the collaborative lesson.")
        )
        try:
            prompt = (
                "Write a single concise analytical insight paragraph (3-4 sentences max) for an educator about their class session based ONLY on these numbers. "
                "Explicitly name any participant with engagement below 40% if present:\n"
                f"{prompt_data}"
            )
            # Use ai_service directly
            res = await ai_service.generate_content(prompt=prompt, history=None)
            ai_insight = res.strip() if res and len(res.strip()) > 10 else default_fallback
        except Exception:
            ai_insight = default_fallback
        ai_insight_cache[id] = ai_insight

    summary = (
        f"Collaborative AR session '{session.name}' focused on {session.topic}. "
        "Participants interacted with 3D models and collaborated via AR manipulation, whiteboard annotations, and chat."
    )

    # Fetch quizzes
    quizzes_stmt = select(Quiz).where(Quiz.session_id == id)
    quizzes = (await db.execute(quizzes_stmt)).scalars().all()
    quiz_items = []
    for q in quizzes:
        quiz_items.append(QuizScore(question=f"Quiz: {q.topic}", score=0.85))

    return SessionReportOut(
        sessionId=session.id,
        durationSeconds=duration,
        totalParticipants=max(len(attendance_list), 1),
        engagementAverage=avg_engagement,
        rating=rating,
        aiInsight=ai_insight,
        summary=summary,
        quizzes=quiz_items,
        attendance=attendance_list,
        engagementSeries=engagement_series,
    )

