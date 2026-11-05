"""Versioned API routes with explicit public catalog projections."""
from __future__ import annotations

import json
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, select, text
from sqlalchemy.orm import Session

from app.catalog.loader import get_public_problem, list_public_problems
from app.engine.llm_client import LLMClient
from app.engine.orchestrator import SessionProblemMismatch, evaluate_submission
from app.models.db_models import SessionTurnLog, TutorSession, get_db
from app.models.schemas import EvaluateRequest, EvaluateResponse, ProblemPublicSchema


router = APIRouter(prefix="/api/v1")
Database = Annotated[Session, Depends(get_db)]


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "version": "3.0.0", "mode": LLMClient()._provider()}


@router.get("/problems", response_model=list[ProblemPublicSchema])
def problems() -> list[ProblemPublicSchema]:
    return list_public_problems()


@router.get("/problems/{problem_id}", response_model=ProblemPublicSchema)
def problem_detail(problem_id: str) -> ProblemPublicSchema:
    try:
        return get_public_problem(problem_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=exc.args[0]) from None


@router.post("/evaluate", response_model=EvaluateResponse)
def evaluate(request: EvaluateRequest, db: Database) -> EvaluateResponse:
    try:
        return evaluate_submission(request, db)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=exc.args[0]) from None
    except SessionProblemMismatch as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from None


def _turn_payload(turn: SessionTurnLog, active_tier: int, current_defect_hash: str) -> dict:
    counterexample = None
    if (active_tier >= 2 and turn.tier_used >= 2
            and turn.defect_hash == current_defect_hash and turn.counterexample_json):
        try:
            counterexample = json.loads(turn.counterexample_json)
        except (TypeError, ValueError):
            # A malformed historical record must not break session recovery.
            counterexample = None
    return {
        "id": turn.id,
        "session_id": turn.session_id,
        "turn_index": turn.turn_index,
        "action": turn.action,
        "tier_used": turn.tier_used,
        "failure_category": turn.failure_category,
        "defect_hash": turn.defect_hash,
        "violated_invariant_id": turn.violated_invariant_id,
        "shield_triggered": turn.shield_triggered,
        "latency_ms": turn.latency_ms,
        "user_code": turn.user_code,
        "socratic_response": (
            "This earlier post-mortem is available only while the escape hatch is unlocked."
            if turn.tier_used == 4 and active_tier < 4 else turn.socratic_response
        ),
        "counterexample": counterexample,
    }


@router.get("/sessions/{session_id}")
def session_detail(session_id: str, db: Database) -> dict:
    session = db.get(TutorSession, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    turns = db.scalars(select(SessionTurnLog).where(
        SessionTurnLog.session_id == session_id,
    ).order_by(SessionTurnLog.turn_index)).all()
    return {
        "session_id": session.session_id,
        "problem_id": session.problem_id,
        "current_tier": session.current_tier,
        "last_defect_hash": session.last_defect_hash,
        "last_code_hash": session.last_code_hash,
        "attempts_on_current_defect": session.attempts_on_current_defect,
        "is_solved": session.is_solved,
        "created_at": session.created_at,
        "updated_at": session.updated_at,
        "turns": [_turn_payload(turn, session.current_tier, session.last_defect_hash) for turn in turns],
    }


@router.post("/sessions/{session_id}/reset")
def reset_session(session_id: str, db: Database) -> dict[str, str]:
    try:
        if db.get_bind().dialect.name == "sqlite":
            # Serialize with evaluation before reading the session or its turns.
            db.execute(text("BEGIN IMMEDIATE"))
        session = db.get(TutorSession, session_id)
        if session is None:
            raise HTTPException(status_code=404, detail="Session not found")
        db.execute(delete(SessionTurnLog).where(SessionTurnLog.session_id == session_id))
        db.delete(session)
        db.commit()
    except BaseException:
        db.rollback()
        raise
    return {"session_id": session_id, "status": "reset"}
