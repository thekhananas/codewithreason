"""Deterministic adversarial vectors, verified minimization, and scale tests."""
from __future__ import annotations

import json
from typing import Any

from app.engine.sandbox import SandboxRunner
from app.models.schemas import (
    ASTAnalysisResult, ArchetypeResult, CounterexampleTrace, FailureCategory,
    FuzzingReport, ProblemSchema, SandboxResult,
)

FUNCTIONAL_ARCHETYPES = (
    "base_min_boundary", "duplicates_and_ties", "negative_or_extreme_values", "off_by_one_edge",
)


def generate_scale_input(problem: ProblemSchema | str, n: int) -> dict[str, Any]:
    kind = problem.scale_generator_type if isinstance(problem, ProblemSchema) else problem
    if n < 2:
        raise ValueError("Scale inputs need at least two elements")
    if kind == "sorted_two_sum":
        return {"nums": list(range(n)), "target": 2 * n - 3}
    if kind == "sliding_window_string":
        return {"s": "".join(chr(0x100 + i) for i in range(n))}
    if kind == "rotated_array":
        pivot = n // 3
        return {"nums": list(range(pivot, n)) + list(range(pivot))}
    if kind in {"dp_array", "kadane_array"}:
        return {"nums": [1] * n}
    if kind == "climbing_stairs":
        return {"n": n}
    raise ValueError(f"Unknown scale generator: {kind}")


def boundary_mutations(problem: ProblemSchema) -> list[tuple[str, dict[str, Any]]]:
    kind = problem.scale_generator_type
    base, ties, negative, edge = FUNCTIONAL_ARCHETYPES
    if kind == "sorted_two_sum":
        return [(base, {"nums": [0, 1], "target": 1}),
                (ties, {"nums": [0, 0], "target": 0}),
                (negative, {"nums": [-1, 1], "target": 0}),
                (edge, {"nums": [0, 1, 3], "target": 4})]
    if kind == "sliding_window_string":
        return [(base, {"s": ""}), (base, {"s": "a"}), (ties, {"s": "aa"}),
                (edge, {"s": "abba"}), (edge, {"s": "dvdf"}), (edge, {"s": "tmmzuxt"})]
    if kind == "rotated_array":
        return [(base, {"nums": [0]}), (edge, {"nums": [1, 0]}),
                (edge, {"nums": [0, 1]}), (edge, {"nums": [2, 0, 1]}),
                (negative, {"nums": [-1, -3, -2]})]
    if kind == "dp_array":
        return [(base, {"nums": [0]}), (base, {"nums": [1]}),
                (edge, {"nums": [0, 1]}), (ties, {"nums": [1, 1, 1]}),
                (edge, {"nums": [2, 1, 1, 2]})]
    if kind == "kadane_array":
        return [(negative, {"nums": [-1]}), (base, {"nums": [0]}),
                (edge, {"nums": [-1, 1]}), (ties, {"nums": [1, -1, 1]})]
    if kind == "climbing_stairs":
        return [(base, {"n": 1}), (edge, {"n": 2}), (edge, {"n": 3}), (edge, {"n": 5})]
    raise ValueError(f"Unknown mutation generator: {kind}")


def _category(reference: SandboxResult, user: SandboxResult) -> FailureCategory:
    if reference.failure_category != FailureCategory.ALL_PASSED:
        raise RuntimeError(f"Reference execution failed: {reference.error_type}: {reference.error_message}")
    if user.failure_category != FailureCategory.ALL_PASSED:
        return user.failure_category
    if user.output != reference.output:
        return FailureCategory.WRONG_ANSWER
    return FailureCategory.ALL_PASSED


def _trace(archetype: str, args: dict, reference: SandboxResult, user: SandboxResult,
           ratio: float | None = None) -> CounterexampleTrace:
    return CounterexampleTrace(
        archetype=archetype, input_args=args, expected_output=reference.output,
        actual_output=user.output, error_type=user.error_type,
        operation_ticks=user.operation_ticks, scale_tick_ratio=ratio,
        execution_time_ms=user.execution_time_ms, is_verified=True,
    )


def run_adversarial_fuzzing(problem: ProblemSchema, user_code: str,
                            ast_res: ASTAnalysisResult) -> FuzzingReport:
    if not ast_res.is_valid_syntax or ast_res.has_incomplete_placeholders:
        return FuzzingReport(failure_category=FailureCategory.SYNTAX_INCOMPLETE)

    # Deduplicate vectors while retaining every archetype membership.
    inputs: list[dict] = []
    lookup: dict[str, int] = {}
    membership: dict[str, list[int]] = {name: [] for name in FUNCTIONAL_ARCHETYPES}
    def add(args: dict) -> int:
        key = json.dumps(args, sort_keys=True)
        if key not in lookup:
            lookup[key] = len(inputs)
            inputs.append(args)
        return lookup[key]
    for spec in problem.archetype_tests:
        if spec.archetype in membership:
            membership[spec.archetype].append(add(spec.input_args))
    for archetype, args in boundary_mutations(problem):
        membership[archetype].append(add(args))
    scale1 = add(generate_scale_input(problem, 100))
    scale2 = add(generate_scale_input(problem, 1000))
    refs, users = SandboxRunner().run_dual(
        problem.reference_solution, user_code, problem.entrypoint_fn, inputs,
    )
    if len(refs) != len(inputs) or len(users) != len(inputs):
        raise RuntimeError("Sandbox returned an incomplete result batch")
    categories = [_category(ref, user) for ref, user in zip(refs, users)]

    results: list[ArchetypeResult] = []
    failures: list[tuple[CounterexampleTrace, FailureCategory]] = []
    for archetype, indices in membership.items():
        failed = [i for i in indices if categories[i] != FailureCategory.ALL_PASSED]
        results.append(ArchetypeResult(
            archetype=archetype, passed=not failed,
            operation_ticks=max((users[i].operation_ticks for i in indices), default=0),
            failure_reason=categories[failed[0]].value if failed else None,
        ))
        failures.extend((_trace(archetype, inputs[i], refs[i], users[i]), categories[i]) for i in failed)

    ratio = users[scale2].operation_ticks / max(users[scale1].operation_ticks, 1)
    scale_category = categories[scale2] if categories[scale2] != FailureCategory.ALL_PASSED else categories[scale1]
    exhausted = users[scale2].failure_category == FailureCategory.TIME_LIMIT_EXCEEDED
    if exhausted or ratio > problem.max_scale_tick_ratio:
        scale_category = FailureCategory.ASYMPTOTIC_SUBOPTIMAL
    results.append(ArchetypeResult(
        archetype="asymptotic_scale", passed=scale_category == FailureCategory.ALL_PASSED,
        operation_ticks=users[scale2].operation_ticks,
        failure_reason=(f"{scale_category.value}; tick ratio {ratio:.3f}"
                        if scale_category != FailureCategory.ALL_PASSED else None),
    ))
    # Functional evidence takes precedence; a wrong answer is not explained away
    # by a static complexity estimate. Minimize only genuinely breaking inputs.
    if failures:
        trace, failure = min(failures, key=lambda item: len(json.dumps(item[0].input_args)))
        return FuzzingReport(failure_category=failure, archetype_results=results, counterexample=trace)
    if scale_category != FailureCategory.ALL_PASSED:
        failing_scale = scale2 if categories[scale2] != FailureCategory.ALL_PASSED or scale_category == FailureCategory.ASYMPTOTIC_SUBOPTIMAL else scale1
        return FuzzingReport(
            failure_category=scale_category, archetype_results=results,
            counterexample=_trace("asymptotic_scale", inputs[failing_scale], refs[failing_scale], users[failing_scale], ratio),
        )
    return FuzzingReport(failure_category=FailureCategory.ALL_PASSED, archetype_results=results)
