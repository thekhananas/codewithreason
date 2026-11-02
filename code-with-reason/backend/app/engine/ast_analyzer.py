"""Analyze Python without executing it and meter abstract Python operations.

Instrumentation calls a sandbox-owned ``__sg_tick__`` closure. Keeping its
counter outside student globals prevents submissions from resetting the budget.
"""
from __future__ import annotations

import ast
import hashlib
import io
import tokenize

from app.models.schemas import ASTAnalysisResult


def _code_hash(code: str, tree: ast.AST | None) -> str:
    if tree is not None:
        normalized = ast.dump(tree, annotate_fields=True, include_attributes=False)
    else:
        try:
            ignored = {tokenize.COMMENT, tokenize.NL, tokenize.NEWLINE, tokenize.ENCODING,
                       tokenize.INDENT, tokenize.DEDENT, tokenize.ENDMARKER}
            normalized = repr([(tok.type, tok.string) for tok in
                               tokenize.generate_tokens(io.StringIO(code).readline)
                               if tok.type not in ignored])
        except (tokenize.TokenError, IndentationError):
            normalized = code.strip()
    return hashlib.sha256(normalized.encode()).hexdigest()[:16]


def _is_stub(node: ast.FunctionDef) -> bool:
    meaningful = [n for n in node.body if not (
        isinstance(n, ast.Expr) and isinstance(n.value, ast.Constant)
        and isinstance(n.value.value, str)
    )]
    def placeholder(n: ast.stmt) -> bool:
        return (isinstance(n, ast.Pass)
                or isinstance(n, ast.Expr) and isinstance(n.value, ast.Constant)
                and n.value.value is Ellipsis
                or isinstance(n, ast.Return) and (n.value is None
                    or isinstance(n.value, ast.Constant) and n.value.value is None))
    return not meaningful or all(placeholder(n) for n in meaningful)


class _ConstructVisitor(ast.NodeVisitor):
    def __init__(self) -> None:
        self.depth = 0
        self.max_depth = 0
        self.constructs: set[str] = set()
        self.halving = False

    def visit_For(self, node: ast.For) -> None:
        # Iterable evaluation happens outside the loop body.
        self.visit(node.iter)
        self.depth += 1
        self.max_depth = max(self.max_depth, self.depth)
        self.constructs.add(type(node).__name__)
        for statement in node.body:
            self.visit(statement)
        self.depth -= 1
        for statement in node.orelse:
            self.visit(statement)

    def visit_While(self, node: ast.While) -> None:
        self.depth += 1
        self.max_depth = max(self.max_depth, self.depth)
        self.constructs.add("While")
        for sub in ast.walk(node):
            if isinstance(sub, ast.BinOp) and isinstance(sub.right, ast.Constant):
                if (isinstance(sub.op, ast.FloorDiv) and sub.right.value == 2
                        or isinstance(sub.op, ast.RShift) and sub.right.value == 1):
                    self.halving = True
            if isinstance(sub, ast.AugAssign) and isinstance(sub.value, ast.Constant):
                if (isinstance(sub.op, ast.FloorDiv) and sub.value.value == 2
                        or isinstance(sub.op, ast.RShift) and sub.value.value == 1):
                    self.halving = True
        self.visit(node.test)
        for statement in node.body:
            self.visit(statement)
        self.depth -= 1
        for statement in node.orelse:
            self.visit(statement)

    def _comprehension(self, node: ast.AST) -> None:
        self.constructs.add(type(node).__name__)
        starting_depth = self.depth
        for generator in node.generators:
            self.visit(generator.iter)
            self.depth += 1
            self.max_depth = max(self.max_depth, self.depth)
            for condition in generator.ifs:
                self.visit(condition)
        for field in ("elt", "key", "value"):
            value = getattr(node, field, None)
            if value is not None:
                self.visit(value)
        self.depth = starting_depth

    visit_ListComp = _comprehension
    visit_SetComp = _comprehension
    visit_DictComp = _comprehension
    visit_GeneratorExp = _comprehension


class ASTTickInjector(ast.NodeTransformer):
    """Count every function entry and attempted loop/comprehension iteration."""

    def __init__(self, max_ticks: int = 150000) -> None:
        self.max_ticks = max_ticks

    def _call(self) -> ast.Call:
        return ast.Call(func=ast.Name(id="__sg_tick__", ctx=ast.Load()), args=[],
                        keywords=[ast.keyword(arg="limit", value=ast.Constant(self.max_ticks))])

    def visit_FunctionDef(self, node: ast.FunctionDef) -> ast.FunctionDef:
        self.generic_visit(node)
        # Preserve docstrings (and hence normal Python function semantics).
        offset = int(bool(node.body) and isinstance(node.body[0], ast.Expr)
                     and isinstance(node.body[0].value, ast.Constant)
                     and isinstance(node.body[0].value.value, str))
        node.body.insert(offset, ast.Expr(value=self._call()))
        return node

    def visit_For(self, node: ast.For) -> ast.For:
        self.generic_visit(node)
        node.body.insert(0, ast.Expr(value=self._call()))
        return node

    def visit_While(self, node: ast.While) -> ast.While:
        self.generic_visit(node)
        node.body.insert(0, ast.Expr(value=self._call()))
        return node

    def visit_comprehension(self, node: ast.comprehension) -> ast.comprehension:
        self.generic_visit(node)
        # First filter is always true; count even items rejected by user filters.
        node.ifs.insert(0, ast.Compare(left=self._call(), ops=[ast.Is()],
                                      comparators=[ast.Constant(None)]))
        return node


def analyze_python_code(code: str, entrypoint_fn: str, max_ticks: int = 150000) -> ASTAnalysisResult:
    try:
        tree = ast.parse(code)
    except (SyntaxError, IndentationError, ValueError, RecursionError) as exc:
        line = getattr(exc, "lineno", None)
        message = getattr(exc, "msg", str(exc))
        return ASTAnalysisResult(is_valid_syntax=False, code_hash=_code_hash(code, None),
                                 syntax_error_msg=f"Line {line or 1}: {message}")
    code_hash = _code_hash(code, tree)
    functions = [n for n in tree.body if isinstance(n, ast.FunctionDef)]
    entry = next((n for n in functions if n.name == entrypoint_fn), None)
    incomplete = entry is None or _is_stub(entry)
    visitor = _ConstructVisitor()
    visitor.visit(tree)
    recursive_functions: list[ast.FunctionDef] = []
    max_self_calls = 0
    for fn in (n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef)):
        calls = [n for n in ast.walk(fn) if isinstance(n, ast.Call)
                 and isinstance(n.func, ast.Name) and n.func.id == fn.name]
        if calls:
            recursive_functions.append(fn)
            max_self_calls = max(max_self_calls, len(calls))
    uses_recursion = bool(recursive_functions)
    has_guard = any(
        isinstance(n, ast.If) and any(
            isinstance(ret, ast.Return) and not any(
                isinstance(call, ast.Call) and isinstance(call.func, ast.Name)
                and call.func.id == fn.name for call in ast.walk(ret)
            ) for statement in n.body for ret in ast.walk(statement)
        ) for fn in recursive_functions for n in ast.walk(fn)
    )
    if uses_recursion:
        complexity = "O(2^N)" if max_self_calls > 1 else "O(N)"
        visitor.constructs.add("Recursion")
    elif visitor.max_depth >= 2:
        complexity = f"O(N^{visitor.max_depth})"
    elif visitor.max_depth == 1:
        complexity = "O(log N)" if visitor.halving else "O(N)"
    else:
        complexity = "O(1)"
    injected = ASTTickInjector(max_ticks).visit(tree)
    instrumented = ast.unparse(ast.fix_missing_locations(injected))
    return ASTAnalysisResult(
        is_valid_syntax=True, has_incomplete_placeholders=incomplete,
        max_loop_depth=visitor.max_depth, uses_recursion=uses_recursion,
        has_base_case_guard=has_guard, has_logarithmic_halving=visitor.halving,
        detected_constructs=sorted(visitor.constructs), estimated_time_complexity=complexity,
        code_hash=code_hash, instrumented_code=instrumented,
    )
