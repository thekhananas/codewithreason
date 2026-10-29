"""Exercise real SQLite transactions, integrity checks, and durable state."""
from datetime import timezone

import pytest
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError

from app.models.db_models import SessionTurnLog, TutorSession, get_engine, init_db, session_scope


@pytest.fixture
def database_url(tmp_path):
    url = f"sqlite:///{tmp_path / 'session.db'}"
    init_db(url)
    yield url
    get_engine(url).dispose()


def turn(session_id: str, index: int = 1) -> SessionTurnLog:
    return SessionTurnLog(
        session_id=session_id, turn_index=index, action="submit_code", tier_used=1,
        failure_category="WRONG_ANSWER", defect_hash="defect-a", latency_ms=10.0,
        user_code="def solve(nums):\n    return []", socratic_response="Which boundary did you test?",
    )


def test_session_state_and_turns_survive_new_connection(database_url):
    with session_scope(database_url) as db:
        session = TutorSession(session_id="durable", problem_id="two-sum-sorted")
        session.turns.append(turn("durable"))
        db.add(session)
    get_engine(database_url).dispose()
    with session_scope(database_url) as db:
        stored = db.get(TutorSession, "durable")
        assert stored.current_tier == 1
        assert stored.last_defect_hash == ""
        assert stored.attempts_on_current_defect == 0
        assert stored.is_solved is False
        assert stored.created_at.tzinfo == timezone.utc
        assert len(stored.turns) == 1
        stored.current_tier = 2
    with session_scope(database_url) as db:
        stored = db.get(TutorSession, "durable")
        assert stored.current_tier == 2
        assert stored.updated_at >= stored.created_at


def test_failed_unit_of_work_rolls_back_session_and_log(database_url):
    with pytest.raises(RuntimeError, match="abort"):
        with session_scope(database_url) as db:
            session = TutorSession(session_id="rolled-back", problem_id="two-sum-sorted")
            session.turns.append(turn("rolled-back"))
            db.add(session)
            db.flush()
            raise RuntimeError("abort")
    with session_scope(database_url) as db:
        assert db.get(TutorSession, "rolled-back") is None
        assert db.scalar(select(func.count()).select_from(SessionTurnLog)) == 0


def test_orphan_logs_and_duplicate_turn_numbers_are_rejected(database_url):
    with pytest.raises(IntegrityError):
        with session_scope(database_url) as db:
            db.add(turn("missing"))
    with session_scope(database_url) as db:
        session = TutorSession(session_id="unique", problem_id="two-sum-sorted")
        session.turns.append(turn("unique"))
        db.add(session)
    with pytest.raises(IntegrityError):
        with session_scope(database_url) as db:
            db.add(turn("unique"))
    with session_scope(database_url) as db:
        assert db.scalar(select(func.count()).select_from(SessionTurnLog)) == 1


def test_database_delete_cascades_turn_history(database_url):
    with session_scope(database_url) as db:
        session = TutorSession(session_id="reset", problem_id="two-sum-sorted")
        session.turns.append(turn("reset"))
        db.add(session)
    with session_scope(database_url) as db:
        db.execute(delete(TutorSession).where(TutorSession.session_id == "reset"))
    with session_scope(database_url) as db:
        assert db.scalar(select(func.count()).select_from(SessionTurnLog)) == 0


def test_tier_and_attempt_constraints_enforced(database_url):
    with pytest.raises(IntegrityError):
        with session_scope(database_url) as db:
            db.add(TutorSession(session_id="invalid", problem_id="two-sum-sorted", current_tier=5))
    with pytest.raises(IntegrityError):
        with session_scope(database_url) as db:
            db.add(TutorSession(session_id="invalid", problem_id="two-sum-sorted", attempts_on_current_defect=-1))


def test_sqlite_configuration(database_url):
    with get_engine(database_url).connect() as conn:
        assert conn.exec_driver_sql("PRAGMA foreign_keys").scalar_one() == 1
        assert conn.exec_driver_sql("PRAGMA journal_mode").scalar_one() == "wal"
        assert conn.exec_driver_sql("PRAGMA busy_timeout").scalar_one() == 5000
