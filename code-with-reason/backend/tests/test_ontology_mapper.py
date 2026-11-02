"""Real catalog evidence must produce stable, defect-scoped diagnoses."""

import hashlib

import pytest

from app.catalog.loader import get_catalog, get_problem
from app.engine.ontology_mapper import compute_defect_hash, diagnose_violated_invariant
from app.models.schemas import ASTAnalysisResult, CounterexampleTrace, FailureCategory


def analysis(**changes):
    return ASTAnalysisResult(is_valid_syntax=True, code_hash="source-v1", **changes)


def trace(args, expected, actual, archetype="off_by_one_edge", **changes):
    return CounterexampleTrace(
        archetype=archetype,
        input_args=args,
        expected_output=expected,
        actual_output=actual,
        **changes,
    )


@pytest.mark.parametrize("problem", list(get_catalog().values()), ids=lambda p: p.problem_id)
def test_syntax_and_placeholder_evidence_maps_to_structure(problem):
    invalid = ASTAnalysisResult(is_valid_syntax=False, syntax_error_msg="line 1: expected ':'", code_hash="broken")
    assert diagnose_violated_invariant(problem, invalid, None, FailureCategory.SYNTAX_INCOMPLETE).id == "structure"
    assert diagnose_violated_invariant(
        problem, analysis(has_incomplete_placeholders=True), None, FailureCategory.SYNTAX_INCOMPLETE
    ).id == "structure"


@pytest.mark.parametrize("problem", list(get_catalog().values()), ids=lambda p: p.problem_id)
def test_empirical_asymptotic_failure_maps_to_complexity(problem):
    observed = trace({}, None, None, "asymptotic_scale", scale_tick_ratio=100.0)
    diagnosed = diagnose_violated_invariant(problem, analysis(max_loop_depth=2), observed, FailureCategory.ASYMPTOTIC_SUBOPTIMAL)
    assert diagnosed.id == "complexity"
    assert diagnosed in problem.invariants


def test_two_sum_distinguishes_index_translation_from_wrong_pair():
    problem = get_problem("two-sum-sorted")
    args = {"nums": [2, 7], "target": 9}
    assert diagnose_violated_invariant(problem, analysis(), trace(args, [1, 2], [0, 1]), FailureCategory.WRONG_ANSWER).id == "indexing"
    assert diagnose_violated_invariant(problem, analysis(), trace(args, [1, 2], []), FailureCategory.WRONG_ANSWER).id == "boundary"


def test_static_complexity_estimate_does_not_replace_verified_functional_defect():
    problem = get_problem("two-sum-sorted")
    observed = trace({"nums": [2, 7], "target": 9}, [1, 2], [0, 1])
    diagnosed = diagnose_violated_invariant(
        problem, analysis(max_loop_depth=2, estimated_time_complexity="O(N^2)"), observed, FailureCategory.WRONG_ANSWER
    )
    assert diagnosed.id == "indexing"


def test_all_negative_kadane_has_specific_invariant():
    problem = get_problem("max-subarray-kadane")
    assert diagnose_violated_invariant(problem, analysis(), trace({"nums": [-3, -1, -5]}, -1, 0), FailureCategory.WRONG_ANSWER).id == "negative"
    assert diagnose_violated_invariant(problem, analysis(), trace({"nums": [-2, 4, -1]}, 4, 2), FailureCategory.WRONG_ANSWER).id == "boundary"


def test_stale_duplicate_window_and_empty_boundary_are_distinct():
    problem = get_problem("longest-unique-substring")
    assert diagnose_violated_invariant(problem, analysis(), trace({"s": "abba"}, 2, 3), FailureCategory.WRONG_ANSWER).id == "window"
    assert diagnose_violated_invariant(problem, analysis(), trace({"s": ""}, 0, 1), FailureCategory.WRONG_ANSWER).id == "boundary"


def test_rotated_search_nonprogress_differs_from_empirical_linear_scan():
    problem = get_problem("rotated-sorted-min")
    observed = trace({"nums": [2, 1]}, 1, None, error_type="TLE_TICK_LIMIT_EXCEEDED")
    assert diagnose_violated_invariant(problem, analysis(max_loop_depth=1), observed, FailureCategory.TIME_LIMIT_EXCEEDED).id == "progress"
    scale = trace({"nums": list(range(100))}, 0, 0, "asymptotic_scale", scale_tick_ratio=9.9)
    assert diagnose_violated_invariant(problem, analysis(max_loop_depth=1), scale, FailureCategory.ASYMPTOTIC_SUBOPTIMAL).id == "complexity"
    assert diagnose_violated_invariant(problem, analysis(), trace({"nums": [2, 1]}, 1, 2), FailureCategory.WRONG_ANSWER).id == "boundary"


def test_house_robber_small_prefix_and_illegal_adjacency_are_distinct():
    problem = get_problem("house-robber-dp")
    assert diagnose_violated_invariant(problem, analysis(), trace({"nums": [7]}, 7, 0), FailureCategory.WRONG_ANSWER).id == "base_case"
    assert diagnose_violated_invariant(problem, analysis(), trace({"nums": [2, 2, 2]}, 4, 6), FailureCategory.WRONG_ANSWER).id == "adjacency"


def test_supplemental_climbing_stairs_diagnoses_base_count():
    problem = get_problem("climbing_stairs_dp")
    assert diagnose_violated_invariant(problem, analysis(), trace({"n": 2}, 2, 1), FailureCategory.WRONG_ANSWER).id == "base_case"
    assert diagnose_violated_invariant(problem, analysis(uses_recursion=True), None, FailureCategory.TIME_LIMIT_EXCEEDED).id == "complexity"


def test_defect_signature_is_stable_but_changes_when_invariant_or_category_changes():
    expected = hashlib.sha256(b"two-sum-sorted|indexing|WRONG_ANSWER").hexdigest()[:16]
    assert compute_defect_hash("two-sum-sorted", "indexing", FailureCategory.WRONG_ANSWER) == expected
    assert compute_defect_hash("two-sum-sorted", "indexing", "WRONG_ANSWER") == expected
    assert compute_defect_hash("two-sum-sorted", "boundary", FailureCategory.WRONG_ANSWER) != expected
    assert compute_defect_hash("two-sum-sorted", "indexing", FailureCategory.RUNTIME_EXCEPTION) != expected
