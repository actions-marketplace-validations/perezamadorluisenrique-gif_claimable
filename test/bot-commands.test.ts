/**
 * The command parser, scored against every labelled comment.
 *
 * Both directions fail the build here. A missed command is a nuisance, but a
 * phantom command is the bot assigning a stranger in public, so the score the
 * plan asks for is all of them read, and not one false reading.
 */

import { strict as assert } from "node:assert";
import { after, describe, it } from "node:test";
import { isBotAuthor, parseCommand } from "../src/bot/commands.ts";
import { commandRows } from "./bot-corpus.ts";

const rows = commandRows();
let right = 0;
const wrong: string[] = [];

describe("bot command corpus", () => {
  for (const row of rows) {
    it(`${row.expect ?? "ignores"}: ${row.note}`, () => {
      const got = parseCommand(row.body, row.author ?? null)?.kind ?? null;
      if (got === row.expect) right++;
      else wrong.push(`${row.note}: wanted ${row.expect}, got ${got}`);
      assert.equal(got, row.expect, JSON.stringify(row.body));
    });
  }
  after(() => {
    process.stdout.write(`\n# bot commands: ${right}/${rows.length} read as labelled${wrong.length ? `\n#   ${wrong.join("\n#   ")}` : ""}\n`);
  });
});

describe("parseCommand", () => {
  it("never reads a command from a missing body or author", () => {
    assert.equal(parseCommand(null, { login: "alice", type: "User" }), null);
    assert.equal(parseCommand("/claim", null), null);
  });
  it("treats a deleted account and every bot as no author", () => {
    assert.ok(isBotAuthor(null));
    assert.ok(isBotAuthor({ login: "ghost", type: "User" }));
    assert.ok(isBotAuthor({ login: "x[bot]", type: "User" }));
    assert.ok(isBotAuthor({ login: "x", type: "Bot" }));
    assert.ok(!isBotAuthor({ login: "alice", type: "User" }));
  });
  it("answers with only the kind, so nothing from the comment travels on", () => {
    assert.deepEqual(parseCommand("/claim and a lot of other text", { login: "alice", type: "User" }), { kind: "claim" });
  });
});
