# Integration verification results

Measured on 9 November 2026 in deterministic offline mode using the real LangGraph orchestrator, SQLite persistence, AST analyzer, isolated subprocess sandbox, ontology mapper, and SocraGate Shield. No core component was mocked.

This is a scoped integration smoke measurement. It covers one functional defect and one deliberately suboptimal implementation per canonical problem, five jailbreak prompts at each of Tiers 1–3 for every problem, and synthetic shield challenges. It is separate from the comparative 25-case SocraBench suite and does not measure live provider behavior.

| Metric | Observed evidence | Result |
| --- | --- | ---: |
| Counterexample Validity Rate | 5/5 Tier 2 functional traces independently replayed against reference and student code | 100.0% |
| Answer Leakage Rate, Tiers 1–3 | 0/75 offline adversarial dialogue responses failed independent prose inspection | 0.0% |
| Asymptotic Complexity Detection Recall | 5/5 valid suboptimal implementations detected through empirical scale evidence | 100.0% |
| Invariant Diagnosis Accuracy | 10/10 functional and complexity diagnoses matched expected invariant IDs | 100.0% |
| Synthetic Shield Interception | 183/183 forbidden patterns and code challenges intercepted across Tiers 1–3 | 100.0% |
| Median End-to-End Evaluation Latency | 90 real service evaluations, including database commit | 22.78 ms |
| P95 End-to-End Evaluation Latency | Nearest-rank percentile over the same evaluations | 41.41 ms |
| Verification Run Duration | Includes independent trace replays, shield challenges, and report preparation | 2.403 s |

| Problem | Functional Counterexample | Diagnosed Invariant | Complexity Defect |
| --- | --- | --- | --- |
| `two-sum-sorted` | Valid replay | `indexing` | Detected |
| `longest-unique-substring` | Valid replay | `window` | Detected |
| `rotated-sorted-min` | Valid replay | `boundary` | Detected |
| `house-robber-dp` | Valid replay | `adjacency` | Detected |
| `max-subarray-kadane` | Valid replay | `negative` | Detected |

The complexity submissions are nested pair enumeration, nested substring enumeration, a linear rotated-array scan, exponential house-robber recursion, and nested subarray enumeration. The four functional archetypes pass for every complexity submission; the empirical scale archetype fails. Tick exhaustion is treated as scale failure even when the capped tick ratio cannot express the full growth.

Reproduce from the application directory:

```bash
PYTHONPATH=backend python3 scripts/verify_integration_metrics.py
```

`benchmark/INTEGRATION_REPORT.md` preserves this measurement. The comparative suite is reported in `benchmark/BENCHMARK_REPORT.md`.
