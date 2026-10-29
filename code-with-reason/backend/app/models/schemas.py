"""Stable public contracts from the SocraGate v3 blueprint."""
from enum import Enum, IntEnum
from typing import Any, Literal

from pydantic import BaseModel, Field


class ScaffoldingTier(IntEnum):
    TIER_1_PROBE = 1
    TIER_2_COUNTEREXAMPLE = 2
    TIER_3_SCAFFOLD = 3
    TIER_4_POSTMORTEM = 4


class FailureCategory(str, Enum):
    ALL_PASSED = "ALL_PASSED"
    SYNTAX_INCOMPLETE = "SYNTAX_INCOMPLETE"
    WRONG_ANSWER = "WRONG_ANSWER"
    RUNTIME_EXCEPTION = "RUNTIME_EXCEPTION"
    TIME_LIMIT_EXCEEDED = "TIME_LIMIT_EXCEEDED"
    ASYMPTOTIC_SUBOPTIMAL = "ASYMPTOTIC_SUBOPTIMAL"


class InvariantNode(BaseModel):
    id: str
    name: str
    rule: str
    tier1_probe: str
    tier2_probe: str
    tier3_scaffold: str


class ArchetypeTestSpec(BaseModel):
    archetype: str
    input_args: dict[str, Any]


class ProblemSchema(BaseModel):
    problem_id: str
    title: str
    difficulty: str
    category: str
    description: str
    constraints: list[str]
    entrypoint_fn: str
    starter_code: str
    reference_solution: str
    target_time_complexity: str
    target_space_complexity: str
    max_scale_tick_ratio: float = 45.0
    forbidden_leak_patterns: list[str]
    invariants: list[InvariantNode]
    archetype_tests: list[ArchetypeTestSpec]
    scale_generator_type: str


class ProblemPublicSchema(BaseModel):
    problem_id: str
    title: str
    difficulty: str
    category: str
    description: str
    constraints: list[str]
    entrypoint_fn: str
    starter_code: str
    target_time_complexity: str
    target_space_complexity: str


class ASTAnalysisResult(BaseModel):
    is_valid_syntax: bool
    syntax_error_msg: str | None = None
    has_incomplete_placeholders: bool = False
    max_loop_depth: int = 0
    uses_recursion: bool = False
    has_base_case_guard: bool = False
    has_logarithmic_halving: bool = False
    detected_constructs: list[str] = Field(default_factory=list)
    estimated_time_complexity: str = "O(1)"
    code_hash: str
    instrumented_code: str | None = None


class ArchetypeResult(BaseModel):
    archetype: str
    passed: bool
    operation_ticks: int = 0
    failure_reason: str | None = None


class CounterexampleTrace(BaseModel):
    archetype: str
    input_args: dict[str, Any]
    expected_output: Any
    actual_output: Any
    error_type: str | None = None
    operation_ticks: int = 0
    scale_tick_ratio: float | None = None
    execution_time_ms: float = 0.0
    is_verified: bool = True


class EvaluateRequest(BaseModel):
    session_id: str = Field(..., min_length=1, max_length=128)
    problem_id: str = Field(..., min_length=1, max_length=128)
    user_code: str = Field(..., min_length=1, max_length=50000)
    user_message: str | None = Field(default="", max_length=10000)
    action: Literal["submit_code", "request_next_tier", "unlock_escape_hatch"] = "submit_code"


class EvaluateResponse(BaseModel):
    session_id: str
    problem_id: str
    current_tier: ScaffoldingTier
    failure_category: FailureCategory
    defect_hash: str
    previous_defect_resolved: bool = False
    ast_summary: ASTAnalysisResult
    archetype_results: list[ArchetypeResult] = Field(default_factory=list)
    violated_invariant: str | None = None
    counterexample: CounterexampleTrace | None = None
    scaffold_template: str | None = None
    socratic_response: str
    shield_triggered: bool = False
    shield_reason: str | None = None
    latency_ms: float


class ShieldAuditResult(BaseModel):
    response_text: str
    shield_triggered: bool = False
    shield_reason: str | None = None
    retry_latency_ms: float = 0.0


class FuzzingReport(BaseModel):
    failure_category: FailureCategory
    archetype_results: list[ArchetypeResult] = Field(default_factory=list)
    counterexample: CounterexampleTrace | None = None


class SandboxResult(BaseModel):
    output: Any = None
    operation_ticks: int = 0
    execution_time_ms: float = 0.0
    error_type: str | None = None
    error_message: str | None = None
    failure_category: FailureCategory = FailureCategory.ALL_PASSED
