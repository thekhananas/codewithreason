"""Real AST analysis and execution of transformed programs; no analyzer mocks."""
from textwrap import dedent

import pytest

from app.engine.ast_analyzer import analyze_python_code


def analyze(source: str, entrypoint: str = "solve", limit: int = 150000):
    return analyze_python_code(dedent(source).strip(), entrypoint, max_ticks=limit)


def execute_instrumented(source: str, arguments: dict, limit: int = 150000):
    result = analyze(source, limit=limit)
    assert result.is_valid_syntax
    assert result.instrumented_code is not None
    ticks = []

    def tick(*, limit):
        ticks.append(limit)
        if len(ticks) > limit:
            raise RuntimeError("TLE_TICK_LIMIT_EXCEEDED")

    namespace = {"__sg_tick__": tick}
    exec(result.instrumented_code, namespace)
    output = namespace["solve"](**arguments)
    return output, ticks


@pytest.mark.parametrize(
    ("source", "line"),
    [
        ("def solve(nums)\n    return nums", "1"),
        ("def solve(nums):\nreturn nums", "2"),
        ("def solve(nums):\n    return [", "2"),
    ],
)
def test_syntax_errors_include_location_without_raising(source, line):
    result = analyze(source)
    assert result.is_valid_syntax is False
    assert result.syntax_error_msg
    assert line in result.syntax_error_msg
    assert result.instrumented_code is None
    assert len(result.code_hash) == 16


@pytest.mark.parametrize(
    "body",
    ["pass", "...", "return None", "return", '"An unfinished solution."', '"An unfinished solution."\n    pass'],
)
def test_incomplete_entrypoint_bodies_are_detected(body):
    result = analyze(f"def solve(nums):\n    {body}")
    assert result.is_valid_syntax
    assert result.has_incomplete_placeholders


def test_missing_entrypoint_is_incomplete_even_if_other_function_is_complete():
    result = analyze("def another(nums):\n    return len(nums)")
    assert result.is_valid_syntax
    assert result.has_incomplete_placeholders


def test_real_function_with_nested_pass_is_not_a_stub():
    result = analyze("""
        def solve(nums):
            for value in nums:
                if value < 0:
                    pass
            return len(nums)
    """)
    assert result.is_valid_syntax
    assert not result.has_incomplete_placeholders
    assert result.max_loop_depth == 1
    assert result.estimated_time_complexity == "O(N)"


@pytest.mark.parametrize(
    ("source", "depth", "complexity"),
    [
        ("def solve(nums):\n    return len(nums)", 0, "O(1)"),
        ("def solve(nums):\n    for x in nums:\n        x + 1\n    return 0", 1, "O(N)"),
        ("def solve(nums):\n    for x in nums:\n        for y in nums:\n            x + y\n    return 0", 2, "O(N^2)"),
        ("def solve(nums):\n    return [x + y for x in nums for y in nums]", 2, "O(N^2)"),
        ("def solve(nums):\n    return [[x + y for y in nums] for x in nums]", 2, "O(N^2)"),
        ("def solve(nums):\n    return {x: x*x for x in nums}", 1, "O(N)"),
        ("def solve(nums):\n    return {x for x in nums}", 1, "O(N)"),
        ("def solve(nums):\n    return sum(x for x in nums)", 1, "O(N)"),
    ],
)
def test_loop_and_comprehension_nesting(source, depth, complexity):
    result = analyze(source)
    assert result.max_loop_depth == depth
    assert result.estimated_time_complexity == complexity


def test_sequential_loops_do_not_count_as_nested():
    result = analyze("""
        def solve(nums):
            total = 0
            for x in nums:
                total += x
            for y in nums:
                total -= y
            return total
    """)
    assert result.max_loop_depth == 1
    assert result.estimated_time_complexity == "O(N)"


@pytest.mark.parametrize("midpoint", ["(left + right) // 2", "(left + right) >> 1"])
def test_halving_within_while_is_logarithmic(midpoint):
    result = analyze(f"""
        def solve(nums):
            left, right = 0, len(nums) - 1
            while left < right:
                mid = {midpoint}
                if nums[mid] > nums[right]:
                    left = mid + 1
                else:
                    right = mid
            return nums[left]
    """)
    assert result.has_logarithmic_halving
    assert result.max_loop_depth == 1
    assert result.estimated_time_complexity == "O(log N)"


def test_halving_outside_loop_does_not_make_program_logarithmic():
    result = analyze("def solve(n):\n    return n // 2")
    assert result.has_logarithmic_halving is False
    assert result.estimated_time_complexity == "O(1)"


def test_linear_recursion_and_base_guard_detected():
    result = analyze("""
        def solve(n):
            if n <= 0:
                return 0
            return 1 + solve(n - 1)
    """)
    assert result.uses_recursion
    assert result.has_base_case_guard
    assert result.estimated_time_complexity == "O(N)"


def test_branching_recursion_is_exponential():
    result = analyze("""
        def solve(n):
            if n < 2:
                return n
            return solve(n - 1) + solve(n - 2)
    """)
    assert result.uses_recursion
    assert result.has_base_case_guard
    assert result.estimated_time_complexity == "O(2^N)"


def test_unguarded_recursion_has_no_base_case():
    result = analyze("def solve(n):\n    return solve(n - 1)")
    assert result.uses_recursion
    assert not result.has_base_case_guard


def test_helper_recursion_detected_and_instrumented():
    source = """
        def helper(n):
            if n <= 0:
                return 0
            return 1 + helper(n - 1)
        def solve(n):
            return helper(n)
    """
    result = analyze(source)
    assert result.uses_recursion
    output, ticks = execute_instrumented(source, {"n": 3})
    assert output == 3
    assert len(ticks) == 5


def test_code_hash_ignores_comments_formatting_and_blank_lines():
    first = analyze("def solve(nums):\n    return nums[0] + 1")
    second = analyze("""
        # A new comment is not a new attempt.
        def solve( nums ):

            return nums[ 0 ]+1 # same syntax
    """)
    assert first.code_hash == second.code_hash
    assert len(first.code_hash) == 16


def test_code_hash_preserves_string_content_including_hashes_and_whitespace():
    first = analyze('def solve():\n    return "a # b"')
    second = analyze('def solve():\n    return "a # c"')
    third = analyze('def solve():\n    return "a  # b"')
    assert len({first.code_hash, second.code_hash, third.code_hash}) == 3


def test_code_hash_changes_when_program_behavior_changes():
    first = analyze("def solve(nums):\n    return nums[0] + 1")
    second = analyze("def solve(nums):\n    return nums[0] + 2")
    assert first.code_hash != second.code_hash


def test_for_loop_execution_counts_function_entry_and_each_iteration():
    output, ticks = execute_instrumented("""
        def solve(nums):
            result = []
            for x in nums:
                if x >= 0:
                    result.append(x)
            return result
    """, {"nums": [1, -2, 3]}, limit=23)
    assert output == [1, 3]
    assert ticks == [23] * 4


def test_while_loop_execution_preserves_output_and_ticks():
    output, ticks = execute_instrumented("""
        def solve(n):
            total = 0
            while n:
                total += n
                n -= 1
            return total
    """, {"n": 3})
    assert output == 6
    assert len(ticks) == 4


@pytest.mark.parametrize(
    ("expression", "expected"),
    [
        ("[x for x in nums if x > 0]", [1, 2]),
        ("{x for x in nums if x > 0}", {1, 2}),
        ("{x: x*x for x in nums if x > 0}", {1: 1, 2: 4}),
        ("list(x for x in nums if x > 0)", [1, 2]),
    ],
)
def test_comprehensions_count_attempted_items_before_filters(expression, expected):
    output, ticks = execute_instrumented(f"def solve(nums):\n    return {expression}", {"nums": [-2, -1, 1, 2]})
    assert output == expected
    assert len(ticks) == 5


def test_multiple_comprehension_generators_each_receive_tick():
    output, ticks = execute_instrumented("""
        def solve():
            return [(x, y) for x in range(3) for y in range(2) if x + y > 0]
    """, {})
    assert output == [(0, 1), (1, 0), (1, 1), (2, 0), (2, 1)]
    assert len(ticks) == 10


def test_recursive_function_ticks_each_invocation():
    output, ticks = execute_instrumented("""
        def solve(n):
            if n <= 0:
                return 0
            return 1 + solve(n - 1)
    """, {"n": 3})
    assert output == 3
    assert len(ticks) == 4


def test_mutually_recursive_helpers_cannot_avoid_function_entry_ticks():
    output, ticks = execute_instrumented("""
        def first(n):
            if n <= 0:
                return 0
            return 1 + second(n - 1)
        def second(n):
            if n <= 0:
                return 0
            return 1 + first(n - 1)
        def solve(n):
            return first(n)
    """, {"n": 3})
    assert output == 3
    assert len(ticks) == 5


def test_infinite_loop_hits_real_injected_operation_budget():
    with pytest.raises(RuntimeError, match="TLE_TICK_LIMIT_EXCEEDED"):
        execute_instrumented("def solve():\n    while True:\n        pass", {}, limit=11)


def test_instrumentation_keeps_function_docstrings():
    result = analyze('def solve():\n    "A useful description."\n    return 7')
    namespace = {"__sg_tick__": lambda **kwargs: None}
    exec(result.instrumented_code, namespace)
    assert namespace["solve"].__doc__ == "A useful description."
    assert namespace["solve"]() == 7
