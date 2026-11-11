import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  capacity, classifyPath, HOURLY_BUDGET, intervalDays, measure, MEASURED, needsAnalysis,
  simulate, syntheticProjects, visitCost,
} from "../index/budget.ts";
import { GROUND_TRUTH, TRIAGE_DATE, TRIAGE_VIEWER } from "./ground-truth.ts";

process.env.CLAIMABLE_NOW = TRIAGE_DATE;

describe("index budget", () => {
  it("the measured cost never grows past the constants the simulation uses", async () => {
    for (const thorough of [false, true]) {
      const m = await measure(GROUND_TRUTH, { thorough, viewer: TRIAGE_VIEWER });
      assert.equal(m.issues, GROUND_TRUTH.length);
      assert.ok(m.perProjectMax <= MEASURED.perProject, `per project ${m.perProjectMax}`);
      assert.ok(m.perIssueMax <= MEASURED.perIssue, `per issue ${m.perIssueMax}`);
      assert.ok(m.searchPerIssueAvg <= MEASURED.searchPerIssue, `search ${m.searchPerIssueAvg}`);
    }
  });

  it("classifies paths", () => {
    assert.equal(classifyPath("/repos/a/b"), "repo");
    assert.equal(classifyPath("/repos/a/b/issues/3/comments?per_page=100"), "issue");
    assert.equal(classifyPath("/repos/a/b/issues?state=open"), "repo");
    assert.equal(classifyPath("/search/issues?q=x"), "search");
  });

  it("rotates by activity and re-checks only what moved", () => {
    assert.equal(intervalDays(0), 1);
    assert.equal(intervalDays(10), 3);
    assert.equal(intervalDays(90), 7);
    const today = Date.parse("2026-11-10T00:00:00Z");
    assert.equal(needsAnalysis(undefined, "x", today), true);
    assert.equal(needsAnalysis({ updatedAt: "a", checkedAt: "2026-11-09", verdict: "discard" }, "a", today), false);
    assert.equal(needsAnalysis({ updatedAt: "a", checkedAt: "2026-11-09", verdict: "discard" }, "b", today), true);
    assert.equal(needsAnalysis({ updatedAt: "a", checkedAt: "2026-11-09", verdict: "viable" }, "a", today), false);
    assert.equal(needsAnalysis({ updatedAt: "a", checkedAt: "2026-11-06", verdict: "viable" }, "a", today), true);
    assert.equal(visitCost(0, 30), 2);
    assert.equal(visitCost(4, 30), 2 + MEASURED.perProject + 4 * MEASURED.perIssue);
  });

  it("30 days with 3,000 projects never spends more than 80 % of the hourly limit", () => {
    const res = simulate(syntheticProjects(3000), 30);
    assert.ok(res.maxHourSpend <= HOURLY_BUDGET, `spent ${res.maxHourSpend}`);
    assert.ok(res.maxSearchPerMinute <= 30 * 0.8);
  });

  it("serves 1,800 projects with no visit a day late after the first week", () => {
    const res = simulate(syntheticProjects(1800), 30);
    assert.ok(res.maxHourSpend <= HOURLY_BUDGET);
    assert.equal(res.lateVisits, 0);
    assert.equal(capacity(), 1800, "update docs/INDEX-BUDGET.md and the plan's stage sizes if this moves");
  });
});
