import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { dataPath, dueProjects, readExclude, run, type Deps, type Project } from "../index/collect.ts";
import type { GhIssue, IssueReport, Verdict } from "../src/types.ts";

const NOW = Date.parse("2026-11-10T12:00:00Z");

function issue(n: number, over: Partial<GhIssue> = {}): GhIssue {
  return {
    number: n, title: `Issue ${n}`, body: "", state: "open", html_url: `https://github.com/o/r/issues/${n}`,
    labels: [{ name: "good first issue" }], assignees: [], assignee: null, comments: 0,
    created_at: "2026-11-09T00:00:00Z", updated_at: "2026-11-09T00:00:00Z", ...over,
  };
}

function fake(issues: Record<string, GhIssue[]>, verdicts: Record<number, Verdict> = {}) {
  let spent = 0;
  const analysed: number[] = [];
  const deps: Deps = {
    listIssues: async (p, label) => {
      spent += 1;
      return label === "good first issue" ? issues[`${p.owner}/${p.repo}`] ?? [] : [];
    },
    analyze: async (p, i) => {
      spent += analysed.length === 0 ? 6 : 0;
      spent += 2;
      analysed.push(i.number);
      const verdict = verdicts[i.number] ?? "viable";
      return {
        ref: { owner: p.owner, repo: p.repo, number: i.number }, title: i.title, url: i.html_url, verdict,
        reason: verdict, findings: verdict === "discard" ? [{ check: "existing-pr", severity: "blocker", message: "PR", evidence: ["https://github.com/o/r/pull/9"] }] : [],
        skipped: [],
      } satisfies IssueReport;
    },
    spent: () => spent,
    reset: () => { analysed.length = analysed.length; },
  };
  return { deps, analysed, spent: () => spent };
}

const P: Project[] = [{ owner: "o", repo: "r", language: "Go" }];

describe("index collector", () => {
  it("stores every verdict with its evidence and skips pull requests", async () => {
    const dir = mkdtempSync(join(tmpdir(), "idx-"));
    const f = fake({ "o/r": [issue(1), issue(2), issue(3, { pull_request: {} })] }, { 2: "discard" });
    const res = await run(dir, P, f.deps, { now: NOW, budget: 800 });
    assert.deepEqual(res.visited, ["o/r"]);
    const data = JSON.parse(readFileSync(dataPath(dir, P[0]), "utf8"));
    assert.deepEqual(data.issues.map((i: { number: number; verdict: string }) => [i.number, i.verdict]), [[1, "viable"], [2, "discard"]]);
    assert.deepEqual(data.issues[1].evidence, ["https://github.com/o/r/pull/9"]);
    assert.equal(data.issues[0].checkedAt, new Date(NOW).toISOString());
    const sched = JSON.parse(readFileSync(join(dir, "schedule.json"), "utf8"));
    assert.equal(sched["o/r"].nextCheck, new Date(NOW + 86_400_000).toISOString(), "new issue this week: daily");
  });

  it("re-analyses only what moved, and viable issues after 3 days", async () => {
    const dir = mkdtempSync(join(tmpdir(), "idx-"));
    const list = [issue(1), issue(2)];
    await run(dir, P, fake({ "o/r": list }, { 2: "discard" }).deps, { now: NOW, budget: 800 });
    const day2 = NOW + 86_400_000;
    const f2 = fake({ "o/r": [issue(1), issue(2, { updated_at: "2026-11-10T13:00:00Z" })] });
    await run(dir, P, f2.deps, { now: day2, budget: 800 });
    assert.deepEqual(f2.analysed, [2]);
    const day4 = NOW + 3 * 86_400_000;
    const f3 = fake({ "o/r": [issue(1), issue(2, { updated_at: "2026-11-10T13:00:00Z" })] });
    await run(dir, P, f3.deps, { now: day4, budget: 800 });
    assert.deepEqual(f3.analysed, [1], "viable issue 1 is 3 days old: re-checked; issue 2 unchanged");
  });

  it("drops closed issues", async () => {
    const dir = mkdtempSync(join(tmpdir(), "idx-"));
    await run(dir, P, fake({ "o/r": [issue(1), issue(2)] }).deps, { now: NOW, budget: 800 });
    await run(dir, P, fake({ "o/r": [issue(2)] }).deps, { now: NOW + 86_400_000, budget: 800 });
    const data = JSON.parse(readFileSync(dataPath(dir, P[0]), "utf8"));
    assert.deepEqual(data.issues.map((i: { number: number }) => i.number), [2]);
  });

  it("stops cleanly at the budget and never crosses it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "idx-"));
    const many = Array.from({ length: 40 }, (_, i) => issue(i + 1));
    const projects: Project[] = Array.from({ length: 5 }, (_, i) => ({ owner: "o", repo: `r${i}` }));
    const lists = Object.fromEntries(projects.map((p) => [`o/${p.repo}`, many]));
    const f = fake(lists);
    const res = await run(dir, projects, f.deps, { now: NOW, budget: 50 });
    assert.ok(f.spent() <= 50, `spent ${f.spent()}`);
    assert.equal(res.stoppedForBudget, true);
    const sched = JSON.parse(readFileSync(join(dir, "schedule.json"), "utf8"));
    assert.equal(sched["o/r0"].nextCheck, new Date(NOW + 3_600_000).toISOString(), "cut short: back in an hour");
    const before = JSON.parse(readFileSync(dataPath(dir, projects[0]), "utf8")).issues.length;
    const next = fake(lists);
    await run(dir, [projects[0]], next.deps, { now: NOW + 3_600_000, budget: 50 });
    assert.ok(next.analysed.length > 0 && !next.analysed.includes(1), "carries on where it stopped");
    assert.ok(JSON.parse(readFileSync(dataPath(dir, projects[0]), "utf8")).issues.length > before);
  });

  it("never shows a viable issue it could not re-check", async () => {
    const dir = mkdtempSync(join(tmpdir(), "idx-"));
    await run(dir, P, fake({ "o/r": [issue(1)] }).deps, { now: NOW, budget: 800 });
    const later = NOW + 4 * 86_400_000;
    await run(dir, P, fake({ "o/r": [issue(1)] }).deps, { now: later, budget: 3 });
    const data = JSON.parse(readFileSync(dataPath(dir, P[0]), "utf8"));
    assert.equal(data.issues.length, 0);
  });

  it("honours the exclusion list and the schedule", () => {
    const ex = readExclude("# comment\nO/R  # asked on #12\n\n");
    assert.deepEqual(dueProjects(P, {}, NOW, ex), []);
    assert.equal(dueProjects(P, { "o/r": { nextCheck: new Date(NOW + 1).toISOString(), lastNewIssue: null } }, NOW).length, 0);
    assert.equal(dueProjects(P, {}, NOW).length, 1);
    assert.ok(!existsSync("index/exclude.txt") || readExclude(readFileSync("index/exclude.txt", "utf8")) instanceof Set);
  });
});
