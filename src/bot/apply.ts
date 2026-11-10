/**
 * Carrying out what `decide` chose: the only part of the bot that writes.
 *
 * Three promises, in order of importance:
 *   1. In `dry-run` nothing is written; the actions are only described.
 *   2. A failure never raises. A 403 (no permission), a 404 (issue gone) or a
 *      422 comes back as an outcome for the job summary, because a bot that
 *      turns somebody's CI red is a bot they uninstall.
 *   3. It never says something that is not true. If GitHub does not accept the
 *      assignment (the person cannot be assigned here), the steps after it,
 *      label and "reserved" comment included, are not run.
 */

import { HttpError, send } from "../github.ts";
import { mdInline } from "../report.ts";
import { renderComment } from "./messages.ts";
import type { Action } from "./types.ts";

export type Sender = <T = unknown>(method: "POST" | "PATCH" | "DELETE", path: string, body?: unknown) => Promise<T>;

export type ApplyContext = { owner: string; repo: string; number: number };

export type Outcome = {
  action: Action;
  status: "done" | "planned" | "skipped" | "failed";
  note: string;
};

const LABEL_COLOR = "0e8a16";
const LABEL_DESCRIPTION = "Reserved with /claim";

function describe(action: Action): string {
  switch (action.type) {
    case "assign":
      return `assign ${mdInline(action.login, 60)}`;
    case "unassign":
      return `unassign ${mdInline(action.login, 60)}`;
    case "label":
      return `add the label ${mdInline(action.name, 60)}`;
    case "unlabel":
      return `remove the label ${mdInline(action.name, 60)}`;
    case "comment":
      return action.mode === "edit" ? `edit the bot comment (${action.reply.kind})` : `post the bot comment (${action.reply.kind})`;
    case "none":
      return `do nothing: ${mdInline(action.reason)}`;
  }
}

function why(err: unknown): string {
  if (err instanceof HttpError) {
    if (err.status === 403) return "GitHub answered 403: the token cannot write here (does the workflow have `issues: write`?)";
    if (err.status === 404) return "GitHub answered 404: the issue, comment or label is gone";
    if (err.status === 422) return "GitHub answered 422: it did not accept the change";
    return `GitHub answered ${err.status || "no response"}`;
  }
  return "unexpected error";
}

export async function applyActions(
  actions: Action[],
  ctx: ApplyContext,
  opts: { dryRun: boolean; sender?: Sender },
): Promise<Outcome[]> {
  const call = opts.sender ?? (send as Sender);
  const base = `/repos/${ctx.owner}/${ctx.repo}`;
  const issue = `${base}/issues/${ctx.number}`;
  const outcomes: Outcome[] = [];
  let stopped = false;

  for (const action of actions) {
    if (action.type === "none") {
      outcomes.push({ action, status: "skipped", note: describe(action) });
      continue;
    }
    if (stopped) {
      outcomes.push({ action, status: "skipped", note: `skipped, an earlier step did not go through: ${describe(action)}` });
      continue;
    }
    if (opts.dryRun) {
      outcomes.push({ action, status: "planned", note: `would ${describe(action)}` });
      continue;
    }

    try {
      switch (action.type) {
        case "assign": {
          const res = await call<{ assignees?: { login: string }[] }>("POST", `${issue}/assignees`, { assignees: [action.login] });
          const took = (res?.assignees ?? []).some((a) => a.login.toLowerCase() === action.login.toLowerCase());
          if (!took) {
            outcomes.push({ action, status: "failed", note: `GitHub did not assign ${mdInline(action.login, 60)} (that account cannot be assigned here)` });
            stopped = true;
            continue;
          }
          break;
        }
        case "unassign":
          await call("DELETE", `${issue}/assignees`, { assignees: [action.login] });
          break;
        case "label":
          try {
            await call("POST", `${issue}/labels`, { labels: [action.name] });
          } catch (err) {
            if (!(err instanceof HttpError) || (err.status !== 404 && err.status !== 422)) throw err;
            await call("POST", `${base}/labels`, { name: action.name, color: LABEL_COLOR, description: LABEL_DESCRIPTION });
            await call("POST", `${issue}/labels`, { labels: [action.name] });
          }
          break;
        case "unlabel":
          try {
            await call("DELETE", `${issue}/labels/${encodeURIComponent(action.name)}`);
          } catch (err) {
            if (!(err instanceof HttpError) || err.status !== 404) throw err;
          }
          break;
        case "comment": {
          const text = renderComment(action.reply, action.marker);
          if (action.mode === "edit" && action.commentId) await call("PATCH", `${base}/issues/comments/${action.commentId}`, { body: text });
          else await call("POST", `${issue}/comments`, { body: text });
          break;
        }
      }
      outcomes.push({ action, status: "done", note: describe(action) });
    } catch (err) {
      outcomes.push({ action, status: "failed", note: `could not ${describe(action)}: ${why(err)}` });
      stopped = true;
    }
  }
  return outcomes;
}
