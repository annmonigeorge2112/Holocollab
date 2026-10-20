import os
os.environ["JWT_SECRET"] = "test-jwt-secret-key-for-unit-testing-32chars"

import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from app.main import app
from app.db.schema import Base
from app.db.engine import get_db

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"

test_engine = create_async_engine(
    TEST_DATABASE_URL,
    connect_args={"check_same_thread": False},
)
async_session_factory = async_sessionmaker(test_engine, expire_on_commit=False, class_=AsyncSession)

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

@pytest.mark.asyncio
async def test_register_success(client: AsyncClient):
    res = await client.post(
        "/auth/register",
        json={
            "name": "Alice Educator",
            "email": "alice@example.com",
            "password": "strongpassword123",
            "role": "educator",
        },
    )
    assert res.status_code == 201
    data = res.json()
    assert "token" in data
    assert data["user"]["email"] == "alice@example.com"
    assert data["user"]["role"] == "educator"
    assert data["user"]["name"] == "Alice Educator"
    assert "id" in data["user"]

@pytest.mark.asyncio
async def test_register_duplicate_email(client: AsyncClient):
    payload = {
        "name": "Bob Student",
        "email": "bob@example.com",
        "password": "password123",
        "role": "student",
    }
    res1 = await client.post("/auth/register", json=payload)
    assert res1.status_code == 201

    res2 = await client.post("/auth/register", json=payload)
    assert res2.status_code == 409
    assert res2.json()["detail"] == "Email already registered"

@pytest.mark.asyncio
async def test_login_success(client: AsyncClient):
    await client.post(
        "/auth/register",
        json={
            "name": "Charlie",
            "email": "charlie@example.com",
            "password": "secretpassword",
            "role": "student",
        },
    )
    res = await client.post(
        "/auth/login",
        json={"email": "charlie@example.com", "password": "secretpassword"},
    )
    assert res.status_code == 200
    data = res.json()
    assert "token" in data
    assert data["user"]["email"] == "charlie@example.com"

@pytest.mark.asyncio
async def test_login_bad_password(client: AsyncClient):
    await client.post(
        "/auth/register",
        json={
            "name": "Dave",
            "email": "dave@example.com",
            "password": "correctpassword",
            "role": "student",
        },
    )
    res = await client.post(
        "/auth/login",
        json={"email": "dave@example.com", "password": "wrongpassword"},
    )
    assert res.status_code == 401
    assert res.json()["detail"] == "Invalid email or password"

@pytest.mark.asyncio
async def test_guest_auth(client: AsyncClient):
    res = await client.post("/auth/guest", json={"name": "Guest Visitor"})
    assert res.status_code == 200
    data = res.json()
    assert "token" in data
    assert data["user"]["name"] == "Guest Visitor"
    assert data["user"]["role"] == "guest"
    assert data["user"]["email"] is None

@pytest.mark.asyncio
async def test_me_endpoint(client: AsyncClient):
    # Unauthenticated
    res_unauth = await client.get("/me")
    assert res_unauth.status_code == 403 or res_unauth.status_code == 401

    # Authenticated
    reg = await client.post(
        "/auth/register",
        json={
            "name": "Eve Student",
            "email": "eve@example.com",
            "password": "password123",
            "role": "student",
        },
    )
    token = reg.json()["token"]
    headers = {"Authorization": f"Bearer {token}"}

    res_me = await client.get("/me", headers=headers)
    assert res_me.status_code == 200
    me_data = res_me.json()
    assert me_data["name"] == "Eve Student"
    assert me_data["email"] == "eve@example.com"
    assert me_data["role"] == "student"
