/**
 * Records a real VIABLE example into test/showcase/ (never test/fixtures, which
 * `npm run record` wipes). Needs a token in GITHUB_TOKEN/GH_TOKEN: in CI that is
 * the repository's own github.token, so no personal token is ever involved.
 *
 *   node test/record-showcase.ts [--max 40] [--ref owner/repo#n] [--query "<search>"]
 */

import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { analyze } from "../src/analyze.ts";
import { findIssues } from "../src/cli.ts";
import { configure } from "../src/github.ts";
import { parseRef } from "../src/refs.ts";
import { refToString } from "../src/types.ts";
import type { IssueRef } from "../src/types.ts";

const ROOT = resolve(import.meta.dirname, "..");
const START = "<!-- viable-example:start -->";
const END = "<!-- viable-example:end -->";

export function defaultQuery(today: Date): string {
  const since = new Date(today.getTime() - 30 * 86400000).toISOString().slice(0, 10);
  return `label:"good first issue" comments:0..15 updated:>=${since}`;
}

/** Insert or replace the README block that holds the VIABLE example. */
export function upsertReadmeBlock(readme: string, ref: string, date: string): string {
  const block = [
    START,
    `And one that cleared every filter on ${date}. It may have been claimed since, which is the point: run it again before you start.`,
    "",
    `<!-- example-viable: ${ref} ${date} -->`,
    "```",
    "(filled by npm run check:docs -- --fix)",
    "```",
    END,
  ].join("\n");
  if (readme.includes(START) && readme.includes(END)) {
    return readme.slice(0, readme.indexOf(START)) + block + readme.slice(readme.indexOf(END) + END.length);
  }
  const m = readme.match(/<!-- example: [^\n]*-->\n```\n[\s\S]*?\n```\n/);
  if (!m || m.index === undefined) throw new Error("README has no <!-- example: --> block to anchor the VIABLE example after");
  const at = m.index + m[0].length;
  return `${readme.slice(0, at)}\n${block}\n${readme.slice(at)}`;
}

function dirBytes(dir: string): number {
  return readdirSync(dir).reduce((n, f) => n + readFileSync(join(dir, f)).length, 0);
}

async function main(argv: string[]): Promise<number> {
  const arg = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token) {
    console.error("needs a token; in CI the workflow passes github.token");
    return 2;
  }
  const max = Number(arg("--max") ?? 40);
  const maxBytes = Number(arg("--max-bytes") ?? 1_500_000);
  const today = new Date();
  const date = today.toISOString().slice(0, 10);

  configure({ token, viewer: null, cassetteMode: "off" });
  let candidates: IssueRef[];
  const one = arg("--ref");
  if (one) {
    const r = parseRef(one);
    if (!r) throw new Error(`cannot parse --ref ${one}`);
    candidates = [r];
  } else {
    candidates = await findIssues(arg("--query") ?? defaultQuery(today), max);
  }

  const tally = { viable: 0, reservations: 0, discard: 0 };
  const tmp = mkdtempSync(join(tmpdir(), "claimable-showcase-"));
  for (const ref of candidates.slice(0, max)) {
    const name = refToString(ref);
    configure({ cassetteMode: "off", viewer: null });
    const first = await analyze(ref);
    tally[first.verdict]++;
    console.error(`${first.verdict.padEnd(13)} ${name}`);
    if (first.verdict !== "viable") continue;

    rmSync(tmp, { recursive: true, force: true });
    mkdirSync(tmp, { recursive: true });
    configure({ cassetteMode: "record", cassetteDir: tmp, viewer: null });
    const second = await analyze(ref);
    configure({ cassetteMode: "off" });
    if (second.verdict !== "viable") continue;
    if (dirBytes(tmp) > maxBytes) {
      console.error("  fixtures too large, skipping");
      continue;
    }
    if (readdirSync(tmp).some((f) => readFileSync(join(tmp, f), "utf8").includes(token))) {
      console.error("a fixture contains the token; aborting");
      return 1;
    }

    const replay = spawnSync(process.execPath, [join(ROOT, "src/cli.ts"), name], {
      encoding: "utf8",
      env: { ...process.env, CLAIMABLE_CASSETTE: "replay", CLAIMABLE_CASSETTE_DIR: tmp, CLAIMABLE_NOW: `${date}T12:00:00Z`, NO_COLOR: "1", GITHUB_TOKEN: "", GH_TOKEN: "" },
    });
    if (replay.status !== 0 || !/^\s*VIABLE /.test(replay.stdout)) {
      console.error("  did not replay as VIABLE, skipping");
      continue;
    }

    const out = join(ROOT, "test/showcase");
    rmSync(join(out, "fixtures"), { recursive: true, force: true });
    cpSync(tmp, join(out, "fixtures"), { recursive: true });
    writeFileSync(join(out, "showcase.json"), `${JSON.stringify({ ref: name, recorded: date, verdict: "viable" }, null, 2)}\n`);
    const readmePath = join(ROOT, "README.md");
    writeFileSync(readmePath, upsertReadmeBlock(readFileSync(readmePath, "utf8"), name, date));
    console.log(`PICKED=${name}`);
    return 0;
  }
  console.error(`0 viable of ${Math.min(candidates.length, max)}: ${tally.reservations} caution, ${tally.discard} discard. Try again another day or widen the query.`);
  return 1;
}

function invokedDirectly(): boolean {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}
if (invokedDirectly()) main(process.argv.slice(2)).then((c) => { process.exitCode = c; });
