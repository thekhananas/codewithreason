import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import ProblemBrief from "@/components/ProblemBrief";
import { getProblemGuide, PROBLEM_GUIDES } from "@/lib/problem-guides";
import { problems } from "./fixtures";

const expectedOutputs: Record<string, unknown[]> = {
  "two-sum-sorted": [
    [1, 2],
    [3, 4],
  ],
  "longest-unique-substring": [3, 3],
  "rotated-sorted-min": [0, 1],
  "house-robber-dp": [4, 12],
  "max-subarray-kadane": [6, -2],
};

describe("student problem brief", () => {
  it.each(Object.keys(expectedOutputs))(
    "shows two worked examples for %s without requiring a run",
    (problemId) => {
      render(
        <ProblemBrief problem={{ ...problems[0], problem_id: problemId }} />,
      );
      expect(screen.getByRole("heading", { name: "Your task" })).toBeTruthy();
      const examples = screen.getAllByRole("article");
      expect(examples).toHaveLength(2);
      const guide = getProblemGuide(problemId)!;
      for (const [index, article] of examples.entries()) {
        expect(article.closest("details")).toBeNull();
        expect(
          within(article).getByRole("heading", {
            name: `Example ${index + 1}`,
          }),
        ).toBeTruthy();
        expect(
          within(article).getByText(guide.examples[index].explanation),
        ).toBeTruthy();
        const fields = article.querySelectorAll("dd");
        expect(fields[0].textContent).toBe(
          Object.entries(guide.examples[index].input)
            .map(([key, value]) => `${key} = ${JSON.stringify(value)}`)
            .join("\n"),
        );
        expect(fields[1].textContent).toBe(
          JSON.stringify(expectedOutputs[problemId][index]),
        );
      }
    },
  );

  it("explains one-based positions rather than asking the learner to infer the output contract", () => {
    render(<ProblemBrief problem={problems[0]} />);
    expect(screen.getByText(/Count positions starting at 1/)).toBeTruthy();
    expect(screen.getByText(/their positions are 3 and 4/)).toBeTruthy();
    expect(
      screen.getByText(
        /Return your result; you do not need to read input or print it/,
      ),
    ).toBeTruthy();
  });

  it("keeps constraints optional and retains unknown catalogue descriptions", () => {
    const description = "A future public problem with its own instructions.";
    render(
      <ProblemBrief
        problem={{ ...problems[0], problem_id: "future-problem", description }}
      />,
    );
    expect(screen.getByText(description)).toBeTruthy();
    expect(screen.queryByRole("article")).toBeNull();
    const summary = screen.getByText("Constraints");
    const details = summary.closest("details")!;
    expect(details.open).toBe(false);
    fireEvent.click(summary);
    expect(details.open).toBe(true);
    expect(screen.getByText(problems[0].constraints[0])).toBeTruthy();
  });

  it("supports legacy public IDs without manufacturing guidance for unknown problems", () => {
    expect(getProblemGuide("two_sum_sorted")).toBe(
      PROBLEM_GUIDES["two-sum-sorted"],
    );
    expect(getProblemGuide("find_min_rotated")).toBe(
      PROBLEM_GUIDES["rotated-sorted-min"],
    );
    expect(getProblemGuide("unknown")).toBeUndefined();
    expect(getProblemGuide("toString")).toBeUndefined();
    expect(getProblemGuide("__proto__")).toBeUndefined();
  });

  it("teaching examples describe results and contain no solution code or private benchmark references", () => {
    const content = JSON.stringify(PROBLEM_GUIDES);
    expect(content).not.toMatch(
      /reference_solution|forbidden_leak_patterns|archetype_tests|def\s+\w+\(|```|while\s+\w+|for\s+\w+\s+in\s/,
    );
  });
});
