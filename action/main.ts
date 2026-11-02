/**
 * Entry point of the GitHub Action (see ../action.yml).
 *
 * Inputs arrive only as INPUT_* environment variables, never interpolated into
 * a shell line. Run it locally the same way:
 *   INPUT_REPO=owner/repo node action/main.ts
 */

import { appendFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { analyze } from "../src/analyze.ts";
import { listRepoIssues } from "../src/cli.ts";
import { configure } from "../src/github.ts";
import { parseRepo } from "../src/refs.ts";
import { countVerdicts, formatMarkdown } from "../src/report.ts";
import type { VerdictCounts } from "../src/report.ts";
import { CHECK_ORDER } from "../src/types.ts";
import type { CheckId, IssueReport } from "../src/types.ts";

export type FailOn = "never" | "no-viable" | "any-discard" | "any-not-viable";
const FAIL_ON: FailOn[] = ["never", "no-viable", "any-discard", "any-not-viable"];

export type ActionInputs = {
  repo: string;
  labels: string[];
  limit: number;
  token: string | null;
  skip: CheckId[];
  thorough: boolean;
  failOn: FailOn;
};

type Env = Record<string, string | undefined>;

export function readInputs(env: Env): ActionInputs {
  const repo = (env.INPUT_REPO ?? "").trim();
  if (!parseRepo(repo)) throw new Error(`repo must be owner/repo, got "${repo}"`);

  const limitText = (env.INPUT_LIMIT ?? "20").trim();
  const limit = Number(limitText);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error(`limit must be an integer from 1 to 100, got "${limitText}"`);

  const skip = (env.INPUT_SKIP ?? "").split(/[\s,]+/).filter(Boolean) as CheckId[];
  for (const s of skip) {
    if (!(CHECK_ORDER as string[]).includes(s)) throw new Error(`unknown check "${s}" in skip; expected one of ${CHECK_ORDER.join(", ")}`);
  }

  const failOn = (env.INPUT_FAIL_ON ?? "never").trim() as FailOn;
  if (!FAIL_ON.includes(failOn)) throw new Error(`fail-on must be one of ${FAIL_ON.join(", ")}, got "${failOn}"`);

  const label = (env.INPUT_LABEL ?? "").trim();
  return {
    repo,
    labels: label ? [label] : [],
    limit,
    token: (env.INPUT_TOKEN ?? "").trim() || null,
    skip,
    thorough: (env.INPUT_THOROUGH ?? "").trim().toLowerCase() === "true",
    failOn,
  };
}

export function failureReason(failOn: FailOn, c: VerdictCounts): string | null {
  if (failOn === "no-viable" && c.viable === 0) return "no issue is viable";
  if (failOn === "any-discard" && c.discard > 0) return `${c.discard} issue(s) are already taken or blocked`;
  if (failOn === "any-not-viable" && c.viable < c.total) return `${c.total - c.viable} issue(s) are not viable`;
  return null;
}

/** One GITHUB_OUTPUT entry; a heredoc delimiter when the value spans lines. */
export function outputBlock(name: string, value: string): string {
  if (!/[\r\n]/.test(value)) return `${name}=${value}\n`;
  let delimiter = "CLAIMABLE_EOF";
  while (value.includes(delimiter)) delimiter += "_X";
  return `${name}<<${delimiter}\n${value}\n${delimiter}\n`;
}

export async function run(env: Env): Promise<number> {
  let inputs: ActionInputs;
  try {
    inputs = readInputs(env);
  } catch (err) {
    process.stdout.write(`::error::${oneLine(err)}\n`);
    return 1;
  }

  try {
    // A token given explicitly wins; an empty one means anonymous (never `gh auth token`).
    configure({ token: inputs.token });
    const refs = await listRepoIssues(inputs.repo, inputs.labels, inputs.limit);
    const reports: IssueReport[] = [];
    // Sequential on purpose: parallel requests trip the secondary rate limit.
    for (const ref of refs) reports.push(await analyze(ref, { thorough: inputs.thorough, skip: inputs.skip }));

    const counts = countVerdicts(reports);
    const label = inputs.labels[0];
    const heading = `claimable: ${inputs.repo}${label ? ` · label \`${label.replace(/`/g, "")}\`` : ""}`;
    const md =
      reports.length === 0
        ? `## ${heading}\n\nNo open issues${label ? ` with label \`${label.replace(/`/g, "")}\`` : ""}.\n`
        : formatMarkdown(reports, { heading, footer: "A snapshot, not a promise: read the thread before you start." });

    const dir = env.RUNNER_TEMP || tmpdir();
    const jsonPath = join(dir, "claimable.json");
    const mdPath = join(dir, "claimable.md");
    writeFileSync(jsonPath, `${JSON.stringify(reports, null, 2)}\n`);
    writeFileSync(mdPath, md);

    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${md}\n`);
    else process.stdout.write(`${md}\n`);

    const urls = (v: IssueReport["verdict"]) => JSON.stringify(reports.filter((r) => r.verdict === v).map((r) => r.url));
    const outputs: [string, string][] = [
      ["total", String(counts.total)],
      ["viable", String(counts.viable)],
      ["caution", String(counts.caution)],
      ["discard", String(counts.discard)],
      ["viable-issues", urls("viable")],
      ["discard-issues", urls("discard")],
      ["report-json", jsonPath],
      ["markdown", mdPath],
    ];
    if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, outputs.map(([k, v]) => outputBlock(k, v)).join(""));

    const reason = failureReason(inputs.failOn, counts);
    if (reason) {
      process.stdout.write(`::error::${reason}\n`);
      return 1;
    }
    return 0;
  } catch (err) {
    process.stdout.write(`::error::${oneLine(err)}\n`);
    return 1;
  }
}

function oneLine(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).replace(/\r?\n/g, " ").replace(/%/g, "%25");
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

