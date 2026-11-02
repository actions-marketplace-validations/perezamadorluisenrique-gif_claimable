import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { parseArgs } from "../src/cli.ts";
import { countVerdicts, formatMarkdown, mdInline } from "../src/report.ts";
import type { IssueReport } from "../src/types.ts";

const ROOT = resolve(import.meta.dirname, "..");

function report(n: number, verdict: IssueReport["verdict"], title = "t", reason = "r"): IssueReport {
  return {
    ref: { owner: "o", repo: "r", number: n },
    url: `https://github.com/o/r/issues/${n}`,
    title,
    verdict,
    reason,
    findings: [],
    skipped: verdict === "reservations" ? [{ check: "environment", why: "could not clone" }] : [],
  } as unknown as IssueReport;
}

describe("formatMarkdown", () => {
  const reports = [report(1, "discard"), report(2, "viable"), report(3, "reservations")];

  it("orders viable, caution, discard and counts them", () => {
    const md = formatMarkdown(reports);
    assert.ok(md.indexOf("o/r#2") < md.indexOf("o/r#3") && md.indexOf("o/r#3") < md.indexOf("o/r#1"));
    assert.match(md, /3 checked: 1 viable, 1 caution, 1 discard/);
    assert.deepEqual(countVerdicts(reports), { total: 3, viable: 1, caution: 1, discard: 1 });
  });

  it("filters rows without changing counts", () => {
    const md = formatMarkdown(reports, { rows: (r) => r.verdict === "viable" });
    assert.match(md, /3 checked/);
    assert.ok(!md.includes("o/r#1"));
  });

  it("lists checks that could not run", () => {
    assert.match(formatMarkdown(reports), /Could not check environment: could not clone/);
  });

  it("handles an empty list", () => {
    assert.match(formatMarkdown([]), /No issues checked/);
  });

  it("keeps hostile titles inside their table cell", () => {
    const md = formatMarkdown([report(9, "viable", "a | b\n<script>x</script> `c` @user")]);
    const row = md.split("\n").find((l) => l.startsWith("| **VIABLE**"))!;
    assert.equal(row.replace(/\\\|/g, "").split("|").length, 5);
    assert.ok(!row.includes("<script"));
    assert.ok(!/(^|\s)@user/.test(row));
  });
});

describe("mdInline", () => {
  it("caps length", () => assert.ok(mdInline("x".repeat(500)).length <= 300));
});

describe("--markdown flag", () => {
  it("parses", () => assert.equal(parseArgs(["--markdown", "o/r#1"]).markdown, true));
  it("is exclusive with --json", () => assert.throws(() => parseArgs(["--json", "--markdown"]), /alternatives/));
  it("prints a report from the recorded fixtures", () => {
    const run = spawnSync(process.execPath, [resolve(ROOT, "src/cli.ts"), "--markdown", "frappe/lms#2711"], {
      encoding: "utf8",
      env: { ...process.env, CLAIMABLE_CASSETTE: "replay", CLAIMABLE_NOW: "2026-09-15T12:00:00Z", NO_COLOR: "1", GITHUB_TOKEN: "", GH_TOKEN: "" },
    });
    assert.equal(run.status, 1, run.stderr);
    assert.match(run.stdout, /^## claimable/);
    assert.match(run.stdout, /\*\*DISCARD\*\*/);
  });
});
