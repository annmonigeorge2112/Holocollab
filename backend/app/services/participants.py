from datetime import datetime, timezone
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.db.schema import Participant

async def record_participant_join(session_id: str, user_id: str, db: AsyncSession) -> Participant:
    stmt = select(Participant).where(
        Participant.session_id == session_id,
        Participant.user_id == user_id,
        Participant.left_at.is_(None)
    )
    existing = (await db.execute(stmt)).scalar_one_or_none()
    if existing:
        return existing

    participant = Participant(
        session_id=session_id,
        user_id=user_id,
        joined_at=datetime.now(timezone.utc),
    )
    db.add(participant)
    await db.commit()
    await db.refresh(participant)
    return participant

async def record_participant_leave(session_id: str, user_id: str, db: AsyncSession) -> Optional[Participant]:
    stmt = select(Participant).where(
        Participant.session_id == session_id,
        Participant.user_id == user_id,
        Participant.left_at.is_(None)
    )
    participant = (await db.execute(stmt)).scalar_one_or_none()
    if participant:
        participant.left_at = datetime.now(timezone.utc)
        await db.commit()
        await db.refresh(participant)
    return participant
