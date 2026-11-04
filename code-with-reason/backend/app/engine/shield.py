"""Deterministic outbound prose inspection with immediate ontology fallbacks."""

from __future__ import annotations

from functools import lru_cache
import re
import unicodedata

from app.models.schemas import InvariantNode, ProblemSchema, ScaffoldingTier, ShieldAuditResult


_PYTHON_STATEMENT = re.compile(
    r"\b(?:def\s+\w+|class\s+\w+|return\s+[\w\[\(\-+]|"
    r"for\s+\w+\s+in\s+|(?:while|elif|if)\s+[^:\n]+:|"
    r"(?:from\s+\w+\s+)?import\s+\w+|raise\s+\w+|"
    r"\w+\s*(?:\+|-|\*\*?|//?|%|&|\||\^|<<|>>)=\s*\S+)",
    re.IGNORECASE,
)
_LITERAL_ASSIGNMENT = re.compile(
    r"(?:^|[\n`;])\s*[A-Za-z_]\w*\s*=(?!=)\s*"
    r"(?:[-+]?\d+(?:\.\d+)?\b|None\b|True\b|False\b|\[\s*\]|\{\s*\}|"
    r"\(\s*\)|\"[^\"\n]*\"|'[^'\n]*')\s*(?:$|[\n`;])",
    re.MULTILINE,
)
_TOKEN = re.compile(r"[A-Za-z_]\w*|\d+(?:\.\d+)?|\*\*|//|<<|>>|==|!=|<=|>=|:=|[-+*/%=<>!&|^~]")
_NUMBER_WORDS = {
    "zero": "0", "one": "1", "two": "2", "three": "3", "four": "4",
    "five": "5", "six": "6", "seven": "7", "eight": "8", "nine": "9", "ten": "10",
}
_OPERATORS = str.maketrans({
    "+": " plus ", "-": " minus ", "=": " equals ", "*": " times ",
    "/": " divided ", ">": " greater ", "<": " less ",
    "≔": " equals ", "←": " equals ", "≡": " equals ",
})
_SAFE_EMERGENCY_PROBE = "What condition must remain true after each step of your reasoning?"


def _canonical_text(text: str) -> str:
    normalized = unicodedata.normalize("NFKC", text)
    return "".join(char for char in normalized if unicodedata.category(char) != "Cf")


def _normalize_pattern(text: str) -> str:
    text = _canonical_text(text).casefold()
    # Hyphenated English is punctuation; subtraction in symbolic expressions
    # remains an operator. Symbols and verbalizations share one representation.
    text = re.sub(r"(?<=[A-Za-z])[-‐‑–—](?=[A-Za-z])", " ", text)
    text = text.translate(_OPERATORS)
    words = re.findall(r"\w+", text, flags=re.UNICODE)
    return " ".join(_NUMBER_WORDS.get(word, word) for word in words)


@lru_cache(maxsize=256)
def _bigrams(text: str) -> frozenset[tuple[str, str]]:
    tokens = _TOKEN.findall(_canonical_text(text).casefold())
    return frozenset(zip(tokens, tokens[1:]))


def reference_bigram_overlap(response_text: str, reference_solution: str) -> float:
    response = _bigrams(response_text)
    reference = _bigrams(reference_solution)
    union = response | reference
    return len(response & reference) / len(union) if union else 0.0


def detect_violation(response_text: str, problem: ProblemSchema) -> str | None:
    """Audit prose independently, including unshielded benchmark responses."""
    text = _canonical_text(response_text)
    if "```" in text or "~~~" in text:
        return "code_fence"
    if _PYTHON_STATEMENT.search(text) or _LITERAL_ASSIGNMENT.search(text):
        return "python_statement"
    normalized = _normalize_pattern(text)
    for pattern in problem.forbidden_leak_patterns:
        forbidden = _normalize_pattern(pattern)
        if forbidden and forbidden in normalized:
            return f"forbidden_pattern: {pattern}"
    overlap = reference_bigram_overlap(text, problem.reference_solution)
    if overlap > 0.22:
        return f"reference_bigram_overlap: {overlap:.3f}"
    return None


class SocraGateShield:
    """Keep solution syntax and reference transitions out of Tiers 1–3 prose."""

    @staticmethod
    def detect_violation(response_text: str, problem: ProblemSchema) -> str | None:
        return detect_violation(response_text, problem)

    def inspect_and_enforce(
        self,
        response_text: str,
        tier: ScaffoldingTier,
        problem: ProblemSchema,
        invariant: InvariantNode,
    ) -> ShieldAuditResult:
        active_tier = ScaffoldingTier(tier)
        if active_tier == ScaffoldingTier.TIER_4_POSTMORTEM:
            return ShieldAuditResult(response_text=response_text)
        reason = detect_violation(response_text, problem)
        if reason is None:
            return ShieldAuditResult(response_text=response_text)
        fallback = (
            invariant.tier1_probe
            if active_tier == ScaffoldingTier.TIER_1_PROBE
            else invariant.tier2_probe
        )
        # Curated data is checked too: a future catalog edit cannot accidentally
        # turn the deterministic fallback into a second leakage path.
        if detect_violation(fallback, problem) is not None:
            fallback = _SAFE_EMERGENCY_PROBE
            reason += "; unsafe_catalog_fallback"
        return ShieldAuditResult(
            response_text=fallback,
            shield_triggered=True,
            shield_reason=reason,
            retry_latency_ms=0.0,
        )


def enforce_socragate_shield(
    response_text: str,
    tier: ScaffoldingTier,
    problem: ProblemSchema,
    invariant: InvariantNode,
) -> ShieldAuditResult:
    """Functional compatibility entrypoint for the same deterministic interceptor."""
    return SocraGateShield().inspect_and_enforce(response_text, tier, problem, invariant)
