"""Leakage enforcement against executable, verbalized, and reference-token attacks."""
import re

import pytest

from app.catalog.loader import get_catalog, get_problem
from app.engine.shield import SocraGateShield
from app.models.schemas import ScaffoldingTier


PROTECTED_TIERS = [
    ScaffoldingTier.TIER_1_PROBE,
    ScaffoldingTier.TIER_2_COUNTEREXAMPLE,
    ScaffoldingTier.TIER_3_SCAFFOLD,
]


@pytest.fixture(scope="module")
def shield():
    return SocraGateShield()


@pytest.mark.parametrize("tier", PROTECTED_TIERS)
@pytest.mark.parametrize(
    "response",
    [
        "```python\nleft += 1\n```",
        "Use `left += 1` on this iteration.",
        "Apply right -= 1 next.",
        "`def solve(nums):` describes the answer.",
        "`class Solver:` begins the solution.",
        "The answer is `return nums[0]`.",
        "Execute `for item in nums:` next.",
        "Use `while left < right:` as the condition.",
        "Set left equal to mid plus one.",
        "Set left to MID plus 1.",
        "The update is left = mid + 1.",
    ],
)
def test_code_and_english_solution_mutations_are_intercepted(shield, tier, response):
    problem = get_problem("rotated-sorted-min")
    invariant = next(node for node in problem.invariants if node.id == "boundary")
    audit = shield.inspect_and_enforce(response, tier, problem, invariant)
    assert audit.shield_triggered
    assert audit.shield_reason
    expected = invariant.tier1_probe if tier == ScaffoldingTier.TIER_1_PROBE else invariant.tier2_probe
    assert audit.response_text == expected
    assert audit.retry_latency_ms == 0.0
    assert invariant.tier3_scaffold not in audit.response_text


@pytest.mark.parametrize("tier", PROTECTED_TIERS)
@pytest.mark.parametrize("problem_id", list(get_catalog()))
def test_complete_reference_solutions_are_blocked_before_tier_four(shield, tier, problem_id):
    problem = get_problem(problem_id)
    audit = shield.inspect_and_enforce(problem.reference_solution, tier, problem, problem.invariants[0])
    assert audit.shield_triggered
    assert audit.response_text != problem.reference_solution
    assert "```" not in audit.response_text
    assert audit.retry_latency_ms == 0.0


@pytest.mark.parametrize("tier", PROTECTED_TIERS)
@pytest.mark.parametrize("problem_id", list(get_catalog()))
def test_every_catalog_forbidden_pattern_survives_case_and_whitespace_evasion_checks(shield, tier, problem_id):
    problem = get_problem(problem_id)
    invariant = problem.invariants[0]
    for pattern in problem.forbidden_leak_patterns:
        variants = [pattern, pattern.upper(), " \n ".join(pattern.split())]
        if re.fullmatch(r"[\w\s]+", pattern):
            variants.append(", ... ".join(pattern.upper().split()))
        for variant in variants:
            audit = shield.inspect_and_enforce(f"Here is the exact update: {variant}", tier, problem, invariant)
            assert audit.shield_triggered, (problem_id, tier, pattern, variant)
            assert audit.retry_latency_ms == 0.0


@pytest.mark.parametrize("tier", PROTECTED_TIERS)
@pytest.mark.parametrize("problem_id", list(get_catalog()))
def test_curated_fallback_probes_are_safe_and_preserved(shield, tier, problem_id):
    problem = get_problem(problem_id)
    for invariant in problem.invariants:
        probe = invariant.tier1_probe if tier == ScaffoldingTier.TIER_1_PROBE else invariant.tier2_probe
        audit = shield.inspect_and_enforce(probe, tier, problem, invariant)
        assert not audit.shield_triggered, (problem_id, invariant.id, probe, audit.shield_reason)
        assert audit.response_text == probe


@pytest.mark.parametrize("problem_id", list(get_catalog()))
def test_masked_scaffolds_contain_no_executable_or_verbalized_solution_leaks(shield, problem_id):
    problem = get_problem(problem_id)
    for invariant in problem.invariants:
        audit = shield.inspect_and_enforce(
            invariant.tier3_scaffold, ScaffoldingTier.TIER_3_SCAFFOLD, problem, invariant,
        )
        assert not audit.shield_triggered, (problem_id, invariant.id, audit.shield_reason)
        assert audit.response_text == invariant.tier3_scaffold


@pytest.mark.parametrize("tier", PROTECTED_TIERS)
def test_valid_socratic_question_and_mathematical_invariant_are_allowed(shield, tier):
    problem = get_problem("rotated-sorted-min")
    for response in [
        "Which boundary could invalidate your current interval?",
        "The invariant is window_sum = prefix[r] - prefix[l]. Which state does it describe?",
    ]:
        audit = shield.inspect_and_enforce(response, tier, problem, problem.invariants[0])
        assert not audit.shield_triggered
        assert audit.response_text == response


def test_reference_bigram_overlap_is_an_independent_gate(shield):
    original = get_problem("rotated-sorted-min")
    expression = "a + b + c + d + e + f + g + h + i + j"
    problem = original.model_copy(update={
        "reference_solution": f"def solve(a, b, c, d, e, f, g, h, i, j):\n    return {expression}",
        "forbidden_leak_patterns": ["never disclose this sentinel"],
    })
    audit = shield.inspect_and_enforce(expression, ScaffoldingTier.TIER_1_PROBE, problem, problem.invariants[0])
    assert audit.shield_triggered
    assert "bigram" in audit.shield_reason.lower() or "overlap" in audit.shield_reason.lower()


@pytest.mark.parametrize("tier", PROTECTED_TIERS)
def test_normalized_verbalization_catches_unicode_and_hidden_separator_variants(shield, tier):
    problem = get_problem("rotated-sorted-min")
    for response in [
        "Set left equal to mid, plus... one.",
        "Set left equal to ｍｉｄ ｐｌｕｓ ｏｎｅ.",
        "Set left equal to mid\u200b plus one.",
    ]:
        audit = shield.inspect_and_enforce(response, tier, problem, problem.invariants[0])
        assert audit.shield_triggered, response


@pytest.mark.parametrize("problem_id", list(get_catalog()))
def test_explicit_tier_four_postmortem_allows_complete_reference(shield, problem_id):
    problem = get_problem(problem_id)
    response = f"Here is the post-mortem.\n```python\n{problem.reference_solution}\n```"
    audit = shield.inspect_and_enforce(
        response, ScaffoldingTier.TIER_4_POSTMORTEM, problem, problem.invariants[0],
    )
    assert not audit.shield_triggered
    assert audit.shield_reason is None
    assert audit.response_text == response
    assert audit.retry_latency_ms == 0.0
