from pydantic import BaseModel, Field, ConfigDict
from typing import Optional, List
from datetime import datetime

class SessionCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    topic: str = Field(..., min_length=1, max_length=200)
    externalLink: Optional[str] = None

class SessionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    topic: str
    roomCode: str = Field(validation_alias="room_code")
    externalLink: Optional[str] = Field(default=None, validation_alias="external_link")
    hostId: Optional[str] = Field(default=None, validation_alias="host_id")
    createdAt: Optional[datetime] = Field(default=None, validation_alias="created_at")
    endedAt: Optional[datetime] = Field(default=None, validation_alias="ended_at")

class SessionEndOut(BaseModel):
    id: str
    status: str
    endedAt: datetime

class QuizScore(BaseModel):
    question: str
    score: float

class AttendanceRecord(BaseModel):
    userId: str
    name: str
    joinedAt: datetime
    leftAt: Optional[datetime] = None
    durationSeconds: int
    engagementPct: float
    chatCount: int = 0
    gestureCount: int = 0
    strokeCount: int = 0

class EngagementBucket(BaseModel):
    timeLabel: str
    activePercentages: dict[str, float] = {}

class SessionReportOut(BaseModel):
    sessionId: str
    durationSeconds: int
    totalParticipants: int
    engagementAverage: float
    rating: str  # Excellent | Good | Fair
    aiInsight: str
    summary: str
    quizzes: List[QuizScore] = []
    attendance: List[AttendanceRecord] = []
    engagementSeries: List[EngagementBucket] = []

