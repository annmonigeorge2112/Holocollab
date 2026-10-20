from typing import Optional, List
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import model_validator

class Settings(BaseSettings):
    ENVIRONMENT: str = "development"  # "development" | "production" | "test"
    DATABASE_URL: Optional[str] = "sqlite+aiosqlite:///./holocollab.db"
    JWT_SECRET: str = "replace_with_a_secure_jwt_secret"
    GEMINI_API_KEY: Optional[str] = ""
    GEMINI_MODEL: str = "gemini-2.5-flash"
    
    # Storage configuration
    STORAGE_BACKEND: str = "local"  # "local" | "supabase"
    SUPABASE_URL: Optional[str] = ""
    SUPABASE_KEY: Optional[str] = ""
    SUPABASE_BUCKET: str = "models"
    UPLOADS_DIR: str = "uploads"
    BASE_URL: str = "http://localhost:8000"
    
    # CORS & WebSockets: comma-separated origins, or FRONTEND_ORIGIN as fallback
    FRONTEND_ORIGIN: str = "http://localhost:5173"
    CORS_ORIGINS: Optional[str] = None

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @model_validator(mode="after")
    def validate_production_settings(self):
        if self.ENVIRONMENT == "production":
            if not self.JWT_SECRET or self.JWT_SECRET in (
                "replace_with_a_secure_jwt_secret",
                "test-jwt-secret-key-for-unit-testing-32chars",
                "secret",
            ):
                raise ValueError("FATAL: JWT_SECRET must be set to a secure, unique value in production.")
        return self

    def get_cors_origins(self) -> List[str]:
        if self.CORS_ORIGINS:
            origins = [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]
            if origins:
                return origins
        if self.ENVIRONMENT == "production":
            return ["*"] if not self.FRONTEND_ORIGIN else [self.FRONTEND_ORIGIN.strip(), "http://localhost:5173", "http://127.0.0.1:5173"]
        return ["*"]

settings = Settings()

