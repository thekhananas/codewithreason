"""Optional provider calls with a deterministic ontology engine as the default.

Provider failures use the same offline engine; there is no retry loop. All
outbound prose still passes through SocraGateShield in the orchestrator.
"""
from __future__ import annotations

import httpx

from app.config import Settings, get_settings
from app.engine.prompts import build_messages
from app.models.schemas import CounterexampleTrace, InvariantNode, ProblemSchema, ScaffoldingTier


class NeuroSymbolicOntologyGenerator:
    def generate(self, problem: ProblemSchema, invariant: InvariantNode,
                 tier: ScaffoldingTier, trace: CounterexampleTrace | None = None) -> str:
        if tier == ScaffoldingTier.TIER_4_POSTMORTEM:
            return (
                f"Escape hatch unlocked. The key invariant: {invariant.rule}\n\n"
                f"The reference meets {problem.target_time_complexity} time and "
                f"{problem.target_space_complexity} auxiliary space. Trace each state change "
                "against the boundary cases, then explain why the invariant is preserved.\n\n"
                f"```python\n{problem.reference_solution.rstrip()}\n```"
            )
        if tier == ScaffoldingTier.TIER_1_PROBE:
            return invariant.tier1_probe
        if tier == ScaffoldingTier.TIER_3_SCAFFOLD:
            return invariant.tier2_probe + " Use the separate logic scaffold to test your reasoning."
        return invariant.tier2_probe


class LLMClient:
    def __init__(self, settings: Settings | None = None, provider: str | None = None,
                 transport: httpx.BaseTransport | None = None) -> None:
        self.settings = settings or get_settings()
        self.provider = provider or self.settings.LLM_PROVIDER
        self.transport = transport
        self.offline = NeuroSymbolicOntologyGenerator()

    def _provider(self) -> str:
        if self.provider == "offline":
            return "offline"
        if self.provider in ("auto", "openai") and self.settings.OPENAI_API_KEY:
            return "openai"
        if self.provider in ("auto", "anthropic") and self.settings.ANTHROPIC_API_KEY:
            return "anthropic"
        return "offline"

    def generate_response(self, problem: ProblemSchema, invariant: InvariantNode,
                          tier: ScaffoldingTier, trace: CounterexampleTrace | None = None,
                          user_code: str = "", user_message: str = "") -> str:
        tier = ScaffoldingTier(tier)
        fallback = self.offline.generate(problem, invariant, tier, trace)
        provider = self._provider()
        if provider == "offline":
            return fallback
        messages = build_messages(problem, invariant, tier, trace, user_code, user_message)
        try:
            with httpx.Client(timeout=httpx.Timeout(1.8, connect=0.5), transport=self.transport,
                              follow_redirects=False) as client:
                if provider == "openai":
                    response = client.post(
                        "https://api.openai.com/v1/chat/completions",
                        headers={"Authorization": f"Bearer {self.settings.OPENAI_API_KEY}"},
                        json={"model": self.settings.LLM_MODEL, "messages": messages,
                              "max_tokens": 1200 if tier == 4 else 250},
                    )
                    response.raise_for_status()
                    text = response.json()["choices"][0]["message"]["content"]
                else:
                    response = client.post(
                        "https://api.anthropic.com/v1/messages",
                        headers={"x-api-key": self.settings.ANTHROPIC_API_KEY or "",
                                 "anthropic-version": "2026-10-21"},
                        json={"model": self.settings.ANTHROPIC_MODEL,
                              "system": messages[0]["content"], "messages": messages[1:],
                              "max_tokens": 1200 if tier == 4 else 250},
                    )
                    response.raise_for_status()
                    text = "\n".join(block["text"] for block in response.json()["content"]
                                     if block.get("type") == "text")
            if isinstance(text, str) and text.strip() and len(text) <= 20000:
                return text.strip()
        except (httpx.HTTPError, ValueError, KeyError, IndexError, TypeError):
            # Never include provider responses, credentials, or user code in logs.
            pass
        return fallback

    generate = generate_response
