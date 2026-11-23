import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalView, compareSummaries } from "./compare.mjs";
const scope = {
  url: "http://127.0.0.1:123/product/14",
  stage: "loaded",
  project: "chromium",
  dataMode: "controlled-api-fixtures",
  scope: "document",
};
const issue = (changes = {}) => ({
  ...scope,
  classification: "automatic-violation",
  rule: "color-contrast",
  target: [".example"],
  ...changes,
});
const report = (issues = [], auditCoverage = [scope]) => ({
  issues,
  auditCoverage,
  tests: [],
});
test("canonical paths ignore ephemeral origin and numeric ids, preserve tab identity", () => {
  assert.equal(
    canonicalView("http://localhost:9/product/345?highlight=8"),
    "/product/:id",
  );
  assert.notEqual(
    canonicalView("/customer/dashboard?tab=orders"),
    canonicalView("/customer/dashboard?tab=messages"),
  );
});
test("findings persist across ports and numeric ids; HTML changes do not create a new issue", () => {
  const result = compareSummaries(
    report([issue()]),
    report([
      issue({
        url: "http://localhost:99/product/57",
        html: "<span>changed</span>",
      }),
    ]),
  );
  assert.equal(result.counts.persistent, 1);
  assert.equal(result.counts.new, 0);
});
test("a finding is absent only when the same scope was actually audited", () => {
  assert.equal(
    compareSummaries(report([issue()]), report()).counts.noLongerDetected,
    1,
  );
  const missing = compareSummaries(report([issue()]), report([], []));
  assert.equal(missing.counts.noLongerDetected, 0);
  assert.equal(missing.counts.notReevaluated, 1);
});
test("manual results cannot be counted as fixes; distinguish added coverage from regression", () => {
  assert.equal(
    compareSummaries(
      report([issue()]),
      report([issue({ classification: "requires-manual-review" })]),
    ).counts.inconclusiveNow,
    1,
  );
  assert.equal(compareSummaries(report(), report([issue()])).counts.new, 1);
  assert.equal(
    compareSummaries(report([], []), report([issue()])).counts.newCoverage,
    1,
  );
});
test("skipped and missing tests cannot imply resolution", () => {
  const before = {
    ...report(),
    tests: [
      {
        file: "spec.ts",
        title: "example",
        project: "chromium",
        status: "expected",
      },
    ],
  };
  const failed = {
    ...report(),
    tests: [{ ...before.tests[0], status: "unexpected" }],
  };
  assert.equal(compareSummaries(before, failed).counts.testRegressions, 1);
  assert.equal(
    compareSummaries(before, {
      ...report(),
      tests: [{ ...before.tests[0], status: "skipped" }],
    }).counts.testsNotReevaluated,
    1,
  );
});
test("static and Lighthouse findings remain not re-evaluated if the tools did not run", () => {
  const previous = {
    ...report(),
    staticIssues: [
      {
        file: "C:/repo/frontend/src/A.tsx",
        line: 1,
        rule: "jsx-a11y/test",
        message: "example",
      },
    ],
    lighthouse: [{ route: "/shop", failed: [{ id: "color-contrast" }] }],
  };
  const unavailable = compareSummaries(previous, report());
  assert.equal(unavailable.staticChanges.notReevaluated.length, 1);
  assert.equal(unavailable.lighthouseChanges.notReevaluated.length, 1);
  const covered = compareSummaries(previous, {
    ...report(),
    evaluatedTools: { static: true },
    lighthouse: [{ route: "/shop", failed: [], errors: [] }],
  });
  assert.equal(covered.staticChanges.noLongerDetected.length, 1);
  assert.equal(covered.lighthouseChanges.noLongerDetected.length, 1);
});
test("a previously failed test that passes is explicitly re-evaluated, not silently dropped", () => {
  const item = {
    file: "test.ts",
    title: "case",
    project: "chromium",
    status: "unexpected",
  };
  const result = compareSummaries(
    { ...report(), tests: [item] },
    { ...report(), tests: [{ ...item, status: "expected" }] },
  );
  assert.equal(result.counts.testImprovements, 1);
  assert.equal(result.counts.testsNotReevaluated, 0);
});
