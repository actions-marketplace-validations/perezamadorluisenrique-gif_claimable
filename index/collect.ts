/**
 * The index collector: visit the projects that are due, analyse the entry
 * issues that changed, and write what was found under `data/`.
 *
 * One run spends at most the hour's budget (`index/budget.ts`) and stops
 * cleanly before crossing it; whatever was not reached stays due and the next
 * hourly run picks it up. Only `viable` issues are ever shown by the site, but
 * every verdict is stored, so a discarded issue is not analysed again until it
 * changes.
 *
 *   node index/collect.ts --data <dir> [--projects index/projects.json] [--budget 800]
 *
 * The data directory is the checkout of the `index-data` branch.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { analyze } from "../src/analyze.ts";
import { api, clearMemo, primeMemo, rateRemaining, requestLog, resetRequestLog } from "../src/github.ts";
import type { GhIssue, IssueReport } from "../src/types.ts";
import { ENTRY_LABELS, HOURLY_BUDGET, intervalDays, MEASURED, needsAnalysis } from "./budget.ts";

export type Project = {
  owner: string;
  repo: string;
  language?: string;
  stars?: number;
  description?: string;
  /** The entry labels this project actually uses; defaults to ENTRY_LABELS. */
  labels?: string[];
};

export type StoredIssue = {
  number: number;
  title: string;
  url: string;
  labels: string[];
  updatedAt: string;
  checkedAt: string;
  verdict: IssueReport["verdict"];
  reason: string;
  /** Evidence URLs from the findings, as `analyze()` gave them; never invented. */
  evidence: string[];
};

export type ProjectData = {
  owner: string;
  repo: string;
  language?: string;
  stars?: number;
  description?: string;
  visitedAt: string;
  issues: StoredIssue[];
};

export type ScheduleEntry = { nextCheck: string; lastNewIssue: string | null };
export type Schedule = Record<string, ScheduleEntry>;

export type Deps = {
  /** Open issues of one label (a single page of 100; pull requests included, filtered here). */
  listIssues: (p: Project, label: string) => Promise<GhIssue[]>;
  analyze: (p: Project, issue: GhIssue) => Promise<IssueReport>;
  /** Requests spent so far in this run. */
  spent: () => number;
  /** Called between projects so memoised responses do not pile up. */
  reset: () => void;
};

export type RunResult = {
  visited: string[];
  analysed: number;
  spent: number;
  stoppedForBudget: boolean;
  due: number;
};

const key = (p: { owner: string; repo: string }) => `${p.owner}/${p.repo}`.toLowerCase();

export function readExclude(text: string): Set<string> {
  return new Set(
    text
      .split("\n")
      .map((l) => l.replace(/#.*/, "").trim().toLowerCase())
      .filter(Boolean),
  );
}

/** Projects due at `now`, oldest due first; never-seen projects first of all. */
export function dueProjects(projects: Project[], schedule: Schedule, now: number, exclude = new Set<string>()): Project[] {
  return projects
    .filter((p) => !exclude.has(key(p)))
    .map((p) => ({ p, at: schedule[key(p)] ? Date.parse(schedule[key(p)].nextCheck) : 0 }))
    .filter((x) => x.at <= now)
    .sort((a, b) => a.at - b.at)
    .map((x) => x.p);
}

function labelNames(issue: GhIssue): string[] {
  return (issue.labels ?? []).map((l) => (typeof l === "string" ? l : l.name));
}

function evidenceOf(report: IssueReport): string[] {
  const out: string[] = [];
  for (const f of report.findings) for (const e of f.evidence ?? []) if (!out.includes(e)) out.push(e);
  return out.slice(0, 10);
}

/**
 * Visits one project. Returns null without writing anything when the visit
 * would cross the budget before it is done (the project stays due).
 */
export async function visit(
  p: Project,
  previous: ProjectData | null,
  sched: ScheduleEntry | undefined,
  deps: Deps,
  now: number,
  budget: number,
): Promise<{ data: ProjectData; sched: ScheduleEntry; analysed: number } | null> {
  const labels = p.labels?.length ? p.labels : [...ENTRY_LABELS];
  if (deps.spent() + labels.length > budget) return null;

  const byNumber = new Map<number, GhIssue>();
  for (const label of labels) {
    for (const issue of await deps.listIssues(p, label)) {
      if (issue.pull_request) continue;
      byNumber.set(issue.number, issue);
    }
  }

  const known = new Map((previous?.issues ?? []).map((i) => [i.number, i]));
  const todo = [...byNumber.values()].filter((i) => needsAnalysis(known.get(i.number), i.updated_at, now));
  const nowIso = new Date(now).toISOString();
  const issues: StoredIssue[] = [];
  let analysed = 0;
  let stopped = false;

  for (const issue of [...byNumber.values()].sort((a, b) => a.number - b.number)) {
    const old = known.get(issue.number);
    if (!todo.includes(issue) && old) {
      issues.push({ ...old, title: issue.title, labels: labelNames(issue) });
      continue;
    }
    // Worst case of what this issue may still cost: the shared project
    // requests if none has been made yet, plus the issue's own.
    const reserve = (analysed === 0 ? MEASURED.perProject : 0) + MEASURED.perIssue + 1;
    if (stopped || deps.spent() + reserve > budget) {
      stopped = true;
      // Not reached this run: keep what we knew, or nothing for a new issue.
      // A known viable issue that is due for a re-check is dropped from the
      // listing rather than shown stale.
      if (old && old.verdict !== "viable") issues.push(old);
      continue;
    }
    const report = await deps.analyze(p, issue);
    analysed++;
    issues.push({
      number: issue.number,
      title: issue.title,
      url: issue.html_url,
      labels: labelNames(issue),
      updatedAt: issue.updated_at,
      checkedAt: nowIso,
      verdict: report.verdict,
      reason: report.reason,
      evidence: evidenceOf(report),
    });
  }

  const newest = [...byNumber.values()].reduce<string | null>(
    (acc, i) => (acc === null || i.created_at > acc ? i.created_at : acc),
    sched?.lastNewIssue ?? null,
  );
  const days = newest ? (now - Date.parse(newest)) / 86_400_000 : 999;
  // A visit cut short comes back in an hour to finish.
  const next = stopped ? now + 3_600_000 : now + intervalDays(days) * 86_400_000;
  return {
    data: {
      owner: p.owner,
      repo: p.repo,
      language: p.language,
      stars: p.stars,
      description: p.description,
      visitedAt: nowIso,
      issues,
    },
    sched: { nextCheck: new Date(next).toISOString(), lastNewIssue: newest },
    analysed,
  };
}

export function dataPath(dir: string, p: { owner: string; repo: string }): string {
  return join(dir, "data", p.owner.toLowerCase(), `${p.repo.toLowerCase()}.json`);
}

function readJson<T>(file: string, fallback: T): T {
  if (!existsSync(file)) return fallback;
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

function writeJson(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 1) + "\n");
}

/** One run over the due projects, writing into `dir`. */
export async function run(
  dir: string,
  projects: Project[],
  deps: Deps,
  opts: { now: number; budget: number; exclude?: Set<string> },
): Promise<RunResult> {
  const schedFile = join(dir, "schedule.json");
  const schedule = readJson<Schedule>(schedFile, {});
  const due = dueProjects(projects, schedule, opts.now, opts.exclude);
  const visited: string[] = [];
  let analysed = 0;
  let stoppedForBudget = false;

  for (const p of due) {
    deps.reset();
    const file = dataPath(dir, p);
    const result = await visit(p, readJson<ProjectData | null>(file, null), schedule[key(p)], deps, opts.now, opts.budget);
    if (!result) {
      stoppedForBudget = true;
      break;
    }
    writeJson(file, result.data);
    schedule[key(p)] = result.sched;
    visited.push(key(p));
    analysed += result.analysed;
    if (opts.budget - deps.spent() < MEASURED.listPerLabel * ENTRY_LABELS.length) {
      stoppedForBudget = true;
      break;
    }
  }
  writeJson(schedFile, schedule);
  return { visited, analysed, spent: deps.spent(), stoppedForBudget, due: due.length };
}

/** The live dependencies: the real API, analysed the fast way (stop at the first blocker). */
export function liveDeps(): Deps {
  resetRequestLog();
  return {
    listIssues: (p, label) =>
      api<GhIssue[]>(
        `/repos/${p.owner}/${p.repo}/issues?state=open&labels=${encodeURIComponent(label)}&sort=updated&direction=desc&per_page=100`,
      ),
    analyze: (p, issue) => {
      primeMemo(`/repos/${p.owner}/${p.repo}/issues/${issue.number}`, issue);
      return analyze({ owner: p.owner, repo: p.repo, number: issue.number });
    },
    spent: () => requestLog().filter((path) => !path.startsWith("/search/")).length,
    reset: () => clearMemo(),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const opt = (name: string, dflt: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : dflt;
  };
  const dir = opt("--data", "index-data");
  const projects = readJson<Project[]>(opt("--projects", "index/projects.json"), []);
  const exclude = readExclude(existsSync("index/exclude.txt") ? readFileSync("index/exclude.txt", "utf8") : "");
  let budget = Number(opt("--budget", String(HOURLY_BUDGET)));
  // Never take more than 80 % of what is actually left this hour: the claim
  // bot shares the bucket and may already have used some of it.
  const remaining = await rateRemaining();
  if (remaining !== null) budget = Math.min(budget, Math.floor(remaining * 0.8));
  const res = await run(dir, projects, liveDeps(), { now: Date.now(), budget, exclude });
  console.log(
    `index: ${res.visited.length} of ${res.due} due projects visited, ${res.analysed} issues analysed, ${res.spent} requests of ${budget}${res.stoppedForBudget ? " (stopped at the budget; the rest wait for the next run)" : ""}`,
  );
}
