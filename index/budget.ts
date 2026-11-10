/**
 * The index's API budget: what one project costs, how often each project is
 * visited, and a simulation that proves the plan stays under the limit.
 *
 * Everything here is pure except `measure()`, which replays the recorded
 * cassettes of the evaluation set and counts the requests `analyze()` makes.
 * `node index/budget.ts` prints the numbers that `docs/INDEX-BUDGET.md` quotes.
 */

import { analyze } from "../src/analyze.ts";
import { configure, requestLog, resetRequestLog } from "../src/github.ts";

/**
 * Limits from docs.github.com (checked 2026-11-10):
 * - "The rate limit for GITHUB_TOKEN is 1,000 requests per hour per repository."
 *   (rest/using-the-rest-api/rate-limits-for-the-rest-api)
 * - Search, authenticated: "up to 30 requests per minute for all search endpoints"
 *   (rest/search/search). Search has its own bucket, separate from the 1,000.
 * The limit is per repository, so the claim bot running in the same repository
 * shares it; spending at most 80 % leaves the bot 200 requests every hour.
 */
export const LIMITS = { restPerHour: 1000, searchPerMinute: 30 } as const;
export const SAFETY = 0.8;
export const HOURLY_BUDGET = Math.floor(LIMITS.restPerHour * SAFETY);

/** Request kinds, split by who shares them. */
export type PathKind = "repo" | "issue" | "search";

export function classifyPath(path: string): PathKind {
  if (path.startsWith("/search/")) return "search";
  if (/^\/repos\/[^/]+\/[^/]+\/issues\/\d+/.test(path)) return "issue";
  return "repo";
}

export type Costs = {
  /** Requests shared by every issue of one project (repo, pulls, tree, docs). */
  perProject: number;
  /** Requests each analysed issue adds (comments, timeline), after priming the issue itself. */
  perIssue: number;
  /** Search requests each analysed issue adds, on average (separate bucket). */
  searchPerIssue: number;
  /** One request lists up to 100 open issues of one entry label. */
  listPerLabel: number;
};

/**
 * Measured with `measure()` over the 21 issues of the evaluation set on
 * 2026-11-10, rounded up. `test/index-budget.test.ts` re-measures and fails if
 * the real cost ever grows past these, so the simulation cannot go stale.
 */
export const MEASURED: Costs = { perProject: 6, perIssue: 2, searchPerIssue: 0.3, listPerLabel: 1 };

export type Measurement = {
  issues: number;
  thorough: boolean;
  /** Worst case of distinct repo-level requests one project needed. */
  perProjectMax: number;
  perProjectAvg: number;
  /** Issue-level requests per issue, excluding the issue GET the listing primes. */
  perIssueMax: number;
  perIssueAvg: number;
  searchPerIssueAvg: number;
};

/** Replays the evaluation set and counts requests by kind. Offline. */
export async function measure(
  rows: { ref: { owner: string; repo: string; number: number } }[],
  opts: { thorough: boolean; viewer: string; cassetteDir?: string },
): Promise<Measurement> {
  const repo: number[] = [];
  const issue: number[] = [];
  let search = 0;
  for (const row of rows) {
    configure({ cassetteMode: "replay", cassetteDir: opts.cassetteDir ?? "test/fixtures", token: null, viewer: opts.viewer });
    resetRequestLog();
    await analyze(row.ref, { thorough: opts.thorough });
    const log = requestLog();
    repo.push(log.filter((p) => classifyPath(p) === "repo").length);
    // The issue GET itself is primed from the listing, so it is free.
    issue.push(log.filter((p) => classifyPath(p) === "issue" && !/\/issues\/\d+$/.test(p)).length);
    search += log.filter((p) => classifyPath(p) === "search").length;
  }
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  return {
    issues: rows.length,
    thorough: opts.thorough,
    perProjectMax: Math.max(0, ...repo),
    perProjectAvg: avg(repo),
    perIssueMax: Math.max(0, ...issue),
    perIssueAvg: avg(issue),
    searchPerIssueAvg: search / Math.max(1, rows.length),
  };
}

// ---------------------------------------------------------------------------
// Rotation

/** Entry labels the index lists (one listing request each, case as GitHub stores them). */
export const ENTRY_LABELS = ["good first issue", "help wanted"] as const;

/**
 * Days until a project is visited again. Busy projects (a new entry issue in
 * the last 7 days) daily; quiet ones every 3 days; dormant ones (nothing new in
 * 30 days) every 7.
 */
export function intervalDays(daysSinceNewIssue: number): 1 | 3 | 7 {
  if (daysSinceNewIssue <= 7) return 1;
  if (daysSinceNewIssue <= 30) return 3;
  return 7;
}

/**
 * Whether a known issue must be analysed again on this visit. An issue whose
 * `updated_at` did not move is kept, with one exception: a listed (viable)
 * issue older than `maxViableAgeDays` is re-checked anyway, because a rival
 * pull request that only mentions the issue does not always bump its
 * `updated_at`, and the index must never keep showing a taken issue for long.
 */
export function needsAnalysis(
  known: { updatedAt: string; checkedAt: string; verdict: string } | undefined,
  updatedAt: string,
  today: number,
  maxViableAgeDays = 3,
): boolean {
  if (!known) return true;
  if (known.updatedAt !== updatedAt) return true;
  if (known.verdict === "viable") {
    const age = (today - Date.parse(known.checkedAt)) / 86_400_000;
    if (age >= maxViableAgeDays) return true;
  }
  return false;
}

/** Requests one visit costs: listings, shared project requests, and the issues that changed. */
export function visitCost(changedIssues: number, openEntryIssues: number, costs: Costs = MEASURED): number {
  const listing = ENTRY_LABELS.length * Math.max(1, Math.ceil(openEntryIssues / 100)) * costs.listPerLabel;
  if (changedIssues === 0) return listing;
  return listing + costs.perProject + changedIssues * costs.perIssue;
}

// ---------------------------------------------------------------------------
// Simulation

export type SimProject = {
  id: number;
  openIssues: number;
  /** Chance a given day brings a new entry issue. */
  newIssueRate: number;
  /** Chance a given day touches each known issue (comment, label…). */
  touchRate: number;
};

export type SimResult = {
  projects: number;
  days: number;
  maxHourSpend: number;
  maxSearchPerMinute: number;
  /** Visits that happened later than their due day. */
  lateVisits: number;
  /** Longest wait past the due day, in days. */
  worstDelayDays: number;
  totalVisits: number;
  hoursUsed: number;
};

/** Small deterministic PRNG so the simulation is the same on every run. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Synthetic projects shaped like the evaluation set: most quiet, a few busy. */
export function syntheticProjects(n: number, seed = 1): SimProject[] {
  const r = rng(seed);
  return Array.from({ length: n }, (_, id) => {
    const busy = r();
    return {
      id,
      openIssues: Math.floor(1 + r() * r() * 60),
      newIssueRate: busy < 0.25 ? 0.4 : busy < 0.6 ? 0.08 : 0.01,
      touchRate: 0.03 + r() * 0.07,
    };
  });
}

/**
 * Runs the index hourly for `days` days. Each hour spends at most
 * `hourlyBudget`, visiting due projects oldest-due first; a project whose
 * visit would cross the budget waits for the next hour. Search is spread at
 * most `searchPerMinute` requests a minute by the collector, so the check here
 * is the hour's search count over 60.
 */
export function simulate(
  projects: SimProject[],
  days = 30,
  opts: { hourlyBudget?: number; costs?: Costs; seed?: number; warmupDays?: number } = {},
): SimResult {
  // The first visit analyses every open issue, so the first days are a
  // backlog by design; lateness is only counted after the warm-up.
  const warmup = opts.warmupDays ?? 7;
  const budget = opts.hourlyBudget ?? HOURLY_BUDGET;
  const costs = opts.costs ?? MEASURED;
  const r = rng(opts.seed ?? 7);
  const state = projects.map((p) => ({
    p,
    due: 0, // hour index
    known: 0, // issues analysed at least once
    changed: p.openIssues, // first visit analyses everything
    lastNewDay: 0,
    pendingSince: 0,
  }));
  let maxHourSpend = 0;
  let maxSearchPerMinute = 0;
  let lateVisits = 0;
  let worstDelay = 0;
  let totalVisits = 0;
  let hoursUsed = 0;

  for (let hour = 0; hour < days * 24; hour++) {
    const day = Math.floor(hour / 24);
    if (hour % 24 === 0) {
      // The day's activity: new issues and touched issues pile up as "changed".
      for (const s of state) {
        if (r() < s.p.newIssueRate) {
          s.changed += 1;
          s.lastNewDay = day;
        }
        let touched = 0;
        for (let i = 0; i < s.p.openIssues; i++) if (r() < s.p.touchRate) touched++;
        // Listed issues are re-checked every 3 days anyway: about a third of
        // the ~1 in 6 that are viable come due each day.
        const viableRecheck = Math.ceil(s.p.openIssues / 6 / 3);
        s.changed = Math.min(s.p.openIssues + 1, s.changed + touched + viableRecheck);
      }
    }
    const due = state.filter((s) => s.due <= hour).sort((a, b) => a.due - b.due);
    let spent = 0;
    let searched = 0;
    for (const s of due) {
      const cost = visitCost(s.changed, s.p.openIssues, costs);
      if (spent + cost > budget) continue;
      spent += cost;
      searched += s.changed * costs.searchPerIssue;
      totalVisits++;
      const delayDays = (hour - s.due) / 24;
      if (delayDays >= 1 && day >= warmup) {
        lateVisits++;
        worstDelay = Math.max(worstDelay, delayDays);
      }
      s.changed = 0;
      s.due = hour + 24 * intervalDays(day - s.lastNewDay);
    }
    if (spent > 0) hoursUsed++;
    maxHourSpend = Math.max(maxHourSpend, spent);
    maxSearchPerMinute = Math.max(maxSearchPerMinute, searched / 60);
  }
  return {
    projects: projects.length,
    days,
    maxHourSpend,
    maxSearchPerMinute,
    lateVisits,
    worstDelayDays: Math.round(worstDelay * 10) / 10,
    totalVisits,
    hoursUsed,
  };
}

/** The largest project count (in steps of `step`) the plan serves with no visit a day late. */
export function capacity(step = 100, max = 20_000): number {
  let best = 0;
  for (let n = step; n <= max; n += step) {
    const res = simulate(syntheticProjects(n), 30);
    if (res.lateVisits > 0) break;
    best = n;
  }
  return best;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { GROUND_TRUTH, TRIAGE_DATE, TRIAGE_VIEWER } = await import("../test/ground-truth.ts");
  process.env.CLAIMABLE_NOW = TRIAGE_DATE;
  for (const thorough of [false, true]) {
    console.log(JSON.stringify(await measure(GROUND_TRUTH, { thorough, viewer: TRIAGE_VIEWER })));
  }
  console.log(JSON.stringify(simulate(syntheticProjects(3000), 30)));
  console.log(JSON.stringify({ capacity: capacity() }));
}
