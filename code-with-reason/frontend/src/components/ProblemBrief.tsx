import { ChevronDown } from "lucide-react";
import type { Problem } from "@/lib/api";
import { getProblemGuide } from "@/lib/problem-guides";
import styles from "./problem-brief.module.css";

export default function ProblemBrief({ problem }: { problem: Problem }) {
  const guide = getProblemGuide(problem.problem_id);

  return (
    <section className={styles.brief} aria-labelledby="problem-brief-title">
      <header className={styles.heading}>
        <h2 id="problem-brief-title">Your task</h2>
      </header>
      <p className={styles.task}>{guide?.task ?? problem.description}</p>
      {guide && (
        <>
          <dl className={styles.contract}>
            <div>
              <dt>Input</dt>
              <dd>{guide.input}</dd>
            </div>
            <div>
              <dt>Return</dt>
              <dd>{guide.returns}</dd>
            </div>
          </dl>
          <div className={styles.examples} aria-label="Worked examples">
            {guide.examples.map((example, index) => (
              <article
                className={styles.example}
                key={index}
                aria-labelledby={`problem-example-${index}`}
              >
                <h3 id={`problem-example-${index}`}>Example {index + 1}</h3>
                <dl>
                  <div>
                    <dt>Input</dt>
                    <dd>
                      <pre>
                        <code>
                          {Object.entries(example.input)
                            .map(
                              ([key, value]) =>
                                `${key} = ${JSON.stringify(value)}`,
                            )
                            .join("\n")}
                        </code>
                      </pre>
                    </dd>
                  </div>
                  <div>
                    <dt>Output</dt>
                    <dd>
                      <pre>
                        <code>{JSON.stringify(example.output)}</code>
                      </pre>
                    </dd>
                  </div>
                </dl>
                <p>{example.explanation}</p>
              </article>
            ))}
          </div>
          {guide.remember && (
            <p className={styles.remember}>
              <strong>Remember:</strong> {guide.remember}
            </p>
          )}
        </>
      )}
      <p className={styles.functionNote}>
        Complete <code>{problem.entrypoint_fn}</code> in the editor. Return your
        result; you do not need to read input or print it.
      </p>
      <details className={styles.constraints}>
        <summary>
          Constraints <ChevronDown size={17} aria-hidden="true" />
        </summary>
        <ul>
          {problem.constraints.map((constraint) => (
            <li key={constraint}>{constraint}</li>
          ))}
        </ul>
        <p className={styles.efficiency}>
          Efficiency target: <code>{problem.target_time_complexity}</code> time
          and <code>{problem.target_space_complexity}</code> extra space.
        </p>
      </details>
    </section>
  );
}
