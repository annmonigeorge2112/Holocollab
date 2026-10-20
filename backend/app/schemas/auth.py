from pydantic import BaseModel, EmailStr, Field, ConfigDict
from typing import Literal, Optional

class RegisterRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    email: EmailStr
    password: str = Field(..., min_length=6)
    role: Literal["student", "educator"]

class LoginRequest(BaseModel):
    email: EmailStr
    password: str

class GuestRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)

class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    email: Optional[str] = None
    role: Literal["student", "educator", "guest"]

class AuthResponse(BaseModel):
    token: str
    user: UserOut
