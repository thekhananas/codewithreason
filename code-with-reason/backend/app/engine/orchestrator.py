"""LangGraph workflow and atomic, defect-scoped session transitions."""
from __future__ import annotations

from functools import lru_cache
from time import perf_counter
from typing import TypedDict

from langgraph.graph import END, START, StateGraph
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.catalog.loader import get_problem
from app.config import get_settings
from app.engine.ast_analyzer import analyze_python_code
from app.engine.fuzzer import run_adversarial_fuzzing
from app.engine.llm_client import LLMClient
from app.engine.ontology_mapper import compute_defect_hash, diagnose_violated_invariant
from app.engine.shield import SocraGateShield
from app.models.db_models import SessionTurnLog, TutorSession
from app.models.schemas import (
    ASTAnalysisResult, EvaluateRequest, EvaluateResponse, FailureCategory,
    FuzzingReport, InvariantNode, ProblemSchema, ScaffoldingTier, ShieldAuditResult,
)


class SessionProblemMismatch(ValueError):
    """A session ID is already bound to another problem."""


class TutorState(TypedDict, total=False):
    request: EvaluateRequest
    problem: ProblemSchema
    session: TutorSession
    llm: LLMClient
    ast: ASTAnalysisResult
    report: FuzzingReport
    invariant: InvariantNode | None
    tier: ScaffoldingTier
    defect_hash: str
    previous_defect_resolved: bool
    prose: str
    audit: ShieldAuditResult


def ast_node(state: TutorState) -> dict:
    return {"ast": analyze_python_code(state["request"].user_code, state["problem"].entrypoint_fn,
                                       get_settings().MAX_AST_TICKS)}


def conditional_router(state: TutorState) -> str:
    analysis = state["ast"]
    return "fuzz_node" if analysis.is_valid_syntax and not analysis.has_incomplete_placeholders else "static_ontology_node"


def static_ontology_node(state: TutorState) -> dict:
    category = FailureCategory.SYNTAX_INCOMPLETE
    return {"report": FuzzingReport(failure_category=category),
            "invariant": diagnose_violated_invariant(state["problem"], state["ast"], None, category)}


def fuzz_node(state: TutorState) -> dict:
    problem = state["problem"]
    report = run_adversarial_fuzzing(problem, state["request"].user_code, state["ast"])
    invariant = (None if report.failure_category == FailureCategory.ALL_PASSED else
                 diagnose_violated_invariant(problem, state["ast"], report.counterexample, report.failure_category))
    return {"report": report, "invariant": invariant}


def tier_controller_node(state: TutorState) -> dict:
    session, request = state["session"], state["request"]
    solved = state["report"].failure_category == FailureCategory.ALL_PASSED
    invariant = state["invariant"]
    defect_hash = ("" if solved else compute_defect_hash(state["problem"].problem_id,
                    invariant.id, state["report"].failure_category))
    changed = bool(session.last_defect_hash) and defect_hash != session.last_defect_hash
    if solved:
        tier = session.current_tier
        previous_resolved = changed and not session.is_solved
    elif request.action == "unlock_escape_hatch":
        tier, previous_resolved = 4, False
    elif not session.last_defect_hash:
        tier, previous_resolved = 1, False
    elif changed:
        tier, previous_resolved = 1, True
    elif request.action == "request_next_tier" or (
        request.action == "submit_code" and state["ast"].code_hash != session.last_code_hash
    ):
        tier, previous_resolved = min(3, session.current_tier + 1), False
    else:
        tier, previous_resolved = session.current_tier, False
    return {"tier": ScaffoldingTier(tier), "defect_hash": defect_hash,
            "previous_defect_resolved": previous_resolved}


def socratic_generator_node(state: TutorState) -> dict:
    if state["report"].failure_category == FailureCategory.ALL_PASSED:
        text = ("All five archetypes passed, including the empirical scale check. "
                "Can you explain why your invariant holds on the boundary cases?")
    else:
        text = state["llm"].generate_response(
            state["problem"], state["invariant"], state["tier"], state["report"].counterexample,
            state["request"].user_code, state["request"].user_message or "",
        )
    return {"prose": text}


def shield_interceptor_node(state: TutorState) -> dict:
    invariant = state["invariant"] or state["problem"].invariants[0]
    return {"audit": SocraGateShield().inspect_and_enforce(
        state["prose"], state["tier"], state["problem"], invariant,
    )}


@lru_cache(maxsize=1)
def get_tutor_graph():
    graph = StateGraph(TutorState)
    for node in (ast_node, static_ontology_node, fuzz_node, tier_controller_node,
                 socratic_generator_node, shield_interceptor_node):
        graph.add_node(node.__name__, node)
    graph.add_edge(START, "ast_node")
    graph.add_conditional_edges("ast_node", conditional_router, {
        "fuzz_node": "fuzz_node", "static_ontology_node": "static_ontology_node",
    })
    graph.add_edge("static_ontology_node", "tier_controller_node")
    graph.add_edge("fuzz_node", "tier_controller_node")
    graph.add_edge("tier_controller_node", "socratic_generator_node")
    graph.add_edge("socratic_generator_node", "shield_interceptor_node")
    graph.add_edge("shield_interceptor_node", END)
    return graph.compile(name="socragate")


def begin_sqlite_write(db: Session) -> None:
    """Serialize SQLite read/modify/write transitions across workers as well.

    Starting the write transaction before reading the active tier avoids lost
    updates and duplicate turn indices under concurrent requests.
    """
    connection = db.connection()
    if connection.dialect.name == "sqlite" and not connection.connection.driver_connection.in_transaction:
        connection.exec_driver_sql("BEGIN IMMEDIATE")


def evaluate_submission(request: EvaluateRequest, db: Session,
                        llm_client: LLMClient | None = None) -> EvaluateResponse:
    started = perf_counter()
    problem = get_problem(request.problem_id)
    try:
        begin_sqlite_write(db)
        session = db.get(TutorSession, request.session_id)
        if session is not None and session.problem_id != problem.problem_id:
            raise SessionProblemMismatch("This session belongs to another problem; reset it or use a new session ID")
        if session is None:
            session = TutorSession(
                session_id=request.session_id, problem_id=problem.problem_id, current_tier=1,
                last_defect_hash="", last_code_hash="", attempts_on_current_defect=0, is_solved=False,
            )
            db.add(session)
            db.flush()
        result = get_tutor_graph().invoke(
            {"request": request, "problem": problem, "session": session, "llm": llm_client or LLMClient()},
            config={"recursion_limit": 16},
        )
        report, tier, audit = result["report"], result["tier"], result["audit"]
        invariant = result["invariant"]
        # Only disclosed evidence is persisted. A Tier 1 session read cannot be
        # used to recover the counterexample withheld by the evaluation route.
        trace = report.counterexample if tier >= 2 else None
        scaffold = invariant.tier3_scaffold if invariant is not None and tier >= 3 else None
        response = EvaluateResponse(
            session_id=request.session_id, problem_id=problem.problem_id, current_tier=tier,
            failure_category=report.failure_category, defect_hash=result["defect_hash"],
            previous_defect_resolved=result["previous_defect_resolved"], ast_summary=result["ast"],
            archetype_results=report.archetype_results, violated_invariant=invariant.id if invariant else None,
            counterexample=trace, scaffold_template=scaffold, socratic_response=audit.response_text,
            shield_triggered=audit.shield_triggered, shield_reason=audit.shield_reason, latency_ms=0,
        )
        if report.failure_category == FailureCategory.ALL_PASSED:
            session.attempts_on_current_defect = 0
        elif result["defect_hash"] != session.last_defect_hash:
            session.attempts_on_current_defect = 1
        elif request.action == "submit_code" and result["ast"].code_hash != session.last_code_hash:
            session.attempts_on_current_defect += 1
        session.current_tier = int(tier)
        session.last_defect_hash = result["defect_hash"]
        session.last_code_hash = result["ast"].code_hash
        session.is_solved = report.failure_category == FailureCategory.ALL_PASSED
        last_turn = db.scalar(select(func.max(SessionTurnLog.turn_index)).where(
            SessionTurnLog.session_id == request.session_id,
        )) or 0
        response.latency_ms = round((perf_counter() - started) * 1000, 3)
        db.add(SessionTurnLog(
            session_id=request.session_id, turn_index=last_turn + 1, action=request.action,
            tier_used=int(tier), failure_category=report.failure_category.value,
            defect_hash=result["defect_hash"], violated_invariant_id=invariant.id if invariant else None,
            shield_triggered=audit.shield_triggered, latency_ms=response.latency_ms,
            user_code=request.user_code, socratic_response=audit.response_text,
            counterexample_json=trace.model_dump_json() if trace is not None else None,
        ))
        db.commit()
        return response
    except BaseException:
        db.rollback()
        raise
