/**
 * The two banks of the claim bot, checked for shape only.
 *
 * No bot logic runs here. The point is that a bank which silently stops being
 * read (a typo in a field name, a thread whose trigger comment is missing)
 * would turn "40 of 40" into a number that means nothing, so the banks are
 * checked before they are used to judge anything.
 */

import { strict as assert } from "node:assert";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { Action, BotThread, Reply } from "../src/bot/types.ts";
import { commandRows, HAND_ROWS } from "./bot-corpus.ts";

const THREADS = join(import.meta.dirname, "bot-threads");
const threadFiles = readdirSync(THREADS).filter((f) => f.endsWith(".json")).sort();

describe("bot command corpus", () => {
  const rows = commandRows();

  it("holds at least 120 comments", () => {
    assert.ok(rows.length >= 120, `only ${rows.length}`);
  });

  it("covers every command, its aliases and the traps", () => {
    const kinds = [...new Set(rows.map((r) => String(r.expect)))].sort();
    assert.deepEqual(kinds, ["claim", "null", "status", "unclaim"]);
    const count = (k: string | null) => rows.filter((r) => r.expect === k).length;
    assert.ok(count("claim") >= 20 && count("unclaim") >= 8 && count("status") >= 5 && count(null) >= 60);
  });

  it("gives every row a body, an author and a note, and no note twice", () => {
    const notes = new Set<string>();
    for (const row of rows) {
      assert.equal(typeof row.body, "string");
      assert.ok(row.author && row.author.login.length > 0);
      assert.ok(row.note.length > 0);
      assert.ok(!notes.has(`${row.note}|${row.body}`), `duplicate row: ${row.note}`);
      notes.add(`${row.note}|${row.body}`);
    }
  });

  it("makes every hand-written bot-authored row a null", () => {
    for (const row of HAND_ROWS.filter((r) => r.author?.type === "Bot")) assert.equal(row.expect, null, row.note);
  });
});

const REPLY_KINDS: Record<Reply["kind"], string[]> = {
  claimed: ["claimant", "since", "nudgeOn", "releaseOn"],
  status: ["holder", "since", "nudgeOn", "releaseOn"],
  released: ["by", "former"],
  nudge: ["holder", "lastOn", "releaseOn"],
  expired: ["former", "lastOn"],
  held: ["requester", "holder", "since"],
  "pull-open": ["requester", "pull", "author"],
  quota: ["requester", "limit", "claims"],
  closed: ["requester"],
  blocked: ["requester", "label"],
  "not-labelled": ["requester", "labels"],
  "not-holder": ["requester", "holder"],
};

function checkAction(a: Action, botCommentIds: Set<number>, where: string): void {
  switch (a.type) {
    case "assign":
    case "unassign":
      assert.ok(a.login, `${where}: ${a.type} needs a login`);
      break;
    case "label":
    case "unlabel":
      assert.ok(a.name, `${where}: ${a.type} needs a name`);
      break;
    case "none":
      assert.ok(a.reason, `${where}: none needs a reason`);
      break;
    case "comment": {
      assert.ok(a.mode === "create" || a.mode === "edit", `${where}: mode`);
      if (a.mode === "edit") assert.ok(a.commentId && botCommentIds.has(a.commentId), `${where}: edit must name a bot comment of the thread`);
      else assert.equal(a.commentId, undefined, `${where}: create has no commentId`);
      const fields = REPLY_KINDS[a.reply.kind];
      assert.ok(fields, `${where}: unknown reply kind ${a.reply.kind}`);
      assert.deepEqual(Object.keys(a.reply).filter((k) => k !== "kind").sort(), [...fields].sort(), `${where}: fields of ${a.reply.kind}`);
      assert.deepEqual(Object.keys(a.marker).sort(), ["claimant", "nudgedAt", "since"], `${where}: marker`);
      break;
    }
    default:
      assert.fail(`${where}: unknown action ${(a as { type: string }).type}`);
  }
}

describe("bot thread bank", () => {
  it("holds at least 40 threads", () => {
    assert.ok(threadFiles.length >= 40, `only ${threadFiles.length}`);
  });

  const names = new Set<string>();
  for (const file of threadFiles) {
    it(`${file} is well formed`, () => {
      const t = JSON.parse(readFileSync(join(THREADS, file), "utf8")) as BotThread;
      assert.equal(file.replace(/^\d+-/, "").replace(/\.json$/, ""), t.name, "file name matches name");
      assert.ok(!names.has(t.name), "unique name");
      names.add(t.name);
      assert.ok(t.source.length > 0);
      assert.ok(!Number.isNaN(Date.parse(t.now)), "now is a date");
      assert.ok(t.issue.number > 0 && ["open", "closed"].includes(t.issue.state) && typeof t.issue.locked === "boolean");
      assert.ok(Array.isArray(t.issue.labels) && Array.isArray(t.issue.assignees));
      assert.ok(Array.isArray(t.timeline) && Array.isArray(t.comments) && Array.isArray(t.requesterClaims));
      assert.equal(typeof t.config, "object");
      for (const c of t.comments) {
        assert.ok(Number.isInteger(c.id) && typeof c.created_at === "string" && typeof c.author_association === "string");
        assert.ok(c.user === null || (c.user.login && c.user.type), "comment user");
        assert.ok(Date.parse(c.created_at) <= Date.parse(t.now), `comment ${c.id} is from the future`);
      }
      assert.equal(new Set(t.comments.map((c) => c.id)).size, t.comments.length, "comment ids are unique");
      assert.ok(t.event.kind === "comment" || t.event.kind === "tick");
      if (t.event.kind === "comment") {
        const id = t.event.commentId;
        assert.ok(t.comments.some((c) => c.id === id), "trigger comment is in the thread");
      }
      assert.ok(t.expected.length > 0);
      const botIds = new Set(t.comments.filter((c) => c.user?.type === "Bot").map((c) => c.id));
      t.expected.forEach((a, i) => checkAction(a, botIds, `${file} expected[${i}]`));
    });
  }
});
