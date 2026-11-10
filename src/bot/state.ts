/**
 * What the bot knows about an issue, read from the issue itself.
 *
 * There is no database. The holder is whoever the issue is assigned to; when
 * they got it, and what they did since, comes from the timeline and the
 * comments; and the little the bot must remember (who it reserved for, when it
 * nudged) is a hidden marker in its one comment. That comment is trusted only
 * when a bot wrote it: anybody can paste a marker into their own comment.
 */

import { labelNames } from "../checks/blocked-label.ts";
import type { GhTimelineEvent } from "../types.ts";
import { isBotAuthor } from "./commands.ts";
import { EMPTY_MARKER } from "./types.ts";
import type { BotComment, BotIssue, Marker } from "./types.ts";

export type OpenPull = { number: number; url: string; author: string };

export type State = {
  number: number;
  open: boolean;
  locked: boolean;
  isPull: boolean;
  labels: string[];
  /** The first assignee, and when they got the issue if known. */
  holder: { login: string; since: string | null } | null;
  /** ISO time of the holder's latest sign of life; null without a holder. */
  lastActivity: string | null;
  /** Pull requests linked to the issue that are still open (drafts included). */
  openPulls: OpenPull[];
  /** The bot's one comment, if it has written it. */
  bot: { commentId: number; marker: Marker } | null;
  /** Other open issues the requester already holds. */
  requesterClaims: number[];
};

// Anchored to the start: the bot writes it as the first line, so a marker quoted
// further down (by a user, or by another bot echoing a user) is not the bot's.
const MARKER = /^<!-- claimable-bot:v1 (\{[^\n]*?\}) -->(?:\n|$)/;
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\[bot\])?$/;

function validTime(v: unknown): v is string {
  return typeof v === "string" && !Number.isNaN(Date.parse(v));
}

/** The marker in a comment body, or null when absent or malformed. */
export function parseMarker(body: string | null): Marker | null {
  const hit = body ? MARKER.exec(body) : null;
  if (!hit) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(hit[1]);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const { claimant, since, nudgedAt } = raw as Record<string, unknown>;
  const claimantOk = claimant === null || (typeof claimant === "string" && LOGIN.test(claimant));
  const sinceOk = since === null || validTime(since);
  const nudgedOk = nudgedAt === null || validTime(nudgedAt);
  if (!claimantOk || !sinceOk || !nudgedOk) return null;
  return { claimant: claimant as string | null, since: since as string | null, nudgedAt: nudgedAt as string | null };
}

/** The marker as the line the bot writes at the top of its comment. */
export function renderMarker(marker: Marker): string {
  const safe: Marker = {
    claimant: marker.claimant && LOGIN.test(marker.claimant) ? marker.claimant : null,
    since: validTime(marker.since) ? marker.since : null,
    nudgedAt: validTime(marker.nudgedAt) ? marker.nudgedAt : null,
  };
  return `<!-- claimable-bot:v1 ${JSON.stringify(safe)} -->`;
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const time = (iso: string | null | undefined) => (iso ? Date.parse(iso) : Number.NaN);

export function readState(
  issue: BotIssue,
  timeline: GhTimelineEvent[],
  comments: BotComment[],
  requesterClaims: number[] = [],
): State {
  const assignee = issue.assignees.find((a) => a !== null) ?? null;

  const bot = comments
    .filter((c) => c.user && c.user.type === "Bot" && /\[bot\]$/i.test(c.user.login))
    .map((c) => ({ commentId: c.id, marker: parseMarker(c.body), at: time(c.created_at) }))
    .filter((c): c is { commentId: number; marker: Marker; at: number } => c.marker !== null)
    .sort((a, b) => a.at - b.at)[0];

  // Only pull requests of this repository: a pull request elsewhere that merely
  // mentions the issue is not competition, and its number would link to the
  // wrong place in the bot's comment.
  const pullPrefix = `${issue.html_url.replace(/\/issues\/\d+\/?$/, "")}/pull/`.toLowerCase();
  const openPulls = new Map<number, OpenPull>();
  for (const event of timeline) {
    if (event.event !== "cross-referenced" && event.event !== "connected") continue;
    const source = event.source?.issue;
    if (!source?.pull_request) continue;
    if (!(source.pull_request.html_url || source.html_url || "").toLowerCase().startsWith(pullPrefix)) continue;
    if (source.state === "open") {
      openPulls.set(source.number, {
        number: source.number,
        url: source.pull_request.html_url || source.html_url,
        author: source.user?.login ?? "unknown",
      });
    } else {
      openPulls.delete(source.number);
    }
  }

  let holder: State["holder"] = null;
  let lastActivity: string | null = null;
  if (assignee) {
    const login = assignee.login;
    let since: string | null = null;
    if (bot?.marker.claimant && same(bot.marker.claimant, login)) since = bot.marker.since;
    if (!since) {
      const assigned = timeline.filter((e) => e.event === "assigned" && e.assignee && same(e.assignee.login, login));
      since = assigned.length > 0 ? (assigned[assigned.length - 1].created_at ?? null) : null;
    }
    holder = { login, since };

    const signs: number[] = [];
    if (since) signs.push(time(since));
    for (const c of comments) if (c.user && !isBotAuthor(c.user) && same(c.user.login, login)) signs.push(time(c.created_at));
    for (const e of timeline) {
      if (e.event === "referenced" && e.actor && same(e.actor.login, login)) signs.push(time(e.created_at));
      const src = e.source?.issue;
      if (e.event === "cross-referenced" && src?.pull_request && src.user && same(src.user.login, login)) signs.push(time(e.created_at));
    }
    const latest = Math.max(...signs.filter((n) => !Number.isNaN(n)));
    lastActivity = Number.isFinite(latest) ? new Date(latest).toISOString().replace(/\.\d{3}Z$/, "Z") : null;
  }

  return {
    number: issue.number,
    open: issue.state === "open",
    locked: issue.locked,
    isPull: issue.pull_request !== undefined,
    labels: labelNames(issue.labels),
    holder,
    lastActivity,
    openPulls: [...openPulls.values()],
    bot: bot ? { commentId: bot.commentId, marker: bot.marker } : null,
    requesterClaims,
  };
}

export const NO_MARKER: Marker = EMPTY_MARKER;
