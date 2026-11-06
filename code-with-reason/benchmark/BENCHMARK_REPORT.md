# SocraBench — offline deterministic evaluation

25 buggy submissions across five blueprint problems, each paired with a distinct jailbreak prompt. Each submission is evaluated at Tiers 1–3: 75 real LangGraph/SQLite/sandbox/shield turns. No external LLM calls or core-engine mocks are used.

| Metric | Baseline: unshielded prompt-only fixture | SocraGate v3.0 |
|---|---:|---:|
| Answer leakage rate, Tiers 1–3 | 100.0% | 0.0% (0/75) |
| Counterexample validity | N/A — no execution evidence | 100.0% (20/20) |
| Asymptotic detection recall | 0.0% (0/5) | 100.0% (5/5) |
| Invariant diagnosis accuracy | 0.0% (0/25) | 100.0% (25/25) |
| Median execution latency | 0.001 ms | 23.91 ms |
| P95 execution latency | 0.002 ms | 218.19 ms |

The baseline is a scripted offline comparator that emits curated unsafe candidate answers. It has no execution or diagnosis capability. These are synthetic stress-test results, not measurements of an external model or evidence of superiority over one. Its latency measures a fixture lookup and is not a like-for-like engine comparison.

Independent shield challenge: the same 25 unsafe candidates were inspected at all three protected tiers. 75/75 triggered a deterministic fallback; post-shield leakage was 0.0%.

Counterexamples are independently replayed against both reference and student code once per distinct submission. Scale proofs replay N=100 and N=1000 and recheck the tick ratio or operation-budget exhaustion. Syntax/stub cases correctly supply no trace and are excluded from the validity denominator. Latency includes service execution, child startup, and SQLite commit, excluding independent replay, HTTP transport, and UI rendering. P95 uses the nearest-rank method.

| Case | Observed failure | Invariant | Trace replay | Median ms |
|---|---|---|---|---:|
| two_sum_stub | SYNTAX_INCOMPLETE | structure | N/A | 1.53 |
| two_sum_zero_index | WRONG_ANSWER | indexing | valid | 23.49 |
| two_sum_duplicate_exit | WRONG_ANSWER | boundary | valid | 23.79 |
| two_sum_quadratic | ASYMPTOTIC_SUBOPTIMAL | complexity | valid | 32.29 |
| two_sum_nonprogress | TIME_LIMIT_EXCEEDED | complexity | valid | 70.62 |
| substring_syntax | SYNTAX_INCOMPLETE | structure | N/A | 1.30 |
| substring_length_off_by_one | WRONG_ANSWER | boundary | valid | 23.94 |
| substring_stale_duplicate | WRONG_ANSWER | window | valid | 24.60 |
| substring_quadratic | ASYMPTOTIC_SUBOPTIMAL | complexity | valid | 51.68 |
| substring_nonprogress | TIME_LIMIT_EXCEEDED | complexity | valid | 159.57 |
| rotated_stub | SYNTAX_INCOMPLETE | structure | N/A | 1.36 |
| rotated_last_position | WRONG_ANSWER | boundary | valid | 22.40 |
| rotated_reversed_ordering | WRONG_ANSWER | boundary | valid | 23.03 |
| rotated_linear_builtin | ASYMPTOTIC_SUBOPTIMAL | complexity | valid | 22.70 |
| rotated_adjacent_nonprogress | TIME_LIMIT_EXCEEDED | progress | valid | 160.91 |
| robber_stub | SYNTAX_INCOMPLETE | structure | N/A | 1.34 |
| robber_skip_final | WRONG_ANSWER | base_case | valid | 23.76 |
| robber_fixed_parity | WRONG_ANSWER | adjacency | valid | 24.00 |
| robber_exponential | ASYMPTOTIC_SUBOPTIMAL | complexity | valid | 65.44 |
| robber_nonprogress | TIME_LIMIT_EXCEEDED | complexity | valid | 217.89 |
| kadane_syntax | SYNTAX_INCOMPLETE | structure | N/A | 1.26 |
| kadane_skip_final | WRONG_ANSWER | boundary | valid | 22.85 |
| kadane_empty_candidate | WRONG_ANSWER | negative | valid | 22.24 |
| kadane_quadratic | ASYMPTOTIC_SUBOPTIMAL | complexity | valid | 42.11 |
| kadane_nonprogress | TIME_LIMIT_EXCEEDED | complexity | valid | 232.43 |

Scope: finite curated inputs and rule-based leakage auditing. Zero observed leakage does not prove protection against every paraphrase. No live-provider efficacy or latency claim is made. Python restrictions require OS/container resource controls for hostile multi-tenant deployment.

Reproduce: `PYTHONPATH=backend python3 benchmark/run_benchmark.py` (activate `.venv` first).
