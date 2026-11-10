/**
 * Entry point of the claim bot Action (see action.yml next to this file).
 *
 * The comment that triggered the run is attacker-controlled text. It reaches
 * this code only as the event payload file (`GITHUB_EVENT_PATH`) and the INPUT_*
 * environment variables; nothing here evaluates it, runs it or puts it into a
 * path or a command. It is parsed for a command by `src/bot/commands.ts`, and
 * the only thing taken from it is the command's kind.
 *
 * The run never fails the workflow: whatever goes wrong becomes a warning and
 * a line in the job summary.
 */

import { appendFileSync, readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { applyActions } from "../src/bot/apply.ts";
import type { Outcome, Sender } from "../src/bot/apply.ts";
import { decide } from "../src/bot/decide.ts";
import { renderComment } from "../src/bot/messages.ts";
import { readState } from "../src/bot/state.ts";
import { DEFAULT_CONFIG } from "../src/bot/types.ts";
import type { Action, BotComment, BotConfig, BotIssue } from "../src/bot/types.ts";
import { getAllComments, getAllTimeline, getHeldIssues, getIssue, getPermission, now } from "../src/fetchers.ts";
import { configure } from "../src/github.ts";
import { parseRepo } from "../src/refs.ts";
import { mdInline } from "../src/report.ts";
import type { GhTimelineEvent, IssueRef } from "../src/types.ts";

type Env = Record<string, string | undefined>;

export type BotInputs = {
  token: string | null;
  /** Anything but an explicit "false" keeps the bot from writing. */
  dryRun: boolean;
};

export function readInputs(env: Env): BotInputs {
  // Exactly "false" writes; anything else, a missing value included, only describes.
  return { token: (env.INPUT_TOKEN ?? "").trim() || null, dryRun: (env.INPUT_DRY_RUN ?? "true") !== "false" };
}

/** The slice of a GitHub `issue_comment` event the bot reads. */
type Payload = {
  action?: string;
  issue?: { number?: number; pull_request?: unknown };
  comment?: RawComment;
  repository?: { full_name?: string; private?: boolean };
};

export type Run = {
  /** The Markdown for the job summary. */
  summary: string;
  actions: Action[];
  outcomes: Outcome[];
  warnings: string[];
};

export type Deps = {
  sender?: Sender;
  config?: Partial<BotConfig>;
};

function nothing(summary: string): Run {
  return { summary: `## Claimable bot\n\n${summary}\n`, actions: [], outcomes: [], warnings: [] };
}

type RawComment = {
  id?: number;
  body?: string | null;
  created_at?: string;
  author_association?: string;
  user?: { login?: string; type?: string } | null;
};

function toBotComment(c: RawComment): BotComment {
  const t = c.user?.type;
  const type = t === "Bot" || t === "Organization" || t === "Mannequin" ? t : "User";
  return {
    id: c.id ?? 0,
    user: c.user?.login ? { login: c.user.login, type } : null,
    author_association: c.author_association ?? "NONE",
    body: c.body ?? null,
    created_at: c.created_at ?? new Date(0).toISOString(),
  };
}

/** Handle one event. Reads from the API, decides, applies (or only describes, in dry-run). */
export async function handle(eventName: string, payload: Payload, inputs: BotInputs, deps: Deps = {}): Promise<Run> {
  if (eventName !== "issue_comment" || payload.action !== "created") {
    return nothing(`Nothing to do for \`${mdInline(eventName, 40)}\`${payload.action ? ` / \`${mdInline(payload.action, 40)}\`` : ""}: the bot reads new issue comments only.`);
  }
  if (payload.issue?.pull_request !== undefined) return nothing("The comment is on a pull request, not an issue.");
  const number = payload.issue?.number;
  const ref0 = parseRepo(payload.repository?.full_name ?? "");
  if (!number || !ref0 || !payload.comment) return nothing("The event has no issue, repository or comment to read.");

  const ref: IssueRef = { owner: ref0.owner, repo: ref0.repo, number };
  const title = `${ref.owner}/${ref.repo}#${ref.number}`;
  const config: BotConfig = { ...DEFAULT_CONFIG, ...deps.config };
  const warnings: string[] = [];

  // A private repository is report-only for now: acting there is the paid part.
  let dryRun = inputs.dryRun;
  if (payload.repository?.private === true && !dryRun) {
    dryRun = true;
    warnings.push("Private repository: the bot only reports what it would do here.");
  }

  const [issue, comments, timeline] = await Promise.all([getIssue(ref), getAllComments(ref), getAllTimeline(ref)]);
  const all: BotComment[] = (comments.items as RawComment[]).map(toBotComment);

  let actions: Action[];
  // The comment is read again from the API, never taken from the event: if it
  // was edited or deleted before this run started, the bot acts on what is there now.
  const trigger = all.find((c) => c.id === payload.comment?.id);
  if (comments.truncated || timeline.truncated) {
    actions = [{ type: "none", reason: "the thread is too long to read in full, so the bot does not act" }];
  } else if (!trigger) {
    actions = [{ type: "none", reason: "the comment is gone" }];
  } else {
    const botIssue: BotIssue = {
      number: issue.number,
      state: issue.state,
      locked: issue.locked === true,
      html_url: issue.html_url,
      title: issue.title,
      labels: issue.labels,
      assignees: issue.assignees ?? [],
      updated_at: issue.updated_at,
      ...(issue.pull_request === undefined ? {} : { pull_request: issue.pull_request }),
    };
    // "Maintainer" means able to triage this repository: a member of the
    // organisation, or a read-only collaborator, does not qualify.
    if (trigger.user && (trigger.author_association === "MEMBER" || trigger.author_association === "COLLABORATOR")) {
      const role = await getPermission(ref, trigger.user.login);
      if (!role || !["admin", "maintain", "write", "triage"].includes(role)) trigger.author_association = "NONE";
    }
    // What the author already holds matters only when they are about to claim.
    const held = trigger.user && /\/claim|\.take|\/assign/i.test(trigger.body ?? "")
      ? await getHeldIssues(ref, trigger.user.login, config.claimedLabel)
      : { numbers: [], truncated: false };
    if (held.truncated) {
      actions = [{ type: "none", reason: "the author holds too many issues to count, so the bot does not act" }];
    } else {
      const state = readState(botIssue, timeline.items as GhTimelineEvent[], all, held.numbers);
      actions = decide({ kind: "comment", comment: trigger }, state, config, now());
    }
  }

  const outcomes = await applyActions(actions, ref, { dryRun, sender: deps.sender });
  return { summary: formatSummary(title, dryRun, outcomes, warnings), actions, outcomes, warnings };
}

export function formatSummary(title: string, dryRun: boolean, outcomes: Outcome[], warnings: string[]): string {
  const out = [`## Claimable bot: ${mdInline(title)}`, ""];
  if (dryRun) out.push("_Dry run: nothing was written._", "");
  for (const w of warnings) out.push(`> ${mdInline(w)}`, "");
  for (const o of outcomes) {
    const mark = { done: "done", planned: "planned", skipped: "skipped", failed: "FAILED" }[o.status];
    out.push(`- **${mark}**: ${o.note}`);
  }
  for (const o of outcomes) {
    if (dryRun && o.action.type === "comment") {
      out.push("", "The comment would read:", "", "````markdown", renderComment(o.action.reply, o.action.marker).trimEnd(), "````");
    }
  }
  return `${out.join("\n")}\n`;
}

export async function run(env: Env): Promise<number> {
  const inputs = readInputs(env);
  try {
    configure({ token: inputs.token });
    const path = env.GITHUB_EVENT_PATH;
    if (!path) {
      process.stdout.write("::warning::GITHUB_EVENT_PATH is not set; the bot has no event to read\n");
      return 0;
    }
    const payload = JSON.parse(readFileSync(path, "utf8")) as Payload;
    const result = await handle(env.GITHUB_EVENT_NAME ?? "", payload, inputs);
    for (const w of result.warnings) process.stdout.write(`::notice::${oneLine(w)}\n`);
    for (const o of result.outcomes) if (o.status === "failed") process.stdout.write(`::warning::${oneLine(o.note)}\n`);
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, result.summary);
    else process.stdout.write(result.summary);
  } catch (err) {
    // The bot never breaks somebody else's workflow.
    process.stdout.write(`::warning::claimable bot stopped: ${oneLine(err)}\n`);
  }
  return 0;
}

function oneLine(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  run(process.env).then((code) => {
    process.exitCode = code;
  });
}
