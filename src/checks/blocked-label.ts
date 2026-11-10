/**
 * Filter 3 — is the issue blocked, or is it an umbrella?
 *
 * Two distinct situations that both look like "open and unassigned":
 *
 *   1. A label that means *do not start*. Some projects enforce this in
 *      writing — Sugar Labs' `on hold` reads "Do not work on this until marked
 *      ready". Zero comments on such an issue means "not specified yet", not
 *      "nobody has claimed it". That inversion is the single easiest way to
 *      waste a week.
 *
 *   2. An umbrella issue, which is not a blocker at all. On umbrella issues you
 *      claim a *unit of work* — one spec file, one module — not the issue, and
 *      several people work under the same number at once. So a high comment
 *      count there means active, not contested. Only an explicit "don't send
 *      PRs against this" turns an umbrella into a wall.
 */

import { getIssue } from "../fetchers.ts";
import type { Finding, GhLabel, IssueRef } from "../types.ts";

/** Labels that mean stop. Matched case-insensitively against the whole name. */
export const BLOCKING_LABEL = /(^|\b)(on[ -]?hold|blocked|do[ -]not[ -]work|needs[ -:]?(design|spec|discussion|decision)|status[ -:]\s*blocked|awaiting[ -]decision|wontfix|invalid|duplicate)(\b|$)/i;

/** Labels that mean "claiming is gated on something", not "stop". */
const CAUTION_LABEL = /(^|\b)(needs[ -:]?triage|discussion|proposal|rfc|question|stale)(\b|$)/i;

/**
 * Phrasings that mean "not against *this* issue".
 *
 * The positive form is the one that gets missed, and it is common on parent
 * issues: "Make Pull Requests against the sub-tasks not against this parent
 * issue" never says "do not", so any pattern built around a negation walks
 * straight past it — and an umbrella you are forbidden to PR against reads as a
 * clean, unclaimed `good first issue`.
 */
const FORBIDS_PRS = [
  /do\s*n['o]?t\s+(send|open|submit|raise|make)\s+(a\s+)?(pull\s*requests?|prs?)/i,
  /(no|avoid)\s+prs?\s+(against|on|for)\s+this\s+issue/i,
  /(pull\s*requests?|prs?)[^.\n]{0,80}\bnot\s+(against|on|to)\s+this\s+(parent\s+|umbrella\s+|tracking\s+)?issue/i,
  /(pull\s*requests?|prs?)\s+(should|must)\s+be\s+(made|opened|raised)\s+against\s+the\s+sub[- ]?(tasks?|issues?)/i,
  /please\s+do\s+not\s+work\s+on\s+this/i,
  /this\s+issue\s+is\s+not\s+(ready|open)\s+(for|to)\s+(work|contributions?)/i,
];

const UMBRELLA_MARKERS = [
  /\bumbrella\s+issue\b/i,
  /\btracking\s+issue\b/i,
  /\bmeta[- ]issue\b/i,
  /\btracker\b/i,
  /\bparent\s+issue\b/i,
  /pick\s+(one|a)\s+(file|item|task|spec)/i,
  /claim\s+(a|one)\s+(file|spec|item|sub-?task)/i,
];

export function labelNames(labels: (GhLabel | string)[]): string[] {
  return labels.map((l) => (typeof l === "string" ? l : l.name));
}

/** A checklist long enough to be a work breakdown rather than a description. */
function checklistItems(body: string): number {
  const matches = body.match(/^\s*[-*]\s*\[[ xX]\]/gm);
  return matches ? matches.length : 0;
}

export async function checkBlockedLabel(ref: IssueRef): Promise<Finding[]> {
  const issue = await getIssue(ref);
  const findings: Finding[] = [];
  const body = issue.body ?? "";
  const names = labelNames(issue.labels);

  for (const name of names) {
    if (BLOCKING_LABEL.test(name)) {
      findings.push({
        check: "blocked-label",
        severity: "blocker",
        message: `labelled \`${name}\` — the project is saying not to start`,
        evidence: [issue.html_url],
      });
    } else if (CAUTION_LABEL.test(name)) {
      findings.push({
        check: "blocked-label",
        severity: "warning",
        message: `labelled \`${name}\` — scope may not be settled yet`,
        evidence: [issue.html_url],
      });
    }
  }

  for (const pattern of FORBIDS_PRS) {
    const hit = body.match(pattern);
    if (hit) {
      findings.push({
        check: "blocked-label",
        severity: "blocker",
        message: `the issue body forbids pull requests against it: "${hit[0].trim()}"`,
        evidence: [issue.html_url],
      });
      break;
    }
  }

  const boxes = checklistItems(body);
  const umbrellaHit = UMBRELLA_MARKERS.find((p) => p.test(body));
  const isUmbrella = umbrellaHit !== undefined || boxes >= 5;

  if (isUmbrella) {
    findings.push({
      check: "blocked-label",
      severity: "info",
      message:
        boxes >= 5 && umbrellaHit === undefined
          ? `looks like an umbrella issue (${boxes} checklist items) — claim one item, not the issue; a high comment count here means active, not taken`
          : "umbrella issue — claim one unit of work, not the issue; a high comment count here means active, not taken",
      evidence: [issue.html_url],
    });
  }

  if (findings.length === 0) {
    findings.push({
      check: "blocked-label",
      severity: "ok",
      message: names.length > 0 ? `no blocking labels (${names.join(", ")})` : "no labels",
    });
  }

  return findings;
}
