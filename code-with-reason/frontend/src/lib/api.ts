export type Action = "submit_code" | "request_next_tier" | "unlock_escape_hatch";
export type FailureCategory = "ALL_PASSED" | "SYNTAX_INCOMPLETE" | "WRONG_ANSWER" | "RUNTIME_EXCEPTION" | "TIME_LIMIT_EXCEEDED" | "ASYMPTOTIC_SUBOPTIMAL";
export type Tier = 1 | 2 | 3 | 4;

export interface Problem {
  problem_id: string;
  title: string;
  difficulty: string;
  category: string;
  description: string;
  constraints: string[];
  entrypoint_fn: string;
  starter_code: string;
  target_time_complexity: string;
  target_space_complexity: string;
}

export interface ASTAnalysisResult {
  is_valid_syntax: boolean;
  syntax_error_msg: string | null;
  has_incomplete_placeholders: boolean;
  max_loop_depth: number;
  uses_recursion: boolean;
  has_base_case_guard: boolean;
  has_logarithmic_halving: boolean;
  detected_constructs: string[];
  estimated_time_complexity: string;
  code_hash: string;
  instrumented_code: string | null;
}

export interface ArchetypeResult {
  archetype: string;
  passed: boolean;
  operation_ticks: number;
  failure_reason: string | null;
}

export interface CounterexampleTrace {
  archetype: string;
  input_args: Record<string, unknown>;
  expected_output: unknown;
  actual_output: unknown;
  error_type: string | null;
  operation_ticks: number;
  scale_tick_ratio: number | null;
  execution_time_ms: number;
  is_verified: boolean;
}

export interface EvaluateRequest {
  session_id: string;
  problem_id: string;
  user_code: string;
  user_message?: string | null;
  action?: Action;
}

export interface EvaluateResponse {
  session_id: string;
  problem_id: string;
  current_tier: Tier;
  failure_category: FailureCategory;
  defect_hash: string;
  previous_defect_resolved: boolean;
  ast_summary: ASTAnalysisResult;
  archetype_results: ArchetypeResult[];
  violated_invariant: string | null;
  counterexample: CounterexampleTrace | null;
  scaffold_template: string | null;
  socratic_response: string;
  shield_triggered: boolean;
  shield_reason: string | null;
  latency_ms: number;
}

export interface SessionTurn {
  id: number;
  session_id: string;
  turn_index: number;
  action: Action;
  tier_used: Tier;
  failure_category: FailureCategory;
  defect_hash: string;
  violated_invariant_id: string | null;
  shield_triggered: boolean;
  latency_ms: number;
  user_code: string;
  socratic_response: string;
  counterexample: CounterexampleTrace | null;
}

export interface SessionDetail {
  session_id: string;
  problem_id: string;
  current_tier: Tier;
  last_defect_hash: string;
  last_code_hash: string;
  attempts_on_current_defect: number;
  is_solved: boolean;
  created_at: string;
  updated_at: string;
  turns: SessionTurn[];
}

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); this.name = "ApiError"; }
}

const BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "";
async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${BASE}/api/v1${path}`, {
      ...options, headers: { "Content-Type": "application/json", ...options.headers },
      signal: controller.signal, cache: "no-store",
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      const detail = typeof body?.detail === "string" ? body.detail : `Request failed (${response.status})`;
      throw new ApiError(detail, response.status);
    }
    return await response.json() as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof Error && error.name === "AbortError") throw new ApiError("The request timed out. Your code is saved; try again.", 408);
    throw new ApiError("Cannot reach SocraGate. Start the backend and try again.", 0);
  } finally { clearTimeout(timeout); }
}

export const getProblems = () => request<Problem[]>("/problems");
export const evaluateCode = (body: EvaluateRequest) => request<EvaluateResponse>("/evaluate", { method: "POST", body: JSON.stringify(body) });
export const getSession = (id: string) => request<SessionDetail>(`/sessions/${encodeURIComponent(id)}`);
export const resetSession = (id: string) => request<{ session_id: string; status: "reset" }>(`/sessions/${encodeURIComponent(id)}/reset`, { method: "POST" });
export const health = () => request<{ status: string; version: string; mode: string }>("/health");
