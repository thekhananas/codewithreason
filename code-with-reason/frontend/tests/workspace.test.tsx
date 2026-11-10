import type { KeyboardEvent } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PracticeWorkspace from "@/app/page";
import {
  ApiError,
  evaluateCode,
  getProblems,
  getSession,
  health,
  resetSession,
} from "@/lib/api";
import { deferred, makeResult, makeSession, problems, trace } from "./fixtures";
import type { EvaluateResponse } from "@/lib/api";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getProblems: vi.fn(),
    getSession: vi.fn(),
    health: vi.fn(),
    evaluateCode: vi.fn(),
    resetSession: vi.fn(),
  };
});

// Exercise real workspace and notebook behavior while avoiding Monaco's layout/
// worker requirements in jsdom. Editor component behavior has separate checks.
vi.mock("@/components/CodeStudio", () => {
  function MockStudio(props: {
    value: string;
    onChange: (value: string) => void;
    onRun: () => void;
  }) {
    return (
      <textarea
        aria-label="Python code editor"
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
          if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
            event.preventDefault();
            props.onRun();
          }
        }}
      />
    );
  }
  return { default: MockStudio, CodeStudio: MockStudio };
});

function editor() {
  return screen.getByRole("textbox", {
    name: "Python code editor",
  }) as HTMLTextAreaElement;
}

function runButton() {
  return screen.getByRole("button", {
    name: /^Run & Reason/,
  }) as HTMLButtonElement;
}

async function openWorkspace() {
  render(<PracticeWorkspace />);
  await waitFor(() => expect(editor().value).toBe(problems[0].starter_code));
  await waitFor(() => expect(runButton().disabled).toBe(false));
}

async function runAndWait() {
  fireEvent.click(runButton());
  await waitFor(() => expect(vi.mocked(evaluateCode)).toHaveBeenCalled());
  await waitFor(() => expect(runButton().disabled).toBe(false));
}

beforeEach(() => {
  localStorage.setItem("codewithreason:developer-mode:v1", "true");
  vi.mocked(getProblems).mockResolvedValue(problems);
  vi.mocked(health).mockResolvedValue({
    status: "ok",
    version: "3.0.0",
    mode: "offline",
  });
  vi.mocked(getSession).mockRejectedValue(
    new ApiError("Session not found", 404),
  );
  vi.mocked(resetSession).mockResolvedValue({
    session_id: "saved-session",
    status: "reset",
  });
  vi.mocked(evaluateCode).mockImplementation(async (request) =>
    makeResult({
      session_id: request.session_id,
      problem_id: request.problem_id,
    }),
  );
});

describe("workspace regression coverage", () => {
  it("loads the real catalogue and runtime and seeds a per-problem draft", async () => {
    await openWorkspace();
    expect(getProblems).toHaveBeenCalledTimes(1);
    expect(health).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("heading", { name: new RegExp(problems[0].title) }),
    ).toBeTruthy();
    expect(
      screen.getByRole("combobox", { name: "Choose a problem" }),
    ).toBeTruthy();
    const saved = JSON.parse(
      localStorage.getItem(`socragate:workspace:v1:${problems[0].problem_id}`)!,
    );
    expect(saved.code).toBe(problems[0].starter_code);
    expect(saved.sessionId.length).toBeGreaterThan(0);
  });

  it("runs current code with the established action and renders exact operation ticks", async () => {
    await openWorkspace();
    fireEvent.change(editor(), {
      target: { value: "def two_sum_sorted(nums, target):\n    return [0, 1]" },
    });
    await runAndWait();
    const payload = vi.mocked(evaluateCode).mock.calls[0][0];
    expect(payload).toMatchObject({
      problem_id: problems[0].problem_id,
      action: "submit_code",
      user_code: editor().value,
    });
    expect(payload).not.toHaveProperty("request_next_tier");
    expect(payload).not.toHaveProperty("force_tier_4");
    expect(screen.getAllByText("124 ticks").length).toBeGreaterThanOrEqual(5);
    expect(
      screen.getAllByText("Which index convention does the statement require?")
        .length,
    ).toBeGreaterThan(0);
  });

  it("keeps Cmd/Ctrl+Enter wired to the same submission path", async () => {
    await openWorkspace();
    fireEvent.keyDown(editor(), { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(evaluateCode).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(runButton().disabled).toBe(false));
    fireEvent.keyDown(editor(), { key: "Enter", metaKey: true });
    await waitFor(() => expect(evaluateCode).toHaveBeenCalledTimes(2));
    expect(
      vi
        .mocked(evaluateCode)
        .mock.calls.every(([request]) => request.action === "submit_code"),
    ).toBe(true);
  });

  it("retains edits made while an evaluation is running", async () => {
    const pending = deferred<EvaluateResponse>();
    vi.mocked(evaluateCode).mockReturnValueOnce(pending.promise);
    await openWorkspace();
    const submitted = editor().value;
    fireEvent.click(runButton());
    await waitFor(() => expect(evaluateCode).toHaveBeenCalledTimes(1));
    const draft = "def two_sum_sorted(nums, target):\n    return [1, 2]";
    fireEvent.change(editor(), { target: { value: draft } });
    await act(async () => pending.resolve(makeResult()));
    await waitFor(() => expect(runButton().disabled).toBe(false));
    const saved = JSON.parse(
      localStorage.getItem(`socragate:workspace:v1:${problems[0].problem_id}`)!,
    );
    expect(editor().value).toBe(draft);
    expect(saved.code).toBe(draft);
    expect(vi.mocked(evaluateCode).mock.calls[0][0].user_code).toBe(submitted);
  });

  it("switches problems and ignores a late result from the previous problem", async () => {
    const pending = deferred<EvaluateResponse>();
    vi.mocked(evaluateCode).mockReturnValueOnce(pending.promise);
    await openWorkspace();
    fireEvent.click(runButton());
    await waitFor(() => expect(evaluateCode).toHaveBeenCalledTimes(1));
    fireEvent.change(
      screen.getByRole("combobox", { name: "Choose a problem" }),
      { target: { value: problems[1].problem_id } },
    );
    await waitFor(() => expect(editor().value).toBe(problems[1].starter_code));
    await act(async () =>
      pending.resolve(
        makeResult({
          socratic_response: "Late guidance from the other problem",
        }),
      ),
    );
    expect(
      screen.getByRole("heading", { name: new RegExp(problems[1].title) }),
    ).toBeTruthy();
    expect(editor().value).toBe(problems[1].starter_code);
    expect(
      screen.queryByText("Late guidance from the other problem"),
    ).toBeNull();
  });

  it("recovers an authoritative session and valid cached telemetry without replaying celebration", async () => {
    const cached = makeResult({
      current_tier: 2,
      previous_defect_resolved: true,
      counterexample: trace,
    });
    const draft = "def two_sum_sorted(nums, target):\n    return [0, 1]";
    localStorage.setItem(
      `socragate:workspace:v1:${problems[0].problem_id}`,
      JSON.stringify({
        sessionId: "saved-session",
        code: draft,
        lastResult: cached,
      }),
    );
    vi.mocked(getSession).mockResolvedValueOnce(makeSession());
    render(<PracticeWorkspace />);
    await screen.findByText("Recovered server guidance.");
    expect(getSession).toHaveBeenCalledWith("saved-session");
    expect(editor().value).toBe(draft);
    expect(screen.getAllByText("124 ticks").length).toBeGreaterThanOrEqual(5);
    expect(screen.queryByText(/Invariant Mastered/)).toBeNull();
  });

  it("rejects stale cached telemetry while still recovering eligible server evidence", async () => {
    const cached = makeResult({ current_tier: 2, counterexample: trace });
    cached.ast_summary.code_hash = "different-code-hash";
    cached.archetype_results = cached.archetype_results.map((result) => ({
      ...result,
      operation_ticks: 99999,
    }));
    localStorage.setItem(
      `socragate:workspace:v1:${problems[0].problem_id}`,
      JSON.stringify({
        sessionId: "saved-session",
        code: problems[0].starter_code,
        lastResult: cached,
      }),
    );
    vi.mocked(getSession).mockResolvedValueOnce(makeSession());
    render(<PracticeWorkspace />);
    await screen.findByText("Recovered server guidance.");
    expect(screen.queryByText("99,999 ticks")).toBeNull();
    expect(
      screen.getByRole("region", { name: "Verified Breaking Trace" })
        .textContent,
    ).toContain("124 ticks");
  });

  it("resets an absent server session and restores starter code with a fresh identity", async () => {
    await openWorkspace();
    fireEvent.change(editor(), { target: { value: "print('draft')" } });
    const previous = JSON.parse(
      localStorage.getItem(`socragate:workspace:v1:${problems[0].problem_id}`)!,
    );
    vi.mocked(resetSession).mockRejectedValueOnce(
      new ApiError("Session not found", 404),
    );
    fireEvent.click(screen.getByRole("button", { name: /^Reset session/ }));
    await waitFor(() =>
      expect(resetSession).toHaveBeenCalledWith(previous.sessionId),
    );
    await waitFor(() => expect(editor().value).toBe(problems[0].starter_code));
    const next = JSON.parse(
      localStorage.getItem(`socragate:workspace:v1:${problems[0].problem_id}`)!,
    );
    expect(next.sessionId).not.toBe(previous.sessionId);
    expect(next).not.toHaveProperty("lastResult");
  });

  it("shows catalogue errors and retries without inventing a problem", async () => {
    vi.mocked(getProblems).mockRejectedValueOnce(
      new ApiError("Catalogue unavailable", 503),
    );
    render(<PracticeWorkspace />);
    await screen.findByText("Catalogue unavailable");
    expect(
      screen.queryByRole("heading", { name: new RegExp(problems[0].title) }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Retry connection/ }));
    await waitFor(() => expect(editor().value).toBe(problems[0].starter_code));
    expect(getProblems).toHaveBeenCalledTimes(2);
  });

  it("retries the failed action and keeps the current draft", async () => {
    vi.mocked(evaluateCode).mockRejectedValueOnce(
      new ApiError("Temporary engine failure", 503),
    );
    await openWorkspace();
    fireEvent.change(editor(), {
      target: { value: "def two_sum_sorted(nums, target):\n    return [1, 2]" },
    });
    fireEvent.click(runButton());
    await screen.findByText("Temporary engine failure");
    fireEvent.click(screen.getByRole("button", { name: /Retry connection/ }));
    await waitFor(() => expect(evaluateCode).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(runButton().disabled).toBe(false));
    expect(vi.mocked(evaluateCode).mock.calls[1][0]).toEqual(
      vi.mocked(evaluateCode).mock.calls[0][0],
    );
    expect(editor().value).toContain("return [1, 2]");
  });

  it("relocks historical post-mortem text when a new defect returns Tier 1", async () => {
    vi.mocked(evaluateCode)
      .mockImplementationOnce(async (request) =>
        makeResult({
          session_id: request.session_id,
          current_tier: 4,
          socratic_response: "Protected complete reference walkthrough",
        }),
      )
      .mockImplementationOnce(async (request) =>
        makeResult({
          session_id: request.session_id,
          current_tier: 1,
          defect_hash: "new-defect",
          previous_defect_resolved: true,
          socratic_response: "A new invariant needs attention.",
        }),
      );
    await openWorkspace();
    await runAndWait();
    expect(
      screen.getAllByText("Protected complete reference walkthrough").length,
    ).toBeGreaterThan(0);
    await runAndWait();
    expect(
      screen.queryByText("Protected complete reference walkthrough"),
    ).toBeNull();
    expect(
      screen.getAllByText(/earlier post-mortem is available only/).length,
    ).toBeGreaterThan(0);
  });
});

describe("student-first workspace", () => {
  beforeEach(() => localStorage.removeItem("codewithreason:developer-mode:v1"));

  it("starts with examples and no diagnostic or benchmark clutter", async () => {
    await openWorkspace();
    expect(screen.getByRole("heading", { name: "Your task" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Example 1" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Example 2" })).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Your Python solution" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Hints & questions" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Benchmarks/ })).toBeNull();
    expect(
      screen.queryByRole("heading", { name: "FIVE WAYS TO TEST AN IDEA" }),
    ).toBeNull();
    expect(screen.queryByText("Active defect")).toBeNull();
    expect(screen.queryByText("Invariant Probe")).toBeNull();
    expect(screen.queryByText(/\d+ ticks/)).toBeNull();
  });

  it("makes developer detail opt-in without evaluating or resetting the session", async () => {
    await openWorkspace();
    const toggle = screen.getByRole("button", { name: /Developer mode/ });
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: /Benchmarks/ })).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "FIVE WAYS TO TEST AN IDEA" }),
    ).toBeTruthy();
    expect(screen.getByText("Invariant Probe")).toBeTruthy();
    expect(localStorage.getItem("codewithreason:developer-mode:v1")).toBe(
      "true",
    );
    fireEvent.click(toggle);
    expect(screen.queryByText("Invariant Probe")).toBeNull();
    expect(evaluateCode).not.toHaveBeenCalled();
    expect(resetSession).not.toHaveBeenCalled();
  });

  it("sends an explanation request before the first run using its own message, not stale composer text", async () => {
    await openWorkspace();
    fireEvent.change(
      screen.getByRole("textbox", {
        name: "Reply in words (optional)",
      }),
      { target: { value: "An older draft message" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Walk through an example" }),
    );
    await waitFor(() => expect(evaluateCode).toHaveBeenCalledTimes(1));
    expect(vi.mocked(evaluateCode).mock.calls[0][0]).toMatchObject({
      user_message: "Please walk me through an input and output example.",
      user_code: problems[0].starter_code,
      action: "submit_code",
    });
  });

  it("retains an explanation question when retrying an interrupted request", async () => {
    vi.mocked(evaluateCode).mockRejectedValueOnce(
      new ApiError("Temporary interruption", 503),
    );
    await openWorkspace();
    fireEvent.click(
      screen.getByRole("button", { name: "Explain the problem" }),
    );
    await screen.findByText("Temporary interruption");
    fireEvent.click(screen.getByRole("button", { name: /Retry connection/ }));
    await waitFor(() => expect(evaluateCode).toHaveBeenCalledTimes(2));
    expect(vi.mocked(evaluateCode).mock.calls[1][0]).toEqual(
      vi.mocked(evaluateCode).mock.calls[0][0],
    );
  });
});

it("answers a comprehension request with an empty editor while preserving the blank draft", async () => {
  localStorage.removeItem("codewithreason:developer-mode:v1");
  await openWorkspace();
  fireEvent.change(editor(), { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "Explain the problem" }));
  await waitFor(() => expect(evaluateCode).toHaveBeenCalledTimes(1));
  await waitFor(() =>
    expect(
      screen
        .getByRole("button", { name: "Explain the problem" })
        .hasAttribute("disabled"),
    ).toBe(false),
  );
  expect(vi.mocked(evaluateCode).mock.calls[0][0]).toMatchObject({
    action: "submit_code",
    user_code: problems[0].starter_code,
    user_message:
      "I do not understand the problem. Please explain what the input and output mean.",
  });
  expect(editor().value).toBe("");
  const saved = JSON.parse(
    localStorage.getItem(`socragate:workspace:v1:${problems[0].problem_id}`)!,
  );
  expect(saved.code).toBe("");
});
