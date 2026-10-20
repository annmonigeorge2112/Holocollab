import os
os.environ["JWT_SECRET"] = "test-jwt-secret-key-for-unit-testing-32chars"

import time
import pytest
import pytest_asyncio
from unittest.mock import patch
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy import select

from app.main import app
from app.db.schema import Base, EngagementSample
from app.db.engine import get_db
import app.db.engine as engine_module
from app.routers.sessions import compute_overall_rating, EXCELLENT_THRESHOLD, GOOD_THRESHOLD, ai_insight_cache
from app.realtime.socket import (
    sio,
    connect,
    join_session,
    engagement_ping,
    socket_users,
    room_state,
    last_ping_time,
    room_activity_counts,
)

from tests.test_realtime import test_engine, async_session_factory
engine_module.async_session_maker = async_session_factory

@pytest_asyncio.fixture(scope="function")
async def db_session():
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with async_session_factory() as session:
        yield session
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)

@pytest_asyncio.fixture(scope="function")
async def client(db_session):
    async def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()

async def get_token_for(client: AsyncClient, email: str, role: str, name: str = "Test User") -> tuple[str, str]:
    res = await client.post(
        "/auth/register",
        json={"name": name, "email": email, "password": "password123", "role": role},
    )
    data = res.json()
    return data["token"], data["user"]["id"]

def test_rating_thresholds():
    """Test rating thresholds: Excellent >= 75%, Good >= 50%, Fair < 50%."""
    assert EXCELLENT_THRESHOLD == 0.75
    assert GOOD_THRESHOLD == 0.50
    assert compute_overall_rating(0.85) == "Excellent"
    assert compute_overall_rating(0.75) == "Excellent"
    assert compute_overall_rating(0.74) == "Good"
    assert compute_overall_rating(0.50) == "Good"
    assert compute_overall_rating(0.49) == "Fair"
    assert compute_overall_rating(0.20) == "Fair"

@pytest.mark.asyncio
async def test_engagement_ping_stored_and_rate_limited(client: AsyncClient, db_session: AsyncSession, monkeypatch):
    """Test engagement_ping stores a row and rate limits faster than 10s."""
    async def mock_enter_room(sid, room, namespace=None):
        pass
    async def mock_emit(*a, **kw):
        pass
    monkeypatch.setattr(sio, "enter_room", mock_enter_room)
    monkeypatch.setattr(sio, "emit", mock_emit)

    token, user_id = await get_token_for(client, "student_ping@example.com", "student", "Ping Student")
    host_token, host_id = await get_token_for(client, "host_ping@example.com", "educator", "Host Teacher")

    # Create session
    res = await client.post(
        "/sessions",
        headers={"Authorization": f"Bearer {host_token}"},
        json={"name": "Physics Session", "topic": "Quantum Mechanics"},
    )
    assert res.status_code == 201
    session_id = res.json()["id"]

    # Connect student via socket
    sid = "sid-student-1"
    conn_res = await connect(sid, {}, auth={"token": token})
    assert conn_res is not False
    await join_session(sid, {"sessionId": session_id})

    # Clear last ping time for clean test state
    last_ping_time.pop(user_id, None)

    # 1. Send first ping
    await engagement_ping(sid, {"sessionId": session_id, "active": True})

    # Verify 1 sample stored in DB
    stmt = select(EngagementSample).where(EngagementSample.session_id == session_id, EngagementSample.user_id == user_id)
    samples = (await db_session.execute(stmt)).scalars().all()
    assert len(samples) == 1
    assert samples[0].is_active is True

    # 2. Send second ping immediately (faster than 10s) -> should be ignored
    await engagement_ping(sid, {"sessionId": session_id, "active": False})
    samples_after = (await db_session.execute(stmt)).scalars().all()
    assert len(samples_after) == 1  # Unchanged

@pytest.mark.asyncio
async def test_host_only_report_check(client: AsyncClient, db_session: AsyncSession):
    """Test GET /sessions/{id}/report is host only (403 for other educator and students)."""
    host_token, _ = await get_token_for(client, "owner_edu@example.com", "educator", "Session Owner")
    other_edu_token, _ = await get_token_for(client, "other_edu@example.com", "educator", "Other Educator")
    student_token, _ = await get_token_for(client, "student_user@example.com", "student", "Student User")

    # Create session
    res = await client.post(
        "/sessions",
        headers={"Authorization": f"Bearer {host_token}"},
        json={"name": "Chem Lab", "topic": "Kinetics"},
    )
    session_id = res.json()["id"]

    # Other educator attempts access -> 403
    res_other = await client.get(
        f"/sessions/{session_id}/report",
        headers={"Authorization": f"Bearer {other_edu_token}"},
    )
    assert res_other.status_code == 403

    # Student attempts access -> 403
    res_student = await client.get(
        f"/sessions/{session_id}/report",
        headers={"Authorization": f"Bearer {student_token}"},
    )
    assert res_student.status_code == 403

    # Host educator accesses -> 200
    res_host = await client.get(
        f"/sessions/{session_id}/report",
        headers={"Authorization": f"Bearer {host_token}"},
    )
    assert res_host.status_code == 200
    report_data = res_host.json()
    assert report_data["sessionId"] == session_id
    assert "rating" in report_data
    assert "attendance" in report_data
    assert "aiInsight" in report_data

@pytest.mark.asyncio
async def test_report_gemini_failure_fallback(client: AsyncClient, db_session: AsyncSession):
    """Test that when Gemini AI fails, the report fallback paragraph is returned without breaking."""
    host_token, _ = await get_token_for(client, "gemini_host@example.com", "educator", "Host")
    res = await client.post(
        "/sessions",
        headers={"Authorization": f"Bearer {host_token}"},
        json={"name": "Fallback Test", "topic": "Robotics"},
    )
    session_id = res.json()["id"]
    ai_insight_cache.pop(session_id, None)

    # Mock ai_service.generate_content to raise an Exception (rate limit / network error)
    with patch("app.services.ai_service.ai_service.generate_content", side_effect=Exception("Gemini 429 ResourceExhausted")):
        res_report = await client.get(
            f"/sessions/{session_id}/report",
            headers={"Authorization": f"Bearer {host_token}"},
        )
        assert res_report.status_code == 200
        data = res_report.json()
        assert len(data["aiInsight"]) > 20
        assert "engagement" in data["aiInsight"].lower()
