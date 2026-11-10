"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  Activity,
  AlertCircle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  Loader2,
  Play,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Sparkles,
  Terminal,
  X,
  XCircle,
} from "lucide-react";
import CodeStudio from "@/components/CodeStudio";
import ProblemBrief from "@/components/ProblemBrief";
import SocraticNotebook, {
  type DialogueEntry,
} from "@/components/SocraticNotebook";
import {
  ApiError,
  evaluateCode,
  getProblems,
  getSession,
  health,
  resetSession,
  type Action,
  type CounterexampleTrace,
  type EvaluateResponse,
  type Problem,
  type SessionDetail,
  type Tier,
} from "@/lib/api";

const ARCHETYPES = [
  ["base_min_boundary", "Base Min", "01"],
  ["duplicates_and_ties", "Duplicates", "02"],
  ["negative_or_extreme_values", "Negatives / Extremes", "03"],
  ["off_by_one_edge", "Off-By-One", "04"],
  ["asymptotic_scale", "Asymptotic Scale", "05"],
] as const;

type SavedWorkspace = {
  sessionId: string;
  code: string;
  lastResult?: EvaluateResponse;
};
type WorkspaceError = {
  message: string;
  retry: "catalog" | "session" | "evaluation";
};

function storageKey(id: string) {
  return `socragate:workspace:v1:${id}`;
}
function readWorkspace(id: string): SavedWorkspace | null {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey(id)) || "null");
    return saved &&
      typeof saved.sessionId === "string" &&
      typeof saved.code === "string"
      ? saved
      : null;
  } catch {
    return null;
  }
}
function saveWorkspace(
  id: string,
  sessionId: string,
  code: string,
  result?: EvaluateResponse | null,
) {
  try {
    const previous = readWorkspace(id);
    const lastResult =
      result === undefined && previous?.sessionId === sessionId
        ? previous.lastResult
        : result || undefined;
    localStorage.setItem(
      storageKey(id),
      JSON.stringify({ sessionId, code, lastResult }),
    );
  } catch {
    /* Browser storage can be unavailable; the workspace still works. */
  }
}
function newSessionId() {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `sg-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Something interrupted the request. Please try again.";
}
function sessionFeed(session: SessionDetail): DialogueEntry[] {
  return session.turns.map((turn) => ({
    id: `turn-${turn.id}`,
    kind: "tutor",
    text: turn.socratic_response,
    tier: turn.tier_used,
    shielded: turn.shield_triggered,
    latency: turn.latency_ms,
  }));
}

function BenchmarkModal({ onClose }: { onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);
  function handleKeys(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") onClose();
    if (event.key !== "Tab") return;
    const items = dialogRef.current?.querySelectorAll<HTMLElement>(
      "button, a[href], [tabindex='0']",
    );
    if (!items?.length) return;
    const first = items[0],
      last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="benchmark-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="benchmark-title"
        onKeyDown={handleKeys}
      >
        <div className="modal-header">
          <div>
            <div className="eyebrow">SOCRABENCH / OFFLINE SUITE</div>
            <h2 id="benchmark-title">Evidence behind the questions.</h2>
          </div>
          <button
            ref={closeRef}
            className="icon-button"
            aria-label="Close benchmarks"
            onClick={onClose}
          >
            <X size={17} />
          </button>
        </div>
        <p className="modal-intro">
          25 authored buggy submissions. Five algorithm families. Each case
          challenged at the first three hint tiers.
        </p>
        <div className="benchmark-stats">
          <div className="benchmark-stat">
            <strong>0.0%</strong>
            <span>
              Answer leakage
              <br />0 of 75 protected turns
            </span>
          </div>
          <div className="benchmark-stat">
            <strong>100%</strong>
            <span>
              Counterexample validity
              <br />
              20 of 20 verified traces
            </span>
          </div>
          <div className="benchmark-stat">
            <strong>100%</strong>
            <span>
              Complexity recall
              <br />5 of 5 suboptimal cases
            </span>
          </div>
        </div>
        <div className="benchmark-detail">
          <span>Invariant diagnosis accuracy</span>
          <strong>25 / 25 cases</strong>
        </div>
        <div className="benchmark-detail">
          <span>Execution evidence</span>
          <strong>Reference replay + operation ticks</strong>
        </div>
        <p className="benchmark-note">
          Measured in the shipped deterministic benchmark. These results
          describe this finite offline suite; live model responses were not
          evaluated. The full reproducible report is in{" "}
          <code>benchmark/BENCHMARK_REPORT.md</code>.
        </p>
      </div>
    </div>
  );
}

export default function PracticeWorkspace() {
  const [problems, setProblems] = useState<Problem[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [code, setCode] = useState("");
  const [submittedCode, setSubmittedCode] = useState("");
  const [message, setMessage] = useState("");
  const [tier, setTier] = useState<Tier>(1);
  const [latest, setLatest] = useState<EvaluateResponse | null>(null);
  const [recoveredTrace, setRecoveredTrace] =
    useState<CounterexampleTrace | null>(null);
  const [feed, setFeed] = useState<DialogueEntry[]>([]);
  const [turnCount, setTurnCount] = useState(0);
  const [isSolved, setIsSolved] = useState(false);
  const [defectHash, setDefectHash] = useState("");
  const [busy, setBusy] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [error, setError] = useState<WorkspaceError | null>(null);
  const [engineMode, setEngineMode] = useState<string | null>(null);
  const [benchmarksOpen, setBenchmarksOpen] = useState(false);
  const [developerMode, setDeveloperMode] = useState(false);
  const requestToken = useRef(0);
  const bootToken = useRef(0);
  const activeProblem = useRef("");
  const lastAction = useRef<Action>("submit_code");

  const problem = problems.find((item) => item.problem_id === selectedId);
  const problemIndex = problems.findIndex(
    (item) => item.problem_id === selectedId,
  );
  const unavailable = busy || recovering || catalogLoading || !problem;
  const trace = tier >= 2 ? latest?.counterexample || recoveredTrace : null;
  const scaffold = tier >= 3 ? latest?.scaffold_template : null;
  const analysis = latest?.ast_summary;
  const draftChanged = Boolean(latest) && code !== submittedCode;

  const activateProblem = useCallback(async (next: Problem, fresh = false) => {
    const token = ++requestToken.current;
    activeProblem.current = next.problem_id;
    setSelectedId(next.problem_id);
    setMessage("");
    setError(null);
    setBusy(false);
    setLatest(null);
    setRecoveredTrace(null);
    setFeed([]);
    setTurnCount(0);
    setTier(1);
    setIsSolved(false);
    setDefectHash("");
    setSubmittedCode("");
    const saved = fresh ? null : readWorkspace(next.problem_id);
    const id = saved?.sessionId || newSessionId();
    const draft = saved?.code ?? next.starter_code;
    setSessionId(id);
    setCode(draft);
    saveWorkspace(next.problem_id, id, draft, fresh ? null : undefined);
    try {
      localStorage.setItem("socragate:last-problem", next.problem_id);
    } catch {
      /* Optional preference. */
    }
    if (!saved) {
      setRecovering(false);
      return;
    }
    setRecovering(true);
    try {
      const session = await getSession(id);
      if (token !== requestToken.current) return;
      if (session.problem_id !== next.problem_id)
        throw new Error(
          "The saved session belongs to another problem. Reset this workspace to continue.",
        );
      setTier(session.current_tier);
      setIsSolved(session.is_solved);
      setDefectHash(session.last_defect_hash);
      setFeed(sessionFeed(session));
      setTurnCount(session.turns.length);
      const last = session.turns[session.turns.length - 1];
      if (last) {
        setSubmittedCode(last.user_code);
        setRecoveredTrace(
          session.current_tier >= 2 ? last.counterexample : null,
        );
      }
      const cached = saved.lastResult;
      if (
        cached &&
        cached.ast_summary.code_hash === session.last_code_hash &&
        cached.current_tier === session.current_tier &&
        cached.defect_hash === session.last_defect_hash
      ) {
        setLatest({ ...cached, previous_defect_resolved: false });
      }
    } catch (caught) {
      if (token !== requestToken.current) return;
      if (!(caught instanceof ApiError && caught.status === 404))
        setError({ message: errorMessage(caught), retry: "session" });
    } finally {
      if (token === requestToken.current) setRecovering(false);
    }
  }, []);

  const loadWorkspace = useCallback(async () => {
    const token = ++bootToken.current;
    setCatalogLoading(true);
    setError(null);
    const [catalog, runtime] = await Promise.allSettled([
      getProblems(),
      health(),
    ]);
    if (token !== bootToken.current) return;
    setEngineMode(runtime.status === "fulfilled" ? runtime.value.mode : null);
    if (catalog.status === "fulfilled" && catalog.value.length) {
      setProblems(catalog.value);
      let savedId = "";
      try {
        savedId = localStorage.getItem("socragate:last-problem") || "";
      } catch {
        /* Optional preference. */
      }
      const first =
        catalog.value.find((item) => item.problem_id === savedId) ||
        catalog.value[0];
      setCatalogLoading(false);
      await activateProblem(first);
    } else {
      setCatalogLoading(false);
      setError({
        message:
          catalog.status === "rejected"
            ? errorMessage(catalog.reason)
            : "The problem catalog is empty. Check the backend catalog and retry.",
        retry: "catalog",
      });
    }
  }, [activateProblem]);

  useEffect(() => {
    void loadWorkspace();
    return () => {
      bootToken.current++;
      requestToken.current++;
    };
  }, [loadWorkspace]);
  useEffect(() => {
    try {
      setDeveloperMode(
        localStorage.getItem("codewithreason:developer-mode:v1") === "true",
      );
    } catch {
      /* Advanced display remains optional when storage is unavailable. */
    }
  }, []);

  function toggleDeveloperMode() {
    const next = !developerMode;
    setDeveloperMode(next);
    if (!next) setBenchmarksOpen(false);
    try {
      localStorage.setItem("codewithreason:developer-mode:v1", String(next));
    } catch {
      /* Display preferences are optional. */
    }
  }

  async function submit(action: Action, messageOverride?: string) {
    const currentMessage = (messageOverride ?? message).trim();
    if (unavailable || !problem || (!code.trim() && !currentMessage)) return;
    const token = ++requestToken.current;
    const currentProblem = problem.problem_id;
    const currentSession = sessionId;
    // Comprehension questions do not require a written solution. Evaluate the
    // public starter internally while keeping the learner's empty draft intact.
    const currentCode = code.trim() ? code : problem.starter_code;
    lastAction.current = action;
    setBusy(true);
    setError(null);
    try {
      const response = await evaluateCode({
        session_id: currentSession,
        problem_id: currentProblem,
        user_code: currentCode,
        user_message: currentMessage,
        action,
      });
      if (
        token !== requestToken.current ||
        currentProblem !== activeProblem.current
      )
        return;
      setLatest(response);
      setTier(response.current_tier);
      setRecoveredTrace(null);
      setDefectHash(response.defect_hash);
      setIsSolved(response.failure_category === "ALL_PASSED");
      setSubmittedCode(currentCode);
      setMessage("");
      setTurnCount((count) => count + 1);
      setFeed((previous) => {
        const safePrevious =
          response.current_tier < 4
            ? previous.map((entry) =>
                entry.tier === 4
                  ? {
                      ...entry,
                      text: "This earlier post-mortem is available only while the escape hatch is unlocked.",
                    }
                  : entry,
              )
            : previous;
        const entry: DialogueEntry = currentMessage
          ? {
              id: `${token}-learner`,
              kind: "learner",
              text: currentMessage,
              tier: response.current_tier,
            }
          : {
              id: `${token}-event`,
              kind: "event",
              text:
                action === "request_next_tier"
                  ? "Next hint requested"
                  : action === "unlock_escape_hatch"
                    ? "Escape hatch explicitly unlocked"
                    : "Code submitted for a challenge",
              tier: response.current_tier,
            };
        return [
          ...safePrevious,
          entry,
          {
            id: `${token}-tutor`,
            kind: "tutor",
            text: response.socratic_response,
            tier: response.current_tier,
            shielded: response.shield_triggered,
            latency: response.latency_ms,
          },
        ];
      });
      const draft = readWorkspace(currentProblem)?.code ?? currentCode;
      saveWorkspace(currentProblem, currentSession, draft, response);
    } catch (caught) {
      if (token === requestToken.current)
        setError({ message: errorMessage(caught), retry: "evaluation" });
    } finally {
      if (token === requestToken.current) setBusy(false);
    }
  }

  async function reset() {
    if (unavailable || !problem) return;
    const token = ++requestToken.current;
    setBusy(true);
    setError(null);
    try {
      try {
        await resetSession(sessionId);
      } catch (caught) {
        if (!(caught instanceof ApiError && caught.status === 404))
          throw caught;
      }
      if (token === requestToken.current) await activateProblem(problem, true);
    } catch (caught) {
      if (token === requestToken.current)
        setError({ message: errorMessage(caught), retry: "session" });
    } finally {
      if (token === requestToken.current) setBusy(false);
    }
  }

  function askForHelp(question: string) {
    if (unavailable) return;
    setMessage(question);
    void submit("submit_code", question);
  }

  function updateCode(value: string) {
    setCode(value);
    if (problem && sessionId)
      saveWorkspace(problem.problem_id, sessionId, value);
  }
  function retry() {
    if (!error) return;
    if (error.retry === "catalog") void loadWorkspace();
    else if (error.retry === "session" && problem)
      void activateProblem(problem);
    else void submit(lastAction.current);
  }

  const verifiedCount =
    latest?.archetype_results.filter((item) => item.passed).length ?? 0;
  const checksRun = latest?.archetype_results.length ?? 0;

  return (
    <div
      className={`workspace-shell ${developerMode ? "developer-view" : "student-view"}`}
    >
      <a className="skip-link" href="#code-workshop">
        Skip to code workspace
      </a>
      <header className="masthead">
        <a href="/" className="brand" aria-label="Code With Reason home">
          <span className="brand-emblem" aria-hidden="true">
            <span>[</span>
            <i>r</i>
            <span>]</span>
          </span>
          <span className="brand-type">
            Code With Reason
            <span className="brand-caption">
              Powered by the SocraGate Engine
            </span>
          </span>
        </a>
        <nav className="main-nav" aria-label="Main navigation">
          <button
            className="nav-link active"
            aria-current={!benchmarksOpen ? "page" : undefined}
            onClick={() => setBenchmarksOpen(false)}
          >
            The workspace
          </button>
          {developerMode && (
            <button
              className="nav-link"
              onClick={() => setBenchmarksOpen(true)}
            >
              <BarChart3 size={17} aria-hidden="true" /> Benchmarks{" "}
              <ArrowUpRight size={15} aria-hidden="true" />
            </button>
          )}
          <button
            className="developer-mode-button"
            aria-pressed={developerMode}
            onClick={toggleDeveloperMode}
          >
            <Settings2 size={17} aria-hidden="true" />
            Developer mode
            <span className="mode-value">{developerMode ? "On" : "Off"}</span>
          </button>
        </nav>
      </header>

      <main className="main-workspace">
        {developerMode && (
          <div className="club-line">
            <span>THE ALGORITHMIC THINKING CLUB</span>
            <span>
              Less guessing. More reasoning.
              <ArrowDownRight size={18} aria-hidden="true" />
            </span>
          </div>
        )}
        {error && (
          <div className="error-banner" role="alert">
            <AlertCircle size={21} aria-hidden="true" />
            <p>{error.message}</p>
            <button onClick={retry} disabled={busy || recovering}>
              Retry connection <ArrowRight size={17} aria-hidden="true" />
            </button>
          </div>
        )}
        {!problem ? (
          <section className="workspace-loading" aria-live="polite">
            {catalogLoading ? (
              <Loader2 className="spin" size={32} aria-hidden="true" />
            ) : (
              <Terminal size={32} aria-hidden="true" />
            )}
            <p className="eyebrow">YOUR THINKING SPACE</p>
            <h1>
              {catalogLoading
                ? "A good question awaits."
                : "Let’s reconnect your workspace."}
            </h1>
            <p>
              {catalogLoading
                ? "Opening the problem collection and checking the reasoning engine…"
                : "Start the SocraGate backend, then retry the connection above. Your saved code stays in this browser."}
            </p>
          </section>
        ) : (
          <>
            <section className="problem-heading" aria-label="Current problem">
              <div className="problem-title-block">
                {developerMode && (
                  <div className="eyebrow">
                    <span className="chapter-mark">
                      {String(problemIndex + 1).padStart(2, "0")}
                    </span>{" "}
                    THE CURRENT CHALLENGE{" "}
                    <span className="heading-of">
                      / {String(problems.length).padStart(2, "0")}
                    </span>
                  </div>
                )}
                <h1>
                  {problem.title}
                  <span className="title-period" aria-hidden="true">
                    .
                  </span>
                </h1>
                <div className="problem-meta">
                  <span>{problem.category}</span>
                  <span className="meta-pill difficulty">
                    {problem.difficulty}
                  </span>
                  {developerMode && (
                    <span className="complexity-target">
                      Target: <strong>{problem.target_time_complexity}</strong>{" "}
                      time <span aria-hidden="true">·</span>{" "}
                      <strong>{problem.target_space_complexity}</strong> space
                    </span>
                  )}
                </div>
              </div>
              <div className="problem-controls">
                <label className="select-label" htmlFor="problem-selector">
                  Choose a problem
                </label>
                <div className="selector-actions">
                  <div className="select-wrap">
                    <select
                      id="problem-selector"
                      aria-label="Choose a problem"
                      value={selectedId}
                      onChange={(event) => {
                        const next = problems.find(
                          (item) => item.problem_id === event.target.value,
                        );
                        if (next) void activateProblem(next);
                      }}
                    >
                      {problems.map((item) => (
                        <option value={item.problem_id} key={item.problem_id}>
                          {item.title}
                        </option>
                      ))}
                    </select>
                    <ChevronDown size={17} aria-hidden="true" />
                  </div>
                  <button
                    className="reset-button"
                    title="Reset session and restore starter code"
                    aria-label="Reset session"
                    onClick={() => void reset()}
                    disabled={unavailable}
                  >
                    <RotateCcw size={17} aria-hidden="true" />
                    <span>Reset</span>
                  </button>
                </div>
                {developerMode && (
                  <div className="session-status">
                    <ShieldCheck size={16} aria-hidden="true" />
                    <span>
                      {engineMode
                        ? `${engineMode} engine`
                        : "Waiting for engine"}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>
                      {tier === 4
                        ? "Post-mortem unlocked"
                        : latest?.shield_triggered
                          ? "Safe guidance applied"
                          : "Socratic shield active"}
                    </span>
                    {latest && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>{Math.round(latest.latency_ms)} ms</span>
                      </>
                    )}
                  </div>
                )}
              </div>
            </section>

            {developerMode && (
              <>
                <nav className="problem-index" aria-label="Algorithm problems">
                  {problems.map((item, index) => (
                    <button
                      key={item.problem_id}
                      className={
                        item.problem_id === selectedId ? "selected" : ""
                      }
                      aria-current={
                        item.problem_id === selectedId ? "page" : undefined
                      }
                      onClick={() => {
                        if (item.problem_id !== selectedId)
                          void activateProblem(item);
                      }}
                    >
                      <span className="problem-number">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span>{item.title}</span>
                      {item.problem_id === selectedId && (
                        <ArrowDownRight size={17} aria-hidden="true" />
                      )}
                    </button>
                  ))}
                </nav>

                <section
                  className="telemetry-section"
                  aria-labelledby="telemetry-title"
                >
                  <div className="section-label-row">
                    <h2 id="telemetry-title" className="eyebrow">
                      FIVE WAYS TO TEST AN IDEA
                    </h2>
                    <span className="telemetry-summary" role="status">
                      {recovering
                        ? "Recovering saved session…"
                        : latest
                          ? checksRun
                            ? `${verifiedCount} / 5 verified${draftChanged ? " · draft modified" : ""}`
                            : "Untested · complete your hypothesis first"
                          : turnCount
                            ? "Run again to refresh the checks"
                            : "Your boundary checks will appear here"}
                    </span>
                  </div>
                  <div className="archetypes">
                    {ARCHETYPES.map(([id, label, number]) => {
                      const result = latest?.archetype_results.find(
                        (item) => item.archetype === id,
                      );
                      const state = result
                        ? result.passed
                          ? "passed"
                          : "failed"
                        : "pending";
                      return (
                        <article
                          key={`${id}-${state}`}
                          className={`archetype ${state}`}
                          aria-label={`${label}: ${result ? (result.passed ? "Verified" : "Violated") : "Untested"}`}
                        >
                          <div className="archetype-top">
                            <span className="archetype-number">{number}</span>
                            <span className="archetype-name">{label}</span>
                            {result ? (
                              result.passed ? (
                                <CheckCircle2 size={19} aria-hidden="true" />
                              ) : (
                                <XCircle size={19} aria-hidden="true" />
                              )
                            ) : (
                              <Circle size={18} aria-hidden="true" />
                            )}
                          </div>
                          <div className="archetype-bottom">
                            <span className="archetype-state">
                              {result
                                ? result.passed
                                  ? "Verified"
                                  : "Violated"
                                : "Untested"}
                            </span>
                            <span className="archetype-ticks">
                              {result
                                ? `${result.operation_ticks.toLocaleString("en-US")} ticks`
                                : "— ticks"}
                            </span>
                          </div>
                          {result?.failure_reason && (
                            <details className="archetype-finding">
                              <summary>Inspect finding</summary>
                              <p>{result.failure_reason}</p>
                            </details>
                          )}
                        </article>
                      );
                    })}
                  </div>
                </section>
              </>
            )}

            {latest?.previous_defect_resolved && (
              <div className="resolved-banner" role="status">
                <span className="celebration-mark">
                  <Sparkles size={25} aria-hidden="true" />
                </span>
                <div>
                  <strong>
                    {developerMode
                      ? "Invariant Mastered — Prior Edge Case Resolved!"
                      : isSolved
                        ? "All checks passed. Nicely done!"
                        : "You fixed the previous issue."}
                  </strong>
                  <p>
                    {isSolved
                      ? "Your solution passes the current checks. Can you explain why it works?"
                      : "There’s one more thing to work on. Read the next hint when you’re ready."}
                  </p>
                </div>
                <span className="mastered-stamp">
                  <Check size={16} aria-hidden="true" /> Well reasoned
                </span>
              </div>
            )}

            <div className="workspace-grid learning-workspace">
              <section
                className="problem-pane"
                aria-label="Problem statement and examples"
              >
                <ProblemBrief problem={problem} />
              </section>
              <div className="solution-pane">
                <section
                  className="left-pane"
                  aria-label="Code workspace"
                  id="code-workshop"
                  tabIndex={-1}
                >
                  <div className="studio-card">
                    <div className="studio-heading">
                      <div>
                        {developerMode && (
                          <div className="eyebrow">01 / THE WORKSHOP</div>
                        )}
                        <h2>
                          {developerMode
                            ? "Active Hypothesis"
                            : "Your Python solution"}
                        </h2>
                      </div>
                      <button
                        className="primary-button studio-run"
                        onClick={() => void submit("submit_code")}
                        disabled={unavailable || !code.trim()}
                      >
                        {busy ? (
                          <Loader2
                            className="spin"
                            size={19}
                            aria-hidden="true"
                          />
                        ) : (
                          <Play
                            size={17}
                            fill="currentColor"
                            aria-hidden="true"
                          />
                        )}
                        <span>
                          {busy ? "Checking your code…" : "Run & Reason"}
                        </span>
                        <kbd>⌘ / Ctrl + Enter</kbd>
                        <ArrowRight size={18} aria-hidden="true" />
                      </button>
                    </div>
                    {!developerMode && (
                      <p className="editor-purpose-note">
                        Write Python here. Run &amp; Reason checks this code.
                      </p>
                    )}
                    <CodeStudio
                      key={`${problem.problem_id}-${sessionId}`}
                      value={code}
                      onChange={updateCode}
                      onRun={() => void submit("submit_code")}
                      disabled={unavailable}
                      draftChanged={draftChanged}
                      analysis={analysis}
                      defectHash={defectHash}
                      isSolved={isSolved}
                      developerMode={developerMode}
                    />
                    {latest && !developerMode && (
                      <div className="student-run-summary" role="status">
                        {isSolved && !draftChanged ? (
                          <CheckCircle2 size={18} aria-hidden="true" />
                        ) : (
                          <AlertCircle size={18} aria-hidden="true" />
                        )}
                        <p>
                          {!code.trim()
                            ? "Your editor is empty. Write a solution here, or keep asking questions below."
                            : draftChanged
                              ? "Draft changed. Run again to check your edits."
                              : checksRun
                                ? `${verifiedCount} of ${checksRun} checks passed.${isSolved ? " Your solution is ready." : " Read the hint below for your next step."}`
                                : "Complete the starter function, then run your code. You can ask for help below."}
                        </p>
                      </div>
                    )}
                  </div>
                </section>

                <SocraticNotebook
                  key={`${problem.problem_id}-${sessionId}`}
                  tier={tier}
                  defectHash={defectHash}
                  latest={latest}
                  feed={feed}
                  trace={trace}
                  scaffold={scaffold ?? null}
                  busy={busy}
                  recovering={recovering}
                  unavailable={unavailable}
                  turnCount={turnCount}
                  isSolved={isSolved}
                  message={message}
                  onMessageChange={setMessage}
                  onSubmit={(action) => void submit(action)}
                  developerMode={developerMode}
                  tutorMode={engineMode}
                  onAskForHelp={askForHelp}
                />
              </div>
            </div>
            <footer className="page-footer">
              {developerMode && (
                <span>
                  <Activity size={17} aria-hidden="true" />
                  {turnCount
                    ? `${turnCount} challenge${turnCount === 1 ? "" : "s"} in this session`
                    : "Your next insight starts with a question."}
                  {isSolved && " · All checks verified"}
                </span>
              )}
              <span className="save-note">
                <span className="status-dot" />
                Your code is saved in this browser.
              </span>
              {developerMode && (
                <span className="footer-signature">
                  Stay curious. Keep reasoning.
                </span>
              )}
            </footer>
          </>
        )}
      </main>
      {benchmarksOpen && (
        <BenchmarkModal onClose={() => setBenchmarksOpen(false)} />
      )}
    </div>
  );
}
