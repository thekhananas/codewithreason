"""Bounded, isolated Python execution with deterministic operation budgets.

This is a defense-in-depth local teaching sandbox, not an OS security boundary.
Deployments accepting hostile public traffic also need container resource limits.
"""
from __future__ import annotations

import ast
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

from app.config import get_settings
from app.engine.ast_analyzer import analyze_python_code
from app.models.schemas import FailureCategory, SandboxResult


_FORBIDDEN_NAMES = {
    "open", "eval", "exec", "compile", "input", "globals", "locals", "vars",
    "getattr", "setattr", "delattr", "dir", "help", "breakpoint", "exit", "quit",
    "type", "object", "super", "memoryview", "BaseException", "SystemExit",
    "KeyboardInterrupt", "GeneratorExit", "copyright", "license", "credits",
}
_ALLOWED_MODULES = {"typing", "math", "collections", "heapq", "bisect", "itertools", "functools"}


class SandboxSecurityError(ValueError):
    """A submitted program requests capabilities outside the teaching runtime."""


def _guard_source(code: str) -> None:
    if len(code) > 50000:
        raise SandboxSecurityError("Submission exceeds 50000 characters")
    tree = ast.parse(code)
    for node in ast.walk(tree):
        if isinstance(node, (ast.ClassDef, ast.AsyncFunctionDef, ast.AsyncFor, ast.AsyncWith, ast.Await)):
            raise SandboxSecurityError("Classes and asynchronous execution are unavailable")
        if isinstance(node, ast.Name) and (node.id.startswith("__") or node.id in _FORBIDDEN_NAMES):
            raise SandboxSecurityError(f"Forbidden name: {node.id}")
        if isinstance(node, (ast.FunctionDef, ast.arg)):
            name = node.name if isinstance(node, ast.FunctionDef) else node.arg
            if name.startswith("__"):
                raise SandboxSecurityError("Reserved instrumentation names are unavailable")
        if isinstance(node, ast.Attribute) and (
            node.attr.startswith("_") or node.attr in {"format", "format_map", "mro"}
        ):
            raise SandboxSecurityError(f"Forbidden attribute: {node.attr}")
        if isinstance(node, ast.ExceptHandler) and node.type is None:
            raise SandboxSecurityError("Use an explicit Exception handler rather than bare except")
        if isinstance(node, (ast.Global, ast.Nonlocal)) and any(name.startswith("__") for name in node.names):
            raise SandboxSecurityError("Reserved instrumentation names are unavailable")
        if isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name not in _ALLOWED_MODULES or (alias.asname or "").startswith("__"):
                    raise SandboxSecurityError(f"Import is unavailable: {alias.name}")
        if isinstance(node, ast.ImportFrom):
            if node.level or node.module not in _ALLOWED_MODULES:
                raise SandboxSecurityError(f"Import is unavailable: {node.module}")
            if any(alias.name.startswith("_") or alias.name == "*" or (alias.asname or "").startswith("__")
                   for alias in node.names):
                raise SandboxSecurityError("Private and wildcard imports are unavailable")


def _failure(kind: str, message: str, category: FailureCategory) -> SandboxResult:
    return SandboxResult(error_type=kind, error_message=message, failure_category=category)


class SandboxRunner:
    def __init__(self, timeout_sec: float | None = None, max_ticks: int | None = None) -> None:
        settings = get_settings()
        self.timeout_sec = min(float(timeout_sec if timeout_sec is not None else settings.SANDBOX_TIMEOUT_SEC), 1.5)
        self.max_ticks = int(max_ticks if max_ticks is not None else settings.MAX_AST_TICKS)
        if self.timeout_sec <= 0 or self.max_ticks <= 0:
            raise ValueError("Sandbox timeout and tick budget must be positive")

    def _prepare(self, code: str, entrypoint_fn: str) -> str | SandboxResult:
        try:
            if not entrypoint_fn.isidentifier() or entrypoint_fn.startswith("__"):
                raise SandboxSecurityError("Invalid entrypoint name")
            _guard_source(code)
            analysis = analyze_python_code(code, entrypoint_fn, max_ticks=self.max_ticks)
            if not analysis.is_valid_syntax:
                return _failure("SyntaxError", analysis.syntax_error_msg or "Invalid syntax",
                                FailureCategory.SYNTAX_INCOMPLETE)
            return analysis.instrumented_code or ""
        except (SyntaxError, IndentationError, ValueError, RecursionError) as exc:
            category = FailureCategory.RUNTIME_EXCEPTION if isinstance(exc, SandboxSecurityError) else FailureCategory.SYNTAX_INCOMPLETE
            return _failure(type(exc).__name__, str(exc), category)

    def _run_programs(self, sources: list[str], entrypoint_fn: str,
                      inputs: list[dict]) -> list[list[SandboxResult]]:
        if not inputs:
            return [[] for _ in sources]
        prepared = [self._prepare(code, entrypoint_fn) for code in sources]
        timeout = _failure("TimeoutExpired", "Hard sandbox timeout exceeded",
                           FailureCategory.TIME_LIMIT_EXCEEDED)
        results = [[item.model_copy() if isinstance(item, SandboxResult) else timeout.model_copy()
                    for _ in inputs] for item in prepared]
        programs = [{"program": index, "source": source, "entrypoint": entrypoint_fn}
                    for index, source in enumerate(prepared) if isinstance(source, str)]
        if not programs:
            return results
        payload = json.dumps({"programs": programs, "inputs": inputs, "max_ticks": self.max_ticks},
                             ensure_ascii=True, allow_nan=False)
        if len(payload) > 2_000_000:
            error = _failure("InputLimitExceeded", "Sandbox input exceeds 2 MB",
                             FailureCategory.RUNTIME_EXCEPTION)
            return [[error.model_copy() for _ in inputs] for _ in sources]
        worker = Path(__file__).with_name("_sandbox_worker.py")
        environment = {"LANG": "C.UTF-8", "LC_ALL": "C.UTF-8", "PATH": os.defpath}
        with tempfile.TemporaryDirectory(prefix="socragate-") as directory:
            with subprocess.Popen([sys.executable, "-I", "-u", str(worker)],
                                  stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                  stderr=subprocess.PIPE, text=True, encoding="utf-8",
                                  cwd=directory, env=environment) as process:
                expired = False
                try:
                    output, stderr = process.communicate(payload, timeout=self.timeout_sec)
                except subprocess.TimeoutExpired:
                    expired = True
                    process.kill()
                    output, stderr = process.communicate()
                except BaseException:
                    process.kill()
                    process.communicate()
                    raise
                completed: set[tuple[int, int]] = set()
                for line in output.splitlines():
                    try:
                        record = json.loads(line)
                        program, index = record["program"], record["index"]
                        if not (isinstance(program, int) and isinstance(index, int)
                                and 0 <= program < len(sources) and 0 <= index < len(inputs)):
                            continue
                        results[program][index] = SandboxResult.model_validate(record["result"])
                        completed.add((program, index))
                    except (ValueError, KeyError, TypeError):
                        continue
                if not expired:
                    for program in programs:
                        for index in range(len(inputs)):
                            key = (program["program"], index)
                            if key not in completed:
                                results[key[0]][index] = _failure(
                                    "WorkerError", (stderr.strip() or "Sandbox child exited without a result")[:1000],
                                    FailureCategory.RUNTIME_EXCEPTION,
                                )
        return results

    def run(self, code: str, entrypoint_fn: str, input_args: dict) -> SandboxResult:
        return self.run_batch(code, entrypoint_fn, [input_args])[0]

    def run_batch(self, code: str, entrypoint_fn: str, inputs: list[dict]) -> list[SandboxResult]:
        return self._run_programs([code], entrypoint_fn, inputs)[0]

    def run_dual(self, reference_code: str, user_code: str, entrypoint_fn: str,
                 inputs: list[dict]) -> tuple[list[SandboxResult], list[SandboxResult]]:
        reference, user = self._run_programs([reference_code, user_code], entrypoint_fn, inputs)
        return reference, user
