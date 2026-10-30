"""Load trusted local problem definitions while keeping public contracts separate."""

from __future__ import annotations

import ast
import json
from functools import lru_cache
from pathlib import Path

from app.models.schemas import ProblemPublicSchema, ProblemSchema


_CATALOG_PATH = Path(__file__).with_name("problems.json")
_SUPPLEMENTAL_PATH = Path(__file__).resolve().parents[3] / "data" / "problems.json"
_EXPECTED_IDS = {
    "two-sum-sorted",
    "longest-unique-substring",
    "rotated-sorted-min",
    "house-robber-dp",
    "max-subarray-kadane",
}
_ARCHETYPES = {
    "base_min_boundary",
    "duplicates_and_ties",
    "negative_or_extreme_values",
    "off_by_one_edge",
    "asymptotic_scale",
}
_ALIASES = {
    "two_sum_sorted": "two-sum-sorted",
    "longest_unique_substring": "longest-unique-substring",
    "find_min_rotated": "rotated-sorted-min",
    "max_subarray_kadane": "max-subarray-kadane",
    "house_robber_dp": "house-robber-dp",
    "climbing-stairs-dp": "climbing_stairs_dp",
}


def _validate_record(raw: dict) -> ProblemSchema:
    problem = ProblemSchema.model_validate(raw)
    invariant_ids = [node.id for node in problem.invariants]
    if not invariant_ids or len(set(invariant_ids)) != len(invariant_ids):
        raise ValueError(f"Missing or duplicate invariant IDs: {problem.problem_id}")
    if not problem.forbidden_leak_patterns or any(
        not pattern.strip() for pattern in problem.forbidden_leak_patterns
    ):
        raise ValueError(f"Missing leak patterns: {problem.problem_id}")
    for node in problem.invariants:
        if not all(
            value.strip()
            for value in (node.id, node.name, node.rule, node.tier1_probe, node.tier2_probe, node.tier3_scaffold)
        ):
            raise ValueError(f"Incomplete ontology node: {problem.problem_id}/{node.id}")
    names = [test.archetype for test in problem.archetype_tests]
    if len(names) != 5 or set(names) != _ARCHETYPES:
        raise ValueError(f"Exactly five unique archetypes are required: {problem.problem_id}")
    if problem.max_scale_tick_ratio <= 0:
        raise ValueError(f"Scale ratio must be positive: {problem.problem_id}")

    reference_tree = ast.parse(problem.reference_solution)
    functions = [
        node for node in reference_tree.body
        if isinstance(node, ast.FunctionDef) and node.name == problem.entrypoint_fn
    ]
    if len(functions) != 1 or any(isinstance(node, ast.Pass) for node in ast.walk(functions[0])):
        raise ValueError(f"Complete reference entrypoint required: {problem.problem_id}")
    function = functions[0]
    if function.args.posonlyargs or function.args.vararg or function.args.kwarg:
        raise ValueError(f"Reference entrypoint must accept named inputs: {problem.problem_id}")
    accepted = {arg.arg for arg in (*function.args.args, *function.args.kwonlyargs)}
    defaulted = {
        arg.arg for arg in function.args.args[len(function.args.args) - len(function.args.defaults):]
    } if function.args.defaults else set()
    defaulted.update(
        arg.arg for arg, default in zip(function.args.kwonlyargs, function.args.kw_defaults)
        if default is not None
    )
    required = accepted - defaulted
    for test in problem.archetype_tests:
        supplied = set(test.input_args)
        if not required <= supplied <= accepted:
            raise ValueError(f"Invalid test arguments: {problem.problem_id}/{test.archetype}")
    starter_tree = ast.parse(problem.starter_code)
    if not any(
        isinstance(node, ast.FunctionDef) and node.name == problem.entrypoint_fn
        for node in starter_tree.body
    ):
        raise ValueError(f"Starter entrypoint missing: {problem.problem_id}")
    return problem


def _load(path: Path) -> dict[str, ProblemSchema]:
    raw_records = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw_records, list):
        raise ValueError(f"Expected a list of problem records: {path}")
    problems = {}
    for raw in raw_records:
        problem = _validate_record(raw)
        if problem.problem_id in problems:
            raise ValueError(f"Duplicate problem ID: {problem.problem_id}")
        problems[problem.problem_id] = problem
    return problems


@lru_cache(maxsize=1)
def get_catalog() -> dict[str, ProblemSchema]:
    """Return the five canonical v3 problems; compatibility seeds stay separate."""
    catalog = _load(_CATALOG_PATH)
    if set(catalog) != _EXPECTED_IDS:
        raise ValueError("Canonical catalog does not contain the five specified problem IDs")
    return catalog


@lru_cache(maxsize=1)
def _get_supplemental_catalog() -> dict[str, ProblemSchema]:
    return _load(_SUPPLEMENTAL_PATH)


def get_problem(problem_id: str) -> ProblemSchema:
    """Resolve canonical IDs, underscore aliases, and the supplemental stairs task."""
    canonical_id = _ALIASES.get(problem_id, problem_id)
    if canonical_id == "climbing_stairs_dp":
        return _get_supplemental_catalog()[canonical_id]
    try:
        return get_catalog()[canonical_id]
    except KeyError:
        raise KeyError(f"Unknown problem: {problem_id}") from None


def list_public_problems() -> list[ProblemPublicSchema]:
    """Explicit public projection excludes references, ontologies, and leak patterns."""
    return [ProblemPublicSchema.model_validate(problem.model_dump()) for problem in get_catalog().values()]


def get_public_problem(problem_id: str) -> ProblemPublicSchema:
    return ProblemPublicSchema.model_validate(get_problem(problem_id).model_dump())
