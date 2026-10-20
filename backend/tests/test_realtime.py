import os
os.environ["JWT_SECRET"] = "test-jwt-secret-key-for-unit-testing-32chars"

import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from app.main import app
from app.db.schema import Base
from app.db.engine import get_db
import app.db.engine as engine_module
from app.realtime.socket import (
    sio,
    connect,
    disconnect,
    join_session,
    leave_session,
    model_transform,
    model_load,
    part_select,
    model_filter,
    room_state,
    socket_users,
)

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"

test_engine = create_async_engine(
    TEST_DATABASE_URL,
    connect_args={"check_same_thread": False},
)
async_session_factory = async_sessionmaker(test_engine, expire_on_commit=False, class_=AsyncSession)
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

async def get_token_for(client: AsyncClient, email: str, role: str, name: str) -> str:
    res = await client.post(
        "/auth/register",
        json={
            "name": name,
            "email": email,
            "password": "password123",
            "role": role,
        },
    )
    return res.json()["token"]

@pytest.mark.asyncio
async def test_socket_authentication_rejection():
    # Test invalid token rejected on connect
    res = await connect("bad_sid", {}, auth={"token": "invalid_jwt_string"})
    assert res is False

@pytest.mark.asyncio
async def test_socket_two_clients_join_and_transform(client: AsyncClient, db_session: AsyncSession, monkeypatch):
    educator_token = await get_token_for(client, "prof_rt@example.com", "educator", "Prof Realtime")
    student_token = await get_token_for(client, "student_rt@example.com", "student", "Student Realtime")

    session_res = await client.post(
        "/sessions",
        json={"name": "Astronomy", "topic": "Solar System"},
        headers={"Authorization": f"Bearer {educator_token}"},
    )
    assert session_res.status_code == 201
    session_id = session_res.json()["id"]

    emitted_events = []
    rooms_map = {}

    async def mock_emit(event, data, room=None, to=None, skip_sid=None):
        emitted_events.append({
            "event": event,
            "data": data,
            "room": room,
            "to": to,
            "skip_sid": skip_sid,
        })

    async def mock_enter_room(sid, room, namespace=None):
        rooms_map.setdefault(room, set()).add(sid)

    async def mock_leave_room(sid, room, namespace=None):
        if room in rooms_map and sid in rooms_map[room]:
            rooms_map[room].remove(sid)

    monkeypatch.setattr(sio, "emit", mock_emit)
    monkeypatch.setattr(sio, "enter_room", mock_enter_room)
    monkeypatch.setattr(sio, "leave_room", mock_leave_room)

    # Connect Educator
    sid1 = "educator_sid_123"
    auth_ok1 = await connect(sid1, {}, auth={"token": educator_token})
    assert auth_ok1 is True

    # Educator joins session
    await join_session(sid1, {"sessionId": session_id})
    assert session_id in room_state
    participants = room_state[session_id]["participants"]
    assert len(participants) == 1
    assert participants[sid1]["name"] == "Prof Realtime"

    # Verify participants_update emitted
    join_emits = [e for e in emitted_events if e["event"] == "participants_update"]
    assert len(join_emits) >= 1
    assert len(join_emits[-1]["data"]["participants"]) == 1

    # Connect Student
    sid2 = "student_sid_456"
    auth_ok2 = await connect(sid2, {}, auth={"token": student_token})
    assert auth_ok2 is True

    # Student joins session
    await join_session(sid2, {"sessionId": session_id})
    assert len(room_state[session_id]["participants"]) == 2
    second_join_emits = [e for e in emitted_events if e["event"] == "participants_update"]
    assert len(second_join_emits[-1]["data"]["participants"]) == 2

    # Educator emits model_transform
    emitted_events.clear()
    transform_payload = {
        "sessionId": session_id,
        "position": [1.0, 2.0, 3.0],
        "rotation": [0.0, 1.0, 0.0],
        "scale": 1.5,
    }
    await model_transform(sid1, transform_payload)

    # Check relay to room skipping sid1
    transform_emits = [e for e in emitted_events if e["event"] == "model_transform"]
    assert len(transform_emits) == 1
    assert transform_emits[0]["room"] == session_id
    assert transform_emits[0]["skip_sid"] == sid1
    assert transform_emits[0]["data"]["scale"] == 1.5

    # Student cannot emit model_load (permission check)
    emitted_events.clear()
    await model_load(sid2, {"assetUrl": "http://model.glb"})
    error_emits = [e for e in emitted_events if e["event"] == "error"]
    assert len(error_emits) == 1
    assert "Permission denied" in error_emits[0]["data"]["message"]

    # Educator can emit model_load
    emitted_events.clear()
    await model_load(sid1, {"assetUrl": "http://model.glb"})
    load_emits = [e for e in emitted_events if e["event"] == "model_load"]
    assert len(load_emits) == 1
    assert load_emits[0]["data"]["assetUrl"] == "http://model.glb"
    assert room_state[session_id]["selected_part_path"] is None

    # Relay part_select (skipping sender) & state storage
    emitted_events.clear()
    await part_select(sid1, {"sessionId": session_id, "path": "1.8.0", "by": "Prof Realtime"})
    part_emits = [e for e in emitted_events if e["event"] == "part_select"]
    assert len(part_emits) == 1
    assert part_emits[0]["room"] == session_id
    assert part_emits[0]["skip_sid"] == sid1
    assert part_emits[0]["data"]["path"] == "1.8.0"
    assert room_state[session_id]["selected_part_path"] == "1.8.0"

    # Relay model_filter (skipping sender) & state storage
    emitted_events.clear()
    await model_filter(sid1, {"sessionId": session_id, "filter": "blue", "by": "Prof Realtime"})
    filter_emits = [e for e in emitted_events if e["event"] == "model_filter"]
    assert len(filter_emits) == 1
    assert filter_emits[0]["room"] == session_id
    assert filter_emits[0]["skip_sid"] == sid1
    assert filter_emits[0]["data"]["filter"] == "blue"
    assert room_state[session_id]["model_filter"] == "blue"

    # Late joiner connects and receives stored model url, last transform, selected part, and filter
    sid3 = "late_student_sid_789"
    auth_ok3 = await connect(sid3, {}, auth={"token": student_token})
    assert auth_ok3 is True
    emitted_events.clear()
    await join_session(sid3, {"sessionId": session_id})

    # Verify late joiner received all current state targeted to sid3
    late_load = [e for e in emitted_events if e["event"] == "model_load" and e.get("to") == sid3]
    assert len(late_load) == 1
    assert late_load[0]["data"]["assetUrl"] == "http://model.glb"

    late_transform = [e for e in emitted_events if e["event"] == "model_transform" and e.get("to") == sid3]
    assert len(late_transform) == 1
    assert late_transform[0]["data"]["scale"] == 1.5

    late_part = [e for e in emitted_events if e["event"] == "part_select" and e.get("to") == sid3]
    assert len(late_part) == 1
    assert late_part[0]["data"]["path"] == "1.8.0"

    late_filter = [e for e in emitted_events if e["event"] == "model_filter" and e.get("to") == sid3]
    assert len(late_filter) == 1
    assert late_filter[0]["data"]["filter"] == "blue"

    # Disconnect participants
    await disconnect(sid3)
    await disconnect(sid2)
    assert len(room_state[session_id]["participants"]) == 1
    await disconnect(sid1)
