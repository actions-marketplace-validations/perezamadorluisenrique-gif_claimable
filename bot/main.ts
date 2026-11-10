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
import { configPath, readConfig } from "../src/bot/config.ts";
import type { Outcome, Sender } from "../src/bot/apply.ts";
import { decide } from "../src/bot/decide.ts";
import { renderComment } from "../src/bot/messages.ts";
import { readState } from "../src/bot/state.ts";
import { DEFAULT_CONFIG } from "../src/bot/types.ts";
import type { Action, BotComment, BotConfig, BotIssue } from "../src/bot/types.ts";
import { getAllComments, getAllTimeline, getClaimedIssues, getFile, getHeldIssues, getIssue, getPermission, getRepo, now } from "../src/fetchers.ts";
import { configure } from "../src/github.ts";
import { parseRepo } from "../src/refs.ts";
import { mdInline } from "../src/report.ts";
import type { GhTimelineEvent, IssueRef } from "../src/types.ts";

type Env = Record<string, string | undefined>;

export type BotInputs = {
  token: string | null;
  /** Path of the configuration file inside the repository; null means the default. */
  config?: string | null;
  /** Anything but an explicit "false" keeps the bot from writing. */
  dryRun: boolean;
};

export function readInputs(env: Env): BotInputs {
  // Exactly "false" writes; anything else, a missing value included, only describes.
  return { token: (env.INPUT_TOKEN ?? "").trim() || null, config: (env.INPUT_CONFIG ?? "").trim() || null, dryRun: (env.INPUT_DRY_RUN ?? "true") !== "false" };
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

/**
 * The project's configuration, read from the default branch. A missing file is
 * the defaults. A file that exists but cannot be read (the API failed) stops
 * the bot for this run: acting on defaults could break a stricter rule the
 * project set.
 */
async function loadConfig(ref: IssueRef, input: string | null | undefined, override: Partial<BotConfig> | undefined): Promise<{ config: BotConfig; warnings: string[]; failed: boolean }> {
  const where = configPath(input ?? undefined);
  const warnings = where.warning ? [where.warning] : [];
  let source: string | null;
  try {
    source = await getFile(ref, where.path);
  } catch {
    return { config: { ...DEFAULT_CONFIG, ...override }, warnings: [...warnings, "The configuration file could not be read, so the bot does not act in this run."], failed: true };
  }
  const read = readConfig(source);
  return { config: { ...read.config, ...override }, warnings: [...warnings, ...read.warnings], failed: false };
}

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
  const loaded = await loadConfig(ref, inputs.config, deps.config);
  const config = loaded.config;
  const warnings: string[] = [...loaded.warnings];

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
  if (loaded.failed) {
    actions = [{ type: "none", reason: "the configuration could not be read, so the bot does not act" }];
  } else if (comments.truncated || timeline.truncated) {
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

  const outcomes = await applyActions(actions, ref, { dryRun, sender: deps.sender, messages: config.messages });
  return { summary: formatSummary(title, dryRun, outcomes, warnings, undefined, config.messages), actions, outcomes, warnings };
}

/** The most issues one daily visit looks at; the rest wait for tomorrow. */
export const TICK_LIMIT = 100;

/** The daily visit: for every open issue labelled `claimed`, remind or release if the holder went quiet. */
export async function handleTick(repoFullName: string, inputs: BotInputs, deps: Deps = {}): Promise<Run> {
  const repo = parseRepo(repoFullName);
  if (!repo) return nothing("The daily visit needs the repository (GITHUB_REPOSITORY).");
  const base: IssueRef = { owner: repo.owner, repo: repo.repo, number: 0 };
  const title = `${base.owner}/${base.repo}`;
  const loaded = await loadConfig(base, inputs.config, deps.config);
  if (loaded.failed) return { summary: formatSummary(title, true, [], loaded.warnings), actions: [], outcomes: [], warnings: loaded.warnings };
  const config = loaded.config;
  const warnings: string[] = [...loaded.warnings];

  let dryRun = inputs.dryRun;
  if (!dryRun && (await getRepo(base)).private === true) {
    dryRun = true;
    warnings.push("Private repository: the bot only reports what it would do here.");
  }

  const listed = await getClaimedIssues(base, config.claimedLabel);
  if (listed.truncated) warnings.push("More claimed issues than one visit reads; the oldest are looked at first.");
  const numbers = [...listed.numbers].sort((a, b) => a - b);
  if (numbers.length > TICK_LIMIT) warnings.push(`Only the first ${TICK_LIMIT} of ${numbers.length} claimed issues are visited today.`);

  const actions: Action[] = [];
  const outcomes: Outcome[] = [];
  let looked = 0;
  for (const number of numbers.slice(0, TICK_LIMIT)) {
    looked++;
    const ref: IssueRef = { ...base, number };
    const [issue, comments, timeline] = await Promise.all([getIssue(ref), getAllComments(ref), getAllTimeline(ref)]);
    if (comments.truncated || timeline.truncated) continue; // too long to read in full: not touched
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
    const state = readState(botIssue, timeline.items as GhTimelineEvent[], (comments.items as RawComment[]).map(toBotComment));
    const todo = decide({ kind: "tick" }, state, config, now()).filter((a) => a.type !== "none");
    if (todo.length === 0) continue;
    actions.push(...todo);
    const done = await applyActions(todo, ref, { dryRun, sender: deps.sender, messages: config.messages });
    outcomes.push(...done.map((o) => ({ ...o, note: `#${number}: ${o.note}` })));
  }
  const summary = formatSummary(title, dryRun, outcomes, warnings, `Visited ${looked} claimed issue${looked === 1 ? "" : "s"}; ${outcomes.length === 0 ? "none needed a reminder or a release" : "see below"}.`, config.messages);
  return { summary, actions, outcomes, warnings };
}

export function formatSummary(title: string, dryRun: boolean, outcomes: Outcome[], warnings: string[], intro?: string, messages: BotConfig["messages"] = {}): string {
  const out = [`## Claimable bot: ${mdInline(title)}`, ""];
  if (intro) out.push(intro, "");
  if (dryRun) out.push("_Dry run: nothing was written._", "");
  for (const w of warnings) out.push(`> ${mdInline(w)}`, "");
  for (const o of outcomes) {
    const mark = { done: "done", planned: "planned", skipped: "skipped", failed: "FAILED" }[o.status];
    out.push(`- **${mark}**: ${o.note}`);
  }
  for (const o of outcomes) {
    if (dryRun && o.action.type === "comment") {
      out.push("", "The comment would read:", "", "````markdown", renderComment(o.action.reply, o.action.marker, messages).trimEnd(), "````");
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
    const eventName = env.GITHUB_EVENT_NAME ?? "";
    const result =
      eventName === "schedule" || eventName === "workflow_dispatch"
        ? await handleTick(env.GITHUB_REPOSITORY ?? payload.repository?.full_name ?? "", inputs)
        : await handle(eventName, payload, inputs);
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
