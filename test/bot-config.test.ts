import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { handle } from "../bot/main.ts";
import { configPath, parseYaml, readConfig } from "../src/bot/config.ts";
import { renderComment } from "../src/bot/messages.ts";
import { DEFAULT_CONFIG } from "../src/bot/types.ts";
import { cassettePath, configure } from "../src/github.ts";

const FULL = `# claimable bot settings
nudge-days: 5
release-days: 3   # after the reminder
max-claims: 1
labels:
  - good first issue
  - "help wanted"
blocked-labels: [on hold, 'needs design']
hint-on-natural-claims: true
exempt-users:
  - octocat
  - '@maintainer-bot'
blocked-users: []
claimed-label: taken
messages:
  claimed: "{user} it is yours until {release-date}."
  nudge: 'Still on it, {user}? Last seen {last-date}; release on {release-date}.'
`;

describe("the configuration file", () => {
  it("reads every setting", () => {
    const { config, warnings } = readConfig(FULL);
    assert.deepEqual(warnings, []);
    assert.equal(config.nudgeDays, 5);
    assert.equal(config.releaseDays, 3);
    assert.equal(config.maxClaims, 1);
    assert.deepEqual(config.labels, ["good first issue", "help wanted"]);
    assert.deepEqual(config.blockedLabels, ["on hold", "needs design"]);
    assert.equal(config.hintOnNaturalClaims, true);
    assert.deepEqual(config.exemptUsers, ["octocat", "maintainer-bot"]);
    assert.deepEqual(config.blockedUsers, []);
    assert.equal(config.claimedLabel, "taken");
    assert.equal(config.messages.claimed, "{user} it is yours until {release-date}.");
    assert.equal(config.messages.nudge, "Still on it, {user}? Last seen {last-date}; release on {release-date}.");
  });
  it("no file, or an empty one, is the defaults and says nothing", () => {
    for (const src of [null, "", "# just a comment\n", "---\n"]) {
      const { config, warnings } = readConfig(src);
      assert.deepEqual(config, DEFAULT_CONFIG);
      assert.deepEqual(warnings, []);
    }
  });
  it("does not share lists with the defaults", () => {
    readConfig("labels: [a]").config.labels.push("x");
    assert.deepEqual(DEFAULT_CONFIG.labels, []);
    assert.deepEqual(readConfig(null).config.labels, []);
  });
  it("keeps the default for a bad value and names the key", () => {
    const cases: [string, string][] = [
      ["nudge-days: 0", "nudge-days"],
      ["nudge-days: soon", "nudge-days"],
      ["release-days: 400", "release-days"],
      ["max-claims: -1", "max-claims"],
      ["max-claims: 1.5", "max-claims"],
      ["hint-on-natural-claims: yes", "hint-on-natural-claims"],
      ["labels: [a, ]", "labels"],
      ["exempt-users: [not a login!]", "exempt-users"],
      ["blocked-users: [-bad]", "blocked-users"],
      ["claimed-label: [a, b]", "claimed-label"],
      ["messages: hello", "messages"],
    ];
    for (const [src, key] of cases) {
      const { config, warnings } = readConfig(src);
      assert.deepEqual(config, DEFAULT_CONFIG, src);
      assert.ok(warnings.some((w) => w.includes(`\`${key}\``)), `${src} -> ${warnings.join(" | ")}`);
    }
  });
  it("one bad key does not spoil the good ones", () => {
    const { config, warnings } = readConfig("nudge-days: soon\nmax-claims: 4\n");
    assert.equal(config.nudgeDays, 7);
    assert.equal(config.maxClaims, 4);
    assert.equal(warnings.length, 1);
  });
  it("rejects the YAML it does not read, with the line", () => {
    const cases: [string, RegExp][] = [
      ["a: &x 1\n", /line 1/],
      ["a: *x\n", /line 1/],
      ["a: |\n  text\n", /line 1/],
      ["a: {b: 1}\n", /line 1/],
      ["\tnudge-days: 3\n", /tabs/],
      ["  stray: 1\n", /unexpected indentation/],
      ["labels:\n  - a\n  b: c\n", /mixes a list and a map/],
      ["max-claims: 1\nmax-claims: 2\n", /appears twice/],
      ["just words\n", /expected `key: value`/],
      ["labels:\n", /has no value/],
    ];
    for (const [src, re] of cases) {
      const { errors } = parseYaml(src);
      assert.ok(errors.some((e) => re.test(e)), `${JSON.stringify(src)} -> ${errors.join(" | ")}`);
    }
  });
  it("the first of two equal keys wins", () => {
    assert.equal(readConfig("max-claims: 1\nmax-claims: 9\n").config.maxClaims, 1);
  });
  it("ignores unknown keys with a warning, and unknown messages too", () => {
    const { warnings } = readConfig("colour: red\nmessages:\n  held: no\n");
    assert.ok(warnings.some((w) => w.includes("`colour`")));
    assert.ok(warnings.some((w) => w.includes("`messages.held`")));
  });
  it("keeps # inside quotes and strips it outside", () => {
    const { config } = readConfig('messages:\n  expired: "Released # not a comment"  # but this is\n');
    assert.equal(config.messages.expired, "Released # not a comment");
  });
  it("refuses a file that is too long, a message that is too long, and hostile label names", () => {
    assert.match(readConfig("a: 1\n".repeat(5000)).warnings[0], /longer than/);
    assert.ok(readConfig(`messages:\n  claimed: "${"x".repeat(601)}"\n`).warnings.some((w) => w.includes("messages.claimed")));
    assert.deepEqual(readConfig('labels: ["a\\u202eb"]').config.labels, []);
    assert.deepEqual(readConfig('labels: ["a\\nb"]').config.labels, []);
  });
  it("only accepts a plain relative path for the file", () => {
    assert.equal(configPath(undefined).path, ".github/claimable.yml");
    assert.equal(configPath("  ").warning, null);
    assert.deepEqual(configPath("config/bot.yml"), { path: "config/bot.yml", warning: null });
    for (const bad of ["../x.yml", "/etc/passwd", "a/../b.yml", "a b.yml", "x.yml?ref=evil", "a//b.yml", "$(id).yml", "a".repeat(101)]) {
      const r = configPath(bad);
      assert.equal(r.path, ".github/claimable.yml", bad);
      assert.ok(r.warning, bad);
    }
  });
});

describe("the example in docs/bot.md", () => {
  it("is read without a single warning and says what the docs say", () => {
    const docs = readFileSync(join(import.meta.dirname, "../docs/bot.md"), "utf8");
    const block = [...docs.matchAll(/```yaml\n([\s\S]*?)```/g)].map((m) => m[1]).find((y) => y.startsWith("nudge-days:"));
    assert.ok(block, "settings example");
    const { config, warnings } = readConfig(block);
    assert.deepEqual(warnings, []);
    assert.equal(config.nudgeDays, DEFAULT_CONFIG.nudgeDays);
    assert.equal(config.maxClaims, DEFAULT_CONFIG.maxClaims);
    assert.deepEqual(config.labels, ["good first issue", "help wanted"]);
    assert.deepEqual(config.exemptUsers, ["octocat"]);
    assert.ok(config.messages.claimed);
  });
});

describe("custom messages", () => {
  const marker = { claimant: "alice", since: "2026-09-01T09:00:00Z", nudgedAt: null };
  it("fills the placeholders and nothing else", () => {
    const text = renderComment(
      { kind: "claimed", claimant: "al<img>ice", since: "2026-09-01", nudgeOn: "2026-09-08", releaseOn: "2026-09-15" },
      marker,
      { claimed: "{user}: until {release-date} ({since}, {nudge-date}) {unknown} ${{ secrets.X }}" },
    );
    assert.equal(text.split("\n")[1], "@alimgice: until 2026-09-15 (2026-09-01, 2026-09-08) {unknown} ${{ secrets.X }}");
    assert.ok(text.startsWith("<!-- claimable-bot:v1 "));
  });
  it("never brings a placeholder in through a value", () => {
    const text = renderComment({ kind: "nudge", holder: "{release-date}", lastOn: "2026-09-01", releaseOn: "2026-09-15" }, marker, { nudge: "{user} {release-date}" });
    assert.equal(text.split("\n")[1], "@release-date 2026-09-15");
  });
  it("leaves the other replies alone", () => {
    const withMsgs = renderComment({ kind: "closed", requester: "bob" }, marker, { claimed: "x" });
    assert.equal(withMsgs, renderComment({ kind: "closed", requester: "bob" }, marker));
  });
});

describe("the configuration, end to end", () => {
  const dir = mkdtempSync(join(tmpdir(), "claimable-cfg-"));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const CASSETTES = join(dir, "cassettes");
  mkdirSync(CASSETTES);
  const put = (path: string, body: unknown, status = 200, error?: string) => {
    configure({ cassetteDir: CASSETTES });
    writeFileSync(cassettePath(path), JSON.stringify({ path, status, body, ...(error ? { error } : {}) }));
  };
  const issue = {
    number: 7, state: "open", locked: false, html_url: "https://github.com/acme/widgets/issues/7", title: "Fix typo",
    labels: [{ name: "good first issue" }], assignees: [], comments: 1, created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-10T00:00:00Z",
  };
  const said = (id: number, body: string) => ({ id, body, created_at: "2026-09-15T11:59:00Z", author_association: "NONE", user: { login: "alice", type: "User" } });
  const FILE = ".github/claimable.yml";
  const OTHER = "ops/bot.yml";
  put("/repos/acme/widgets/issues/7", issue);
  put("/repos/acme/widgets/issues/7/comments?per_page=100", [said(1, "/claim"), said(2, "can I take this?")]);
  put("/repos/acme/widgets/issues/7/timeline?per_page=100", []);
  put("/repos/acme/widgets/issues?state=open&labels=taken&assignee=alice&per_page=100", []);
  put("/repos/acme/widgets/issues?state=open&labels=claimed&assignee=alice&per_page=100", []);
  put(`/repos/acme/widgets/contents/${FILE}`, {
    encoding: "base64",
    content: Buffer.from('claimed-label: taken\nlabels: [help wanted]\nnudge-days: soon\nmessages:\n  claimed: "{user} yours until {release-date}"\n').toString("base64"),
  });
  put(`/repos/acme/widgets/contents/${OTHER}`, { encoding: "base64", content: Buffer.from("max-claims: 3\nhint-on-natural-claims: true\n").toString("base64") });
  put("/repos/acme/widgets/contents/broken.yml", null, 500, "boom");
  const payload = (id: number, body: string) => ({
    action: "created",
    issue: { number: 7 },
    comment: { id, body, created_at: "2026-09-15T11:59:00Z", author_association: "NONE", user: { login: "alice", type: "User" } },
    repository: { full_name: "acme/widgets", private: false },
  });
  const replay = () => configure({ cassetteMode: "replay", cassetteDir: CASSETTES, token: "", viewer: null });
  const stop = () => configure({ cassetteMode: "off", cassetteDir: "test/fixtures" });

  it("applies the file from the repository and reports what it could not use", async () => {
    replay();
    try {
      const run = await handle("issue_comment", payload(1, "/claim"), { token: null, dryRun: true });
      // The file asks for the label `help wanted`, which this issue lacks.
      assert.deepEqual(run.actions.map((a) => (a.type === "comment" ? a.reply.kind : a.type)), ["not-labelled"]);
      assert.ok(run.warnings.some((w) => w.includes("`nudge-days`")));
    } finally {
      stop();
    }
  });
  it("reads the path from the config input and uses the hint", async () => {
    replay();
    try {
      const run = await handle("issue_comment", payload(2, "can I take this?"), { token: null, dryRun: true, config: OTHER });
      assert.deepEqual(run.actions.map((a) => (a.type === "comment" ? a.reply.kind : a.type)), ["hint"]);
      assert.match(run.summary, /to reserve this issue, comment `\/claim`/);
    } finally {
      stop();
    }
  });
  it("does not act when the file cannot be read", async () => {
    replay();
    try {
      const run = await handle("issue_comment", payload(1, "/claim"), { token: null, dryRun: true, config: "broken.yml" });
      assert.deepEqual(run.actions, [{ type: "none", reason: "the configuration could not be read, so the bot does not act" }]);
      assert.ok(run.warnings.some((w) => w.includes("could not be read")));
    } finally {
      stop();
    }
  });
});
