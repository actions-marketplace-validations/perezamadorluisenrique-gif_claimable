/**
 * Turning reports into something a person reads at 1 a.m. and believes.
 *
 * Two rules the output obeys:
 *   - Never state a verdict without the reason next to it.
 *   - Never state a reason without somewhere to go and check it.
 */

import type { CheckId, Finding, IssueReport, Severity } from "./types.ts";
import { refToString } from "./types.ts";

/**
 * Colour is for terminals, not for files — but "is this a terminal?" is the
 * wrong question when the output is being piped somewhere that renders it
 * anyway (`less -R`, a CI log, a recorded demo). So the two standard overrides
 * win over the TTY check in both directions, `NO_COLOR` first.
 *
 * Exported pure so the precedence is testable without a pseudo-terminal.
 */
export function shouldUseColour(
  env: Record<string, string | undefined>,
  isTTY: boolean,
): boolean {
  if (env.NO_COLOR !== undefined) return false;
  if (env.TERM === "dumb") return false;
  if (env.FORCE_COLOR !== undefined) return env.FORCE_COLOR !== "0";
  if (env.CLICOLOR_FORCE !== undefined) return env.CLICOLOR_FORCE !== "0";
  return isTTY;
}

const useColour = shouldUseColour(process.env, process.stdout.isTTY === true);

const ESC = String.fromCharCode(27);
const paint = (code: string, text: string) => (useColour ? `${ESC}[${code}m${text}${ESC}[0m` : text);

const dim = (t: string) => paint("2", t);
const bold = (t: string) => paint("1", t);
const red = (t: string) => paint("31", t);
const yellow = (t: string) => paint("33", t);
const green = (t: string) => paint("32", t);

const MARK: Record<Severity, string> = {
  blocker: red("×"),
  warning: yellow("!"),
  info: dim("·"),
  ok: green("✓"),
};

const CHECK_LABEL: Record<CheckId, string> = {
  "repo-alive": "repo alive",
  "existing-pr": "existing PR",
  "blocked-label": "blocked / umbrella",
  claimants: "claimants",
  prerequisites: "prerequisites",
  environment: "environment",
  "claim-protocol": "claim protocol",
  hacktoberfest: "hacktoberfest",
};

function verdictLabel(report: IssueReport): string {
  if (report.verdict === "discard") return red(bold("DISCARD"));
  if (report.verdict === "reservations") return yellow(bold("CAUTION"));
  return green(bold("VIABLE "));
}

/** One line per issue — the scan view. */
export function formatLine(report: IssueReport): string {
  const ref = bold(refToString(report.ref).padEnd(38));
  return `${verdictLabel(report)}  ${ref}  ${dim(report.reason)}`;
}

/** Everything known about one issue — the inspect view. */
export function formatDetail(report: IssueReport, opts: { showOk?: boolean } = {}): string {
  const lines: string[] = [];
  lines.push("");
  lines.push(`${verdictLabel(report)}  ${bold(refToString(report.ref))}  ${report.title}`);
  lines.push(`         ${dim(report.url)}`);
  lines.push("");
  lines.push(`  ${bold("Why:")} ${report.reason}`);
  lines.push("");

  const shown = opts.showOk
    ? report.findings
    : report.findings.filter((f) => f.severity !== "ok" || report.verdict === "viable");

  const byCheck = new Map<CheckId, Finding[]>();
  for (const finding of shown) {
    const list = byCheck.get(finding.check);
    if (list) list.push(finding);
    else byCheck.set(finding.check, [finding]);
  }

  for (const [check, findings] of byCheck) {
    lines.push(`  ${dim(CHECK_LABEL[check])}`);
    for (const finding of findings) {
      lines.push(`    ${MARK[finding.severity]} ${finding.message}`);
      for (const evidence of finding.evidence ?? []) {
        lines.push(`      ${dim(evidence)}`);
      }
    }
  }

  // Filters that could not run are listed, always. A check that silently did
  // not happen is indistinguishable from a check that passed, and that is the
  // one way this tool could quietly mislead someone.
  const notRun = report.skipped.filter((s) => !s.why.startsWith("not run"));
  const shortCircuited = report.skipped.filter((s) => s.why.startsWith("not run"));

  if (notRun.length > 0) {
    lines.push("");
    lines.push(`  ${yellow("Could not check:")}`);
    for (const skip of notRun) {
      lines.push(`    ${yellow("?")} ${CHECK_LABEL[skip.check]} — ${skip.why}`);
    }
  }

  if (shortCircuited.length > 0) {
    lines.push("");
    lines.push(
      dim(`  Not run (already ruled out): ${shortCircuited.map((s) => CHECK_LABEL[s.check]).join(", ")} — use --thorough to run them anyway`),
    );
  }

  lines.push("");
  return lines.join("\n");
}

export type VerdictCounts = { total: number; viable: number; caution: number; discard: number };

export function countVerdicts(reports: IssueReport[]): VerdictCounts {
  const count = (v: IssueReport["verdict"]) => reports.filter((r) => r.verdict === v).length;
  return { total: reports.length, viable: count("viable"), caution: count("reservations"), discard: count("discard") };
}

export function formatSummary(reports: IssueReport[]): string {
  const { viable, caution, discard } = countVerdicts(reports);
  return dim(
    `\n${reports.length} checked — ${green(`${viable} viable`)}, ${yellow(`${caution} caution`)}, ${red(`${discard} discard`)}\n`,
  );
}

/**
 * Text written by strangers (issue titles, comment-derived reasons) goes into a
 * Markdown table that may be pasted into an issue: neutralise anything that
 * breaks the table, injects HTML, or pings people.
 */
export function mdInline(text: string, max = 300): string {
  let t = text.replace(/\r?\n|\r/g, " ").trim();
  if (t.length > max) t = `${t.slice(0, max - 1)}…`;
  return t
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/`/g, "\\`")
    .replace(/(^|[^\w`])@(?=[\w-])/g, "$1@\u200b");
}

export type MarkdownOptions = {
  heading?: string;
  /** Which reports get a collapsible detail block. Default: everything not discarded. */
  details?: "all" | "not-discard" | "none";
  rows?: (r: IssueReport) => boolean;
  footer?: string;
};

const MD_WORD: Record<IssueReport["verdict"], string> = { viable: "VIABLE", reservations: "CAUTION", discard: "DISCARD" };
const MD_ORDER: IssueReport["verdict"][] = ["viable", "reservations", "discard"];
const MAX_DETAILS = 50;

function mdLink(url: string): string {
  return /^https?:\/\/\S+$/.test(url) ? `<${url.replace(/>/g, "%3E")}>` : mdInline(url);
}

/** The same report as Markdown: for a job summary, an issue body, a PR comment. */
export function formatMarkdown(reports: IssueReport[], opts: MarkdownOptions = {}): string {
  const c = countVerdicts(reports);
  const out: string[] = [];
  out.push(`## ${opts.heading ?? "claimable"}`, "");
  if (reports.length === 0) {
    out.push("No issues checked.", "");
    return out.join("\n");
  }
  out.push(`**${c.total} checked: ${c.viable} viable, ${c.caution} caution, ${c.discard} discard**`, "");

  const sorted = MD_ORDER.flatMap((v) => reports.filter((r) => r.verdict === v)).filter((r) => !opts.rows || opts.rows(r));
  out.push("| Verdict | Issue | Why |", "|---|---|---|");
  for (const r of sorted) {
    out.push(`| **${MD_WORD[r.verdict]}** | [${mdInline(refToString(r.ref))}](${r.url}) ${mdInline(r.title, 120)} | ${mdInline(r.reason)} |`);
  }
  out.push("");

  const mode = opts.details ?? "not-discard";
  const detailed = mode === "none" ? [] : sorted.filter((r) => mode === "all" || r.verdict !== "discard");
  for (const r of detailed.slice(0, MAX_DETAILS)) {
    out.push(`<details><summary><b>${MD_WORD[r.verdict]}</b> ${mdInline(refToString(r.ref))}</summary>`, "");
    for (const f of r.findings.filter((x) => x.severity !== "ok" || r.verdict === "viable")) {
      out.push(`- **${CHECK_LABEL[f.check]}**: ${mdInline(f.message)}`);
      for (const e of f.evidence ?? []) out.push(`  - ${mdLink(e)}`);
    }
    for (const s of r.skipped.filter((x) => !x.why.startsWith("not run"))) {
      out.push(`- Could not check ${CHECK_LABEL[s.check]}: ${mdInline(s.why)}`);
    }
    out.push("", "</details>", "");
  }
  if (detailed.length > MAX_DETAILS) out.push(`_${detailed.length - MAX_DETAILS} more not expanded._`, "");
  if (opts.footer) out.push(`<sub>${mdInline(opts.footer)}</sub>`, "");
  return out.join("\n");
}
