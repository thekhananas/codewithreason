"""Deterministic diagnosis of an observed defect against a curated ontology."""

from __future__ import annotations

import hashlib

from app.models.schemas import (
    ASTAnalysisResult,
    CounterexampleTrace,
    FailureCategory,
    InvariantNode,
    ProblemSchema,
)


def compute_defect_hash(
    problem_id: str, invariant_id: str, failure_category: FailureCategory
) -> str:
    """Identify a defect independently of code formatting and conversational text."""
    category = FailureCategory(failure_category).value
    signature = f"{problem_id}|{invariant_id}|{category}"
    return hashlib.sha256(signature.encode("utf-8")).hexdigest()[:16]


def _select(problem: ProblemSchema, invariant_id: str) -> InvariantNode:
    for invariant in problem.invariants:
        if invariant.id == invariant_id:
            return invariant
    if not problem.invariants:
        raise ValueError(f"Problem has no invariant ontology: {problem.problem_id}")
    return problem.invariants[0]


def _is_zero_based_pair(trace: CounterexampleTrace | None) -> bool:
    if trace is None:
        return False
    expected, actual = trace.expected_output, trace.actual_output
    return (
        isinstance(expected, (list, tuple))
        and isinstance(actual, (list, tuple))
        and len(expected) == len(actual) == 2
        and all(type(value) is int for value in (*expected, *actual))
        and all(observed == wanted - 1 for wanted, observed in zip(expected, actual))
    )


def diagnose_violated_invariant(
    problem: ProblemSchema,
    ast_res: ASTAnalysisResult,
    trace: CounterexampleTrace | None,
    failure_category: FailureCategory,
) -> InvariantNode:
    """Map execution evidence to a stable, problem-specific invariant.

    Empirical scale evidence takes precedence over functional signatures. Static
    loop nesting alone never overrides an observed functional defect: an AST
    estimate cannot establish which bug caused a particular wrong output.
    """
    category = FailureCategory(failure_category)
    if (
        category == FailureCategory.SYNTAX_INCOMPLETE
        or not ast_res.is_valid_syntax
        or ast_res.has_incomplete_placeholders
    ):
        return _select(problem, "structure")

    if category == FailureCategory.ASYMPTOTIC_SUBOPTIMAL or (
        trace is not None
        and trace.scale_tick_ratio is not None
        and trace.scale_tick_ratio > problem.max_scale_tick_ratio
    ):
        return _select(problem, "complexity")

    kind = problem.scale_generator_type
    if category == FailureCategory.TIME_LIMIT_EXCEEDED:
        if kind == "rotated_array":
            return _select(problem, "progress")
        return _select(problem, "complexity")

    args = trace.input_args if trace is not None else {}
    if kind == "sorted_two_sum":
        return _select(problem, "indexing" if _is_zero_based_pair(trace) else "boundary")
    if kind == "kadane_array":
        nums = args.get("nums", [])
        all_negative = (
            isinstance(nums, list)
            and bool(nums)
            and all(isinstance(value, (int, float)) and value < 0 for value in nums)
        )
        return _select(problem, "negative" if all_negative else "boundary")
    if kind == "sliding_window_string":
        text = args.get("s", "")
        has_duplicate = isinstance(text, str) and len(set(text)) < len(text)
        return _select(problem, "window" if has_duplicate else "boundary")
    if kind == "rotated_array":
        return _select(problem, "boundary")
    if kind == "dp_array":
        nums = args.get("nums", [])
        small_prefix = isinstance(nums, list) and len(nums) <= 2 and trace is not None
        return _select(problem, "base_case" if small_prefix else "adjacency")
    if kind == "climbing_stairs":
        n = args.get("n")
        small_height = isinstance(n, int) and n <= 2
        return _select(problem, "base_case" if small_height else "boundary")
    return _select(problem, "structure")
