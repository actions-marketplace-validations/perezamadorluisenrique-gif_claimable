/**
 * Thin accessors over the REST client.
 *
 * Every check pulls what it needs through here, so the memo in `github.ts` makes
 * overlapping needs free: seven checks on one issue cost roughly five requests,
 * not seventeen.
 */

import { api, apiOptional } from "./github.ts";
import type { GhComment, GhIssue, GhPull, GhRepo, GhTimelineEvent, IssueRef } from "./types.ts";

export function getRepo(ref: IssueRef): Promise<GhRepo> {
  return api<GhRepo>(`/repos/${ref.owner}/${ref.repo}`);
}

export function getIssue(ref: IssueRef): Promise<GhIssue> {
  return api<GhIssue>(`/repos/${ref.owner}/${ref.repo}/issues/${ref.number}`);
}

export function getComments(ref: IssueRef): Promise<GhComment[]> {
  // 100 is the cap. Issues with more comments than that are, by the method's own
  // logic, either umbrella issues or contested — both of which the first page
  // already reveals, so paginating further buys nothing.
  return api<GhComment[]>(`/repos/${ref.owner}/${ref.repo}/issues/${ref.number}/comments?per_page=100`);
}

export function getTimeline(ref: IssueRef): Promise<GhTimelineEvent[]> {
  return api<GhTimelineEvent[]>(`/repos/${ref.owner}/${ref.repo}/issues/${ref.number}/timeline?per_page=100`);
}

/**
 * Every page of a list, up to `maxPages`. When the last page it was willing to
 * read is still full, the list is reported as `truncated` instead of passed off
 * as complete: the bot must not act on the first hundred entries of a longer
 * thread, because the entry that matters (a rival pull request, its own
 * comment) may be on a page it never saw.
 */
async function allPages<T>(base: string, maxPages = 10): Promise<{ items: T[]; truncated: boolean }> {
  const items: T[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const got = await api<T[]>(page === 1 ? base : `${base}&page=${page}`);
    items.push(...got);
    if (got.length < 100) return { items, truncated: false };
  }
  return { items, truncated: true };
}

export function getAllComments(ref: IssueRef): Promise<{ items: GhComment[]; truncated: boolean }> {
  return allPages<GhComment>(`/repos/${ref.owner}/${ref.repo}/issues/${ref.number}/comments?per_page=100`);
}

export function getAllTimeline(ref: IssueRef): Promise<{ items: GhTimelineEvent[]; truncated: boolean }> {
  return allPages<GhTimelineEvent>(`/repos/${ref.owner}/${ref.repo}/issues/${ref.number}/timeline?per_page=100`);
}

/** Open issues of the repo carrying `label` and assigned to `login`: what a person already holds. */
export async function getHeldIssues(ref: IssueRef, login: string, label: string): Promise<{ numbers: number[]; truncated: boolean }> {
  const { items, truncated } = await allPages<GhIssue>(
    `/repos/${ref.owner}/${ref.repo}/issues?state=open&labels=${encodeURIComponent(label)}&assignee=${encodeURIComponent(login)}&per_page=100`,
    3,
  );
  return { numbers: items.filter((i) => !i.pull_request && i.number !== ref.number).map((i) => i.number), truncated };
}

/** Open issues of the repo carrying `label`, whoever holds them: what the daily visit looks at. */
export async function getClaimedIssues(ref: IssueRef, label: string): Promise<{ numbers: number[]; truncated: boolean }> {
  const { items, truncated } = await allPages<GhIssue>(
    `/repos/${ref.owner}/${ref.repo}/issues?state=open&labels=${encodeURIComponent(label)}&per_page=100`,
    3,
  );
  return { numbers: items.filter((i) => !i.pull_request).map((i) => i.number), truncated };
}

/** A person's role on the repository (admin, maintain, write, triage, read, none), or null when it cannot be read. */
export async function getPermission(ref: IssueRef, login: string): Promise<string | null> {
  try {
    const res = await apiOptional<{ role_name?: string; permission?: string }>(
      `/repos/${ref.owner}/${ref.repo}/collaborators/${encodeURIComponent(login)}/permission`,
    );
    return res?.role_name ?? res?.permission ?? null;
  } catch {
    return null;
  }
}

/** Recently-closed PRs, used to measure whether review actually happens here. */
export function getRecentPulls(ref: IssueRef): Promise<GhPull[]> {
  return api<GhPull[]>(
    `/repos/${ref.owner}/${ref.repo}/pulls?state=closed&sort=updated&direction=desc&per_page=50`,
  );
}

/**
 * Fetch a text file from the default branch. Returns null when absent, which is
 * itself informative — a repo with no CONTRIBUTING.md has no claim protocol to
 * violate.
 */
export async function getFile(ref: IssueRef, path: string): Promise<string | null> {
  const res = await apiOptional<{ content?: string; encoding?: string; size?: number }>(
    `/repos/${ref.owner}/${ref.repo}/contents/${path}`,
  );
  if (!res || !res.content || res.encoding !== "base64") return null;
  return Buffer.from(res.content, "base64").toString("utf8");
}

/** Directory listing, used to test whether a prerequisite path actually exists. */
export async function pathExists(ref: IssueRef, path: string): Promise<boolean> {
  const res = await apiOptional<unknown>(`/repos/${ref.owner}/${ref.repo}/contents/${path}`);
  return res !== null;
}

export type TreeEntry = { path: string; type: string; size?: number };
export type RepoTree = { entries: TreeEntry[]; truncated: boolean };

/**
 * The whole file list in one request.
 *
 * Worth the single large response: checking "do the twelve paths this issue
 * mentions actually exist?" against a local set costs nothing, whereas twelve
 * `contents/` requests costs twelve. Very large monorepos come back truncated,
 * which is reported rather than hidden — a partial tree would otherwise produce
 * confident false "this file does not exist" claims.
 */
export async function getTree(ref: IssueRef): Promise<RepoTree> {
  const repo = await getRepo(ref);
  const res = await apiOptional<{ tree?: TreeEntry[]; truncated?: boolean }>(
    `/repos/${ref.owner}/${ref.repo}/git/trees/${repo.default_branch}?recursive=1`,
  );
  if (!res || !res.tree) return { entries: [], truncated: true };
  return { entries: res.tree, truncated: res.truncated === true };
}

/** Where projects actually put the rules, in rough order of likelihood. */
export const DOC_PATHS = [
  "CONTRIBUTING.md",
  ".github/CONTRIBUTING.md",
  "docs/CONTRIBUTING.md",
  "README.md",
  "AGENTS.md",
  ".github/AGENTS.md",
  "CLAUDE.md",
  "DEVELOPMENT.md",
  "docs/development.md",
  "INSTALL.md",
];

/** Fetch whichever of the usual docs exist. Missing ones are simply absent. */
export async function getDocs(ref: IssueRef, paths: string[] = DOC_PATHS): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  const tree = await getTree(ref).catch(() => ({ entries: [], truncated: true }) as RepoTree);
  const present = new Set(tree.entries.map((e) => e.path));

  for (const path of paths) {
    // When the tree is trustworthy, skip requests for files we know are absent.
    if (!tree.truncated && tree.entries.length > 0 && !present.has(path)) continue;
    const content = await getFile(ref, path).catch(() => null);
    if (content) found.set(path, content);
  }
  return found;
}

/**
 * "Now", overridable via CLAIMABLE_NOW.
 *
 * Needed because the recorded fixtures are a snapshot of a particular day, and
 * "is this repo stale?" is a question about elapsed time. Without pinning the
 * clock, the test suite would start failing on its own after a few months and
 * the failure would look like a regression.
 */
export function now(): number {
  const pinned = process.env.CLAIMABLE_NOW;
  if (pinned) {
    const parsed = Date.parse(pinned);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return Date.now();
}

export function daysSince(iso: string | null | undefined): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return Number.POSITIVE_INFINITY;
  return (now() - then) / 86_400_000;
}

export function median(values: number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}
