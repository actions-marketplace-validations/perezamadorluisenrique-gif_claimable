/**
 * Vocabulary of the claim bot.
 *
 * Everything the bot decides is a pure function from these shapes to these
 * shapes (`commands.ts`, `state.ts`, `decide.ts`); only `apply.ts` touches the
 * network. Keeping the decision data-only is what lets 40 recorded threads
 * prove the bot never acts wrongly in public.
 */

import type { GhTimelineEvent } from "../types.ts";

/** Who may release somebody else's claim. */
export const MAINTAINER_ASSOCIATIONS = ["OWNER", "MEMBER", "COLLABORATOR"] as const;

export type CommandKind = "claim" | "unclaim" | "status";

export type Command = { kind: CommandKind };

/** A comment as the bot reads it: only the fields it needs. */
export type BotComment = {
  id: number;
  /** `null` is a deleted account ("ghost"). */
  user: { login: string; type: "User" | "Bot" | "Organization" | "Mannequin" } | null;
  author_association: string;
  body: string | null;
  created_at: string;
};

export type BotIssue = {
  number: number;
  state: "open" | "closed";
  locked: boolean;
  html_url: string;
  title: string;
  labels: (string | { name: string })[];
  assignees: ({ login: string } | null)[];
  updated_at: string;
  /** Present only when the "issue" is really a pull request. */
  pull_request?: unknown;
};

export type BotEvent = { kind: "comment"; commentId: number } | { kind: "tick" };

/** What the bot remembers, hidden in its one comment: `<!-- claimable-bot:v1 {json} -->`. */
export type Marker = {
  claimant: string | null;
  /** ISO time of the claim. */
  since: string | null;
  /** ISO time of the nudge, once sent. */
  nudgedAt: string | null;
};

export const EMPTY_MARKER: Marker = { claimant: null, since: null, nudgedAt: null };

export type BotConfig = {
  /** Days without activity before the holder is nudged. */
  nudgeDays: number;
  /** Days after the nudge, still without activity, before the claim is released. */
  releaseDays: number;
  /** Open claims one person may hold at once. */
  maxClaims: number;
  /** When not empty, only issues with one of these labels can be claimed. */
  labels: string[];
  /** Labels (besides the built-in blocking ones) that stop claims. */
  blockedLabels: string[];
  /** Answer once, with how to claim, to a comment that sounds like a claim. */
  hintOnNaturalClaims: boolean;
  /** People who never count against the claim limit. */
  exemptUsers: string[];
  /** People whose commands the bot ignores. */
  blockedUsers: string[];
  /** The label that marks a claimed issue. */
  claimedLabel: string;
};

export const DEFAULT_CONFIG: BotConfig = {
  nudgeDays: 7,
  releaseDays: 7,
  maxClaims: 2,
  labels: [],
  blockedLabels: [],
  hintOnNaturalClaims: false,
  exemptUsers: [],
  blockedUsers: [],
  claimedLabel: "claimed",
};

/** What the single bot comment says. The text itself is rendered in `messages.ts`. */
export type Reply =
  | { kind: "claimed"; claimant: string; since: string; nudgeOn: string; releaseOn: string }
  | { kind: "status"; holder: string | null; since: string | null; nudgeOn: string | null; releaseOn: string | null }
  | { kind: "released"; by: string; former: string }
  | { kind: "nudge"; holder: string; lastOn: string; releaseOn: string }
  | { kind: "expired"; former: string; lastOn: string }
  | { kind: "held"; requester: string; holder: string; since: string | null }
  | { kind: "pull-open"; requester: string; pull: number; author: string }
  | { kind: "quota"; requester: string; limit: number; claims: number[] }
  | { kind: "closed"; requester: string }
  | { kind: "blocked"; requester: string; label: string }
  | { kind: "not-labelled"; requester: string; labels: string[] }
  | { kind: "not-holder"; requester: string; holder: string };

export type Action =
  | { type: "assign"; login: string }
  | { type: "unassign"; login: string }
  | { type: "label"; name: string }
  | { type: "unlabel"; name: string }
  | { type: "comment"; mode: "create" | "edit"; commentId?: number; reply: Reply; marker: Marker }
  | { type: "none"; reason: string };

/** One recorded thread of the bank in `test/bot-threads/`. */
export type BotThread = {
  name: string;
  /** Where the situation comes from: a ground-truth issue, or "synthetic". */
  source: string;
  now: string;
  issue: BotIssue;
  timeline: GhTimelineEvent[];
  comments: BotComment[];
  event: BotEvent;
  /** Open issues of the repo already claimed by the person who wrote the command. */
  requesterClaims: number[];
  config: Partial<BotConfig>;
  expected: Action[];
};
