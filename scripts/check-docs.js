#!/usr/bin/env node
/**
 * The README makes claims that are numbers, and numbers drift.
 *
 * Every figure below is something a reader can check — the size of the test
 * suite, the evaluation score and its breakdown, the example output — and the
 * whole pitch of this project is that its claims are checkable. So this reruns
 * each one and fails when the prose no longer matches what the code says.
 * `--fix` rewrites the prose instead, for the commit that changed the code.
 *
 * Same idea as `npm run demo`, which keeps the animated recording honest.
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { evalFigures } from "./eval-figures.js";

const fix = process.argv.includes("--fix");
const ENV = { ...process.env, NO_COLOR: "1", GITHUB_TOKEN: "", GH_TOKEN: "" };

function run(args, env = {}) {
  const res = spawnSync(process.execPath, args, { encoding: "utf8", env: { ...ENV, ...env } });
  if (res.error) throw res.error;
  return res.stdout;
}

// ── what the code says ─────────────────────────────────────────────────────

const tap = run(["--test", "--test-reporter=tap", "test/**/*.test.ts"]);
const tests = Number(tap.match(/^# tests (\d+)$/m)?.[1]);
const failed = Number(tap.match(/^# fail (\d+)$/m)?.[1]);
if (!tests || failed) {
  console.error(`the suite itself is not green (${failed} failing) — fix that first`);
  process.exit(1);
}

const { figures, summary } = evalFigures();

/** The README's example, replayed on the date its day counts were taken. */
function example(ref, date, extraEnv = {}) {
  const out = run(["src/cli.ts", ref], { CLAIMABLE_CASSETTE: "replay", CLAIMABLE_NOW: `${date}T12:00:00Z`, ...extraEnv });
  return `$ claimable ${ref}\n${out.replace(/\n+$/, "")}`;
}

// ── what the prose says ────────────────────────────────────────────────────

const checks = [
  {
    file: "README.md",
    what: "test count",
    pattern: /(npm test\s+# )\d+( tests)/,
    want: (m) => `${m[1]}${tests}${m[2]}`,
  },
  {
    file: "CONTRIBUTING.md",
    what: "test count",
    pattern: /(npm test\s+# )\d+( tests)/,
    want: (m) => `${m[1]}${tests}${m[2]}`,
  },
  {
    file: "README.md",
    what: "evaluation summary line",
    pattern: /\d+\/\d+ agree with the verified verdict[^\n]*/,
    want: () => summary,
  },
  {
    file: "README.md",
    what: "evaluation set size",
    pattern: /(It is )\d+( issues triaged by hand)/,
    want: (m) => `${m[1]}${figures.issues}${m[2]}`,
  },
  {
    file: "CONTRIBUTING.md",
    what: "evaluation set size",
    pattern: /(is )\d+( issues triaged by hand)/,
    want: (m) => `${m[1]}${figures.issues}${m[2]}`,
  },
  {
    file: "README.md",
    what: "rejections reproduced",
    pattern: /(\| \*\*)\d+ \/ \d+(\*\* \| hand rejections reproduced)/,
    want: (m) => `${m[1]}${figures.rejections} / ${figures.rejectionsOf}${m[2]}`,
  },
  {
    file: "README.md",
    what: "misses caught",
    pattern: /(\| \*\*)\d+(\*\* \| issues the hand pass \*cleared\*)/,
    want: (m) => `${m[1]}${figures.caught}${m[2]}`,
  },
  {
    file: "README.md",
    what: "soft disagreements",
    pattern: /(\| \*\*)\d+(\*\* \| soft disagreements)/,
    want: (m) => `${m[1]}${figures.soft}${m[2]}`,
  },
  {
    file: "README.md",
    what: "drift",
    pattern: /(\| \*\*)\d+(\*\* \| excluded as drift)/,
    want: (m) => `${m[1]}${figures.drift}${m[2]}`,
  },
  {
    file: "README.md",
    what: "wrongly ruled out",
    pattern: /(\| \*\*)\d+(\*\* \| issues wrongly ruled out)/,
    want: (m) => `${m[1]}${figures.wronglyRuledOut}${m[2]}`,
  },
  {
    file: "README.md",
    what: "example output",
    // <!-- example: owner/repo#N YYYY-MM-DD --> then a fenced block.
    pattern: /(<!-- example: (\S+) (\d{4}-\d{2}-\d{2}) -->\n```\n)([\s\S]*?)(\n```)/,
    want: (m) => `${m[1]}${example(m[2], m[3])}${m[5]}`,
  },
  {
    file: "README.md",
    what: "viable example output",
    optional: true, // absent until the "Record a VIABLE example" workflow has run once
    pattern: /(<!-- example-viable: (\S+) (\d{4}-\d{2}-\d{2}) -->\n```\n)([\s\S]*?)(\n```)/,
    want: (m) => {
      const out = example(m[2], m[3], { CLAIMABLE_CASSETTE_DIR: "test/showcase/fixtures" });
      if (!/^\$ claimable \S+\n+VIABLE /.test(out)) throw new Error(`the VIABLE example ${m[2]} no longer replays as VIABLE`);
      return `${m[1]}${out}${m[5]}`;
    },
  },
];

let drift = 0;
const files = new Map();
for (const check of checks) {
  const text = files.get(check.file) ?? readFileSync(check.file, "utf8");
  const match = text.match(check.pattern);
  if (!match && check.optional) continue;
  if (!match) {
    console.error(`${check.file}: could not find the ${check.what} — was the wording changed? Update scripts/check-docs.js with it.`);
    drift++;
    continue;
  }
  const wanted = check.want(match);
  if (match[0] !== wanted) {
    drift++;
    console.error(`${check.file}: ${check.what} is out of date`);
    // Show the first line that differs, not the first lines of the block.
    const says = match[0].split("\n");
    const code = wanted.split("\n");
    const at = says.findIndex((line, i) => line !== code[i]);
    console.error(`  says:      ${says[at] ?? "(nothing)"}`);
    console.error(`  code says: ${code[at] ?? "(nothing)"}`);
  }
  files.set(check.file, text.replace(check.pattern, wanted));
}

if (drift === 0) {
  console.log(`docs match the code: ${tests} tests, ${summary}`);
} else if (fix) {
  for (const [file, text] of files) writeFileSync(file, text);
  console.log(`rewrote ${drift} stale claim${drift === 1 ? "" : "s"}; review the diff`);
} else {
  console.error(`\n${drift} claim${drift === 1 ? "" : "s"} in the docs no longer match the code. Run \`npm run check:docs -- --fix\`.`);
  process.exit(1);
}
