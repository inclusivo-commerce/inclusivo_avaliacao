import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, sep } from "node:path";
import { generateReports, wcagCriteria } from "./report.mjs";

test("extracts WCAG tags without interpreting version or best-practice tags as criteria", () => {
  assert.deepEqual(
    wcagCriteria([
      "wcag2aa",
      "wcag21aa",
      "best-practice",
      "wcag143",
      "wcag2411",
    ]),
    ["1.4.3", "2.4.11"],
  );
});

test("keeps incomplete findings separate and preserves real counts and statuses", async () => {
  // Synthetic data exercises the report generator, never the application evaluation.
  const directory = await mkdtemp(resolve(tmpdir(), "inclusivo-report-test-"));
  try {
    await mkdir(resolve(directory, "artifacts"));
    const node = {
      target: [".example"],
      html: '<span class="example">fixture</span>',
      failureSummary: "synthetic fixture",
    };
    await writeFile(
      resolve(directory, "artifacts/test-axe.json"),
      JSON.stringify({
        url: "http://localhost/shop",
        scope: "document",
        evaluation: {
          stage: "fixture",
          project: "test",
          dataMode: "synthetic-unit-test",
        },
        violations: [
          {
            id: "color-contrast",
            impact: "serious",
            tags: ["wcag143"],
            nodes: [node],
            helpUrl: "https://example.test/help",
          },
        ],
        incomplete: [
          {
            id: "aria-hidden-focus",
            impact: "serious",
            tags: ["wcag412"],
            nodes: [node],
            helpUrl: "https://example.test/help",
          },
        ],
        passes: [{ id: "html-has-lang" }],
        inapplicable: [],
      }),
    );
    await writeFile(
      resolve(directory, "playwright.json"),
      JSON.stringify({
        suites: [
          {
            title: "synthetic fixture",
            specs: [
              {
                title: "test",
                tests: [
                  {
                    projectName: "test",
                    status: "unexpected",
                    results: [
                      {
                        status: "failed",
                        duration: 1,
                        errors: [{ message: "synthetic failure" }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      }),
    );
    const result = await generateReports(directory);
    assert.equal(result.counts.violationOccurrences, 1);
    assert.equal(result.counts.inconclusiveOccurrences, 1);
    assert.equal(result.counts.passed, 0);
    assert.equal(result.counts.failed, 1);
    assert.equal(result.counts.axeRuleEvaluations, 3);
    assert.equal(result.issues[0].abnt.clause, "5.11.3");
    assert.equal(result.issues[1].abnt, null);
    const report = await readFile(resolve(directory, "README.md"), "utf8");
    assert.match(report, /Lighthouse: não executado/);
    assert.match(
      await readFile(resolve(directory, "technical.md"), "utf8"),
      /synthetic failure/,
    );
  } finally {
    const absolute = resolve(directory);
    const allowed = resolve(tmpdir()) + sep;
    if (
      !absolute.startsWith(allowed) ||
      !absolute.split(sep).at(-1).startsWith("inclusivo-report-test-")
    )
      throw new Error("Unexpected cleanup path");
    await rm(absolute, { recursive: true, force: true });
  }
});
