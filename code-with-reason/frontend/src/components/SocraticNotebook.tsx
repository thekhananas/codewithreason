"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowRight,
  ArrowUp,
  BookOpen,
  Check,
  ChevronDown,
  Clock3,
  FlaskConical,
  LockKeyhole,
  MessageCircle,
  ShieldCheck,
  Sparkles,
  Workflow,
  X,
} from "lucide-react";
import type {
  Action,
  CounterexampleTrace,
  EvaluateResponse,
  Tier,
} from "@/lib/api";
import styles from "./socratic-notebook.module.css";

export type DialogueEntry = {
  id: string;
  kind: "tutor" | "learner" | "event";
  text: string;
  tier: number;
  shielded?: boolean;
  latency?: number;
};

export interface SocraticNotebookProps {
  tier: Tier;
  defectHash: string;
  latest: EvaluateResponse | null;
  feed: DialogueEntry[];
  trace: CounterexampleTrace | null;
  scaffold: string | null;
  busy: boolean;
  recovering: boolean;
  unavailable: boolean;
  turnCount: number;
  isSolved: boolean;
  message: string;
  onMessageChange: (value: string) => void;
  onSubmit: (action: Action) => void;
  developerMode?: boolean;
  tutorMode?: string | null;
  onAskForHelp?: (message: string) => void;
}

const STEPS = [
  {
    title: "Invariant Probe",
    explanation: "Find the assumption your approach depends on.",
  },
  {
    title: "Counterexample",
    explanation: "Inspect an input that challenges that assumption.",
  },
  {
    title: "Logic Scaffold",
    explanation: "Fill in the missing pieces of your invariant.",
  },
  {
    title: "Post-Mortem",
    explanation: "Study the solution, then explain why it holds.",
  },
];

function pretty(value: unknown) {
  return JSON.stringify(value, null, 2) ?? String(value);
}

function label(value: string) {
  return value.replace(/[_-]+/g, " ");
}

function shieldExplanation(reason: string | null, tier: Tier) {
  if (!reason) return "No intervention required";
  if (tier === 4) return reason;
  // A forbidden-pattern reason includes the intercepted solution itself.
  // Explain the intervention without returning that withheld solution to view.
  const category = reason.split(":", 1)[0].split(";", 1)[0];
  const explanations: Record<string, string> = {
    code_fence: "A code block was withheld so the hint stays Socratic.",
    python_statement: "Executable solution syntax was withheld.",
    forbidden_pattern: "A solution-revealing pattern was withheld.",
    reference_bigram_overlap:
      "The draft overlapped too closely with the reference solution.",
  };
  const explanation =
    explanations[category] || "Guidance required a safe ontology fallback.";
  return reason.includes("unsafe_catalog_fallback")
    ? `${explanation} A safe question also replaced an unsafe fallback.`
    : explanation;
}

function inline(text: string): ReactNode[] {
  return text.split(/(`[^`\n]+`)/g).map((part, index) =>
    part.startsWith("`") && part.endsWith("`") ? (
      <code key={index} className={styles.inlineCode}>
        {part.slice(1, -1)}
      </code>
    ) : (
      part
    ),
  );
}

/** A small text-only renderer: model text never becomes executable HTML. */
function InquiryProse({ text }: { text: string }) {
  const sections = text.split(/(```[\s\S]*?```)/g).filter(Boolean);
  return (
    <div className={styles.prose}>
      {sections.map((section, sectionIndex) => {
        const fenced = section.match(/^```([^\n]*)\n([\s\S]*?)```$/);
        if (fenced)
          return (
            <div className={styles.codeBlock} key={sectionIndex}>
              <span className={styles.codeLanguage}>
                {fenced[1].trim() || "Code notes"}
              </span>
              <pre>
                <code>{fenced[2].replace(/\n$/, "")}</code>
              </pre>
            </div>
          );
        return section
          .split(/\n\s*\n/)
          .filter((block) => block.trim())
          .map((block, blockIndex) => {
            const key = `${sectionIndex}-${blockIndex}`;
            const lines = block.trim().split("\n");
            if (lines.every((line) => /^\s*[-*]\s+/.test(line))) {
              return (
                <ul key={key}>
                  {lines.map((line, index) => (
                    <li key={index}>
                      {inline(line.replace(/^\s*[-*]\s+/, ""))}
                    </li>
                  ))}
                </ul>
              );
            }
            if (lines.every((line) => /^\s*\d+[.)]\s+/.test(line))) {
              return (
                <ol key={key}>
                  {lines.map((line, index) => (
                    <li key={index}>
                      {inline(line.replace(/^\s*\d+[.)]\s+/, ""))}
                    </li>
                  ))}
                </ol>
              );
            }
            const heading = block.match(/^#{1,6}\s+([^\n]+)(?:\n([\s\S]*))?$/);
            if (heading)
              return (
                <div key={key}>
                  <h4>{inline(heading[1])}</h4>
                  {heading[2] && <p>{inline(heading[2])}</p>}
                </div>
              );
            return <p key={key}>{inline(block.trim())}</p>;
          });
      })}
    </div>
  );
}

function BreakingTrace({
  trace,
  developerMode,
}: {
  trace: CounterexampleTrace;
  developerMode: boolean;
}) {
  return (
    <section className={styles.evidence} aria-labelledby="breaking-trace-title">
      <div className={styles.evidenceHeading}>
        <span className={styles.sectionIcon}>
          <FlaskConical size={19} aria-hidden="true" />
        </span>
        <div>
          {developerMode && (
            <p className={styles.kicker}>Evidence / Tier 02+</p>
          )}
          <h3 id="breaking-trace-title">
            {developerMode
              ? trace.is_verified
                ? "Verified Breaking Trace"
                : "Breaking Trace"
              : "Why this code fails"}
          </h3>
        </div>
        {developerMode && trace.is_verified && (
          <span className={styles.verified}>
            <Check size={15} aria-hidden="true" /> Verified
          </span>
        )}
      </div>
      {developerMode && (
        <p className={styles.archetypeName}>{label(trace.archetype)}</p>
      )}
      <div className={styles.inputBlock}>
        <h4>{developerMode ? "Failing Input" : "Input"}</h4>
        <pre>
          <code>{pretty(trace.input_args)}</code>
        </pre>
      </div>
      <div className={styles.comparison}>
        <div className={styles.expected}>
          <h4>Expected Output</h4>
          <pre>
            <code>{pretty(trace.expected_output)}</code>
          </pre>
        </div>
        <div className={styles.actual}>
          <h4>Your Output / Error</h4>
          {trace.error_type && (
            <p className={styles.errorType}>{trace.error_type}</p>
          )}
          <pre>
            <code>{pretty(trace.actual_output)}</code>
          </pre>
        </div>
      </div>
      {developerMode && (
        <dl className={styles.traceMetrics}>
          <div>
            <dt>Operation Ticks</dt>
            <dd>
              {trace.operation_ticks.toLocaleString("en-US")} <span>ticks</span>
            </dd>
          </div>
          {trace.scale_tick_ratio !== null && (
            <div>
              <dt>Empirical Scale Ratio</dt>
              <dd>{trace.scale_tick_ratio.toFixed(2)}×</dd>
            </div>
          )}
          <div>
            <dt>Execution Time</dt>
            <dd>
              {trace.execution_time_ms.toLocaleString("en-US", {
                maximumFractionDigits: 3,
              })}{" "}
              <span>ms</span>
            </dd>
          </div>
        </dl>
      )}
    </section>
  );
}

function Skeleton({
  template,
  developerMode,
}: {
  template: string;
  developerMode: boolean;
}) {
  return (
    <section
      className={styles.scaffold}
      aria-labelledby="invariant-skeleton-title"
    >
      <div className={styles.evidenceHeading}>
        <span className={styles.sectionIcon}>
          <Workflow size={19} aria-hidden="true" />
        </span>
        <div>
          {developerMode && (
            <p className={styles.kicker}>Blueprint / Tier 03+</p>
          )}
          <h3 id="invariant-skeleton-title">
            {developerMode ? "Invariant Skeleton" : "Build your approach"}
          </h3>
        </div>
      </div>
      <p className={styles.scaffoldIntro}>
        {developerMode
          ? "The structure is here. Make each missing condition your own."
          : "Fill in the marked parts, then test your code again."}
      </p>
      <pre>
        <code>
          {template
            .split(/(\[[A-Z][A-Z0-9_]*\])/g)
            .map((part, index) =>
              /^\[[A-Z][A-Z0-9_]*\]$/.test(part) ? (
                <mark key={index}>{part}</mark>
              ) : (
                part
              ),
            )}
        </code>
      </pre>
    </section>
  );
}

function EvaluationRecord({
  result,
  activeTier,
}: {
  result: EvaluateResponse;
  activeTier: Tier;
}) {
  const records: [string, ReactNode][] = [
    ["session_id", result.session_id],
    ["problem_id", result.problem_id],
    ["current_tier", result.current_tier],
    ["failure_category", result.failure_category],
    ["defect_hash", result.defect_hash || "None — all checks passed"],
    ["previous_defect_resolved", String(result.previous_defect_resolved)],
    ["violated_invariant", result.violated_invariant || "None"],
    ["shield_triggered", String(result.shield_triggered)],
    ["shield_reason", shieldExplanation(result.shield_reason, activeTier)],
    [
      "latency_ms",
      `${result.latency_ms.toLocaleString("en-US", { maximumFractionDigits: 3 })} ms`,
    ],
  ];
  return (
    <details className={styles.record}>
      <summary>
        <ShieldCheck size={17} aria-hidden="true" />
        <span>Evaluation record</span>
        <ChevronDown size={16} aria-hidden="true" />
      </summary>
      <div className={styles.recordBody}>
        <p>Session, diagnosis and shield details for the latest run.</p>
        <dl className={styles.recordList}>
          {records.map(([key, value]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <details className={styles.innerRecord}>
          <summary>
            Archetype execution details{" "}
            <ChevronDown size={16} aria-hidden="true" />
          </summary>
          {result.archetype_results.length ? (
            <ul className={styles.archetypeDetails}>
              {result.archetype_results.map((item) => (
                <li key={item.archetype}>
                  <strong>{label(item.archetype)}</strong>
                  <span>
                    {item.passed ? "Verified" : "Violated"} ·{" "}
                    {item.operation_ticks.toLocaleString("en-US")} ticks
                  </span>
                  {item.failure_reason && <p>{item.failure_reason}</p>}
                </li>
              ))}
            </ul>
          ) : (
            <p>
              No archetypes executed. Complete the code structure before running
              the checks.
            </p>
          )}
        </details>
      </div>
    </details>
  );
}

export default function SocraticNotebook({
  tier,
  defectHash,
  latest,
  feed,
  trace,
  scaffold,
  busy,
  recovering,
  unavailable,
  turnCount,
  isSolved,
  message,
  onMessageChange,
  onSubmit,
  developerMode = false,
  tutorMode,
  onAskForHelp,
}: SocraticNotebookProps) {
  const consoleRef = useRef<HTMLDivElement>(null);
  const cancelEscapeRef = useRef<HTMLButtonElement>(null);
  const escapeButtonRef = useRef<HTMLButtonElement>(null);
  const [confirmEscape, setConfirmEscape] = useState(false);
  const nextTier = Math.min(3, tier + 1);
  const canEscalate = !unavailable && turnCount > 0 && tier < 3 && !isSolved;
  const canEscape = !unavailable && turnCount > 0 && tier < 4 && !isSolved;

  useEffect(() => {
    setConfirmEscape(false);
  }, [tier, defectHash, latest]);

  useEffect(() => {
    const panel = consoleRef.current;
    if (!panel?.scrollTo) return;
    const reduceMotion = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    panel.scrollTo({
      top: panel.scrollHeight,
      behavior: reduceMotion ? "auto" : "smooth",
    });
  }, [feed, busy, recovering]);

  useEffect(() => {
    if (confirmEscape) cancelEscapeRef.current?.focus();
  }, [confirmEscape]);

  function cancelEscape() {
    setConfirmEscape(false);
    escapeButtonRef.current?.focus();
  }

  const studentFeed = feed.filter((entry) => entry.kind !== "event");
  const latestTutorIndex = studentFeed.reduce(
    (last, entry, index) => (entry.kind === "tutor" ? index : last),
    -1,
  );
  const exchangeStart =
    latestTutorIndex > 0 && studentFeed[latestTutorIndex - 1].kind === "learner"
      ? latestTutorIndex - 1
      : Math.max(0, latestTutorIndex);
  const earlierEntries = studentFeed.slice(0, exchangeStart);
  const currentEntries = studentFeed.slice(exchangeStart);

  function renderEntry(entry: DialogueEntry) {
    if (entry.kind === "event")
      return (
        <p className={styles.event} key={entry.id}>
          <span aria-hidden="true" />
          {entry.text}
        </p>
      );
    const lockedPostmortem =
      entry.kind === "tutor" && entry.tier === 4 && tier < 4;
    return (
      <article
        key={entry.id}
        className={`${styles.entry} ${entry.kind === "learner" ? styles.learnerEntry : styles.tutorEntry}`}
      >
        <div className={styles.entryMeta}>
          <span>
            {entry.kind === "tutor" ? (
              <>
                <Sparkles size={16} aria-hidden="true" />
                {developerMode ? "SocraGate" : "Tutor"}
              </>
            ) : (
              <>
                <MessageCircle size={16} aria-hidden="true" />
                {developerMode ? "Your reasoning" : "You"}
              </>
            )}
          </span>
          {developerMode && entry.kind === "tutor" && (
            <span className={styles.entryTier}>Tier {entry.tier}</span>
          )}
        </div>
        {developerMode && entry.kind === "tutor" && (
          <h3 className={styles.inquiryHeading}>
            {entry.tier === 4
              ? lockedPostmortem
                ? "Earlier post-mortem"
                : "The Post-Mortem"
              : entry.tier === 3
                ? "Reconstruct the invariant"
                : entry.tier === 2
                  ? "Follow the evidence"
                  : "Active Hypothesis"}
          </h3>
        )}
        <InquiryProse
          text={
            lockedPostmortem
              ? "This earlier post-mortem is available only while the escape hatch is unlocked."
              : entry.text
          }
        />
        {developerMode && entry.kind === "tutor" && (
          <div className={styles.entryFooter}>
            <span>
              <ShieldCheck size={14} aria-hidden="true" />
              {entry.tier === 4
                ? lockedPostmortem
                  ? "Earlier post-mortem is locked"
                  : "Explicit solution walkthrough"
                : entry.shielded
                  ? "Safe ontology fallback applied"
                  : "Execution-grounded inquiry"}
            </span>
            {entry.latency !== undefined && (
              <span>
                <Clock3 size={14} aria-hidden="true" />
                {Math.round(entry.latency).toLocaleString("en-US")} ms
              </span>
            )}
          </div>
        )}
      </article>
    );
  }

  return (
    <section
      className={`${styles.notebook} ${!developerMode ? styles.studentNotebook : ""}`}
      aria-labelledby="notebook-title"
    >
      <div className={styles.notebookHeader}>
        <div className={styles.notebookTitle}>
          <span className={styles.notebookIcon}>
            <BookOpen size={23} aria-hidden="true" />
          </span>
          <div>
            {developerMode && (
              <p className={styles.kicker}>02 / Think it through</p>
            )}
            <h2 id="notebook-title">
              {developerMode ? "Socratic Field Notebook" : "Hints & questions"}
            </h2>
          </div>
        </div>
        {developerMode && (
          <span
            className={`${styles.shieldStatus} ${latest?.shield_triggered ? styles.shieldIntervened : ""}`}
          >
            <ShieldCheck size={16} aria-hidden="true" />
            {tier === 4
              ? "Solution unlocked"
              : latest?.shield_triggered
                ? "Shield intervened"
                : "Answer shield on"}
          </span>
        )}
      </div>

      {developerMode && (
        <div className={styles.ladder}>
          <ol
            aria-label={`Scaffolding ladder: Tier ${tier}, ${STEPS[tier - 1].title}`}
          >
            {STEPS.map((step, index) => {
              const number = index + 1;
              return (
                <li
                  key={step.title}
                  className={
                    tier === number
                      ? styles.activeStep
                      : tier > number
                        ? styles.completedStep
                        : ""
                  }
                  aria-current={tier === number ? "step" : undefined}
                >
                  <span className={styles.stepNumber}>
                    {tier > number ? (
                      <Check size={15} aria-hidden="true" />
                    ) : (
                      number
                    )}
                  </span>
                  <span>{step.title}</span>
                </li>
              );
            })}
          </ol>
          <p className={styles.stepExplanation}>
            <strong>Tier {tier}.</strong> {STEPS[tier - 1].explanation}
          </p>
        </div>
      )}
      {developerMode && defectHash && (
        <div className={styles.defectContext}>
          <span className={styles.defectDot} aria-hidden="true" />
          <span>Active defect</span>
          <details className={styles.defectDetails}>
            <summary>
              {defectHash.slice(0, 10)}{" "}
              <ChevronDown size={14} aria-hidden="true" />
            </summary>
            <code>{defectHash}</code>
          </details>
        </div>
      )}

      <div
        ref={consoleRef}
        className={styles.entries}
        aria-label="Questions and answers"
        aria-busy={busy || recovering}
        tabIndex={0}
      >
        {!feed.length && !recovering ? (
          developerMode ? (
            <div className={styles.welcome}>
              <span className={styles.welcomeRule} aria-hidden="true" />
              <p className={styles.kicker}>
                A good question changes the approach.
              </p>
              <h3>
                What must
                <br />
                stay true?
              </h3>
              <p>
                Write your first approach, then{" "}
                <strong>Run &amp; Reason</strong>. We’ll test its assumptions
                together, one invariant at a time.
              </p>
            </div>
          ) : (
            <p className={styles.studentWelcome}>
              Start with the examples. Ask for help whenever something is
              unclear.
            </p>
          )
        ) : (
          <div className={styles.feed}>
            {developerMode ? (
              feed.map(renderEntry)
            ) : (
              <>
                {earlierEntries.length > 0 && (
                  <details className={styles.earlierMessages}>
                    <summary>
                      Earlier messages ({earlierEntries.length})
                      <ChevronDown size={16} aria-hidden="true" />
                    </summary>
                    {earlierEntries.map(renderEntry)}
                  </details>
                )}
                {currentEntries.map(renderEntry)}
              </>
            )}
          </div>
        )}
        {(busy || recovering) && (
          <p className={styles.working} role="status">
            <span aria-hidden="true" />
            {recovering ? "Loading your conversation…" : "Thinking…"}
          </p>
        )}
      </div>
      <span className={styles.screenReaderStatus} role="status">
        {!busy && !recovering && feed.length
          ? developerMode
            ? `Field notebook updated after ${turnCount} ${turnCount === 1 ? "run" : "runs"}. Tier ${tier}: ${STEPS[tier - 1].title}.`
            : "Tutor reply ready."
          : ""}
      </span>

      {!developerMode && tutorMode && (
        <p className={styles.modeNote}>
          {tutorMode === "offline"
            ? "Guided hints · offline"
            : "Live tutor configured"}
        </p>
      )}

      {!developerMode && onAskForHelp && (
        <div
          className={styles.quickHelp}
          aria-label="Get help with the problem"
        >
          <button
            disabled={unavailable}
            onClick={() =>
              onAskForHelp(
                "I do not understand the problem. Please explain what the input and output mean.",
              )
            }
          >
            Explain the problem
          </button>
          <button
            disabled={unavailable}
            onClick={() =>
              onAskForHelp(
                "Please walk me through an input and output example.",
              )
            }
          >
            Walk through an example <ArrowRight size={16} aria-hidden="true" />
          </button>
        </div>
      )}

      <form
        className={styles.reasoningForm}
        onSubmit={(event) => {
          event.preventDefault();
          if (message.trim() && !unavailable) onSubmit("submit_code");
        }}
      >
        <label htmlFor="sparring-message">
          {developerMode
            ? "Put your reasoning into words"
            : "Reply in words (optional)"}
        </label>
        <div className={styles.composer}>
          <textarea
            id="sparring-message"
            aria-describedby="tutor-reply-help"
            maxLength={10000}
            rows={2}
            value={message}
            onChange={(event) => onMessageChange(event.target.value)}
            placeholder={
              developerMode
                ? "I think the invariant is…"
                : "e.g. Those are positions, or: Please explain the example."
            }
            disabled={unavailable}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                if (message.trim() && !unavailable) onSubmit("submit_code");
              }
            }}
          />
          <button
            type="submit"
            aria-label={
              developerMode ? "Send reasoning with current code" : "Send reply"
            }
            disabled={unavailable || !message.trim()}
          >
            <ArrowUp size={20} aria-hidden="true" />
            {!developerMode && <span>Send</span>}
          </button>
        </div>
        <p id="tutor-reply-help">
          {!developerMode &&
            "Questions and explanations go here; write Python in the code editor. "}
          Enter to send · Shift + Enter for a new line
        </p>
      </form>

      {(developerMode || turnCount > 0 || isSolved) && (
        <div className={styles.progressiveActions}>
          {isSolved ? (
            <p className={styles.solvedNote}>
              <Check size={18} aria-hidden="true" />
              {developerMode
                ? "Every archetype verified. Explain why your invariant holds."
                : "Your code passes all checks. Nice work."}
            </p>
          ) : tier < 3 ? (
            <button
              className={styles.nextHint}
              disabled={!canEscalate}
              onClick={() => onSubmit("request_next_tier")}
            >
              <span>
                {developerMode
                  ? `Still stuck? Reveal Tier ${nextTier} hint`
                  : "Show me a hint"}
              </span>
              <ArrowRight size={18} aria-hidden="true" />
            </button>
          ) : (
            <p className={styles.scaffoldNote}>
              <Workflow size={18} aria-hidden="true" />
              {developerMode
                ? tier === 4
                  ? "The post-mortem is unlocked."
                  : "Your logic scaffold is unlocked below."
                : tier === 4
                  ? "The full solution is below."
                  : "Use the outline below to build your approach."}
            </p>
          )}
          {tier < 4 && !isSolved && (
            <button
              ref={escapeButtonRef}
              className={styles.escapeButton}
              disabled={!canEscape}
              onClick={() => setConfirmEscape(true)}
              aria-expanded={confirmEscape}
              aria-controls="postmortem-confirmation"
            >
              <LockKeyhole size={16} aria-hidden="true" />
              {developerMode
                ? "Unlock Tier 4 Post-Mortem"
                : "Explain the full solution"}
            </button>
          )}
          {confirmEscape && (
            <div
              id="postmortem-confirmation"
              className={styles.escapeConfirmation}
              role="group"
              aria-labelledby="postmortem-confirmation-title"
              onKeyDown={(event) => {
                if (event.key === "Escape") cancelEscape();
              }}
            >
              <div className={styles.confirmationHeading}>
                <h3 id="postmortem-confirmation-title">
                  Ready to study the solution?
                </h3>
                <button
                  className={styles.dismiss}
                  aria-label={
                    developerMode
                      ? "Keep reasoning and cancel post-mortem"
                      : "Keep trying and cancel solution"
                  }
                  onClick={cancelEscape}
                >
                  <X size={18} aria-hidden="true" />
                </button>
              </div>
              <p>
                {developerMode
                  ? "This reveals the reference solution and walkthrough for this attempt. Take a moment to name the assumption you want to revisit."
                  : "This shows the full code and explanation. You can keep trying or read the solution now."}
              </p>
              <div className={styles.confirmationActions}>
                <button ref={cancelEscapeRef} onClick={cancelEscape}>
                  Keep reasoning
                </button>
                <button
                  className={styles.confirmEscape}
                  disabled={!canEscape}
                  onClick={() => {
                    setConfirmEscape(false);
                    onSubmit("unlock_escape_hatch");
                  }}
                >
                  {developerMode
                    ? "Reveal post-mortem"
                    : "Show the full solution"}
                  <ArrowRight size={16} aria-hidden="true" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {tier >= 2 && trace && (
        <BreakingTrace trace={trace} developerMode={developerMode} />
      )}
      {tier >= 3 && scaffold && (
        <Skeleton template={scaffold} developerMode={developerMode} />
      )}
      {developerMode && latest && (
        <EvaluationRecord result={latest} activeTier={tier} />
      )}
    </section>
  );
}
