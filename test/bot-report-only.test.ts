/**
 * Report-only mode: a private repository (or `dry-run`) gets a description of
 * what the bot would do and not one write. The guarantee is tested from three
 * sides: the code that writes, the whole bot with a sender that explodes, and
 * the only file allowed to import the writing function.
 */

import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { REPORT_ONLY_NOTE, chooseMode, handle, handleTick } from "../bot/main.ts";
import { applyActions } from "../src/bot/apply.ts";
import type { Sender } from "../src/bot/apply.ts";
import type { Action } from "../src/bot/types.ts";
import { cassettePath, configure } from "../src/github.ts";

const ROOT = join(import.meta.dirname, "..");
const marker = { claimant: "alice", since: "2026-09-01T09:00:00Z", nudgedAt: null };
const exploding: Sender = async (method, path) => {
  throw new Error(`report-only mode wrote: ${method} ${path}`);
};

describe("chooseMode", () => {
  it("a private repository is report-only whatever the input says", () => {
    assert.equal(chooseMode(false, true), "report-only");
    assert.equal(chooseMode(true, true), "report-only");
  });
  it("a public one follows the dry-run input", () => {
    assert.equal(chooseMode(true, false), "dry-run");
    assert.equal(chooseMode(false, false), "live");
  });
});

describe("nothing is written outside live mode", () => {
  const everyAction: Action[] = [
    { type: "assign", login: "alice" },
    { type: "unassign", login: "alice" },
    { type: "label", name: "claimed" },
    { type: "unlabel", name: "claimed" },
    { type: "comment", mode: "create", reply: { kind: "hint", requester: "alice" }, marker },
    { type: "comment", mode: "edit", commentId: 5, reply: { kind: "nudge", holder: "alice", lastOn: "2026-09-01", releaseOn: "2026-09-15" }, marker },
    { type: "comment", mode: "edit", commentId: 5, reply: { kind: "expired", former: "alice", lastOn: "2026-09-01" }, marker },
    { type: "none", reason: "x" },
  ];
  it("applyActions calls the sender for no kind of action when dry", async () => {
    const out = await applyActions(everyAction, { owner: "acme", repo: "vault", number: 1 }, { dryRun: true, sender: exploding });
    assert.deepEqual(out.map((o) => o.status), ["planned", "planned", "planned", "planned", "planned", "planned", "planned", "skipped"]);
  });
  it("only apply.ts imports the function that writes", () => {
    const files = [join(ROOT, "bot/main.ts"), ...readdirSync(join(ROOT, "src/bot")).map((f) => join(ROOT, "src/bot", f))];
    for (const file of files) {
      const code = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      const imports = /import[^;]*\bsend\b[^;]*from/.test(code) || /\bsend\s*\(/.test(code);
      assert.equal(imports, file.endsWith("src/bot/apply.ts"), file);
    }
  });
});

describe("a private repository, end to end, offline", () => {
  const dir = mkdtempSync(join(tmpdir(), "claimable-private-"));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const CASSETTES = join(dir, "c");
  mkdirSync(CASSETTES);
  const put = (path: string, body: unknown, status = 200, error?: string) => {
    configure({ cassetteDir: CASSETTES });
    writeFileSync(cassettePath(path), JSON.stringify({ path, status, body, ...(error ? { error } : {}) }));
  };
  const issue = (n: number, extra: object = {}) => ({
    number: n, state: "open", locked: false, html_url: `https://github.com/acme/vault/issues/${n}`, title: "Secret work",
    labels: [{ name: "claimed" }], assignees: [{ login: "alice" }], comments: 2, created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z", ...extra,
  });
  put("/repos/acme/vault", { full_name: "acme/vault", private: true, default_branch: "main" });
  put("/repos/acme/vault/contents/.github/claimable.yml", null, 404, "Not Found");
  put("/repos/acme/vault/issues?state=open&labels=claimed&per_page=100", [issue(3)]);
  put("/repos/acme/vault/issues/3", issue(3));
  put("/repos/acme/vault/issues/3/comments?per_page=100", [
    { id: 30, body: "/claim", created_at: "2026-09-01T09:00:00Z", author_association: "NONE", user: { login: "alice", type: "User" } },
    { id: 31, body: '<!-- claimable-bot:v1 {"claimant":"alice","since":"2026-09-01T09:00:00Z","nudgedAt":null} -->\nHi.', created_at: "2026-09-01T09:00:00Z", author_association: "NONE", user: { login: "github-actions[bot]", type: "Bot" } },
  ]);
  put("/repos/acme/vault/issues/3/timeline?per_page=100", [{ event: "assigned", created_at: "2026-09-01T09:00:00Z", assignee: { login: "alice" } }]);
  put("/repos/acme/vault/issues/4", issue(4, { assignees: [], labels: [] }));
  put("/repos/acme/vault/issues/4/comments?per_page=100", [
    { id: 40, body: "/claim", created_at: "2026-09-15T11:59:00Z", author_association: "NONE", user: { login: "bob", type: "User" } },
  ]);
  put("/repos/acme/vault/issues/4/timeline?per_page=100", []);
  put("/repos/acme/vault/issues?state=open&labels=claimed&assignee=bob&per_page=100", []);
  configure({ cassetteDir: "test/fixtures" });

  const replay = () => configure({ cassetteMode: "replay", cassetteDir: CASSETTES, token: "", viewer: null });
  const stop = () => configure({ cassetteMode: "off", cassetteDir: "test/fixtures" });

  it("the daily visit only reports, even with dry-run false", async () => {
    replay();
    process.env.CLAIMABLE_NOW = "2026-09-08T12:00:00Z";
    try {
      const run = await handleTick("acme/vault", { token: null, dryRun: false }, { sender: exploding });
      assert.equal(run.outcomes.length, 1);
      assert.ok(run.outcomes.every((o) => o.status === "planned"));
      assert.ok(run.summary.includes(REPORT_ONLY_NOTE));
      assert.match(run.summary, /would edit the bot comment \(nudge\)/);
    } finally {
      delete process.env.CLAIMABLE_NOW;
      stop();
    }
  });
  it("a /claim only reports, even with dry-run false", async () => {
    replay();
    const payload = {
      action: "created", issue: { number: 4 },
      comment: { id: 40, body: "/claim", created_at: "2026-09-15T11:59:00Z", author_association: "NONE", user: { login: "bob", type: "User" } },
      repository: { full_name: "acme/vault", private: true },
    };
    try {
      const run = await handle("issue_comment", payload, { token: null, dryRun: false }, { sender: exploding });
      assert.deepEqual(run.actions.map((a) => a.type), ["assign", "label", "comment"]);
      assert.ok(run.outcomes.every((o) => o.status === "planned"));
      assert.ok(run.summary.includes(REPORT_ONLY_NOTE));
    } finally {
      stop();
    }
  });
  it("talks about no price, plan or licence anywhere a user reads", () => {
    const words = /\$\d|usd|price|pricing|\bpro\b|paid|licen[sc]e|subscription/i;
    assert.ok(!words.test(REPORT_ONLY_NOTE));
    assert.ok(!words.test(readFileSync(join(ROOT, "docs/bot.md"), "utf8")));
    const main = readFileSync(join(ROOT, "bot/main.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    assert.ok(!words.test(main.slice(main.indexOf("REPORT_ONLY_NOTE"), main.indexOf("REPORT_ONLY_NOTE") + 200)));
  });
});
