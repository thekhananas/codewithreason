"""Standalone stdlib-only worker, launched with Python's isolated (-I) mode.

Only the parent supplies instrumented programs. Result lines are flushed after
each vector so a later hard timeout preserves completed reference evidence.
"""
from __future__ import annotations

import builtins
import collections
import copy
import functools
import heapq
import bisect
import itertools
import json
import math
import sys
import time
import types
import typing


class _TickLimit(BaseException):
    pass


def _batched_compat(iterable, n, *, strict=False):
    """Python 3.11 equivalent of itertools.batched."""
    if n < 1:
        raise ValueError("n must be at least one")
    iterator = iter(iterable)
    while batch := tuple(itertools.islice(iterator, n)):
        if strict and len(batch) != n:
            raise ValueError("incomplete batch")
        yield batch


def _bounded_output(value, depth=0, ancestors=None, counter=None):
    if ancestors is None:
        ancestors, counter = set(), [0]
    counter[0] += 1
    if depth > 24 or counter[0] > 20000:
        raise ValueError("Output exceeds structural limit")
    if value is None or isinstance(value, bool):
        return value
    if isinstance(value, int):
        if value.bit_length() > 12000:
            raise ValueError("Output integer exceeds size limit")
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError("Output must contain finite numbers")
        return value
    if isinstance(value, str):
        if len(value) > 20000:
            raise ValueError("Output string exceeds size limit")
        return value
    if not isinstance(value, (list, tuple, dict)):
        raise TypeError("Output must be a JSON-compatible value")
    marker = id(value)
    if marker in ancestors or len(value) > 10000:
        raise ValueError("Cyclic or oversized output")
    ancestors.add(marker)
    try:
        if isinstance(value, dict):
            if not all(isinstance(key, str) for key in value):
                raise TypeError("Output dictionary keys must be strings")
            return {key: _bounded_output(item, depth + 1, ancestors, counter)
                    for key, item in value.items()}
        return [_bounded_output(item, depth + 1, ancestors, counter) for item in value]
    finally:
        ancestors.remove(marker)


def _runtime(max_ticks):
    ticks = [0]

    def tick(*, limit=max_ticks):
        # The parent's budget is authoritative even if generated call arguments differ.
        ticks[0] += 1
        if ticks[0] > max_ticks:
            raise _TickLimit("TLE_TICK_LIMIT_EXCEEDED")

    def metered(iterable):
        for item in iterable:
            tick()
            yield item

    def minimum(*args, **kwargs):
        if len(args) == 1:
            return min(metered(args[0]), **kwargs)
        return min(*args, **kwargs)

    def maximum(*args, **kwargs):
        if len(args) == 1:
            return max(metered(args[0]), **kwargs)
        return max(*args, **kwargs)

    def summed(iterable, start=0):
        return sum(metered(iterable), start)

    def every(iterable):
        return all(metered(iterable))

    def some(iterable):
        return any(metered(iterable))

    def ordered(iterable, *, key=None, reverse=False):
        return sorted(metered(iterable), key=key, reverse=reverse)

    def reduced(function, iterable, *initial):
        return functools.reduce(function, metered(iterable), *initial)

    def itertools_function(name):
        function = getattr(itertools, name, _batched_compat if name == "batched" else None)

        def call(*args, **kwargs):
            # Pool-building functions must also meter their input consumption.
            iterable_positions = {
                "accumulate": {0}, "batched": {0}, "chain": set(range(len(args))),
                "combinations": {0}, "combinations_with_replacement": {0},
                "compress": {0, 1}, "cycle": {0}, "dropwhile": {1},
                "filterfalse": {1}, "groupby": {0}, "islice": {0},
                "pairwise": {0}, "permutations": {0}, "product": set(range(len(args))),
                "starmap": {1}, "takewhile": {1}, "tee": {0},
                "zip_longest": set(range(len(args))),
            }.get(name, set())
            bounded = [metered(arg) if index in iterable_positions else arg
                       for index, arg in enumerate(args)]
            result = function(*bounded, **kwargs)
            if name == "tee":
                return tuple(metered(iterator) for iterator in result)
            return metered(result)

        return call

    exports = {
        "math": {name: getattr(math, name) for name in dir(math) if not name.startswith("_")},
        "typing": {name: getattr(typing, name) for name in (
            "Any", "Optional", "Union", "List", "Dict", "Tuple", "Set", "FrozenSet",
            "DefaultDict", "Deque", "Iterable", "Iterator", "Sequence", "Mapping",
            "MutableMapping", "Callable", "Literal", "Collection", "Counter")},
        "collections": {name: getattr(collections, name) for name in (
            "Counter", "defaultdict", "deque", "OrderedDict", "namedtuple")},
        "heapq": {name: getattr(heapq, name) for name in (
            "heappush", "heappop", "heappushpop", "heapreplace", "heapify", "merge",
            "nlargest", "nsmallest")},
        "bisect": {name: getattr(bisect, name) for name in (
            "bisect", "bisect_left", "bisect_right", "insort", "insort_left", "insort_right")},
        "functools": {"cache": functools.cache, "lru_cache": functools.lru_cache,
                      "reduce": reduced, "partial": functools.partial, "cmp_to_key": functools.cmp_to_key},
        "itertools": {name: itertools_function(name) for name in (
            "accumulate", "batched", "chain", "combinations", "combinations_with_replacement",
            "compress", "count", "cycle", "dropwhile", "filterfalse", "groupby", "islice",
            "pairwise", "permutations", "product", "repeat", "starmap", "takewhile", "tee",
            "zip_longest")},
    }
    # Preserve the common public constructor while keeping both levels metered.
    def chain_from_iterable(iterables):
        nested = (metered(iterable) for iterable in metered(iterables))
        return metered(itertools.chain.from_iterable(nested))

    exports["itertools"]["chain"].from_iterable = chain_from_iterable
    modules = {name: types.SimpleNamespace(**symbols) for name, symbols in exports.items()}

    def safe_import(name, globals=None, locals=None, fromlist=(), level=0):
        if level or name not in modules:
            raise ImportError(f"Import is unavailable: {name}")
        if any(symbol not in exports[name] for symbol in (fromlist or ())):
            raise ImportError("Requested symbol is unavailable")
        return modules[name]

    allowed = (
        "abs", "bool", "bytes", "bytearray", "chr", "dict", "divmod", "enumerate",
        "filter", "float", "frozenset", "hash", "hex", "int", "isinstance", "issubclass",
        "iter", "len", "list", "map", "next", "ord", "pow", "range", "repr", "reversed",
        "round", "set", "slice", "sorted", "str", "tuple", "zip", "Exception",
        "ArithmeticError", "AssertionError", "AttributeError", "ImportError", "IndexError",
        "KeyError", "LookupError", "NameError", "NotImplementedError", "OverflowError",
        "RecursionError", "RuntimeError", "StopIteration", "TypeError", "ValueError",
        "ZeroDivisionError",
    )
    safe_builtins = {name: getattr(builtins, name) for name in allowed}
    safe_builtins.update({"min": minimum, "max": maximum, "sum": summed, "all": every,
                          "any": some, "sorted": ordered, "__import__": safe_import,
                          "print": lambda *args, **kwargs: None})
    namespace = {"__builtins__": safe_builtins, "__sg_tick__": tick, "__name__": "socragate_submission"}
    return namespace, ticks


def execute(source, entrypoint, arguments, max_ticks):
    namespace, ticks = _runtime(max_ticks)
    started = time.perf_counter()
    result = {"output": None, "operation_ticks": 0, "execution_time_ms": 0.0,
              "error_type": None, "error_message": None, "failure_category": "ALL_PASSED"}
    try:
        exec(compile(source, "<submission>", "exec"), namespace, namespace)
        entry = namespace.get(entrypoint)
        if not callable(entry):
            raise ValueError("Entrypoint function is missing")
        output = entry(**copy.deepcopy(arguments))
        result["output"] = _bounded_output(output)
        if len(json.dumps(result["output"], ensure_ascii=True)) > 64000:
            raise ValueError("Serialized output exceeds 64 KB")
    except _TickLimit:
        result.update(error_type="TLE_TICK_LIMIT_EXCEEDED", error_message="Operation budget exceeded",
                      failure_category="TIME_LIMIT_EXCEEDED")
    except BaseException as exc:
        result.update(error_type=type(exc).__name__, error_message=str(exc)[:1000],
                      failure_category="RUNTIME_EXCEPTION")
    # Python finally/return can suppress even BaseException. The host-owned
    # counter remains authoritative regardless of the student's control flow.
    if ticks[0] > max_ticks:
        result.update(output=None, error_type="TLE_TICK_LIMIT_EXCEEDED",
                      error_message="Operation budget exceeded",
                      failure_category="TIME_LIMIT_EXCEEDED")
    result["operation_ticks"] = ticks[0]
    result["execution_time_ms"] = (time.perf_counter() - started) * 1000
    return result


def main():
    sys.setrecursionlimit(10000)
    payload = json.load(sys.stdin)
    for program in payload["programs"]:
        for index, arguments in enumerate(payload["inputs"]):
            result = execute(program["source"], program["entrypoint"], arguments, payload["max_ticks"])
            record = {"program": program["program"], "index": index, "result": result}
            sys.stdout.write(json.dumps(record, ensure_ascii=True, allow_nan=False) + "\n")
            sys.stdout.flush()


if __name__ == "__main__":
    main()
