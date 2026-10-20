import uuid
from datetime import datetime
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
from sqlalchemy import String, DateTime, ForeignKey, Boolean, Text

class Base(DeclarativeBase):
    pass

class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(20), nullable=False)  # 'teacher' or 'student'
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    rooms = relationship("Room", back_populates="host")

class Room(Base):
    __tablename__ = "rooms"

    code: Mapped[str] = mapped_column(String(6), primary_key=True, index=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    model_url: Mapped[str] = mapped_column(String(500), default="")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    host_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    host = relationship("User", back_populates="rooms")
    analytics = relationship("RoomAnalytics", back_populates="room", uselist=False)

class RoomAnalytics(Base):
    __tablename__ = "room_analytics"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    room_code: Mapped[str] = mapped_column(String(6), ForeignKey("rooms.code"), unique=True, nullable=False)
    duration_seconds: Mapped[int] = mapped_column(default=0)
    participant_count: Mapped[int] = mapped_column(default=0)
    gemini_queries_count: Mapped[int] = mapped_column(default=0)
    summary: Mapped[str] = mapped_column(Text, default="")

    room = relationship("Room", back_populates="analytics")
