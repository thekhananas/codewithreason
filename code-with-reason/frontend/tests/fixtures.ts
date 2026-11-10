import type { EvaluateResponse, Problem, SessionDetail } from "@/lib/api";

export const problems: Problem[] = [
  {
    problem_id: "two-sum-sorted",
    title: "Two Sum, Sorted",
    difficulty: "Easy",
    category: "Two pointers",
    description: "Find two entries whose sum equals the target.",
    constraints: ["2 <= len(nums) <= 10000", "Exactly one solution exists"],
    entrypoint_fn: "two_sum_sorted",
    starter_code: "def two_sum_sorted(nums, target):\n    pass",
    target_time_complexity: "O(N)",
    target_space_complexity: "O(1)",
  },
  {
    problem_id: "house-robber-dp",
    title: "House Robber",
    difficulty: "Medium",
    category: "Dynamic programming",
    description: "Maximize a sum without choosing adjacent entries.",
    constraints: ["1 <= len(nums) <= 10000"],
    entrypoint_fn: "rob",
    starter_code: "def rob(nums):\n    pass",
    target_time_complexity: "O(N)",
    target_space_complexity: "O(1)",
  },
];

export const trace = {
  archetype: "off_by_one_edge",
  input_args: { nums: [2, 7, 11], target: 9 },
  expected_output: [1, 2],
  actual_output: [0, 1],
  error_type: null,
  operation_ticks: 124,
  scale_tick_ratio: 2.01,
  execution_time_ms: 0.42,
  is_verified: true,
};

export function makeResult(
  overrides: Partial<EvaluateResponse> = {},
): EvaluateResponse {
  return {
    session_id: "saved-session",
    problem_id: problems[0].problem_id,
    current_tier: 1,
    failure_category: "WRONG_ANSWER",
    defect_hash: "index-origin-defect",
    previous_defect_resolved: false,
    ast_summary: {
      is_valid_syntax: true,
      syntax_error_msg: null,
      has_incomplete_placeholders: false,
      max_loop_depth: 1,
      uses_recursion: false,
      has_base_case_guard: true,
      has_logarithmic_halving: false,
      detected_constructs: ["while"],
      estimated_time_complexity: "O(N)",
      code_hash: "code-hash-1",
      instrumented_code: null,
    },
    archetype_results: [
      "base_min_boundary",
      "duplicates_and_ties",
      "negative_or_extreme_values",
      "off_by_one_edge",
      "asymptotic_scale",
    ].map((archetype) => ({
      archetype,
      passed: archetype !== "off_by_one_edge",
      operation_ticks: 124,
      failure_reason:
        archetype === "off_by_one_edge" ? "Index origin differs" : null,
    })),
    violated_invariant: "index-origin",
    counterexample: null,
    scaffold_template: null,
    socratic_response: "Which index convention does the statement require?",
    shield_triggered: false,
    shield_reason: null,
    latency_ms: 42.3,
    ...overrides,
  };
}

export function makeSession(
  overrides: Partial<SessionDetail> = {},
): SessionDetail {
  return {
    session_id: "saved-session",
    problem_id: problems[0].problem_id,
    current_tier: 2,
    last_defect_hash: "index-origin-defect",
    last_code_hash: "code-hash-1",
    attempts_on_current_defect: 1,
    is_solved: false,
    created_at: "2026-11-10T12:00:00Z",
    updated_at: "2026-11-10T12:01:00Z",
    turns: [
      {
        id: 1,
        session_id: "saved-session",
        turn_index: 1,
        action: "request_next_tier",
        tier_used: 2,
        failure_category: "WRONG_ANSWER",
        defect_hash: "index-origin-defect",
        violated_invariant_id: "index-origin",
        shield_triggered: false,
        latency_ms: 42.3,
        user_code: "def two_sum_sorted(nums, target):\n    return [0, 1]",
        socratic_response: "Recovered server guidance.",
        counterexample: trace,
      },
    ],
    ...overrides,
  };
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
