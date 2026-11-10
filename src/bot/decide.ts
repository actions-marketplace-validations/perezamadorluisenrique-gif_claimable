/**
 * What the bot does, as a pure function.
 *
 * `decide(event, state, config)` returns the actions to take and touches
 * nothing. That is the whole safety argument of the bot: the 49 recorded
 * threads in `test/bot-threads/` pin down every action it can take, and
 * `apply.ts` only carries them out.
 *
 * The order of the refusals is deliberate: facts about the issue come before
 * facts about the person (closed, then who holds it, then why it cannot be
 * held), so a refusal always names the thing that matters most.
 */

import { BLOCKING_LABEL } from "../checks/blocked-label.ts";
import { isBotAuthor, parseCommand } from "./commands.ts";
import type { State } from "./state.ts";
import { MAINTAINER_ASSOCIATIONS } from "./types.ts";
import type { Action, BotComment, BotConfig, BotEvent, Marker, Reply } from "./types.ts";
import { EMPTY_MARKER } from "./types.ts";

/** What `decide` is given: a comment event carries the comment itself. */
export type DecideEvent = Extract<BotEvent, { kind: "tick" }> | { kind: "comment"; comment: BotComment };

const DAY = 86_400_000;

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const dayOf = (isoTime: string | null) => (isoTime ? day(Date.parse(isoTime)) : null);

/**
 * When the reminder and the release are due, from the holder's last sign of
 * life. After a reminder, only the release is left; a sign of life after the
 * reminder starts the clock again.
 */
export function deadlines(
  lastActivity: string | null,
  nudgedAt: string | null,
  config: Pick<BotConfig, "nudgeDays" | "releaseDays">,
): { nudgeOn: string | null; releaseOn: string } | null {
  if (!lastActivity) return null;
  const last = Date.parse(lastActivity);
  if (nudgedAt && Date.parse(nudgedAt) >= last) {
    return { nudgeOn: null, releaseOn: day(Date.parse(nudgedAt) + config.releaseDays * DAY) };
  }
  const nudge = last + config.nudgeDays * DAY;
  return { nudgeOn: day(nudge), releaseOn: day(nudge + config.releaseDays * DAY) };
}

/** The marker to write: the existing one, with a reminder dropped if the holder has answered since. */
function carriedMarker(state: State): Marker {
  const marker = state.bot?.marker ?? EMPTY_MARKER;
  if (marker.nudgedAt && state.lastActivity && Date.parse(state.lastActivity) > Date.parse(marker.nudgedAt)) {
    return { ...marker, nudgedAt: null };
  }
  return { ...marker };
}

function comment(state: State, reply: Reply, marker: Marker = carriedMarker(state)): Action {
  return state.bot
    ? { type: "comment", mode: "edit", commentId: state.bot.commentId, reply, marker }
    : { type: "comment", mode: "create", reply, marker };
}

function statusReply(state: State, config: BotConfig): Reply {
  if (!state.holder) return { kind: "status", holder: null, since: null, nudgeOn: null, releaseOn: null };
  const tracked = state.labels.some((l) => same(l, config.claimedLabel));
  const due = tracked ? deadlines(state.lastActivity, carriedMarker(state).nudgedAt, config) : null;
  return {
    kind: "status",
    holder: state.holder.login,
    since: dayOf(state.holder.since),
    nudgeOn: due?.nudgeOn ?? null,
    releaseOn: due?.releaseOn ?? null,
  };
}

/**
 * The daily visit to a claimed issue: leave one reminder, later release.
 *
 * Every early return is a reason NOT to touch the claim, and they come first
 * on purpose. Only a claim the bot itself made (label, bot comment and marker
 * all naming the assignee) is ever released; an issue a maintainer assigned by
 * hand, or reassigned afterwards, is left alone. A holder who has an open pull
 * request is never nudged or released, however quiet the issue is.
 */
function decideTick(state: State, config: BotConfig, nowMs: number): Action[] {
  const none = (reason: string): Action[] => [{ type: "none", reason }];
  if (state.isPull) return none("this is a pull request, not an issue");
  if (!state.open) return none("the issue is closed");
  if (state.locked) return none("the issue is locked");
  const holder = state.holder;
  if (!holder) return none("nobody holds this issue");
  if (!state.labels.some((l) => same(l, config.claimedLabel))) return none("assigned by hand, not reserved with the bot");
  const marker = state.bot?.marker;
  if (!marker?.claimant || !same(marker.claimant, holder.login)) return none("the bot did not reserve it for the current assignee");
  if (!state.lastActivity) return none("the holder's activity cannot be dated");

  // A sign of life after the reminder starts the clock again. The comment still
  // says "reminder", so put it back to the plain status (an edit, no new notice).
  if (marker.nudgedAt && Date.parse(state.lastActivity) > Date.parse(marker.nudgedAt)) {
    return [comment(state, statusReply(state, config))];
  }
  if (state.openPulls.some((p) => same(p.author, holder.login))) return none("the holder has a pull request open");

  const today = day(nowMs);
  const lastOn = day(Date.parse(state.lastActivity));
  const due = deadlines(state.lastActivity, marker.nudgedAt, config)!;
  if (marker.nudgedAt) {
    if (today < due.releaseOn) return none(`waiting for the reminder to run out on ${due.releaseOn}`);
    return [
      { type: "unassign", login: holder.login },
      { type: "unlabel", name: config.claimedLabel },
      comment(state, { kind: "expired", former: holder.login, lastOn }, { ...EMPTY_MARKER }),
    ];
  }
  if (today < due.nudgeOn!) return none(`active enough: the reminder is due ${due.nudgeOn}`);
  return [
    comment(state, { kind: "nudge", holder: holder.login, lastOn, releaseOn: day(nowMs + config.releaseDays * DAY) }, { ...marker, nudgedAt: iso(nowMs) }),
  ];
}

export function decide(event: DecideEvent, state: State, config: BotConfig, nowMs: number): Action[] {
  if (event.kind === "tick") return decideTick(state, config, nowMs);

  const c = event.comment;
  if (!c.user || c.user.login.toLowerCase() === "ghost") return [{ type: "none", reason: "the author is a deleted account" }];
  if (isBotAuthor(c.user)) return [{ type: "none", reason: "the author is a bot" }];
  const requester = c.user.login;
  if (config.blockedUsers.some((u) => same(u, requester))) return [{ type: "none", reason: "the author is on the blocked list" }];
  if (state.isPull) return [{ type: "none", reason: "this is a pull request, not an issue" }];

  const command = parseCommand(c.body, c.user);
  if (!command) return [{ type: "none", reason: "no command" }];
  if (state.locked) return [{ type: "none", reason: "the issue is locked" }];

  const holder = state.holder;

  if (command.kind === "status") return [comment(state, statusReply(state, config))];

  if (command.kind === "unclaim") {
    if (!holder) return [{ type: "none", reason: "nobody holds this issue" }];
    const maintainer = (MAINTAINER_ASSOCIATIONS as readonly string[]).includes(c.author_association);
    if (!same(holder.login, requester) && !maintainer) {
      return [comment(state, { kind: "not-holder", requester, holder: holder.login })];
    }
    const actions: Action[] = [{ type: "unassign", login: holder.login }];
    if (state.labels.some((l) => same(l, config.claimedLabel))) actions.push({ type: "unlabel", name: config.claimedLabel });
    actions.push(comment(state, { kind: "released", by: requester, former: holder.login }, { ...EMPTY_MARKER }));
    return actions;
  }

  // claim
  if (!state.open) return [comment(state, { kind: "closed", requester })];

  if (holder) {
    if (same(holder.login, requester)) return [comment(state, statusReply(state, config))];
    return [comment(state, { kind: "held", requester, holder: holder.login, since: dayOf(holder.since) })];
  }

  const blocked =
    state.labels.find((l) => BLOCKING_LABEL.test(l)) ??
    state.labels.find((l) => config.blockedLabels.some((b) => same(b, l)));
  if (blocked !== undefined) return [comment(state, { kind: "blocked", requester, label: blocked })];

  if (config.labels.length > 0 && !state.labels.some((l) => config.labels.some((w) => same(w, l)))) {
    return [comment(state, { kind: "not-labelled", requester, labels: config.labels })];
  }

  const rival = state.openPulls.find((p) => !same(p.author, requester));
  if (rival) return [comment(state, { kind: "pull-open", requester, pull: rival.number, author: rival.author })];

  const exempt = config.exemptUsers.some((u) => same(u, requester));
  if (!exempt && state.requesterClaims.length >= config.maxClaims) {
    return [comment(state, { kind: "quota", requester, limit: config.maxClaims, claims: [...state.requesterClaims].sort((a, b) => a - b) })];
  }

  const marker: Marker = { claimant: requester, since: iso(nowMs), nudgedAt: null };
  const due = deadlines(iso(nowMs), null, config)!; // a fresh claim always has a last activity
  const actions: Action[] = [{ type: "assign", login: requester }];
  if (!state.labels.some((l) => same(l, config.claimedLabel))) actions.push({ type: "label", name: config.claimedLabel });
  actions.push(
    comment(state, { kind: "claimed", claimant: requester, since: day(nowMs), nudgeOn: due.nudgeOn ?? day(nowMs), releaseOn: due.releaseOn }, marker),
  );
  return actions;
}
