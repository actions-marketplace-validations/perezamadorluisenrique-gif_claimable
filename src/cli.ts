#!/usr/bin/env node
/**
 * claimable — is this GitHub issue actually claimable?
 *
 * Run before you start work, not after.
 */

import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { analyze } from "./analyze.ts";
import { api, configure, hasToken, requestCount } from "./github.ts";
import { parseRef, parseRefs, parseRepo } from "./refs.ts";
import { formatDetail, formatLine, formatMarkdown, formatSummary } from "./report.ts";
import { CHECK_ORDER, refToString } from "./types.ts";
import type { CheckId, GhIssue, IssueRef, IssueReport } from "./types.ts";

const USAGE = `
claimable — tells you whether a GitHub issue is actually claimable.

  "unassigned" is not the same as "free". This runs the checks that a careful
  contributor runs by hand: is the repo alive, is a PR already open against the
  issue, is it on hold or an umbrella, has someone claimed it in the thread,
  does the fix depend on code that does not exist yet, can you even build the
  project, and what does the project demand before it accepts your work.

USAGE
  claimable <issue> [<issue> ...]
  <command that prints issues> | claimable -
  claimable --repo <owner/repo> [--label <label>] [--limit <n>]
  claimable --find "<GitHub issue search>" [--limit <n>]

ISSUE FORMS
  owner/repo#123
  https://github.com/owner/repo/issues/123
  -   read them from standard input, one per line, e.g.
      gh issue list -R owner/repo -l "good first issue" --json url -q '.[].url' | claimable -

OPTIONS
  --repo <owner/repo>   Scan open issues in a repository instead of named ones
  --label <label>       With --repo: only issues carrying this label (repeatable)
  --find <query>        Search GitHub for open, unassigned issues and run every
                        result through the filters, e.g.
                        --find 'label:hacktoberfest language:rust'
  --limit <n>           With --repo or --find: how many issues to scan (default 20)
  --api-url <url>       GitHub API base URL, for GitHub Enterprise Server, e.g.
                        https://ghe.example.com/api/v3 (default: $GITHUB_API_URL,
                        then https://api.github.com)
  --thorough            Run every filter even after one rules an issue out
  --hacktoberfest       Also check whether a PR here would count for Hacktoberfest
  --skip <check>        Skip a filter (repeatable). One of:
                        ${CHECK_ORDER.join(", ")}
  --json                Machine-readable output
  --markdown            Markdown report (for job summaries, issue bodies); not with --json
  --quiet               One line per issue, no detail
  --viable-only         Print only issues that survive every filter
  -h, --help            This text
  -V, --version         Print the version and exit

EXIT CODES
  0  at least one issue is viable (or, with a single issue, it is viable)
  1  nothing viable
  2  usage or network error
`;

type Options = {
  refs: string[];
  stdin: boolean;
  repo: string | null;
  find: string | null;
  labels: string[];
  limit: number;
  apiUrl: string | null;
  thorough: boolean;
  hacktoberfest: boolean;
  skip: CheckId[];
  json: boolean;
  markdown: boolean;
  quiet: boolean;
  viableOnly: boolean;
  help: boolean;
  version: boolean;
};

export function parseArgs(argv: string[]): Options {
  const opts: Options = {
    refs: [],
    stdin: false,
    repo: null,
    find: null,
    labels: [],
    limit: 20,
    apiUrl: null,
    thorough: false,
    hacktoberfest: false,
    skip: [],
    json: false,
    markdown: false,
    quiet: false,
    viableOnly: false,
    help: false,
    version: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      return value;
    };

    switch (arg) {
      case "-h":
      case "--help":
        opts.help = true;
        break;
      case "-V":
      case "--version":
        opts.version = true;
        break;
      case "--repo":
        opts.repo = next();
        break;
      case "--find":
        opts.find = next();
        break;
      case "--label":
        opts.labels.push(next());
        break;
      case "--limit": {
        const value = Number(next());
        if (!Number.isInteger(value) || value < 1) throw new Error("--limit needs a positive integer");
        opts.limit = value;
        break;
      }
      case "--api-url":
        opts.apiUrl = next();
        break;
      case "--thorough":
        opts.thorough = true;
        break;
      case "--hacktoberfest":
        opts.hacktoberfest = true;
        break;
      case "--skip": {
        const value = next() as (typeof CHECK_ORDER)[number];
        if (!CHECK_ORDER.includes(value)) {
          throw new Error(`unknown check "${value}" — expected one of ${CHECK_ORDER.join(", ")}`);
        }
        opts.skip.push(value);
        break;
      }
      case "--json":
        opts.json = true;
        break;
      case "--markdown":
        opts.markdown = true;
        break;
      case "--quiet":
        opts.quiet = true;
        break;
      case "--viable-only":
        opts.viableOnly = true;
        break;
      case "-":
        opts.stdin = true;
        break;
      default:
        if (arg.startsWith("-")) throw new Error(`unknown option "${arg}"`);
        opts.refs.push(arg);
    }
  }

  if (opts.json && opts.markdown) throw new Error("--json and --markdown are alternatives; pick one");
  return opts;
}

/**
 * The published version, read from the manifest rather than duplicated here —
 * a hard-coded string is one `npm version` away from lying, and a bug report
 * that names the wrong version wastes the reporter's time and mine.
 *
 * `../package.json` resolves from both layouts: `src/cli.ts` in the repository
 * and `dist/cli.js` in the installed package.
 */
function version(): string {
  try {
    const manifest = fileURLToPath(new URL("../package.json", import.meta.url));
    const parsed: unknown = JSON.parse(readFileSync(manifest, "utf8"));
    if (typeof parsed === "object" && parsed !== null && "version" in parsed) {
      const value = (parsed as { version: unknown }).version;
      if (typeof value === "string") return value;
    }
  } catch {
    // Fall through: a missing or unreadable manifest is not worth a crash in a
    // flag whose whole job is to help somebody file a report.
  }
  return "unknown";
}

export async function listRepoIssues(repo: string, labels: string[], limit: number): Promise<IssueRef[]> {
  const parsed = parseRepo(repo);
  if (!parsed) throw new Error(`--repo expects owner/repo, got "${repo}"`);

  // /issues returns pull requests too, so a page holds fewer issues than its
  // size. Page until `limit` issues are collected or the repository runs out,
  // sequentially (parallel requests trip the secondary rate limit) and stopping
  // as soon as there are enough: anonymous runs only get 60 requests an hour.
  const perPage = Math.min(Math.max(limit, 30), 100);
  const refs: IssueRef[] = [];
  for (let page = 1; refs.length < limit; page++) {
    const params = new URLSearchParams({ state: "open", per_page: String(perPage), page: String(page) });
    if (labels.length > 0) params.set("labels", labels.join(","));

    const items = await api<GhIssue[]>(`/repos/${parsed.owner}/${parsed.repo}/issues?${params}`);
    for (const issue of items) {
      if (issue.pull_request) continue;
      refs.push({ owner: parsed.owner, repo: parsed.repo, number: issue.number });
      if (refs.length === limit) break;
    }
    if (items.length < perPage) break; // last page
  }
  return refs;
}

/**
 * The search a `--find` runs, made explicit.
 *
 * GitHub's issue search returns pull requests, closed issues and assigned
 * issues unless told otherwise, and every one of those would cost a full set
 * of filter requests only to be discarded. So the cheap exclusions go into the
 * query — unless the caller already said something about them, in which case
 * their words win.
 */
export function buildFindQuery(query: string): string {
  const parts = [query.trim()];
  const has = (pattern: RegExp) => pattern.test(query);
  if (!has(/\bis:(issue|pr|pull-request)\b|\btype:(issue|pr)\b/i)) parts.push("is:issue");
  if (!has(/\b(is|state):(open|closed)\b/i)) parts.push("is:open");
  if (!has(/\b(no:assignee|assignee:)/i)) parts.push("no:assignee");
  if (!has(/\barchived:/i)) parts.push("archived:false");
  return parts.filter(Boolean).join(" ");
}

/** Search hits carry the repository only as an API URL. */
export function refFromSearchHit(hit: { number: number; repository_url: string }): IssueRef | null {
  const match = hit.repository_url.match(/\/repos\/([^/]+)\/([^/]+)$/);
  return match ? { owner: match[1], repo: match[2], number: hit.number } : null;
}

export async function findIssues(query: string, limit: number): Promise<IssueRef[]> {
  const q = buildFindQuery(query);
  const perPage = Math.min(limit, 100);
  const refs: IssueRef[] = [];

  // Search pages are 100 at most and stop at 1000 results. Pages are fetched
  // only while more are needed, since search has the strictest rate limit
  // GitHub has.
  for (let page = 1; refs.length < limit && page <= 10; page++) {
    const result = await api<{ total_count: number; items: { number: number; repository_url: string; pull_request?: unknown }[] }>(
      `/search/issues?q=${encodeURIComponent(q)}&per_page=${perPage}&page=${page}`,
    );
    for (const hit of result.items) {
      if (hit.pull_request) continue;
      const ref = refFromSearchHit(hit);
      if (ref) refs.push(ref);
    }
    if (result.items.length < perPage) break;
  }
  return refs.slice(0, limit);
}

/**
 * Issue references from piped text: the first thing on each line that reads as
 * one. Lines are what `gh`, `grep` and `jq` produce, and taking the first
 * reference per line means a line with a title after the URL still works.
 */
export function refsFromText(text: string): { found: string[]; unreadable: string[] } {
  const found: string[] = [];
  const unreadable: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const token = trimmed.split(/\s+/).find((t) => parseRef(t) !== null);
    if (token) found.push(token);
    else unreadable.push(trimmed);
  }
  return { found, unreadable };
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * A progress line goes to stderr, only for a person watching a terminal: not in
 * a pipe or CI log, not with --json, and not on a dumb terminal that cannot
 * rewrite a line. NO_COLOR is deliberately not a reason: it asks for no
 * colour, and this line has none.
 */
export function shouldShowProgress(
  env: Record<string, string | undefined>,
  stderrIsTTY: boolean,
  json: boolean,
): boolean {
  return stderrIsTTY && !json && env.TERM !== "dumb";
}

async function main(argv: string[]): Promise<number> {
  // The published JavaScript runs on Node 18 and later; CI runs it on each
  // even-numbered release from there. Older than that, the first sign would
  // be "fetch is not defined" from deep inside a filter, so say it plainly.
  if (typeof fetch !== "function") {
    process.stderr.write(`claimable needs Node 18 or newer, and this is Node ${process.versions.node}.\n`);
    return 2;
  }

  let opts: Options;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n\nRun claimable --help\n`);
    return 2;
  }

  if (opts.version) {
    process.stdout.write(`${version()}\n`);
    return 0;
  }

  if (opts.apiUrl !== null) configure({ apiUrl: opts.apiUrl });

  if (opts.stdin) {
    if (process.stdin.isTTY) {
      process.stderr.write("claimable - reads issue references from a pipe, and nothing is piped in.\n\nRun claimable --help\n");
      return 2;
    }
    const { found, unreadable } = refsFromText(await readStdin());
    if (unreadable.length > 0) {
      process.stderr.write(`Skipped ${unreadable.length} line${unreadable.length === 1 ? "" : "s"} with no issue reference, starting with: ${unreadable[0]}\n`);
    }
    if (found.length === 0) {
      process.stderr.write("No issue references came in on standard input.\n");
      return 2;
    }
    opts.refs.push(...found);
  }

  if (opts.help || (opts.refs.length === 0 && opts.repo === null && opts.find === null)) {
    process.stdout.write(USAGE);
    return opts.help ? 0 : 2;
  }

  let targets: IssueRef[] = [];

  if (opts.find !== null) {
    if (opts.repo || opts.refs.length > 0) {
      process.stderr.write("--find searches for issues itself; pass it without --repo or issue references\n\nRun claimable --help\n");
      return 2;
    }
    if (!opts.json) process.stderr.write(`Searching: ${buildFindQuery(opts.find)}\n`);
    targets = await findIssues(opts.find, opts.limit);
    if (targets.length === 0) {
      process.stderr.write("No open, unassigned issues matched that search.\n");
      return 1;
    }
    if (!opts.json) process.stderr.write(`Checking ${targets.length} issue${targets.length === 1 ? "" : "s"}…\n\n`);
  } else if (opts.repo) {
    targets = await listRepoIssues(opts.repo, opts.labels, opts.limit);
    if (targets.length === 0) {
      process.stderr.write(`No open issues found in ${opts.repo}${opts.labels.length ? ` with label(s) ${opts.labels.join(", ")}` : ""}.\n`);
      return 1;
    }
  } else {
    const { refs, invalid } = parseRefs(opts.refs);
    if (invalid.length > 0) {
      process.stderr.write(`Could not parse: ${invalid.join(", ")}\nExpected owner/repo#123 or a GitHub issue URL.\n`);
      return 2;
    }
    targets = refs;
  }

  if (!hasToken() && targets.length > 3 && !opts.json) {
    process.stderr.write(
      "Note: no GitHub token found, so this runs at 60 requests/hour and may stop partway.\n" +
        "      Run `gh auth login` or set GITHUB_TOKEN to raise that to 5000.\n\n",
    );
  }

  const progress = targets.length > 1 && shouldShowProgress(process.env, process.stderr.isTTY === true, opts.json || opts.markdown);
  const clearProgress = () => {
    if (progress) process.stderr.write("\r\x1b[K");
  };

  const reports: IssueReport[] = [];
  for (const [index, ref] of targets.entries()) {
    if (progress) process.stderr.write(`\r\x1b[Kscanning ${index + 1}/${targets.length}  ${refToString(ref)}`);
    // Sequential on purpose. Parallel requests trip GitHub's secondary rate
    // limit, and scanning forty issues slightly slower beats being blocked for
    // an hour halfway through.
    const report = await analyze(ref, { thorough: opts.thorough, skip: opts.skip, hacktoberfest: opts.hacktoberfest });
    reports.push(report);
    clearProgress();

    if (opts.json || opts.markdown) continue;
    if (opts.viableOnly && report.verdict !== "viable") continue;
    // A search is a scan: one line per result as it comes in, and the full
    // detail only for the ones worth reading, once the scan is over.
    const scanView = opts.quiet || opts.find !== null;
    process.stdout.write(scanView ? `${formatLine(report)}\n` : formatDetail(report));
  }

  if (opts.find !== null && !opts.json && !opts.markdown && !opts.quiet) {
    const viable = reports.filter((r) => r.verdict === "viable");
    for (const report of viable) process.stdout.write(formatDetail(report));
    if (viable.length === 0 && reports.some((r) => r.verdict === "reservations")) {
      process.stdout.write("\nNothing cleared every filter. Run claimable <issue> on a CAUTION line for the full detail.\n");
    }
  }

  if (opts.json) {
    process.stdout.write(`${JSON.stringify(reports, null, 2)}\n`);
  } else if (opts.markdown) {
    const heading = opts.repo ? `claimable: ${opts.repo}` : opts.find ? `claimable: search \`${opts.find.replace(/`/g, "")}\`` : "claimable";
    process.stdout.write(
      `${formatMarkdown(reports, { heading, rows: opts.viableOnly ? (r) => r.verdict === "viable" : undefined })}\n`,
    );
  } else if (reports.length > 1) {
    process.stdout.write(formatSummary(reports));
    if (process.env.CLAIMABLE_DEBUG) {
      process.stdout.write(`${requestCount()} API requests\n`);
    }
  }

  return reports.some((r) => r.verdict === "viable") ? 0 : 1;
}

/**
 * Is this file being run, or imported?
 *
 * The obvious comparison — `import.meta.filename === process.argv[1]` — is
 * wrong for an installed package, and wrong in the worst possible way. npm
 * puts a symlink in `node_modules/.bin`, so `npx claimable` runs with
 * `argv[1]` pointing at the link while `import.meta.filename` is already
 * resolved to its target. They never match, `main` never runs, and the
 * command exits 0 having printed nothing: a silent success that looks like
 * the tool considered your issue and had no opinion.
 *
 * So both sides are resolved before they are compared. `realpath` can throw
 * (a deleted or unreadable argv[1]); running is the safer answer there, since
 * the failure mode of a false negative is the silent no-op above.
 */
function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return entry === import.meta.filename;
  }
}

if (invokedDirectly()) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      process.exitCode = 2;
    });
}

export { main };
