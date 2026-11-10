import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import SocraticNotebook, {
  type SocraticNotebookProps,
} from "@/components/SocraticNotebook";
import { makeResult, trace } from "./fixtures";

function props(
  overrides: Partial<SocraticNotebookProps> = {},
): SocraticNotebookProps {
  return {
    developerMode: true,
    tier: 1,
    defectHash: "index-origin-defect",
    latest: makeResult(),
    feed: [],
    trace: null,
    scaffold: null,
    busy: false,
    recovering: false,
    unavailable: false,
    turnCount: 1,
    isSolved: false,
    message: "",
    onMessageChange: vi.fn(),
    onSubmit: vi.fn(),
    ...overrides,
  };
}

describe("Socratic notebook disclosures and actions", () => {
  it("preserves the early escape route and requires inline confirmation before unlocking", () => {
    const initial = props({ turnCount: 0 });
    const { rerender } = render(<SocraticNotebook {...initial} />);
    expect(
      (
        screen.getByRole("button", {
          name: "Still stuck? Reveal Tier 2 hint",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: "Unlock Tier 4 Post-Mortem",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    const active = { ...initial, turnCount: 1 };
    rerender(<SocraticNotebook {...active} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Still stuck? Reveal Tier 2 hint" }),
    );
    expect(active.onSubmit).toHaveBeenLastCalledWith("request_next_tier");
    vi.mocked(active.onSubmit).mockClear();
    fireEvent.click(
      screen.getByRole("button", { name: "Unlock Tier 4 Post-Mortem" }),
    );
    expect(
      screen.getByRole("heading", { name: "Ready to study the solution?" }),
    ).toBeTruthy();
    expect(active.onSubmit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Keep reasoning" }));
    expect(
      screen.queryByRole("heading", { name: "Ready to study the solution?" }),
    ).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Unlock Tier 4 Post-Mortem" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Reveal post-mortem" }));
    expect(active.onSubmit).toHaveBeenCalledExactlyOnceWith(
      "unlock_escape_hatch",
    );
  });

  it("withholds evidence at Tier 1 and retains the scaffold at Tier 4", () => {
    const initial = props({
      trace,
      scaffold: "while [CONDITION_1]:\n    [UPDATE_1]",
    });
    const { rerender } = render(<SocraticNotebook {...initial} />);
    expect(
      screen.queryByRole("heading", { name: "Verified Breaking Trace" }),
    ).toBeNull();
    expect(
      screen.queryByRole("heading", { name: "Invariant Skeleton" }),
    ).toBeNull();
    rerender(<SocraticNotebook {...initial} tier={2} />);
    expect(
      screen.getByRole("heading", { name: "Verified Breaking Trace" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("heading", { name: "Invariant Skeleton" }),
    ).toBeNull();
    rerender(<SocraticNotebook {...initial} tier={3} />);
    expect(
      screen.getByRole("heading", { name: "Invariant Skeleton" }),
    ).toBeTruthy();
    expect(screen.getByText("[CONDITION_1]").tagName).toBe("MARK");
    rerender(<SocraticNotebook {...initial} tier={4} />);
    expect(
      screen.getByRole("heading", { name: "Invariant Skeleton" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Unlock Tier 4 Post-Mortem" }),
    ).toBeNull();
  });

  it("respects verification state and keeps output, error, ticks, scale and time distinct", () => {
    render(
      <SocraticNotebook
        {...props({
          tier: 2,
          trace: {
            ...trace,
            is_verified: false,
            actual_output: "partial output",
            error_type: "ValueError",
          },
        })}
      />,
    );
    const evidence = screen.getByRole("region", { name: "Breaking Trace" });
    expect(
      screen.queryByRole("heading", { name: "Verified Breaking Trace" }),
    ).toBeNull();
    expect(within(evidence).getByText("ValueError")).toBeTruthy();
    expect(within(evidence).getByText('"partial output"')).toBeTruthy();
    expect(within(evidence).getByText("Operation Ticks")).toBeTruthy();
    expect(within(evidence).getByText("2.01×")).toBeTruthy();
    expect(within(evidence).getByText("Execution Time")).toBeTruthy();
    expect(evidence.textContent).toContain("124 ticks");
    expect(evidence.textContent).toContain("0.42 ms");
  });

  it("sends reasoning with the submit action while Shift+Enter remains a newline affordance", () => {
    const initial = props({
      message: "I think the result should use one-based indices.",
    });
    render(<SocraticNotebook {...initial} />);
    const composer = screen.getByRole("textbox", {
      name: "Put your reasoning into words",
    }) as HTMLTextAreaElement;
    expect(composer.maxLength).toBe(10000);
    fireEvent.keyDown(composer, { key: "Enter", shiftKey: true });
    expect(initial.onSubmit).not.toHaveBeenCalled();
    fireEvent.keyDown(composer, { key: "Enter" });
    expect(initial.onSubmit).toHaveBeenCalledExactlyOnceWith("submit_code");
    fireEvent.change(composer, { target: { value: "A revised invariant" } });
    expect(initial.onMessageChange).toHaveBeenCalledWith("A revised invariant");
  });

  it("renders model code and HTML-like text as inert text with preserved code structure", () => {
    const modelText =
      "# Reasoning\n\n<img src=x onerror=alert(1)>\n\n```python\ndef solve():\n    return 42\n```";
    const { container } = render(
      <SocraticNotebook
        {...props({
          tier: 4,
          feed: [
            {
              id: "turn-1",
              kind: "tutor",
              tier: 4,
              text: modelText,
              shielded: false,
              latency: 12,
            },
          ],
        })}
      />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeTruthy();
    expect(container.querySelector("pre code")?.textContent).toBe(
      "def solve():\n    return 42",
    );
    expect(screen.getByRole("heading", { name: "Reasoning" })).toBeTruthy();
  });

  it("dismisses an open confirmation when the active session changes", () => {
    const initial = props();
    const { rerender } = render(<SocraticNotebook {...initial} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Unlock Tier 4 Post-Mortem" }),
    );
    expect(
      screen.getByRole("heading", { name: "Ready to study the solution?" }),
    ).toBeTruthy();
    rerender(
      <SocraticNotebook
        {...initial}
        latest={makeResult({ session_id: "another-session" })}
      />,
    );
    expect(
      screen.queryByRole("heading", { name: "Ready to study the solution?" }),
    ).toBeNull();
  });

  it.each([1, 2, 3] as const)(
    "keeps intercepted solution text out of the Tier %i evaluation record",
    (tier) => {
      const reason = "forbidden_pattern: LEFT SECRET UPDATE";
      const result = makeResult({
        current_tier: tier,
        shield_triggered: true,
        shield_reason: reason,
      });
      const { container } = render(
        <SocraticNotebook {...props({ tier, latest: result })} />,
      );
      fireEvent.click(screen.getByText("Evaluation record"));
      expect(
        screen.getByText("A solution-revealing pattern was withheld."),
      ).toBeTruthy();
      expect(container.textContent).not.toContain("LEFT SECRET UPDATE");
      expect(result.shield_reason).toBe(reason);
    },
  );

  it("defensively relocks a historical Tier 4 entry even before the parent feed is sanitized", () => {
    const initial = props({
      tier: 4,
      feed: [
        {
          id: "old-postmortem",
          kind: "tutor",
          tier: 4,
          text: "REFERENCE SOLUTION MUST STAY LOCKED",
        },
      ],
    });
    const { rerender, container } = render(<SocraticNotebook {...initial} />);
    expect(container.textContent).toContain(
      "REFERENCE SOLUTION MUST STAY LOCKED",
    );
    rerender(<SocraticNotebook {...initial} tier={1} />);
    expect(container.textContent).not.toContain(
      "REFERENCE SOLUTION MUST STAY LOCKED",
    );
    expect(
      screen.getByText(/This earlier post-mortem is available only/),
    ).toBeTruthy();
  });
});

describe("student-first help view", () => {
  it("defaults to a short question view without tier, hash, latency or evaluation telemetry", () => {
    const initial = props({
      developerMode: undefined,
      feed: [
        {
          id: "answer",
          kind: "tutor",
          tier: 1,
          text: "Which two values add up to 9?",
          latency: 151,
        },
      ],
    });
    const { container } = render(<SocraticNotebook {...initial} />);
    expect(
      screen.getByRole("heading", { name: "Hints & questions" }),
    ).toBeTruthy();
    expect(screen.getByText("Which two values add up to 9?")).toBeTruthy();
    expect(screen.queryByText("Active defect")).toBeNull();
    expect(screen.queryByText("Evaluation record")).toBeNull();
    expect(screen.queryByText("151 ms")).toBeNull();
    expect(
      screen.queryByRole("list", { name: /Scaffolding ladder/ }),
    ).toBeNull();
    expect(container.textContent).not.toContain("Invariant Probe");
    expect(container.textContent).not.toContain("index-origin-defect");
    expect(screen.getByRole("button", { name: "Show me a hint" })).toBeTruthy();
    expect(
      screen.getByRole("textbox", { name: "Reply in words (optional)" }),
    ).toBeTruthy();
  });

  it("retains the complete ladder and diagnostic record only in developer mode", () => {
    render(<SocraticNotebook {...props()} />);
    expect(
      screen.getByRole("heading", { name: "Socratic Field Notebook" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("list", { name: /Scaffolding ladder/ }),
    ).toBeTruthy();
    expect(screen.getByText("Active defect")).toBeTruthy();
    expect(screen.getByText("Evaluation record")).toBeTruthy();
  });

  it("offers problem and example clarification before the first code run without stale composer submission", () => {
    const onAskForHelp = vi.fn();
    const initial = props({
      developerMode: false,
      turnCount: 0,
      onAskForHelp,
      message: "An older draft message",
    });
    render(<SocraticNotebook {...initial} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Explain the problem" }),
    );
    expect(onAskForHelp).toHaveBeenLastCalledWith(
      "I do not understand the problem. Please explain what the input and output mean.",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Walk through an example" }),
    );
    expect(onAskForHelp).toHaveBeenLastCalledWith(
      "Please walk me through an input and output example.",
    );
    expect(initial.onSubmit).not.toHaveBeenCalled();
    expect(initial.onMessageChange).not.toHaveBeenCalled();
  });

  it("uses familiar evidence and outline titles without revealing operation telemetry", () => {
    render(
      <SocraticNotebook
        {...props({
          developerMode: false,
          tier: 3,
          trace,
          scaffold: "while [CONDITION_1]:\n    [UPDATE_1]",
        })}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Why this code fails" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Build your approach" }),
    ).toBeTruthy();
    expect(screen.queryByText("Operation Ticks")).toBeNull();
    expect(screen.queryByText("Execution Time")).toBeNull();
    expect(screen.getByText("[CONDITION_1]").tagName).toBe("MARK");
  });

  it("keeps previous messages available behind a disclosure rather than repeating the whole conversation", () => {
    render(
      <SocraticNotebook
        {...props({
          developerMode: false,
          feed: [
            { id: "first", kind: "tutor", tier: 1, text: "Earlier question" },
            { id: "learner", kind: "learner", tier: 1, text: "No idea" },
            {
              id: "latest",
              kind: "tutor",
              tier: 1,
              text: "Let's look at two numbers first.",
            },
          ],
        })}
      />,
    );
    const earlier = screen.getByText("Earlier messages (1)").closest("details");
    expect(earlier).not.toBeNull();
    expect(earlier?.hasAttribute("open")).toBe(false);
    expect(
      within(earlier as HTMLElement).getByText("Earlier question"),
    ).toBeTruthy();
    expect(screen.getByText("No idea")).toBeTruthy();
    expect(screen.getByText("Let's look at two numbers first.")).toBeTruthy();
  });
});
