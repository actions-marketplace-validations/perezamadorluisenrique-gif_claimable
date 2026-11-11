/**
 * The words of the bot's one comment.
 *
 * Short, plain, no exclamation marks. Everything that came from somebody else
 * (logins, labels) goes through `mdInline`, so a label called `<img src=x>` or a
 * login with markup in it cannot change how the comment renders. The person
 * addressed is mentioned with `@`; everybody else is named in bold, because a
 * bot that pings third parties on every edit is a bot nobody keeps.
 */

import { mdInline } from "../report.ts";
import { renderMarker } from "./state.ts";
import type { BotConfig, Marker, Reply } from "./types.ts";

export type Messages = BotConfig["messages"];

/** Outside text as plain text: Markdown syntax and invisible or direction-changing characters made inert. */
export function mdText(text: string, max = 60): string {
  const clean = text.replace(/\p{Cf}/gu, "");
  return mdInline(clean, max).replace(/[*_\[\]()!#~]/g, "\\$&");
}
const who = (login: string) => `**${mdText(login)}**`;
const to = (login: string) => `@${login.replace(/[^A-Za-z0-9-]/g, "")}`;
const from = (date: string | null) => (date ? ` since ${date}` : "");
const HOW = "Comment `/claim` to reserve an issue, `/unclaim` to release it, `/claim status` to see who holds it.";

/**
 * A project's own words for a reply, with `{user}`, `{since}`, `{nudge-date}`,
 * `{release-date}` and `{last-date}` filled in. The template comes from the
 * default branch's config file; what is filled in is a login with everything
 * but letters, digits and hyphens removed, or a date. Substitution runs once,
 * so a value can never bring a new placeholder in.
 */
function customBody(reply: Reply, messages: Messages): string | null {
  let template: string | undefined;
  let values: Record<string, string> = {};
  if (reply.kind === "claimed") {
    template = messages.claimed;
    values = { user: to(reply.claimant), since: reply.since, "nudge-date": reply.nudgeOn, "release-date": reply.releaseOn };
  } else if (reply.kind === "nudge") {
    template = messages.nudge;
    values = { user: to(reply.holder), "last-date": reply.lastOn, "release-date": reply.releaseOn };
  } else if (reply.kind === "expired") {
    template = messages.expired;
    values = { user: to(reply.former), "last-date": reply.lastOn };
  }
  if (!template) return null;
  return template.replace(/\r/g, "").replace(/\{([a-z-]+)\}/g, (all, name: string) => values[name] ?? all);
}

function body(reply: Reply, messages: Messages = {}): string {
  const own = customBody(reply, messages);
  if (own !== null) return own;
  switch (reply.kind) {
    case "hint":
      return `${to(reply.requester)} to reserve this issue, comment \`/claim\`. ${HOW}`;
    case "claimed":
      return [
        `${to(reply.claimant)} this issue is reserved for you as of ${reply.since}.`,
        `If there is no activity here by ${reply.nudgeOn} I will leave one reminder, and if there is still none by ${reply.releaseOn} the claim is released. A comment, a linked pull request or a commit that mentions the issue counts as activity. Comment \`/unclaim\` to release it yourself.`,
      ].join("\n\n");
    case "status":
      if (!reply.holder) return `Nobody holds this issue. Comment \`/claim\` to reserve it.`;
      if (reply.releaseOn === null) return `Held by ${who(reply.holder)}${from(reply.since)}. It was assigned by hand, so I will not release it.`;
      if (reply.nudgeOn === null) {
        return `Held by ${who(reply.holder)}${from(reply.since)}. I have left a reminder; without activity here the claim is released on ${reply.releaseOn}.`;
      }
      return `Held by ${who(reply.holder)}${from(reply.since)}. Reminder due ${reply.nudgeOn}; the claim is released on ${reply.releaseOn} unless there is activity here.`;
    case "released":
      return reply.by.toLowerCase() === reply.former.toLowerCase()
        ? `${who(reply.former)} released this issue. ${HOW}`
        : `The claim of ${who(reply.former)} was released by ${who(reply.by)}. ${HOW}`;
    case "nudge":
      return `${to(reply.holder)} there has been no activity on this issue since ${reply.lastOn}. This is the one reminder: if there is still none by ${reply.releaseOn} (a comment, a linked pull request, or a commit that mentions the issue) the claim is released so someone else can take it. Comment \`/unclaim\` to release it yourself.`;
    case "expired":
      return `The claim of ${who(reply.former)} was released: there was no activity since ${reply.lastOn} and the reminder went unanswered. ${HOW}`;
    case "held":
      return `${to(reply.requester)} this issue is held by ${who(reply.holder)}${from(reply.since)}, so I did not assign it. Comment \`/claim status\` to check on it later.`;
    case "pull-open":
      return `${to(reply.requester)} pull request #${reply.pull} by ${who(reply.author)} is already open against this issue, so I did not assign it.`;
    case "quota": {
      const list = reply.claims.map((n) => `#${n}`).join(", ");
      return `${to(reply.requester)} you already hold ${reply.claims.length} issue${reply.claims.length === 1 ? "" : "s"} here (${list}) and the limit is ${reply.limit}. Comment \`/unclaim\` on one of them to make room.`;
    }
    case "closed":
      return `${to(reply.requester)} this issue is closed, so it cannot be claimed.`;
    case "blocked":
      return `${to(reply.requester)} this issue is labelled ${who(reply.label)}, which means do not start yet, so I did not assign it.`;
    case "not-labelled":
      return `${to(reply.requester)} only issues with one of these labels can be claimed here: ${reply.labels.map((l) => who(l)).join(", ")}.`;
    case "not-holder":
      return `${to(reply.requester)} only ${who(reply.holder)} or a maintainer can release this claim.`;
  }
}

/** The whole comment: the marker on top, then the words. */
export function renderComment(reply: Reply, marker: Marker, messages: Messages = {}): string {
  return `${renderMarker(marker)}\n${body(reply, messages)}\n`;
}
