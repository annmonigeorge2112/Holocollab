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

async def get_token_for(client: AsyncClient, email: str, role: str) -> str:
    res = await client.post(
        "/auth/register",
        json={
            "name": f"User {role}",
            "email": email,
            "password": "password123",
            "role": role,
        },
    )
    return res.json()["token"]

@pytest.mark.asyncio
async def test_session_create_by_educator(client: AsyncClient):
    token = await get_token_for(client, "prof@example.com", "educator")
    headers = {"Authorization": f"Bearer {token}"}

    res = await client.post(
        "/sessions",
        json={"name": "Biology 101", "topic": "Cell Structure"},
        headers=headers,
    )
    assert res.status_code == 201
    data = res.json()
    assert data["name"] == "Biology 101"
    assert data["topic"] == "Cell Structure"
    assert len(data["roomCode"]) == 6
    # Ensure no ambiguous characters
    assert not any(c in data["roomCode"] for c in "0O1I")

@pytest.mark.asyncio
async def test_session_create_role_restriction(client: AsyncClient):
    # Student role cannot create session
    token = await get_token_for(client, "student@example.com", "student")
    headers = {"Authorization": f"Bearer {token}"}

    res = await client.post(
        "/sessions",
        json={"name": "Prohibited Session", "topic": "Testing"},
        headers=headers,
    )
    assert res.status_code == 403

@pytest.mark.asyncio
async def test_session_join_by_code(client: AsyncClient):
    educator_token = await get_token_for(client, "teacher2@example.com", "educator")
    student_token = await get_token_for(client, "student2@example.com", "student")

    # Educator creates session
    create_res = await client.post(
        "/sessions",
        json={"name": "Chemistry Lab", "topic": "Molecules"},
        headers={"Authorization": f"Bearer {educator_token}"},
    )
    room_code = create_res.json()["roomCode"]

    # Student joins by code
    join_res = await client.get(
        f"/sessions/by-code/{room_code}",
        headers={"Authorization": f"Bearer {student_token}"},
    )
    assert join_res.status_code == 200
    assert join_res.json()["roomCode"] == room_code
    assert join_res.json()["name"] == "Chemistry Lab"

@pytest.mark.asyncio
async def test_session_end(client: AsyncClient):
    educator_token = await get_token_for(client, "teacher3@example.com", "educator")
    other_educator_token = await get_token_for(client, "teacher4@example.com", "educator")

    create_res = await client.post(
        "/sessions",
        json={"name": "Physics", "topic": "Gravity"},
        headers={"Authorization": f"Bearer {educator_token}"},
    )
    session_id = create_res.json()["id"]

    # Non-host educator cannot end session
    end_fail = await client.post(
        f"/sessions/{session_id}/end",
        headers={"Authorization": f"Bearer {other_educator_token}"},
    )
    assert end_fail.status_code == 403

    # Host educator can end session
    end_res = await client.post(
        f"/sessions/{session_id}/end",
        headers={"Authorization": f"Bearer {educator_token}"},
    )
    assert end_res.status_code == 200
    assert end_res.json()["status"] == "ended"

@pytest.mark.asyncio
async def test_asset_upload_and_listing(client: AsyncClient):
    token = await get_token_for(client, "uploader@example.com", "educator")
    headers = {"Authorization": f"Bearer {token}"}

    # Upload invalid extension
    invalid_file = {"file": ("test.txt", b"dummy content", "text/plain")}
    res_bad = await client.post("/assets", files=invalid_file, headers=headers)
    assert res_bad.status_code == 400

    # Upload valid .glb
    valid_file = {"file": ("molecule.glb", b"glTF binary dummy content", "model/gltf-binary")}
    res_good = await client.post("/assets", files=valid_file, data={"name": "Molecule Model"}, headers=headers)
    assert res_good.status_code == 201
    asset_data = res_good.json()
    assert asset_data["name"] == "Molecule Model"
    assert "/uploads/" in asset_data["url"] or "supabase" in asset_data["url"]

    # List assets
    list_res = await client.get("/assets", headers=headers)
    assert list_res.status_code == 200
    assert len(list_res.json()) >= 1
