import os
os.environ["JWT_SECRET"] = "test-jwt-secret-key-for-unit-testing-32chars"

import json
from unittest.mock import MagicMock, AsyncMock, patch
import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from app.main import app
from app.db.schema import Base, User, Session
from app.db.engine import get_db
from app.services.ai_service import ai_service, AIService
from app.routers.auth import create_access_token
from app.realtime.socket import sio
import app.db.engine as engine_module

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

@pytest.fixture(autouse=True)
def reset_service_state():
    # Clear cache and rate limits between tests
    ai_service.cache.cache.clear()
    ai_service.rate_limiter.user_timestamps.clear()

@pytest.mark.asyncio
async def test_ai_rate_limit(client: AsyncClient, db_session: AsyncSession):
    # Setup user
    user = User(name="Test Student", email="student@test.com", password_hash="hash", role="student")
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)

    token = create_access_token(user.id, user.role)
    headers = {"Authorization": f"Bearer {token}"}

    # Pre-fill user's rate limiter with 10 requests
    for _ in range(10):
        ai_service.rate_limiter.check_and_record(user.id)

    # 11th request should return 429
    res = await client.post(
        "/ai/chat",
        headers=headers,
        json={"sessionId": "test-session", "message": "What is this engine?"},
    )
    assert res.status_code == 429
    detail_data = res.json()["detail"]
    msg_str = detail_data["detail"] if isinstance(detail_data, dict) else detail_data
    assert "limit" in msg_str.lower()

@pytest.mark.asyncio
async def test_ai_cache_hit(client: AsyncClient, db_session: AsyncSession):
    user = User(name="Educator", email="edu@test.com", password_hash="hash", role="educator")
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)

    token = create_access_token(user.id, user.role)
    headers = {"Authorization": f"Bearer {token}"}

    # Pre-populate cache
    ai_service.cache.set("chat", "cached-session:hello test", "Cached answer from Gemini")

    res = await client.post(
        "/ai/chat",
        headers=headers,
        json={"sessionId": "cached-session", "message": "hello test"},
    )
    assert res.status_code == 200
    assert res.json()["reply"] == "Cached answer from Gemini"

@pytest.mark.asyncio
async def test_ai_quiz_invalid_json_retry():
    """Test that generate_quiz retries once on invalid JSON and succeeds when second attempt gives valid JSON."""
    service = AIService()

    valid_quiz_json = json.dumps({
        "quiz": [
            {
                "question": "What does the crankshaft do?",
                "options": ["Converts linear to rotary motion", "Cools engine", "Fires spark", "Filters oil"],
                "answer": "Converts linear to rotary motion",
                "explanation": "Translates piston reciprocating motion into rotation."
            }
        ]
    })

    # Mock _call_gemini_with_retry: first call returns invalid json, second returns valid JSON
    call_mock = AsyncMock(side_effect=["Not JSON response text", valid_quiz_json])
    service._call_gemini_with_retry = call_mock

    quiz = await service.generate_quiz("Internal Combustion Engines", count=1)

    assert len(quiz) == 1
    assert quiz[0]["answer"] == "Converts linear to rotary motion"
    assert call_mock.call_count == 2

@pytest.mark.asyncio
async def test_ai_highlight_tag_stripped_and_emitted(client: AsyncClient, db_session: AsyncSession):
    user = User(name="User", email="user@test.com", password_hash="hash", role="student")
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)

    session_obj = Session(name="Engine Room", topic="Engines", room_code="ENG123", host_id=user.id)
    db_session.add(session_obj)
    await db_session.commit()
    await db_session.refresh(session_obj)

    token = create_access_token(user.id, user.role)
    headers = {"Authorization": f"Bearer {token}"}

    # Mock chat response containing [[HIGHLIGHT: Crankcase]]
    mock_reply = "Here is the Crankcase of the engine:\n[[HIGHLIGHT: Crankcase]]\nIt houses the crankshaft."

    with patch.object(ai_service, "chat", new=AsyncMock(return_value=mock_reply)), \
         patch.object(sio, "emit", new=AsyncMock()) as mock_sio_emit:

        res = await client.post(
            "/ai/chat",
            headers=headers,
            json={"sessionId": session_obj.id, "message": "Where is the crankcase?"},
        )

        assert res.status_code == 200
        reply_text = res.json()["reply"]
        # Tag stripped from reply shown to user
        assert "[[HIGHLIGHT:" not in reply_text
        assert "Crankcase" in reply_text

        # Verify sio.emit was called with highlight_object and part name
        mock_sio_emit.assert_called_once_with(
            "highlight_object",
            {"name": "Crankcase", "by": "Gemini AI"},
            room=session_obj.id,
        )

@pytest.mark.asyncio
async def test_ai_health_normal_reply(client: AsyncClient, db_session: AsyncSession):
    user = User(name="User", email="health_ok@test.com", password_hash="hash", role="student")
    db_session.add(user)
    await db_session.commit()
    token = create_access_token(user.id, user.role)

    with patch.object(ai_service, "generate_content", new=AsyncMock(return_value="OK")):
        res = await client.get("/ai/health", headers={"Authorization": f"Bearer {token}"})
        assert res.status_code == 200
        assert res.json() == {"ok": True}

@pytest.mark.asyncio
async def test_ai_health_missing_key(client: AsyncClient, db_session: AsyncSession):
    user = User(name="User", email="health_nokey@test.com", password_hash="hash", role="student")
    db_session.add(user)
    await db_session.commit()
    token = create_access_token(user.id, user.role)

    with patch("app.services.ai_service.settings.GEMINI_API_KEY", ""):
        ai_service.client = None
        res = await client.get("/ai/health", headers={"Authorization": f"Bearer {token}"})
        assert res.status_code == 503
        data = res.json()
        assert data["detail"]["code"] == "missing_key"

@pytest.mark.asyncio
async def test_ai_health_bad_model(client: AsyncClient, db_session: AsyncSession):
    user = User(name="User", email="health_badmodel@test.com", password_hash="hash", role="student")
    db_session.add(user)
    await db_session.commit()
    token = create_access_token(user.id, user.role)

    with patch.object(ai_service, "generate_content", side_effect=Exception("Model gemini-invalid not found (404)")):
        res = await client.get("/ai/health", headers={"Authorization": f"Bearer {token}"})
        assert res.status_code == 400
        data = res.json()
        assert data["detail"]["code"] == "bad_model"

@pytest.mark.asyncio
async def test_ai_health_rate_limited(client: AsyncClient, db_session: AsyncSession):
    user = User(name="User", email="health_429@test.com", password_hash="hash", role="student")
    db_session.add(user)
    await db_session.commit()
    token = create_access_token(user.id, user.role)

    with patch.object(ai_service, "generate_content", side_effect=Exception("429 ResourceExhausted quota exceeded")):
        res = await client.get("/ai/health", headers={"Authorization": f"Bearer {token}"})
        assert res.status_code == 429
        data = res.json()
        assert data["detail"]["code"] == "rate_limited"

