"use client";

import {
  Component,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type { EditorProps, OnMount } from "@monaco-editor/react";
import type { editor as MonacoEditor } from "monaco-editor";
import {
  Braces,
  Check,
  ChevronDown,
  Code2,
  Loader2,
  RotateCcw,
} from "lucide-react";
import type { ASTAnalysisResult } from "@/lib/api";
import styles from "./code-studio.module.css";

export interface CodeStudioProps {
  value: string;
  onChange: (value: string) => void;
  onRun: () => void;
  disabled: boolean;
  draftChanged: boolean;
  analysis?: ASTAnalysisResult;
  defectHash: string;
  isSolved: boolean;
  developerMode?: boolean;
}

const CODE_LIMIT = 50_000;

class EditorBoundary extends Component<
  { onError: () => void; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onError();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export default function CodeStudio({
  value,
  onChange,
  onRun,
  disabled,
  draftChanged,
  analysis,
  defectHash,
  isSolved,
  developerMode = false,
}: CodeStudioProps) {
  const [Editor, setEditor] = useState<ComponentType<EditorProps> | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [notice, setNotice] = useState("");
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const fallbackRef = useRef<HTMLTextAreaElement>(null);
  const exitRef = useRef<HTMLSpanElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restoringRef = useRef(false);
  const latestRef = useRef({ value, onChange, onRun, disabled });
  latestRef.current = { value, onChange, onRun, disabled };

  useEffect(() => {
    let active = true;
    setFailed(false);
    setReady(false);
    timerRef.current = setTimeout(() => {
      if (active) setFailed(true);
    }, 15_000);

    // The editor, language definition and worker are all bundled with this app.
    // No user code or runtime editor assets are sent to an external CDN.
    const environment = self as typeof self & {
      MonacoEnvironment?: { getWorker: () => Worker };
    };
    environment.MonacoEnvironment = {
      getWorker() {
        return new Worker(
          new URL("monaco-editor/editor/editor.worker.js", import.meta.url),
        );
      },
    };
    void Promise.all([
      import("@monaco-editor/react"),
      import("monaco-editor/editor/editor.api.js"),
      import("monaco-editor/languages/definitions/python/register.js"),
      import("monaco-editor/editor/browser/coreCommands.js"),
      import(
        "monaco-editor/editor/contrib/tokenization/browser/tokenization.js"
      ),
      import("monaco-editor/editor/contrib/clipboard/browser/clipboard.js"),
      import("monaco-editor/editor/contrib/find/browser/findController.js"),
      import("monaco-editor/editor/contrib/folding/browser/folding.js"),
      import("monaco-editor/editor/contrib/contextmenu/browser/contextmenu.js"),
      import(
        "monaco-editor/editor/contrib/bracketMatching/browser/bracketMatching.js"
      ),
      import(
        "monaco-editor/editor/contrib/toggleTabFocusMode/browser/toggleTabFocusMode.js"
      ),
    ])
      .then(([reactEditor, monaco]) => {
        if (!active) return;
        monaco.editor.defineTheme("reason-paper", {
          base: "vs",
          inherit: false,
          rules: [
            { token: "", foreground: "141413" },
            { token: "comment", foreground: "514F49" },
            { token: "keyword", foreground: "2447A6" },
            { token: "string", foreground: "20563D" },
            { token: "number", foreground: "693374" },
            { token: "type", foreground: "493A95" },
            { token: "identifier", foreground: "141413" },
            { token: "delimiter", foreground: "38352F" },
            { token: "operator", foreground: "754016" },
            { token: "predefined", foreground: "2447A6" },
          ],
          colors: {
            "editor.background": "#FFFDF9",
            "editor.foreground": "#141413",
            "editorLineNumber.foreground": "#59564F",
            "editorLineNumber.activeForeground": "#141413",
            "editorCursor.foreground": "#2447BB",
            "editor.selectionBackground": "#E9EDFA",
            "editor.inactiveSelectionBackground": "#EEEAE2",
            "editor.lineHighlightBackground": "#F7F4ED",
            "editor.lineHighlightBorder": "#F7F4ED",
            "editorIndentGuide.background1": "#E1DCD2",
            "editorIndentGuide.activeBackground1": "#777167",
            "editorWidget.background": "#FFFDF9",
            "editorWidget.border": "#C6BFB2",
            "editorSuggestWidget.foreground": "#141413",
            "editorSuggestWidget.background": "#FFFDF9",
            "editorSuggestWidget.selectedBackground": "#E9EDFA",
            "editorError.foreground": "#9A3028",
            "editorWarning.foreground": "#754016",
            focusBorder: "#2447BB",
          },
        });
        reactEditor.loader.config({ monaco });
        setEditor(() => reactEditor.default);
      })
      .catch(() => {
        if (active) setFailed(true);
      });

    return () => {
      active = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      editorRef.current = null;
    };
  }, [attempt]);

  const mountEditor: OnMount = (instance, monaco) => {
    const fallback = fallbackRef.current;
    const restoreFocus =
      fallback && document.activeElement === fallback
        ? { start: fallback.selectionStart, end: fallback.selectionEnd }
        : null;
    editorRef.current = instance;
    setReady(true);
    setFailed(false);
    if (timerRef.current) clearTimeout(timerRef.current);
    const font = getComputedStyle(document.documentElement)
      .getPropertyValue("--font-code")
      .trim();
    if (font) instance.updateOptions({ fontFamily: font + ", monospace" });
    instance.addAction({
      id: "reason.run",
      label: "Run & Reason",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
      run: () => {
        if (!latestRef.current.disabled) latestRef.current.onRun();
      },
    });
    instance.addAction({
      id: "reason.leave-editor",
      label: "Leave code editor",
      keybindings: [monaco.KeyMod.Shift | monaco.KeyCode.Tab],
      run: () => {
        exitRef.current?.focus();
      },
    });
    if (restoreFocus)
      requestAnimationFrame(() => {
        const model = instance.getModel();
        if (!model || editorRef.current !== instance) return;
        const start = model.getPositionAt(restoreFocus.start);
        const end = model.getPositionAt(restoreFocus.end);
        instance.setSelection(
          new monaco.Selection(
            start.lineNumber,
            start.column,
            end.lineNumber,
            end.column,
          ),
        );
        instance.focus();
      });
  };

  function updateCode(next: string | undefined) {
    if (restoringRef.current) return;
    const text = next ?? "";
    if (text.length > CODE_LIMIT) {
      setNotice(
        "Code is limited to 50,000 characters. That edit was not applied; your previous draft is intact.",
      );
      const model = editorRef.current?.getModel();
      if (model && model.getValue() !== latestRef.current.value) {
        restoringRef.current = true;
        try {
          model.applyEdits([
            { range: model.getFullModelRange(), text: latestRef.current.value },
          ]);
        } finally {
          restoringRef.current = false;
        }
      }
      return;
    }
    setNotice("");
    latestRef.current.onChange(text);
  }

  function fallbackKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      if (!disabled) onRun();
    }
    if (event.shiftKey && event.key === "Tab") {
      event.preventDefault();
      exitRef.current?.focus();
    } else if (event.key === "Tab") {
      event.preventDefault();
      const input = event.currentTarget;
      const start = input.selectionStart,
        end = input.selectionEnd;
      const next = value.slice(0, start) + "    " + value.slice(end);
      updateCode(next);
      if (next.length <= CODE_LIMIT)
        requestAnimationFrame(() => {
          input.selectionStart = input.selectionEnd = start + 4;
        });
    }
  }

  return (
    <section
      className={styles.studio}
      aria-label="Focused code studio"
      data-student-view={!developerMode}
    >
      <header className={styles.toolbar}>
        <span className={styles.file}>
          <Code2 size={18} aria-hidden="true" /> solution.py
        </span>
        <span className={styles.language}>
          Python 3 <span aria-hidden="true">·</span>{" "}
          {draftChanged ? "Draft modified" : "Draft saved locally"}
        </span>
      </header>
      <div className={styles.editorArea}>
        {(!ready || failed) && (
          <textarea
            ref={fallbackRef}
            className={styles.fallback}
            aria-label="Python code editor"
            aria-describedby="code-editor-help"
            value={value}
            maxLength={CODE_LIMIT}
            onChange={(event) => updateCode(event.target.value)}
            onKeyDown={fallbackKey}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
          />
        )}
        {Editor && !failed && (
          <EditorBoundary key={attempt} onError={() => setFailed(true)}>
            <div
              className={[
                styles.monacoLayer,
                !ready ? styles.loadingEditor : "",
              ].join(" ")}
              aria-hidden={!ready}
            >
              <Editor
                height="100%"
                language="python"
                theme="reason-paper"
                value={value}
                onChange={updateCode}
                onMount={mountEditor}
                loading={
                  <span className={styles.editorLoading}>
                    Opening code studio…
                  </span>
                }
                options={{
                  ariaLabel: "Python code editor",
                  fontFamily: "JetBrains Mono, monospace",
                  fontSize: 15,
                  suggestFontSize: 15,
                  suggestLineHeight: 26,
                  fontWeight: "400",
                  lineHeight: 26,
                  minimap: { enabled: false },
                  lineNumbersMinChars: 3,
                  glyphMargin: false,
                  folding: true,
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                  tabSize: 4,
                  insertSpaces: true,
                  wordWrap: "on",
                  padding: { top: 20, bottom: 20 },
                  renderLineHighlight: "line",
                  roundedSelection: false,
                  contextmenu: true,
                  stickyScroll: { enabled: false },
                  bracketPairColorization: { enabled: false },
                  guides: { indentation: true },
                }}
              />
            </div>
          </EditorBoundary>
        )}
      </div>
      <div className={styles.editorHelp}>
        <span id="code-editor-help">
          Tab indents · Shift + Tab leaves the editor.
          {developerMode && " Limit: 50,000 characters."}
          {value.length >= 49_000 &&
            " (" + value.length.toLocaleString("en-US") + " used)"}
        </span>
        {failed ? (
          <button
            type="button"
            className={styles.retry}
            onClick={() => {
              setEditor(null);
              setAttempt((n) => n + 1);
            }}
          >
            <RotateCcw size={15} aria-hidden="true" /> Retry enhanced editor
          </button>
        ) : developerMode ? (
          <span className={styles.loadStatus}>
            {ready ? (
              <Check size={15} aria-hidden="true" />
            ) : (
              <Loader2
                className={styles.spinner}
                size={15}
                aria-hidden="true"
              />
            )}
            {ready ? "Monaco ready" : "Enhancing editor…"}
          </span>
        ) : null}
      </div>
      {failed && (
        <p className={styles.notice} role="status">
          The enhanced editor could not load. Your draft is available in the
          plain editor; running code still works.
        </p>
      )}
      {notice && (
        <p className={styles.notice} role="alert">
          {notice}
        </p>
      )}
      {!developerMode && analysis?.syntax_error_msg && (
        <p className={styles.notice} role="status">
          Python could not read this line yet: {analysis.syntax_error_msg}
        </p>
      )}

      {developerMode && (
        <div className={styles.footprint}>
          <div className={styles.footprintHeading}>
            <Braces size={18} aria-hidden="true" />
            <h3>Complexity Footprint</h3>
            <span>
              {draftChanged
                ? "Last run"
                : analysis
                  ? "Execution signals"
                  : "Awaiting first run"}
            </span>
          </div>
          <dl className={styles.metrics}>
            <div>
              <dt>Estimated time</dt>
              <dd>{analysis?.estimated_time_complexity || "—"}</dd>
            </div>
            <div>
              <dt>Max loop depth</dt>
              <dd>{analysis ? analysis.max_loop_depth : "—"}</dd>
            </div>
            <div>
              <dt>Active defect</dt>
              <dd className={styles.defect} title={defectHash}>
                {isSolved
                  ? "All checks passed"
                  : defectHash
                    ? defectHash.slice(0, 10)
                    : "—"}
              </dd>
            </div>
          </dl>
          {analysis?.syntax_error_msg && (
            <p className={styles.notice} role="status">
              {analysis.syntax_error_msg}
            </p>
          )}
          {analysis && (
            <details className={styles.details}>
              <summary>
                Inspect reasoning signals{" "}
                <ChevronDown size={16} aria-hidden="true" />
              </summary>
              <dl className={styles.signals}>
                <div>
                  <dt>Valid Python syntax</dt>
                  <dd>{analysis.is_valid_syntax ? "Yes" : "No"}</dd>
                </div>
                <div>
                  <dt>Incomplete placeholders</dt>
                  <dd>
                    {analysis.has_incomplete_placeholders
                      ? "Present"
                      : "None detected"}
                  </dd>
                </div>
                <div>
                  <dt>Recursion</dt>
                  <dd>
                    {analysis.uses_recursion ? "Detected" : "Not detected"}
                  </dd>
                </div>
                <div>
                  <dt>Base-case guard</dt>
                  <dd>
                    {analysis.has_base_case_guard ? "Detected" : "Not detected"}
                  </dd>
                </div>
                <div>
                  <dt>Logarithmic halving</dt>
                  <dd>
                    {analysis.has_logarithmic_halving
                      ? "Detected"
                      : "Not detected"}
                  </dd>
                </div>
                <div>
                  <dt>Detected constructs</dt>
                  <dd>{analysis.detected_constructs.join(", ") || "None"}</dd>
                </div>
                <div>
                  <dt>Syntax diagnostic</dt>
                  <dd>
                    {analysis.syntax_error_msg || "No syntax issue detected"}
                  </dd>
                </div>
                <div>
                  <dt>Code fingerprint</dt>
                  <dd className={styles.hash}>{analysis.code_hash}</dd>
                </div>
                <div>
                  <dt>Defect fingerprint</dt>
                  <dd className={styles.hash}>
                    {defectHash || "No active defect"}
                  </dd>
                </div>
              </dl>
              <details className={styles.instrumentation}>
                <summary>Instrumented code</summary>
                <pre>
                  {analysis.instrumented_code ||
                    "No instrumented code returned for this submission."}
                </pre>
              </details>
            </details>
          )}
        </div>
      )}
      <span ref={exitRef} tabIndex={-1} className={styles.exit}>
        Code editor exited. Press Tab to continue through the workspace.
      </span>
    </section>
  );
}
