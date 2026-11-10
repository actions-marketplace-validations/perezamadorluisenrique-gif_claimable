/**
 * Core vocabulary.
 *
 * The whole tool answers one question per issue: if I do this work, is there a
 * realistic path to a merged PR? Everything here exists to make that answer
 * explainable — a verdict nobody can audit is worth less than no verdict.
 */

/** A `owner/repo#number` coordinate. */
export type IssueRef = {
  owner: string;
  repo: string;
  number: number;
};

export function refToString(ref: IssueRef): string {
  return `${ref.owner}/${ref.repo}#${ref.number}`;
}

export function repoToString(ref: IssueRef): string {
  return `${ref.owner}/${ref.repo}`;
}

/**
 * How badly a single check went.
 *
 * `blocker` means stop — no amount of effort on this issue produces a merged
 * PR. `warning` means proceed with your eyes open. `info` is context that
 * changes nothing on its own but shows up in the report.
 */
export type Severity = "blocker" | "warning" | "info" | "ok";

export type Finding = {
  /** Which filter produced this. */
  check: CheckId;
  severity: Severity;
  /** One line, written to be read by a human deciding what to do next. */
  message: string;
  /** Where to look to confirm it by hand. Never fabricate these. */
  evidence?: string[];
};

export type CheckId =
  | "repo-alive"
  | "existing-pr"
  | "blocked-label"
  | "claimants"
  | "prerequisites"
  | "environment"
  | "claim-protocol"
  /** Opt-in, not one of the seven: see `checks/hacktoberfest.ts`. */
  | "hacktoberfest";

/** Ordered as in the hand-run method: cheapest and most decisive first. */
export const CHECK_ORDER: Exclude<CheckId, "hacktoberfest">[] = [
  "repo-alive",
  "existing-pr",
  "blocked-label",
  "claimants",
  "prerequisites",
  "environment",
  "claim-protocol",
];

export type Verdict = "viable" | "reservations" | "discard";

export type IssueReport = {
  ref: IssueRef;
  title: string;
  url: string;
  verdict: Verdict;
  /** The single finding that decided the verdict. */
  reason: string;
  findings: Finding[];
  /** Checks that could not run, and why. An empty list here is suspicious. */
  skipped: { check: CheckId; why: string }[];
};

/** Minimal shapes of the GitHub payloads we actually read. */

export type GhUser = { login: string } | null;

export type GhLabel = { name: string };

export type GhIssue = {
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  /** Conversation locked; absent from older recorded fixtures. */
  locked?: boolean;
  html_url: string;
  labels: (GhLabel | string)[];
  assignees: GhUser[];
  assignee: GhUser;
  comments: number;
  created_at: string;
  updated_at: string;
  /** Present only when the "issue" is really a pull request. */
  pull_request?: unknown;
};

export type GhComment = {
  id: number;
  user: GhUser;
  body: string | null;
  created_at: string;
  html_url: string;
};

export type GhRepo = {
  full_name: string;
  pushed_at: string;
  archived: boolean;
  disabled: boolean;
  open_issues_count: number;
  default_branch: string;
  topics?: string[];
};

export type GhPull = {
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  draft: boolean;
  html_url: string;
  user: GhUser;
  created_at: string;
  updated_at: string;
  merged_at: string | null;
};

export type GhTimelineEvent = {
  event: string;
  created_at?: string;
  /** Who did it (assigned, referenced, ...). */
  actor?: { login: string } | null;
  /** For `assigned` / `unassigned`. */
  assignee?: { login: string } | null;
  source?: {
    issue?: {
      number: number;
      html_url: string;
      state: string;
      title: string;
      pull_request?: { merged_at: string | null; html_url: string };
      user?: GhUser;
      draft?: boolean;
    };
  };
};
