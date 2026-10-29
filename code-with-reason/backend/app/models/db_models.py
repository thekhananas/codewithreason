"""SQLite persistence for defect-scoped tutor sessions and immutable turn logs.

Engines are cached by URL; passing a URL explicitly provides isolated databases
for tests and command-line tools without mutating application configuration.
"""
from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime, timezone
from functools import lru_cache

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    create_engine,
    event,
    false,
    text,
)
from sqlalchemy.engine import Engine, make_url
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, relationship, sessionmaker
from sqlalchemy.pool import StaticPool
from sqlalchemy.types import TypeDecorator

from app.config import get_settings


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class UTCDateTime(TypeDecorator[datetime]):
    """Retain UTC offsets when SQLite returns otherwise-naive timestamps."""

    impl = DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(self, value: datetime | None, dialect) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None:
            raise ValueError("Persistence timestamps must include a timezone")
        value = value.astimezone(timezone.utc)
        return value.replace(tzinfo=None) if dialect.name == "sqlite" else value

    def process_result_value(self, value: datetime | None, dialect) -> datetime | None:
        if value is None:
            return None
        return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


class Base(DeclarativeBase):
    pass


class TutorSession(Base):
    __tablename__ = "tutor_sessions"
    __table_args__ = (
        CheckConstraint("current_tier BETWEEN 1 AND 4", name="ck_session_tier"),
        CheckConstraint("attempts_on_current_defect >= 0", name="ck_session_attempts"),
    )

    session_id: Mapped[str] = mapped_column(String, primary_key=True)
    problem_id: Mapped[str] = mapped_column(String, index=True, nullable=False)
    current_tier: Mapped[int] = mapped_column(Integer, default=1, server_default=text("1"), nullable=False)
    last_defect_hash: Mapped[str] = mapped_column(String, default="", server_default="", nullable=False)
    last_code_hash: Mapped[str] = mapped_column(String, default="", server_default="", nullable=False)
    attempts_on_current_defect: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"), nullable=False)
    is_solved: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false(), nullable=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utc_now, onupdate=utc_now, nullable=False)
    turns: Mapped[list[SessionTurnLog]] = relationship(
        back_populates="session", cascade="all, delete-orphan", passive_deletes=True,
        order_by="SessionTurnLog.turn_index",
    )


class SessionTurnLog(Base):
    __tablename__ = "session_turn_logs"
    __table_args__ = (
        UniqueConstraint("session_id", "turn_index", name="uq_session_turn"),
        CheckConstraint("turn_index >= 1", name="ck_turn_index"),
        CheckConstraint("tier_used BETWEEN 1 AND 4", name="ck_turn_tier"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[str] = mapped_column(
        ForeignKey("tutor_sessions.session_id", ondelete="CASCADE"), index=True, nullable=False,
    )
    turn_index: Mapped[int] = mapped_column(Integer, nullable=False)
    action: Mapped[str] = mapped_column(String, nullable=False)
    tier_used: Mapped[int] = mapped_column(Integer, nullable=False)
    failure_category: Mapped[str] = mapped_column(String, nullable=False)
    defect_hash: Mapped[str] = mapped_column(String, default="", nullable=False)
    violated_invariant_id: Mapped[str | None] = mapped_column(String, nullable=True)
    shield_triggered: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    latency_ms: Mapped[float] = mapped_column(Float, nullable=False)
    user_code: Mapped[str] = mapped_column(Text, nullable=False)
    socratic_response: Mapped[str] = mapped_column(Text, nullable=False)
    counterexample_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    session: Mapped[TutorSession] = relationship(back_populates="turns")


@lru_cache(maxsize=32)
def _engine_for_url(database_url: str) -> Engine:
    url = make_url(database_url)
    options: dict = {"pool_pre_ping": True}
    if url.get_backend_name() == "sqlite":
        options["connect_args"] = {"check_same_thread": False, "timeout": 5.0}
        in_memory = url.database in (None, "", ":memory:")
        if in_memory:
            options["poolclass"] = StaticPool
    else:
        in_memory = False
    engine = create_engine(url, **options)
    if url.get_backend_name() == "sqlite":
        @event.listens_for(engine, "connect")
        def configure_sqlite(connection, _record) -> None:
            cursor = connection.cursor()
            try:
                cursor.execute("PRAGMA foreign_keys=ON")
                cursor.execute("PRAGMA busy_timeout=5000")
                if not in_memory:
                    cursor.execute("PRAGMA journal_mode=WAL")
            finally:
                cursor.close()
    return engine


def get_engine(database_url: str | None = None) -> Engine:
    return _engine_for_url(database_url or get_settings().DATABASE_URL)


def init_db(database_url: str | None = None) -> Engine:
    """Create the schema idempotently, returning the selected engine."""
    engine = get_engine(database_url)
    Base.metadata.create_all(engine)
    return engine


def get_session_factory(database_url: str | None = None) -> sessionmaker[Session]:
    return sessionmaker(bind=get_engine(database_url), expire_on_commit=False)


@contextmanager
def session_scope(database_url: str | None = None) -> Iterator[Session]:
    """Commit a successful unit of work; roll back any failed operation."""
    with get_session_factory(database_url)() as db:
        try:
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise


def get_db() -> Iterator[Session]:
    """FastAPI dependency; the service owns the evaluation transaction."""
    with get_session_factory()() as db:
        yield db
