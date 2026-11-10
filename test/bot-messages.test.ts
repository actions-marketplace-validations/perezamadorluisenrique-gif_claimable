import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { deadlines } from "../src/bot/decide.ts";
import { renderComment } from "../src/bot/messages.ts";
import { parseMarker, readState, renderMarker } from "../src/bot/state.ts";
import type { BotComment, BotIssue, Marker, Reply } from "../src/bot/types.ts";

const M: Marker = { claimant: "alice", since: "2026-09-10T09:00:00Z", nudgedAt: null };

const REPLIES: Reply[] = [
  { kind: "claimed", claimant: "alice", since: "2026-09-15", nudgeOn: "2026-09-22", releaseOn: "2026-09-29" },
  { kind: "status", holder: null, since: null, nudgeOn: null, releaseOn: null },
  { kind: "status", holder: "alice", since: "2026-09-10", nudgeOn: "2026-09-17", releaseOn: "2026-09-24" },
  { kind: "status", holder: "alice", since: "2026-09-10", nudgeOn: null, releaseOn: "2026-09-24" },
  { kind: "status", holder: "alice", since: null, nudgeOn: null, releaseOn: null },
  { kind: "released", by: "alice", former: "alice" },
  { kind: "released", by: "owner", former: "alice" },
  { kind: "nudge", holder: "alice", lastOn: "2026-09-10", releaseOn: "2026-09-24" },
  { kind: "expired", former: "alice", lastOn: "2026-09-10" },
  { kind: "held", requester: "bob", holder: "alice", since: "2026-09-10" },
  { kind: "pull-open", requester: "bob", pull: 12, author: "carol" },
  { kind: "quota", requester: "bob", limit: 2, claims: [3, 8] },
  { kind: "closed", requester: "bob" },
  { kind: "blocked", requester: "bob", label: "on hold" },
  { kind: "not-labelled", requester: "bob", labels: ["good first issue"] },
  { kind: "not-holder", requester: "bob", holder: "alice" },
];

describe("renderComment", () => {
  it("starts with a marker that reads back, for every reply", () => {
    for (const reply of REPLIES) {
      const text = renderComment(reply, M);
      assert.deepEqual(parseMarker(text), M, reply.kind);
      assert.ok(text.split("\n")[0].startsWith("<!-- claimable-bot:v1 "));
    }
  });
  it("is short, calm and one comment's worth", () => {
    for (const reply of REPLIES) {
      const text = renderComment(reply, M);
      assert.ok(text.length < 900, `${reply.kind}: ${text.length} characters`);
      assert.ok(!text.split("\n").slice(1).join("\n").includes("!"), `${reply.kind} shouts`);
    }
  });
  it("mentions only the person it answers", () => {
    const text = renderComment({ kind: "held", requester: "bob", holder: "alice", since: "2026-09-10" }, M);
    assert.equal([...text.matchAll(/@\w+/g)].map((m) => m[0]).join(","), "@bob");
  });
  it("cannot be bent by a hostile label or login", () => {
    const label = "<img src=x onerror=alert(1)> `x` |y| @everyone [a](http://evil)\nnext line";
    const text = renderComment({ kind: "blocked", requester: "bob", label }, M);
    assert.ok(!text.includes("<img"), text);
    assert.ok(!/\n.*next line/.test(text), "a label cannot start a new line");
    assert.ok(!text.includes("@everyone"), "no ping through a label");
    const md = renderComment({ kind: "blocked", requester: "bob", label: "x** [click](https://evil.example) **y\u202e" }, M);
    assert.ok(!md.includes("](http"), md);
    assert.ok(!md.includes("\u202e"));
    const login = renderComment({ kind: "held", requester: "bob", holder: "x`<script>", since: null }, M);
    assert.ok(!login.includes("<script>"));
    const pinged = renderComment({ kind: "pull-open", requester: "b@d", pull: 1, author: "@team" }, M);
    assert.ok(!pinged.includes("@team"));
  });
});

describe("markers", () => {
  it("round-trips and rejects anything malformed", () => {
    assert.deepEqual(parseMarker(renderMarker(M)), M);
    const bad = [
      "<!-- claimable-bot:v1 {not json} -->",
      '<!-- claimable-bot:v1 {"claimant":5,"since":null,"nudgedAt":null} -->',
      '<!-- claimable-bot:v1 {"claimant":"a b","since":null,"nudgedAt":null} -->',
      '<!-- claimable-bot:v1 {"claimant":"alice","since":"yesterday","nudgedAt":null} -->',
      '<!-- claimable-bot:v1 {"claimant":"alice","since":null} -->',
      '<!-- claimable-bot:v1 [] -->',
      "no marker at all",
      null,
    ];
    for (const b of bad) assert.equal(parseMarker(b), null, String(b));
  });
  it("is the marker of a bot only when it is the first line", () => {
    const quoted = `Someone wrote:\n> ${renderMarker(M)}\nthanks`;
    assert.equal(parseMarker(quoted), null);
    assert.equal(parseMarker(`> ${renderMarker(M)}`), null);
    assert.deepEqual(parseMarker(`${renderMarker(M)}\nhello`), M);
  });
  it("writes only what is valid, whatever it is given", () => {
    const text = renderMarker({ claimant: "a --> <script>", since: "nope", nudgedAt: "2026-09-10T09:00:00Z" });
    assert.ok(!text.slice(5).includes("-->") || text.endsWith(" -->"));
    assert.deepEqual(parseMarker(text), { claimant: null, since: null, nudgedAt: "2026-09-10T09:00:00Z" });
  });
});

describe("readState", () => {
  const issue: BotIssue = {
    number: 1, state: "open", locked: false, html_url: "https://github.com/acme/widgets/issues/1", title: "t", labels: ["claimed"],
    assignees: [{ login: "alice" }], updated_at: "2026-09-01T00:00:00Z",
  };
  const botBody = `${renderMarker(M)}\nx`;
  const comment = (id: number, login: string, type: "User" | "Bot", body: string, at: string): BotComment => ({
    id, user: { login, type }, author_association: "NONE", body, created_at: at,
  });

  it("trusts a marker only from a bot", () => {
    const forged = readState(issue, [], [comment(1, "mallory", "User", botBody, "2026-09-02T00:00:00Z")]);
    assert.equal(forged.bot, null);
    const lookalike = readState(issue, [], [comment(1, "mallory", "Bot", botBody, "2026-09-02T00:00:00Z")]);
    assert.equal(lookalike.bot, null, "a Bot type without the [bot] login is not accepted either");
    const real = readState(issue, [], [comment(1, "github-actions[bot]", "Bot", botBody, "2026-09-02T00:00:00Z")]);
    assert.equal(real.bot?.commentId, 1);
  });
  it("keeps the oldest bot comment if there are two", () => {
    const s = readState(issue, [], [
      comment(5, "github-actions[bot]", "Bot", botBody, "2026-09-05T00:00:00Z"),
      comment(4, "github-actions[bot]", "Bot", botBody, "2026-09-04T00:00:00Z"),
    ]);
    assert.equal(s.bot?.commentId, 4);
  });
  it("counts the holder's comments, linked pull requests and commits as activity, and nobody else's", () => {
    const base = readState(issue, [], [comment(1, "alice", "User", "hi", "2026-09-02T00:00:00Z")]);
    assert.equal(base.lastActivity, "2026-09-02T00:00:00Z");
    const others = readState(issue, [], [comment(1, "alice", "User", "hi", "2026-09-02T00:00:00Z"), comment(2, "bob", "User", "hi", "2026-09-09T00:00:00Z")]);
    assert.equal(others.lastActivity, "2026-09-02T00:00:00Z");
    const commit = readState(issue, [{ event: "referenced", created_at: "2026-09-07T00:00:00Z", actor: { login: "Alice" } }], []);
    assert.equal(commit.lastActivity, "2026-09-07T00:00:00Z");
    const pr = readState(issue, [{ event: "cross-referenced", created_at: "2026-09-08T00:00:00Z", source: { issue: { number: 9, html_url: "p", state: "open", title: "t", pull_request: { merged_at: null, html_url: "p" }, user: { login: "alice" } } } }], []);
    assert.equal(pr.lastActivity, "2026-09-08T00:00:00Z");
  });
  it("counts only pull requests of this repository", () => {
    const ref = (html: string) => ({ event: "cross-referenced", created_at: "2026-09-01T00:00:00Z", source: { issue: { number: 1, html_url: html, state: "open", title: "t", pull_request: { merged_at: null, html_url: html }, user: { login: "mallory" } } } });
    const mine = { ...issue, html_url: "https://github.com/acme/widgets/issues/1" };
    assert.equal(readState(mine, [ref("https://github.com/mallory/junk/pull/1")], []).openPulls.length, 0);
    assert.equal(readState(mine, [ref("https://github.com/acme/widgets/pull/1")], []).openPulls.length, 1);
    assert.equal(readState(mine, [ref("https://github.com/ACME/Widgets/pull/1")], []).openPulls.length, 1);
  });
  it("forgets a pull request that was closed later", () => {
    const open = { event: "cross-referenced", created_at: "2026-09-01T00:00:00Z", source: { issue: { number: 9, html_url: "https://github.com/acme/widgets/pull/9", state: "open", title: "t", pull_request: { merged_at: null, html_url: "https://github.com/acme/widgets/pull/9" } } } };
    const closed = { ...open, created_at: "2026-09-02T00:00:00Z", source: { issue: { ...open.source.issue, state: "closed" } } };
    assert.equal(readState(issue, [open], []).openPulls.length, 1);
    assert.equal(readState(issue, [open, closed], []).openPulls.length, 0);
  });
});

describe("deadlines", () => {
  const cfg = { nudgeDays: 7, releaseDays: 7 };
  it("counts from the last sign of life", () => {
    assert.deepEqual(deadlines("2026-09-10T09:00:00Z", null, cfg), { nudgeOn: "2026-09-17", releaseOn: "2026-09-24" });
  });
  it("leaves only the release once nudged, and restarts after an answer", () => {
    assert.deepEqual(deadlines("2026-09-10T09:00:00Z", "2026-09-17T09:00:00Z", cfg), { nudgeOn: null, releaseOn: "2026-09-24" });
    assert.deepEqual(deadlines("2026-09-20T09:00:00Z", "2026-09-17T09:00:00Z", cfg), { nudgeOn: "2026-09-27", releaseOn: "2026-10-04" });
  });
  it("has nothing without a sign of life", () => assert.equal(deadlines(null, null, cfg), null));
});
