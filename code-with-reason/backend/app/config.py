"""Environment configuration; offline mode is the local default."""
from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    DATABASE_URL: str = "sqlite:///./socragate.db"
    LLM_PROVIDER: Literal["offline", "auto", "openai", "anthropic"] = "auto"
    OPENAI_API_KEY: str | None = None
    ANTHROPIC_API_KEY: str | None = None
    LLM_MODEL: str = "gpt-4o-mini"
    ANTHROPIC_MODEL: str = "claude-haiku-5-5"
    SANDBOX_TIMEOUT_SEC: float = Field(default=1.5, gt=0, le=1.5)
    MAX_AST_TICKS: int = Field(default=150000, gt=0)
    CORS_ORIGINS: list[str] = ["http://localhost:3000", "http://127.0.0.1:3000"]


@lru_cache
def get_settings() -> Settings:
    return Settings()
