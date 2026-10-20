from typing import AsyncGenerator
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from app.config import settings
from app.db.schema import Base

def get_database_url() -> str:
    url = settings.DATABASE_URL or "sqlite+aiosqlite:///./holocollab.db"
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql+asyncpg://", 1)
    elif url.startswith("postgresql://") and not url.startswith("postgresql+asyncpg://"):
        url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
    
    # asyncpg requires ssl=require, not sslmode=require
    if "sslmode=require" in url:
        url = url.replace("sslmode=require", "ssl=require")
    return url

DATABASE_URL = get_database_url()

# Connection arguments:
# SQLite needs check_same_thread: False.
# asyncpg with SSL on Neon/Postgres requires ssl='require'.
connect_args = {}
if "sqlite" in DATABASE_URL:
    connect_args["check_same_thread"] = False

engine = create_async_engine(DATABASE_URL, echo=False, connect_args=connect_args)
async_session_maker = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

async def init_db() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with async_session_maker() as session:
        yield session
