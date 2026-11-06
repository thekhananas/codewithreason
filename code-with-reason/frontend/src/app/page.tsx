"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  Activity, AlertCircle, ArrowRight, ArrowUp, ArrowUpRight, BarChart3, BrainCircuit,
  Check, CheckCircle2, ChevronDown, ChevronRight, Circle, Code2, Compass,
  CornerDownLeft, FlaskConical, Leaf, Loader2, LockKeyhole, MessageSquare, Play,
  RotateCcw, ShieldCheck, Sparkles, Terminal, Workflow, X, XCircle,
} from "lucide-react";
import {
  ApiError, evaluateCode, getProblems, getSession, health, resetSession,
  type Action, type CounterexampleTrace, type EvaluateResponse, type Problem,
  type SessionDetail, type Tier,
} from "@/lib/api";

const ARCHETYPES = [
  ["base_min_boundary", "Min. boundary"],
  ["duplicates_and_ties", "Duplicates & ties"],
  ["negative_or_extreme_values", "Negative / extreme"],
  ["off_by_one_edge", "Off-by-one"],
  ["asymptotic_scale", "Scale check"],
] as const;
const TIERS = [
  { label: "Invariant probe", caption: "Question the assumption" },
  { label: "Counterexample", caption: "See the breaking input" },
  { label: "Logic scaffold", caption: "Find your next step" },
  { label: "Post-mortem", caption: "Reflect on the solution" },
];

type DialogueEntry = {
  id: string; kind: "tutor" | "learner" | "event"; text: string;
  tier: number; shielded?: boolean; latency?: number;
};
type SavedWorkspace = { sessionId: string; code: string; lastResult?: EvaluateResponse };
type WorkspaceError = { message: string; retry: "catalog" | "session" | "evaluation" };

function storageKey(id: string) { return `socragate:workspace:v1:${id}`; }
function readWorkspace(id: string): SavedWorkspace | null {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey(id)) || "null");
    return saved && typeof saved.sessionId === "string" && typeof saved.code === "string" ? saved : null;
  } catch { return null; }
}
function saveWorkspace(id: string, sessionId: string, code: string, result?: EvaluateResponse | null) {
  try {
    const previous = readWorkspace(id);
    const lastResult = result === undefined && previous?.sessionId === sessionId ? previous.lastResult : result || undefined;
    localStorage.setItem(storageKey(id), JSON.stringify({ sessionId, code, lastResult }));
  } catch { /* Browser storage can be unavailable; the workspace still works. */ }
}
function newSessionId() { return typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `sg-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : "Something interrupted the request. Please try again."; }
function pretty(value: unknown) { return JSON.stringify(value, null, 2) ?? String(value); }
function sessionFeed(session: SessionDetail): DialogueEntry[] {
  return session.turns.map(turn => ({
    id: `turn-${turn.id}`, kind: "tutor", text: turn.socratic_response,
    tier: turn.tier_used, shielded: turn.shield_triggered, latency: turn.latency_ms,
  }));
}

function EvidenceCard({ trace }: { trace: CounterexampleTrace }) {
  return <section className="evidence-card" aria-label="Verified counterexample">
    <div className="evidence-title"><FlaskConical size={14} /> Verified counterexample <ShieldCheck size={12} style={{ marginLeft: "auto" }} /></div>
    <div className="evidence-body">
      <div className="evidence-archetype">{trace.archetype}</div>
      <div className="json-row"><span>Input</span><pre>{pretty(trace.input_args)}</pre></div>
      <div className="json-row"><span>Expected</span><pre>{pretty(trace.expected_output)}</pre></div>
      <div className="json-row actual"><span>Actual</span><pre>{trace.error_type || pretty(trace.actual_output)}</pre></div>
      <div className="evidence-metrics"><span>{trace.operation_ticks.toLocaleString("en-US")} ticks</span>{trace.scale_tick_ratio !== null && <span>{trace.scale_tick_ratio.toFixed(2)}× scale ratio</span>}</div>
    </div>
  </section>;
}

function BenchmarkModal({ onClose }: { onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => { document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  function handleKeys(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") onClose();
    if (event.key !== "Tab") return;
    const items = dialogRef.current?.querySelectorAll<HTMLElement>("button, a[href], [tabindex='0']");
    if (!items?.length) return;
    const first = items[0], last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={dialogRef} className="benchmark-modal" role="dialog" aria-modal="true" aria-labelledby="benchmark-title" onKeyDown={handleKeys}>
      <div className="modal-header"><div><div className="eyebrow">SOCRABENCH / OFFLINE SUITE</div><h2 id="benchmark-title">Evidence behind the questions.</h2></div><button ref={closeRef} className="icon-button" aria-label="Close benchmarks" onClick={onClose}><X size={17} /></button></div>
      <p className="modal-intro">25 authored buggy submissions. Five algorithm families. Each case challenged at the first three hint tiers.</p>
      <div className="benchmark-stats">
        <div className="benchmark-stat"><strong>0.0%</strong><span>Answer leakage<br />0 of 75 protected turns</span></div>
        <div className="benchmark-stat"><strong>100%</strong><span>Counterexample validity<br />20 of 20 verified traces</span></div>
        <div className="benchmark-stat"><strong>100%</strong><span>Complexity recall<br />5 of 5 suboptimal cases</span></div>
      </div>
      <div className="benchmark-detail"><span>Invariant diagnosis accuracy</span><strong>25 / 25 cases</strong></div>
      <div className="benchmark-detail"><span>Execution evidence</span><strong>Reference replay + operation ticks</strong></div>
      <p className="benchmark-note">Measured in the shipped deterministic benchmark. These results describe this finite offline suite; live model responses were not evaluated. The full reproducible report is in <code>benchmark/BENCHMARK_REPORT.md</code>.</p>
    </div>
  </div>;
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
  const [recoveredTrace, setRecoveredTrace] = useState<CounterexampleTrace | null>(null);
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
  const requestToken = useRef(0);
  const bootToken = useRef(0);
  const activeProblem = useRef("");
  const lastAction = useRef<Action>("submit_code");
  const consoleRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);

  const problem = problems.find(item => item.problem_id === selectedId);
  const problemIndex = problems.findIndex(item => item.problem_id === selectedId);
  const unavailable = busy || recovering || catalogLoading || !problem;
  const trace = tier >= 2 ? latest?.counterexample || recoveredTrace : null;
  const scaffold = tier >= 3 ? latest?.scaffold_template : null;
  const analysis = latest?.ast_summary;
  const draftChanged = Boolean(latest) && code !== submittedCode;

  const activateProblem = useCallback(async (next: Problem, fresh = false) => {
    const token = ++requestToken.current;
    activeProblem.current = next.problem_id;
    setSelectedId(next.problem_id); setMessage(""); setError(null); setBusy(false);
    setLatest(null); setRecoveredTrace(null); setFeed([]); setTurnCount(0);
    setTier(1); setIsSolved(false); setDefectHash(""); setSubmittedCode("");
    const saved = fresh ? null : readWorkspace(next.problem_id);
    const id = saved?.sessionId || newSessionId();
    const draft = saved?.code ?? next.starter_code;
    setSessionId(id); setCode(draft);
    saveWorkspace(next.problem_id, id, draft, fresh ? null : undefined);
    try { localStorage.setItem("socragate:last-problem", next.problem_id); } catch { /* Optional preference. */ }
    if (!saved) { setRecovering(false); return; }
    setRecovering(true);
    try {
      const session = await getSession(id);
      if (token !== requestToken.current) return;
      if (session.problem_id !== next.problem_id) throw new Error("The saved session belongs to another problem. Reset this workspace to continue.");
      setTier(session.current_tier); setIsSolved(session.is_solved); setDefectHash(session.last_defect_hash);
      setFeed(sessionFeed(session)); setTurnCount(session.turns.length);
      const last = session.turns[session.turns.length - 1];
      if (last) { setSubmittedCode(last.user_code); setRecoveredTrace(session.current_tier >= 2 ? last.counterexample : null); }
      const cached = saved.lastResult;
      if (cached && cached.ast_summary.code_hash === session.last_code_hash && cached.current_tier === session.current_tier && cached.defect_hash === session.last_defect_hash) {
        setLatest({ ...cached, previous_defect_resolved: false });
      }
    } catch (caught) {
      if (token !== requestToken.current) return;
      if (!(caught instanceof ApiError && caught.status === 404)) setError({ message: errorMessage(caught), retry: "session" });
    } finally { if (token === requestToken.current) setRecovering(false); }
  }, []);

  const loadWorkspace = useCallback(async () => {
    const token = ++bootToken.current;
    setCatalogLoading(true); setError(null);
    const [catalog, runtime] = await Promise.allSettled([getProblems(), health()]);
    if (token !== bootToken.current) return;
    setEngineMode(runtime.status === "fulfilled" ? runtime.value.mode : null);
    if (catalog.status === "fulfilled" && catalog.value.length) {
      setProblems(catalog.value);
      let savedId = "";
      try { savedId = localStorage.getItem("socragate:last-problem") || ""; } catch { /* Optional preference. */ }
      const first = catalog.value.find(item => item.problem_id === savedId) || catalog.value[0];
      setCatalogLoading(false);
      await activateProblem(first);
    } else {
      setCatalogLoading(false);
      setError({ message: catalog.status === "rejected" ? errorMessage(catalog.reason) : "The problem catalog is empty. Check the backend catalog and retry.", retry: "catalog" });
    }
  }, [activateProblem]);

  useEffect(() => { void loadWorkspace(); return () => { bootToken.current++; requestToken.current++; }; }, [loadWorkspace]);
  useEffect(() => {
    const console = consoleRef.current;
    console?.scrollTo({ top: console.scrollHeight, behavior: "smooth" });
  }, [feed, busy]);

  async function submit(action: Action) {
    if (unavailable || !problem || !code.trim()) return;
    const token = ++requestToken.current;
    const currentProblem = problem.problem_id;
    const currentSession = sessionId;
    const currentCode = code;
    const currentMessage = message.trim();
    lastAction.current = action;
    setBusy(true); setError(null);
    try {
      const response = await evaluateCode({ session_id: currentSession, problem_id: currentProblem, user_code: currentCode, user_message: currentMessage, action });
      if (token !== requestToken.current || currentProblem !== activeProblem.current) return;
      setLatest(response); setTier(response.current_tier); setRecoveredTrace(null);
      setDefectHash(response.defect_hash); setIsSolved(response.failure_category === "ALL_PASSED");
      setSubmittedCode(currentCode); setMessage(""); setTurnCount(count => count + 1);
      setFeed(previous => {
        const safePrevious = response.current_tier < 4 ? previous.map(entry => entry.tier === 4 ? { ...entry, text: "This earlier post-mortem is available only while the escape hatch is unlocked." } : entry) : previous;
        const entry: DialogueEntry = currentMessage
          ? { id: `${token}-learner`, kind: "learner", text: currentMessage, tier: response.current_tier }
          : { id: `${token}-event`, kind: "event", text: action === "request_next_tier" ? "Next hint requested" : action === "unlock_escape_hatch" ? "Escape hatch explicitly unlocked" : "Code submitted for a challenge", tier: response.current_tier };
        return [...safePrevious, entry, { id: `${token}-tutor`, kind: "tutor", text: response.socratic_response, tier: response.current_tier, shielded: response.shield_triggered, latency: response.latency_ms }];
      });
      const draft = readWorkspace(currentProblem)?.code ?? currentCode;
      saveWorkspace(currentProblem, currentSession, draft, response);
    } catch (caught) {
      if (token === requestToken.current) setError({ message: errorMessage(caught), retry: "evaluation" });
    } finally { if (token === requestToken.current) setBusy(false); }
  }

  async function reset() {
    if (unavailable || !problem) return;
    const token = ++requestToken.current;
    setBusy(true); setError(null);
    try {
      try { await resetSession(sessionId); } catch (caught) { if (!(caught instanceof ApiError && caught.status === 404)) throw caught; }
      if (token === requestToken.current) await activateProblem(problem, true);
    } catch (caught) { if (token === requestToken.current) setError({ message: errorMessage(caught), retry: "session" }); }
    finally { if (token === requestToken.current) setBusy(false); }
  }

  function updateCode(value: string) {
    setCode(value);
    if (problem && sessionId) saveWorkspace(problem.problem_id, sessionId, value);
  }
  function editorKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); void submit("submit_code"); }
    if (event.key === "Tab" && !event.shiftKey) {
      event.preventDefault();
      const editor = event.currentTarget, start = editor.selectionStart, end = editor.selectionEnd;
      updateCode(code.slice(0, start) + "    " + code.slice(end));
      requestAnimationFrame(() => { editor.selectionStart = editor.selectionEnd = start + 4; });
    }
  }
  function retry() {
    if (!error) return;
    if (error.retry === "catalog") void loadWorkspace();
    else if (error.retry === "session" && problem) void activateProblem(problem);
    else void submit(lastAction.current);
  }

  return <div className="workspace-shell">
    <aside className="sidebar" aria-label="Workspace navigation">
      <div><div className="brand"><span className="brand-mark" aria-hidden="true"><i /><i /><i /><i /></span>SocraGate</div><p className="brand-caption">LEARN TO THINK IN CODE</p></div>
      <nav className="side-nav" aria-label="Main navigation"><button className="active" onClick={() => setBenchmarksOpen(false)}><Compass size={17} /> Practice</button><button onClick={() => setBenchmarksOpen(true)}><BarChart3 size={17} /> Benchmarks</button></nav>
      <div className="side-divider" />
      <div className="problem-set-label"><span className="eyebrow">Problem set</span><span className="problem-count">{String(problems.length || 5).padStart(2, "0")}</span></div>
      <nav className="problem-nav" aria-label="Algorithm problems">{problems.map((item, index) => <button key={item.problem_id} className={item.problem_id === selectedId ? "selected" : ""} aria-current={item.problem_id === selectedId ? "page" : undefined} onClick={() => { if (item.problem_id !== selectedId) void activateProblem(item); }}><span className="problem-number">{String(index + 1).padStart(2, "0")}</span><span><span className="problem-nav-title">{item.title}</span><span className="problem-nav-category" style={{ display: "block" }}>{item.category}</span></span></button>)}</nav>
      <div className="sidebar-bottom"><Leaf size={22} color="#a7c58e" strokeWidth={1.3} /><p className="side-note"><strong>A little friction.<br />A lot of understanding.</strong><br />The answer can wait.</p><div className="runtime-status"><span className={`status-dot ${engineMode ? "" : "offline"}`} />{engineMode === "offline" ? "Offline engine ready" : engineMode ? `${engineMode} engine connected` : "Waiting for engine"}</div></div>
    </aside>

    <main className="main-workspace">
      <header className="topbar"><div className="breadcrumb"><span>WORKSPACE</span><ChevronRight size={11} /><span>PRACTICE</span></div><div className="topbar-tools"><span className="shortcut">Run your code <kbd>⌘ ↵</kbd></span><span className="connection"><span className={`status-dot ${engineMode ? "" : "offline"}`} />{engineMode === "offline" ? "Deterministic engine" : engineMode ? `${engineMode} engine` : "Connecting"}</span></div></header>
      <div className="content">
        {error && <div className="error-banner" role="alert"><AlertCircle size={16} /><p>{error.message}</p><button onClick={retry} disabled={busy || recovering}>Retry connection</button></div>}
        {!problem ? <div className="workspace-loading">{catalogLoading ? <Loader2 className="spin" size={27} /> : <Terminal size={27} />}<h1>{catalogLoading ? "Opening your workspace…" : "Your workspace is ready to connect."}</h1><p>{catalogLoading ? "Loading the problem catalog and checking the tutor engine." : "Start the SocraGate backend, then retry the connection above. Your saved code stays in this browser."}</p></div> : <>
          <div className="heading-row"><div><div className="heading-index">CHALLENGE {String(problemIndex + 1).padStart(2, "0")} / {String(problems.length).padStart(2, "0")}</div><h1>{problem.title}</h1><div className="meta-row"><span className="category-label">{problem.category}</span><span className="meta-badge difficulty">{problem.difficulty}</span><span className="meta-badge">{problem.target_time_complexity} time</span><span className="meta-badge">{problem.target_space_complexity} space</span></div></div><div className="problem-controls"><div className="select-wrap"><label htmlFor="problem-selector" className="sr-only">Choose a problem</label><select id="problem-selector" value={selectedId} onChange={event => { const next = problems.find(item => item.problem_id === event.target.value); if (next) void activateProblem(next); }}>{problems.map(item => <option value={item.problem_id} key={item.problem_id}>{item.title}</option>)}</select><ChevronDown size={14} /></div><button className="icon-button" title="Reset session and restore starter code" aria-label="Reset session and restore starter code" onClick={() => void reset()} disabled={unavailable}><RotateCcw size={15} /></button></div></div>

          <section className="tier-ladder" aria-label={`Hint ladder: current tier ${tier}`}>{TIERS.map((step, index) => <div key={step.label} className={`tier-step ${tier === index + 1 ? "current" : tier > index + 1 ? "done" : ""}`} aria-current={tier === index + 1 ? "step" : undefined}><div className="tier-circle">{tier > index + 1 ? <Check size={12} /> : String(index + 1).padStart(2, "0")}</div><div><div className="tier-step-label">{step.label}</div><div className="tier-step-caption">{step.caption}</div></div></div>)}</section>
          <div className="section-label-row"><span className="eyebrow">Adversarial checks</span><span className="subtle-label">{recovering ? "Recovering saved session…" : latest ? `${latest.archetype_results.filter(item => item.passed).length} / 5 passed${draftChanged ? " · draft modified" : ""}` : turnCount ? "Re-run to refresh telemetry" : "Five ways to challenge your approach"}</span></div>
          <section className="archetypes" aria-label="Five archetype execution results">{ARCHETYPES.map(([id, label]) => { const result = latest?.archetype_results.find(item => item.archetype === id); return <div key={id} className={`archetype ${result ? result.passed ? "passed" : "failed" : ""}`} title={result?.failure_reason || id}><div className="archetype-top">{result ? result.passed ? <CheckCircle2 size={13} /> : <XCircle size={13} /> : <Circle size={13} />}<span>{label}</span></div><div className="archetype-ticks">{result ? `${result.operation_ticks.toLocaleString("en-US")} ticks` : "— ticks"}</div></div>; })}</section>
          {latest?.previous_defect_resolved && <div className="resolved-banner" role="status"><Sparkles size={17} /><div><strong>{isSolved ? "Every check passed. Well reasoned." : "Prior edge case resolved."}</strong><p>{isSolved ? "Your implementation meets the functional and empirical scale checks." : "Moving to the next invariant at Tier 1. A fresh question, and another step forward."}</p></div></div>}

          <div className="workspace-grid">
            <section className="left-pane" aria-label="Problem and code editor">
              <div className="brief-card"><div className="brief-heading"><span className="eyebrow">The challenge</span><span className="brief-number">{String(problemIndex + 1).padStart(2, "0")} <ArrowUpRight size={11} style={{ display: "inline", verticalAlign: "middle", marginLeft: 4 }} /></span></div><p>{problem.description}</p><details><summary><ChevronRight size={11} /> Constraints <span style={{ marginLeft: "auto", fontFamily: "monospace" }}>{problem.constraints.length}</span></summary><ul>{problem.constraints.map(constraint => <li key={constraint}>{constraint}</li>)}</ul></details></div>
              <div className="editor-card"><div className="editor-toolbar"><span className="file-tab"><Code2 size={14} /> solution.py</span><span className="editor-language">{draftChanged && <><span className="draft-dot" /> Draft modified <span>·</span></>}Python 3</span></div><div className="code-editor"><div className="line-numbers" aria-hidden="true" style={{ height: Math.max(303, code.split("\n").length * 22 + 36) }}>{code.split("\n").map((_, index) => <span key={index}>{index + 1}</span>)}</div><textarea ref={editorRef} maxLength={50000} aria-label="Python code editor" spellCheck={false} autoCapitalize="off" autoComplete="off" autoCorrect="off" value={code} onChange={event => updateCode(event.target.value)} onKeyDown={editorKey} style={{ height: Math.max(303, code.split("\n").length * 22 + 36) }} /></div><div className="ast-strip" aria-label="Live AST telemetry"><div className="ast-item"><span className="ast-item-label">Max loop depth</span><span className="ast-item-value">{analysis ? analysis.max_loop_depth : "—"}</span></div><div className="ast-item"><span className="ast-item-label">Estimated complexity</span><span className="ast-item-value">{analysis?.estimated_time_complexity || "Awaiting run"}</span></div><div className="ast-item"><span className="ast-item-label">Defect hash</span><span className="ast-item-value" title={defectHash}>{isSolved ? "All passed" : defectHash ? defectHash.slice(0, 10) : "—"}</span></div></div></div>
              <div className="editor-actions"><button className="primary-button" onClick={() => void submit("submit_code")} disabled={unavailable || !code.trim()}>{busy ? <Loader2 className="spin" size={15} /> : <Play size={13} fill="currentColor" />} {busy ? "Challenging your approach…" : "Run & challenge code"}<ArrowUpRight size={14} style={{ marginLeft: "auto" }} /></button><span className="run-shortcut">⌘ / Ctrl + ↵</span></div>
            </section>

            <section className="right-pane" aria-label="Socratic sparring console">
              <div className="console-card"><div className="console-header"><div className="console-title"><MessageSquare size={16} /> Socratic sparring</div><span className="shield-badge"><ShieldCheck size={11} />{tier === 4 ? "Escape hatch unlocked" : "Shield active"}</span></div><div ref={consoleRef} className="console-content" aria-live="polite" aria-busy={busy || recovering}>
                {!feed.length && !recovering ? <div className="welcome"><div className="welcome-orbit"><BrainCircuit size={29} strokeWidth={1.25} /></div><div className="eyebrow">TIER 01 / INVARIANT PROBE</div><h2>Let’s test your reasoning.</h2><p>Write an approach on the left. I’ll challenge the assumption that needs the most attention.</p><div className="welcome-steps"><span><b>01</b> Write</span><ArrowRight size={10} /><span><b>02</b> Challenge</span><ArrowRight size={10} /><span><b>03</b> Refine</span></div><div className="welcome-note"><ShieldCheck size={15} /><span>Your first hint is a question. Verified counterexamples and deeper guidance unlock as you work.</span></div></div> : <div className="dialogue-feed">{feed.map(entry => entry.kind === "event" ? <div className="dialogue-entry event" key={entry.id}>{entry.text}</div> : <article className={`dialogue-entry ${entry.kind}`} key={entry.id}><div className="message-meta"><span className="agent-avatar">{entry.kind === "tutor" ? <Sparkles size={11} /> : <span>Y</span>}</span>{entry.kind === "tutor" ? "SOCRAGATE" : "YOU"}{entry.kind === "tutor" && <span className="message-tier">TIER {String(entry.tier).padStart(2, "0")}</span>}</div>{entry.tier === 4 && entry.kind === "tutor" ? <pre className="postmortem-text">{entry.text}</pre> : <p className="message-text">{entry.text}</p>}{entry.kind === "tutor" && <div className="message-footer"><ShieldCheck size={9} />{entry.tier === 4 ? "Explicit solution walkthrough" : entry.shielded ? "Safe ontology fallback applied" : "Execution-grounded guidance"}{entry.latency !== undefined && <span style={{ marginLeft: "auto" }}>{Math.round(entry.latency)} ms</span>}</div>}</article>)}</div>}
                {(busy || recovering) && <div className="typing-status" role="status"><Loader2 size={13} className="spin" />{recovering ? "Recovering your session…" : "Checking the evidence…"}</div>}
              </div><form className="chat-form" onSubmit={event => { event.preventDefault(); void submit("submit_code"); }}><label className="sr-only" htmlFor="sparring-message">Message to the Socratic tutor</label><textarea id="sparring-message" maxLength={10000} value={message} onChange={event => setMessage(event.target.value)} placeholder="Share your reasoning or ask a question…" disabled={unavailable} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); if (message.trim()) void submit("submit_code"); } }} /><button type="submit" aria-label="Send message with current code" disabled={unavailable || !message.trim()}><ArrowUp size={16} /></button></form></div>
              <div className="hint-controls"><button className="secondary-button" onClick={() => void submit("request_next_tier")} disabled={unavailable || !turnCount || tier >= 3 || isSolved}><Workflow size={14} />{tier >= 3 ? "Logic scaffold unlocked" : "Unlock next hint tier"}<ChevronRight size={12} /></button><button className="secondary-button escape-button" title="Explicitly reveal the reference solution and walkthrough" onClick={() => void submit("unlock_escape_hatch")} disabled={unavailable || !turnCount || tier === 4 || isSolved}><LockKeyhole size={12} />Tier 4 escape hatch</button></div>
              {trace && <EvidenceCard trace={trace} />}{scaffold && <section className="scaffold-card" aria-label="Tier 3 logic scaffold"><div className="scaffold-title"><Workflow size={14} />Logic scaffold · fill in the reasoning</div><p>{scaffold}</p></section>}
            </section>
          </div>
          <footer className="page-footer"><span><Activity size={10} />{turnCount ? `${turnCount} challenge${turnCount === 1 ? "" : "s"} in this session` : "Your next insight starts with a question."}{isSolved && " · All checks passed"}</span><span><CornerDownLeft size={10} />Code saved in this browser · session retained by the tutor</span></footer>
        </>}
      </div>
    </main>
    {benchmarksOpen && <BenchmarkModal onClose={() => setBenchmarksOpen(false)} />}
  </div>;
}
