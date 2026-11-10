import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import CodeStudio from "@/components/CodeStudio";
import { makeResult } from "./fixtures";

// An unavailable local asset must preserve a usable editor. Force this error
// path without loading Monaco or starting a browser/worker in jsdom.
vi.mock("@monaco-editor/react", () => {
  throw new Error("Local editor asset unavailable");
});
vi.mock("monaco-editor/editor/editor.api.js", () => ({
  editor: { defineTheme: vi.fn() },
}));
vi.mock("monaco-editor/languages/definitions/python/register.js", () => ({}));

function Harness({
  onRun,
  disabled = false,
  developerMode = false,
}: {
  onRun: () => void;
  disabled?: boolean;
  developerMode?: boolean;
}) {
  const [code, setCode] = useState("pass");
  return (
    <CodeStudio
      value={code}
      onChange={setCode}
      onRun={onRun}
      disabled={disabled}
      draftChanged={false}
      analysis={makeResult().ast_summary}
      defectHash="index-origin-defect"
      isSolved={false}
      developerMode={developerMode}
    />
  );
}

describe("code studio fallback and keyboard behavior", () => {
  it("keeps the draft editable and runnable when enhanced editor assets fail", async () => {
    const onRun = vi.fn();
    render(<Harness onRun={onRun} />);
    await screen.findByText(/The enhanced editor could not load/);
    const input = screen.getByRole("textbox", {
      name: "Python code editor",
    }) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "return 42" } });
    expect(input.value).toBe("return 42");
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    fireEvent.keyDown(input, { key: "Enter", metaKey: true });
    expect(onRun).toHaveBeenCalledTimes(2);
  });

  it("preserves Tab indentation and Shift+Tab focus escape during an evaluation", async () => {
    const onRun = vi.fn();
    render(<Harness onRun={onRun} disabled />);
    await screen.findByText(/The enhanced editor could not load/);
    const input = screen.getByRole("textbox", {
      name: "Python code editor",
    }) as HTMLTextAreaElement;
    input.focus();
    input.setSelectionRange(0, 0);
    fireEvent.keyDown(input, { key: "Tab" });
    await waitFor(() => expect(input.value).toBe("    pass"));
    fireEvent.keyDown(input, { key: "Tab", shiftKey: true });
    expect(document.activeElement).not.toBe(input);
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    expect(onRun).not.toHaveBeenCalled();
  });

  it("rejects over-limit edits with a visible message and preserves the previous draft", async () => {
    render(<Harness onRun={vi.fn()} />);
    await screen.findByText(/The enhanced editor could not load/);
    const input = screen.getByRole("textbox", {
      name: "Python code editor",
    }) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "x".repeat(50001) } });
    expect(input.value).toBe("pass");
    expect(screen.getByRole("alert").textContent).toContain(
      "That edit was not applied",
    );
  });
});

it("keeps actual editor diagnostics behind developer mode", async () => {
  const onRun = vi.fn();
  const view = render(<Harness onRun={onRun} />);
  await screen.findByText(/The enhanced editor could not load/);
  expect(
    screen.queryByRole("heading", { name: "Complexity Footprint" }),
  ).toBeNull();
  expect(screen.queryByText("Max loop depth")).toBeNull();
  view.rerender(<Harness onRun={onRun} developerMode />);
  expect(
    screen.getByRole("heading", { name: "Complexity Footprint" }),
  ).toBeTruthy();
  expect(screen.getByText("Max loop depth")).toBeTruthy();
});
