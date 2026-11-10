/**
 * The 40-plus recorded threads, each judged on the exact actions the bot takes.
 *
 * One wrong action in public is the bot's version of clearing a taken issue, so
 * a single thread that disagrees fails the build, and the expected actions are
 * never edited to match the code: if one is wrong, say why beside it.
 */

import { strict as assert } from "node:assert";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { decide } from "../src/bot/decide.ts";
import { readState } from "../src/bot/state.ts";
import { DEFAULT_CONFIG } from "../src/bot/types.ts";
import type { BotThread } from "../src/bot/types.ts";

const DIR = join(import.meta.dirname, "bot-threads");
const files = readdirSync(DIR).filter((f) => f.endsWith(".json")).sort();
let agree = 0;

export function runThread(t: BotThread) {
  const state = readState(t.issue, t.timeline, t.comments, t.requesterClaims);
  const config = { ...DEFAULT_CONFIG, ...t.config };
  if (t.event.kind === "tick") return decide({ kind: "tick" }, state, config, Date.parse(t.now));
  const id = t.event.commentId;
  const comment = t.comments.find((c) => c.id === id);
  assert.ok(comment, "trigger comment");
  return decide({ kind: "comment", comment }, state, config, Date.parse(t.now));
}

describe("bot threads", () => {
  for (const file of files) {
    it(file.replace(/\.json$/, ""), () => {
      const t = JSON.parse(readFileSync(join(DIR, file), "utf8")) as BotThread;
      const got = runThread(t);
      assert.deepEqual(got, t.expected);
      agree++;
    });
  }
  after(() => process.stdout.write(`\n# bot threads: ${agree}/${files.length} give exactly the expected actions\n`));
});
