"""Exercise real isolated execution, tick budgets, and reference-grounded fuzzing."""
from copy import deepcopy
import json
from textwrap import dedent

import pytest

from app.catalog.loader import get_catalog, get_problem
from app.engine.ast_analyzer import analyze_python_code
from app.engine.fuzzer import generate_scale_input, run_adversarial_fuzzing
from app.engine.sandbox import SandboxRunner
from app.models.schemas import FailureCategory


ARCHETYPES = {
    "base_min_boundary", "duplicates_and_ties", "negative_or_extreme_values",
    "off_by_one_edge", "asymptotic_scale",
}


def fuzz(problem_id: str, code: str):
    problem = get_problem(problem_id)
    source = dedent(code).strip()
    ast_result = analyze_python_code(source, problem.entrypoint_fn)
    return run_adversarial_fuzzing(problem, source, ast_result)


@pytest.mark.parametrize("problem_id", list(get_catalog()))
def test_every_reference_solution_passes_all_five_archetypes(problem_id):
    problem = get_problem(problem_id)
    report = fuzz(problem_id, problem.reference_solution)
    assert report.failure_category == FailureCategory.ALL_PASSED
    assert report.counterexample is None
    assert len(report.archetype_results) == 5
    assert {result.archetype for result in report.archetype_results} == ARCHETYPES
    assert all(result.passed for result in report.archetype_results)
    assert all(result.operation_ticks > 0 for result in report.archetype_results)


@pytest.mark.parametrize("problem_id", list(get_catalog()))
def test_scale_generators_create_tenfold_inputs_and_valid_reference_vectors(problem_id):
    problem = get_problem(problem_id)
    small = generate_scale_input(problem, 100)
    large = generate_scale_input(problem.scale_generator_type, 1000)
    data_key = "s" if problem.scale_generator_type == "sliding_window_string" else "nums"
    assert len(small[data_key]) == 100
    assert len(large[data_key]) == 1000
    results = SandboxRunner().run_batch(problem.reference_solution, problem.entrypoint_fn, [small, large])
    assert len(results) == 2
    assert all(result.failure_category == FailureCategory.ALL_PASSED for result in results)
    assert results[1].operation_ticks > 0


ZERO_INDEX_TWO_SUM = """
    def two_sum_sorted(nums, target):
        left, right = 0, len(nums) - 1
        while left < right:
            total = nums[left] + nums[right]
            if total == target:
                return [left, right]
            if total < target:
                left += 1
            else:
                right -= 1
        return []
"""


def test_off_by_one_failure_is_minimized_and_independently_replayable():
    problem = get_problem("two-sum-sorted")
    report = fuzz(problem.problem_id, ZERO_INDEX_TWO_SUM)
    assert report.failure_category == FailureCategory.WRONG_ANSWER
    trace = report.counterexample
    assert trace is not None and trace.is_verified
    assert len(trace.input_args["nums"]) == 2
    assert trace.expected_output != trace.actual_output
    functional_inputs = [test.input_args for test in problem.archetype_tests if test.archetype != "asymptotic_scale"]
    assert len(json.dumps(trace.input_args)) <= min(len(json.dumps(args)) for args in functional_inputs)
    references, students = SandboxRunner().run_dual(
        problem.reference_solution, dedent(ZERO_INDEX_TWO_SUM).strip(), problem.entrypoint_fn, [trace.input_args],
    )
    assert references[0].failure_category == FailureCategory.ALL_PASSED
    assert references[0].output == trace.expected_output
    assert students[0].output == trace.actual_output
    assert trace.operation_ticks == students[0].operation_ticks


def test_infinite_loop_terminates_by_ticks_in_under_100ms_execution_time():
    result = SandboxRunner(max_ticks=1000).run("def solve():\n    while True:\n        pass", "solve", {})
    assert result.failure_category == FailureCategory.TIME_LIMIT_EXCEEDED
    assert result.operation_ticks > 1000
    assert "TLE_TICK_LIMIT_EXCEEDED" in f"{result.error_type} {result.error_message}"
    assert result.execution_time_ms < 100


def test_catching_runtime_error_cannot_swallow_private_tick_limit():
    result = SandboxRunner(max_ticks=1000).run(dedent("""
        def solve():
            try:
                while True:
                    pass
            except RuntimeError:
                return "budget swallowed"
    """).strip(), "solve", {})
    assert result.failure_category == FailureCategory.TIME_LIMIT_EXCEEDED
    assert result.output != "budget swallowed"
    assert result.operation_ticks > 1000


BRUTE_FORCE_TWO_SUM = """
    def two_sum_sorted(nums, target):
        for i in range(len(nums)):
            for j in range(i + 1, len(nums)):
                if nums[i] + nums[j] == target:
                    return [i + 1, j + 1]
        return []
"""


def test_quadratic_two_sum_is_caught_by_empirical_scale_check():
    report = fuzz("two-sum-sorted", BRUTE_FORCE_TWO_SUM)
    assert report.failure_category == FailureCategory.ASYMPTOTIC_SUBOPTIMAL
    by_name = {result.archetype: result for result in report.archetype_results}
    assert all(by_name[name].passed for name in ARCHETYPES - {"asymptotic_scale"})
    assert not by_name["asymptotic_scale"].passed
    trace = report.counterexample
    assert trace is not None and trace.archetype == "asymptotic_scale"
    assert trace.scale_tick_ratio is not None
    assert trace.scale_tick_ratio > 45 or trace.operation_ticks > 150000


@pytest.mark.parametrize(
    "source",
    [
        """
        def find_min(nums):
            answer = nums[0]
            for value in nums:
                if value < answer:
                    answer = value
            return answer
        """,
        """
        def find_min(nums):
            return min(nums)
        """,
    ],
)
def test_linear_rotated_minimum_including_builtin_scan_fails_logarithmic_target(source):
    report = fuzz("rotated-sorted-min", source)
    assert report.failure_category == FailureCategory.ASYMPTOTIC_SUBOPTIMAL
    assert report.counterexample is not None
    assert report.counterexample.scale_tick_ratio > 4
    assert all(result.passed for result in report.archetype_results if result.archetype != "asymptotic_scale")


@pytest.mark.parametrize(
    "source",
    [
        "import os\ndef solve():\n    return os.getcwd()",
        "def solve():\n    return open('/tmp/socragate-should-not-open', 'w')",
        "def solve():\n    return ().__class__",
        "import typing\ndef solve():\n    return typing.sys.version",
        "def solve():\n    __sg_tick__ = lambda **kwargs: None\n    return 1",
        "def solve():\n    return eval('1 + 1')",
        "from math import *\ndef solve():\n    return sqrt(4)",
    ],
)
def test_unsafe_imports_files_reflection_and_instrumentation_tampering_are_blocked(source):
    result = SandboxRunner().run(source, "solve", {})
    assert result.failure_category == FailureCategory.RUNTIME_EXCEPTION
    assert result.error_type or result.error_message


def test_safe_competitive_programming_imports_work():
    result = SandboxRunner().run(dedent("""
        from collections import deque
        import math
        def solve(nums):
            values = deque(nums)
            return math.floor(sum(values))
    """).strip(), "solve", {"nums": [1, 2, 3]})
    assert result.failure_category == FailureCategory.ALL_PASSED
    assert result.output == 6


def test_user_print_does_not_corrupt_json_transport():
    result = SandboxRunner().run("def solve():\n    print('not json')\n    return 7", "solve", {})
    assert result.failure_category == FailureCategory.ALL_PASSED
    assert result.output == 7


def test_runtime_crash_is_not_misclassified_as_wrong_answer_or_timeout():
    result = SandboxRunner().run("def solve():\n    return 1 // 0", "solve", {})
    assert result.failure_category == FailureCategory.RUNTIME_EXCEPTION
    assert "ZeroDivisionError" in f"{result.error_type} {result.error_message}"


def test_dual_execution_and_batch_cases_do_not_share_mutated_input():
    inputs = [{"nums": [1, 2]}, {"nums": [1, 2]}]
    unchanged = deepcopy(inputs)
    references, students = SandboxRunner().run_dual(
        "def solve(nums):\n    return nums",
        "def solve(nums):\n    nums.pop()\n    return nums",
        "solve", inputs,
    )
    assert inputs == unchanged
    assert [result.output for result in references] == [[1, 2], [1, 2]]
    assert [result.output for result in students] == [[1], [1]]
    assert all(result.failure_category == FailureCategory.ALL_PASSED for result in references + students)


def test_hard_subprocess_timeout_returns_cleanly_and_next_worker_still_runs():
    timed_out = SandboxRunner(timeout_sec=0.000001).run("def solve():\n    return 1", "solve", {})
    assert timed_out.failure_category == FailureCategory.TIME_LIMIT_EXCEEDED
    assert "TimeoutExpired" in f"{timed_out.error_type} {timed_out.error_message}"
    subsequent = SandboxRunner().run("def solve():\n    return 2", "solve", {})
    assert subsequent.failure_category == FailureCategory.ALL_PASSED
    assert subsequent.output == 2


def test_finally_return_cannot_suppress_the_authoritative_tick_limit():
    code = "def solve():\n    try:\n        while True:\n            pass\n    finally:\n        return 7"
    result = SandboxRunner(max_ticks=1000).run(code, "solve", {})
    assert result.failure_category == FailureCategory.TIME_LIMIT_EXCEEDED
    assert result.error_type == "TLE_TICK_LIMIT_EXCEEDED"
    assert result.operation_ticks == 1001
    assert result.output is None


def test_scale_small_sample_failure_is_reported_even_when_large_sample_passes():
    problem = get_problem("two-sum-sorted")
    source = problem.reference_solution.replace(
        "return [left + 1, right + 1]",
        "return [] if len(nums) == 100 else [left + 1, right + 1]",
    )
    report = fuzz(problem.problem_id, source)
    assert report.failure_category == FailureCategory.WRONG_ANSWER
    by_name = {result.archetype: result for result in report.archetype_results}
    assert all(by_name[name].passed for name in ARCHETYPES - {"asymptotic_scale"})
    assert not by_name["asymptotic_scale"].passed
    observed = report.counterexample
    assert observed is not None and observed.is_verified
    assert observed.archetype == "asymptotic_scale"
    assert len(observed.input_args["nums"]) == 100
    assert observed.expected_output == [99, 100]
    assert observed.actual_output == []
    references, students = SandboxRunner().run_dual(
        problem.reference_solution, source, problem.entrypoint_fn,
        [observed.input_args, generate_scale_input(problem, 1000)],
    )
    assert references[0].output != students[0].output
    assert references[1].output == students[1].output
