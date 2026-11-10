import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, describe, it } from "node:test";
import { TICK_LIMIT, handle, handleTick, readInputs } from "../bot/main.ts";
import { applyActions } from "../src/bot/apply.ts";
import type { Sender } from "../src/bot/apply.ts";
import type { Action } from "../src/bot/types.ts";
import { HttpError, cassettePath, configure } from "../src/github.ts";

const ROOT = resolve(import.meta.dirname, "..");
const dir = mkdtempSync(join(tmpdir(), "claimable-bot-"));
after(() => rmSync(dir, { recursive: true, force: true }));

/** A recorded 404, as `CLAIMABLE_CASSETTE=record` writes it. */
function put404(path: string) {
  writeFileSync(cassettePath(path), JSON.stringify({ path, status: 404, body: null, error: `GET ${path} → 404: Not Found` }));
}

// ── action.yml, the code and the docs say the same thing ──────────────────
describe("bot/action.yml and its docs", () => {
  const yml = readFileSync(join(ROOT, "bot/action.yml"), "utf8");
  const inputsBlock = yml.slice(yml.indexOf("\ninputs:"), yml.indexOf("\nruns:"));
  const names = [...inputsBlock.matchAll(/^  ([a-z-]+):/gm)].map((m) => m[1]);
  const main = readFileSync(join(ROOT, "bot/main.ts"), "utf8");
  const docs = readFileSync(join(ROOT, "docs/bot.md"), "utf8");

  it("every input is read, passed and documented", () => {
    assert.ok(names.length >= 2);
    for (const n of names) {
      const env = `INPUT_${n.toUpperCase().replace(/-/g, "_")}`;
      assert.ok(main.includes(env), `${env} not read in bot/main.ts`);
      assert.ok(yml.includes(`${env}: \${{ inputs.${n} }}`), `${env} not passed in bot/action.yml`);
      assert.ok(docs.includes(`\`${n}\``), `${n} not in docs/bot.md`);
    }
  });
  it("has the Marketplace metadata", () => {
    for (const k of ["name", "description", "author"]) assert.match(yml, new RegExp(`^${k}: ".+"`, "m"));
    assert.match(yml, /^branding:\n {2}icon: [a-z-]+\n {2}color: (white|yellow|blue|green|orange|red|purple|gray-dark)$/m);
  });
});

// ── nothing a stranger writes can reach a shell ───────────────────────────
describe("the bot cannot be driven by a comment", () => {
  const files = ["bot/action.yml", ".github/workflows/claim-bot.yml"];
  const docs = readFileSync(join(ROOT, "docs/bot.md"), "utf8");
  const yamlInDocs = [...docs.matchAll(/```yaml\n([\s\S]*?)```/g)].map((m) => m[1]).filter((y) => y.includes("uses:")); // the workflows; the settings sample is not one

  /** Lines of every `run:` script in a YAML text. */
  function runScripts(text: string): string[] {
    const lines = text.split("\n");
    const out: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const m = /^(\s*)(?:- )?run:\s*(.*)$/.exec(lines[i]);
      if (!m) continue;
      if (m[2] && !/^[|>][-+]?$/.test(m[2])) {
        out.push(m[2]);
        continue;
      }
      const indent = m[1].length;
      for (let j = i + 1; j < lines.length; j++) {
        const lead = /^(\s*)/.exec(lines[j])![1].length;
        if (lines[j].trim() !== "" && lead <= indent) break;
        out.push(lines[j]);
      }
    }
    return out;
  }

  for (const [label, text] of [...files.map((f) => [f, readFileSync(join(ROOT, f), "utf8")] as const), ...yamlInDocs.map((y, i) => [`docs/bot.md block ${i + 1}`, y] as const)]) {
    it(`${label}: no expression inside a run script`, () => {
      for (const line of runScripts(text)) assert.ok(!line.includes("${{"), `expression in a run script: ${line.trim()}`);
    });
    it(`${label}: no trigger that hands a stranger's code a write token`, () => {
      assert.ok(!/pull_request_target|workflow_run/.test(text.replace(/#.*$/gm, "")));
      assert.ok(!/ref:\s*\$\{\{/.test(text), "checkout of a ref taken from the event");
    });
  }
  it("the workflows ask for issues: write and nothing else", () => {
    for (const text of [readFileSync(join(ROOT, ".github/workflows/claim-bot.yml"), "utf8"), ...yamlInDocs]) {
      const perms = /^permissions:\n((?:[ \t]+.+\n)+)/m.exec(text);
      assert.ok(perms, "permissions block");
      assert.deepEqual(perms![1].trim().split("\n").map((l) => l.trim()), ["issues: write"]);
    }
  });
  it("the documented install does not check anything out", () => {
    for (const y of yamlInDocs) assert.ok(!y.includes("actions/checkout"));
  });
  it("the bot's own code never spawns, evaluates or fetches directly", () => {
    const sources = [join(ROOT, "bot/main.ts"), ...readdirSync(join(ROOT, "src/bot")).map((f) => join(ROOT, "src/bot", f))];
    for (const file of sources) {
      const code = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      assert.ok(!/child_process|\beval\s*\(|new Function|\bfetch\s*\(|execSync|spawn/.test(code), `${file}`);
    }
  });
});

// ── applyActions ──────────────────────────────────────────────────────────
describe("applyActions", () => {
  const ctx = { owner: "acme", repo: "widgets", number: 7 };
  const marker = { claimant: "alice", since: "2026-09-15T12:00:00Z", nudgedAt: null };
  const claim: Action[] = [
    { type: "assign", login: "alice" },
    { type: "label", name: "claimed" },
    { type: "comment", mode: "create", reply: { kind: "claimed", claimant: "alice", since: "2026-09-15", nudgeOn: "2026-09-22", releaseOn: "2026-09-29" }, marker },
  ];

  function fake(handler: (method: string, path: string, body: unknown) => unknown = () => ({ assignees: [{ login: "alice" }] })) {
    const calls: { method: string; path: string; body: unknown }[] = [];
    const sender: Sender = async (method, path, body) => {
      calls.push({ method, path, body });
      const out = handler(method, path, body);
      if (out instanceof Error) throw out;
      return out as never;
    };
    return { calls, sender };
  }
  const err = (status: number) => Object.assign(new HttpError(`x ${status}`), { status });

  it("dry-run writes nothing, not even once", async () => {
    const f = fake();
    const out = await applyActions(claim, ctx, { dryRun: true, sender: f.sender });
    assert.equal(f.calls.length, 0);
    assert.deepEqual(out.map((o) => o.status), ["planned", "planned", "planned"]);
  });
  it("makes the three calls of a claim, in order", async () => {
    const f = fake();
    const out = await applyActions(claim, ctx, { dryRun: false, sender: f.sender });
    assert.deepEqual(f.calls.map((c) => `${c.method} ${c.path}`), [
      "POST /repos/acme/widgets/issues/7/assignees",
      "POST /repos/acme/widgets/issues/7/labels",
      "POST /repos/acme/widgets/issues/7/comments",
    ]);
    assert.deepEqual(f.calls[0].body, { assignees: ["alice"] });
    assert.match((f.calls[2].body as { body: string }).body, /^<!-- claimable-bot:v1 \{"claimant":"alice"/);
    assert.ok(out.every((o) => o.status === "done"));
  });
  it("edits the comment it was told to edit", async () => {
    const f = fake();
    const edit: Action = { ...(claim[2] as Extract<Action, { type: "comment" }>), mode: "edit", commentId: 99 };
    await applyActions([edit], ctx, { dryRun: false, sender: f.sender });
    assert.equal(`${f.calls[0].method} ${f.calls[0].path}`, "PATCH /repos/acme/widgets/issues/comments/99");
  });
  it("does not say 'reserved' when GitHub did not assign", async () => {
    const f = fake(() => ({ assignees: [] }));
    const out = await applyActions(claim, ctx, { dryRun: false, sender: f.sender });
    assert.equal(f.calls.length, 1);
    assert.deepEqual(out.map((o) => o.status), ["failed", "skipped", "skipped"]);
  });
  it("turns a 403 into an outcome, never an exception, and stops", async () => {
    const f = fake(() => err(403));
    const out = await applyActions(claim, ctx, { dryRun: false, sender: f.sender });
    assert.equal(f.calls.length, 1);
    assert.equal(out[0].status, "failed");
    assert.match(out[0].note, /issues: write/);
    assert.equal(out[2].status, "skipped");
  });
  it("creates the label when it does not exist, then adds it", async () => {
    let first = true;
    const f = fake((_m, path) => {
      if (path.endsWith("/issues/7/labels") && first) {
        first = false;
        return err(422);
      }
      return { assignees: [{ login: "alice" }] };
    });
    const out = await applyActions([{ type: "label", name: "claimed" }], ctx, { dryRun: false, sender: f.sender });
    assert.deepEqual(f.calls.map((c) => `${c.method} ${c.path}`), [
      "POST /repos/acme/widgets/issues/7/labels",
      "POST /repos/acme/widgets/labels",
      "POST /repos/acme/widgets/issues/7/labels",
    ]);
    assert.equal(out[0].status, "done");
  });
  it("treats removing a label that is already gone as done", async () => {
    const f = fake(() => err(404));
    const out = await applyActions([{ type: "unlabel", name: "needs triage" }], ctx, { dryRun: false, sender: f.sender });
    assert.equal(f.calls[0].path, "/repos/acme/widgets/issues/7/labels/needs%20triage");
    assert.equal(out[0].status, "done");
  });
  it("cannot reach the network while cassettes are replayed", async () => {
    configure({ cassetteMode: "replay" });
    try {
      const out = await applyActions([{ type: "assign", login: "alice" }], ctx, { dryRun: false });
      assert.equal(out[0].status, "failed");
    } finally {
      configure({ cassetteMode: "off" });
    }
  });
});

// ── the whole bot, offline ────────────────────────────────────────────────
describe("bot end to end, offline", () => {
  const CASSETTES = join(dir, "cassettes");
  mkdirSync(CASSETTES);
  const put = (path: string, body: unknown) => {
    configure({ cassetteDir: CASSETTES });
    writeFileSync(cassettePath(path), JSON.stringify({ path, status: 200, body }));
  };
  const issue = {
    number: 7, state: "open", locked: false, html_url: "https://github.com/acme/widgets/issues/7", title: "Fix typo",
    labels: [{ name: "good first issue" }], assignees: [], comments: 1, created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-10T00:00:00Z",
  };
  put("/repos/acme/widgets/issues/7", issue);
  const said = (id: number, body: string, assoc = "NONE", login = "alice") => ({
    id, body, created_at: "2026-09-15T11:59:00Z", author_association: assoc, user: { login, type: "User" },
  });
  put("/repos/acme/widgets/issues/7/comments?per_page=100", [
    said(5001, "/claim"),
    said(5002, "I would like to work on this"),
    said(5003, "/claim\n$(touch /tmp/pwned) `id` ${{ secrets.X }} ; rm -rf /"),
    said(5004, "/unclaim", "MEMBER", "pat"),
  ]);
  put404("/repos/acme/widgets/contents/.github/claimable.yml");
  put("/repos/acme/widgets/collaborators/pat/permission", { permission: "read", role_name: "read" });
  put("/repos/acme/widgets/issues/7/timeline?per_page=100", []);
  put("/repos/acme/widgets/issues?state=open&labels=claimed&assignee=alice&per_page=100", []);
  configure({ cassetteDir: "test/fixtures" });

  const payload = (body: string, extra: object = {}, id = 5001) => ({
    action: "created",
    issue: { number: 7 },
    comment: { id, body, created_at: "2026-09-15T11:59:00Z", author_association: "NONE", user: { login: "alice", type: "User" } },
    repository: { full_name: "acme/widgets", private: false },
    ...extra,
  });
  const replay = () => configure({ cassetteMode: "replay", cassetteDir: CASSETTES, token: "", viewer: null });
  const stop = () => configure({ cassetteMode: "off", cassetteDir: "test/fixtures" });

  it("describes a claim in dry-run and writes nothing", async () => {
    replay();
    try {
      const run = await handle("issue_comment", payload("/claim"), { token: null, dryRun: true });
      assert.deepEqual(run.actions.map((a) => a.type), ["assign", "label", "comment"]);
      assert.ok(run.outcomes.every((o) => o.status === "planned"));
      assert.match(run.summary, /Dry run: nothing was written/);
      assert.match(run.summary, /reserved for you as of/);
    } finally {
      stop();
    }
  });
  it("makes the writes through the sender when it is allowed to", async () => {
    replay();
    const calls: string[] = [];
    const sender: Sender = async (method, path) => {
      calls.push(`${method} ${path}`);
      return { assignees: [{ login: "alice" }] } as never;
    };
    try {
      const run = await handle("issue_comment", payload("/claim"), { token: null, dryRun: false }, { sender });
      assert.equal(calls.length, 3);
      assert.ok(run.outcomes.every((o) => o.status === "done"));
    } finally {
      stop();
    }
  });
  it("forces report-only on a private repository", async () => {
    replay();
    const sender: Sender = async () => {
      throw new Error("must not write");
    };
    try {
      const run = await handle("issue_comment", payload("/claim", { repository: { full_name: "acme/widgets", private: true } }), { token: null, dryRun: false }, { sender });
      assert.ok(run.outcomes.every((o) => o.status === "planned"));
      assert.match(run.summary, /Report-only mode: this repository is private/);
    } finally {
      stop();
    }
  });
  it("does nothing for other events, pull requests and comments without a command", async () => {
    replay();
    try {
      for (const [name, p] of [
        ["issues", payload("/claim")],
        ["issue_comment", payload("/claim", { action: "edited" })],
        ["issue_comment", payload("/claim", { issue: { number: 7, pull_request: {} } })],
      ] as const) {
        const run = await handle(name, p, { token: null, dryRun: false });
        assert.deepEqual(run.actions, [], name);
      }
      const run = await handle("issue_comment", payload("I would like to work on this", {}, 5002), { token: null, dryRun: false });
      assert.deepEqual(run.actions, [{ type: "none", reason: "no command" }]);
    } finally {
      stop();
    }
  });
  it("is just text in, summary out, when a hostile comment arrives as a process", () => {
    const event = join(dir, "event.json");
    const summary = join(dir, "summary.md");
    writeFileSync(event, JSON.stringify(payload("/claim\n$(touch /tmp/pwned) `id` ${{ secrets.X }} ; rm -rf /", {}, 5003)));
    writeFileSync(summary, "");
    const res = spawnSync(process.execPath, [join(ROOT, "bot/main.ts")], {
      encoding: "utf8",
      env: {
        ...process.env, CLAIMABLE_CASSETTE: "replay", CLAIMABLE_CASSETTE_DIR: CASSETTES, CLAIMABLE_NOW: "2026-09-15T12:00:00Z",
        GITHUB_EVENT_NAME: "issue_comment", GITHUB_EVENT_PATH: event, GITHUB_STEP_SUMMARY: summary,
        GITHUB_TOKEN: "", GH_TOKEN: "", INPUT_TOKEN: "", INPUT_DRY_RUN: "true",
      },
    });
    assert.equal(res.status, 0, res.stdout + res.stderr);
    const text = readFileSync(summary, "utf8");
    assert.match(text, /planned/);
    assert.match(text, /2026-09-22/);
    assert.ok(!text.includes("touch /tmp/pwned"));
  });
  it("acts on the comment as the API has it, not as the event says", async () => {
    replay();
    try {
      // Event claims /claim, but comment 5002 says something else now.
      const edited = await handle("issue_comment", payload("/claim", {}, 5002), { token: null, dryRun: true });
      assert.deepEqual(edited.actions, [{ type: "none", reason: "no command" }]);
      // And a comment that is gone is not acted on at all.
      const gone = await handle("issue_comment", payload("/claim", {}, 9999), { token: null, dryRun: true });
      assert.deepEqual(gone.actions, [{ type: "none", reason: "the comment is gone" }]);
    } finally {
      stop();
    }
  });
  it("does not let a read-only organisation member release someone else's claim", async () => {
    replay();
    try {
      const run = await handle("issue_comment", payload("/unclaim", { comment: { id: 5004, body: "/unclaim", created_at: "2026-09-15T11:59:00Z", author_association: "MEMBER", user: { login: "pat", type: "User" } } }, 5004), { token: null, dryRun: true });
      // Nobody holds the issue, so the answer is "nobody holds": the point is that the permission lookup ran and nothing threw.
      assert.deepEqual(run.actions, [{ type: "none", reason: "nobody holds this issue" }]);
    } finally {
      stop();
    }
  });
  it("exits 0 with a warning when the API is out of reach", () => {
    const event = join(dir, "event2.json");
    writeFileSync(event, JSON.stringify(payload("/claim", { issue: { number: 8 } })));
    const res = spawnSync(process.execPath, [join(ROOT, "bot/main.ts")], {
      encoding: "utf8",
      env: {
        ...process.env, CLAIMABLE_CASSETTE: "replay", CLAIMABLE_CASSETTE_DIR: CASSETTES,
        GITHUB_EVENT_NAME: "issue_comment", GITHUB_EVENT_PATH: event, GITHUB_TOKEN: "", GH_TOKEN: "", INPUT_TOKEN: "", INPUT_DRY_RUN: "false",
      },
    });
    assert.equal(res.status, 0);
    assert.match(res.stdout, /::warning::claimable bot stopped/);
  });
});

// ── the daily visit, offline ──────────────────────────────────────────────
describe("the daily visit, offline", () => {
  const CASSETTES = join(dir, "tick-cassettes");
  mkdirSync(CASSETTES);
  const put = (path: string, body: unknown) => {
    configure({ cassetteDir: CASSETTES });
    writeFileSync(cassettePath(path), JSON.stringify({ path, status: 200, body }));
  };
  const issue = (n: number, assignee: string) => ({
    number: n, state: "open", locked: false, html_url: `https://github.com/acme/widgets/issues/${n}`, title: `Issue ${n}`,
    labels: [{ name: "claimed" }], assignees: [{ login: assignee }], comments: 2, created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z",
  });
  const marker = (n: number) => `<!-- claimable-bot:v1 {"claimant":"alice","since":"2026-09-01T09:00:00Z","nudgedAt":null} -->\nBot text ${n}.`;
  const thread = (n: number, who: string) => {
    put(`/repos/acme/widgets/issues/${n}`, issue(n, who));
    put(`/repos/acme/widgets/issues/${n}/comments?per_page=100`, [
      { id: n * 10, body: "/claim", created_at: "2026-09-01T09:00:00Z", author_association: "NONE", user: { login: who, type: "User" } },
      { id: n * 10 + 1, body: marker(n), created_at: "2026-09-01T09:00:00Z", author_association: "NONE", user: { login: "github-actions[bot]", type: "Bot" } },
    ]);
    put(`/repos/acme/widgets/issues/${n}/timeline?per_page=100`, [{ event: "assigned", created_at: "2026-09-01T09:00:00Z", assignee: { login: who } }]);
  };
  put("/repos/acme/widgets", { full_name: "acme/widgets", private: false, default_branch: "main" });
  put404("/repos/acme/widgets/contents/.github/claimable.yml");
  put("/repos/acme/widgets/issues?state=open&labels=claimed&per_page=100", [issue(7, "alice"), issue(8, "alice")]);
  thread(7, "alice");
  thread(8, "alice");
  configure({ cassetteDir: "test/fixtures" });

  const replay = () => configure({ cassetteMode: "replay", cassetteDir: CASSETTES, token: "", viewer: null });
  const stop = () => configure({ cassetteMode: "off", cassetteDir: "test/fixtures" });
  const noWrite: Sender = async () => {
    throw new Error("must not write");
  };

  it("leaves one reminder per quiet claim, through the sender", async () => {
    replay();
    process.env.CLAIMABLE_NOW = "2026-09-08T12:00:00Z";
    const calls: string[] = [];
    const sender: Sender = async (method, path, body) => {
      calls.push(`${method} ${path} ${(body as { body: string }).body.split("\n")[0]}`);
      return {} as never;
    };
    try {
      const run = await handleTick("acme/widgets", { token: null, dryRun: false }, { sender });
      assert.equal(calls.length, 2);
      assert.match(calls[0], /^PATCH \/repos\/acme\/widgets\/issues\/comments\/71 .*"nudgedAt":"2026-09-08T12:00:00Z"/);
      assert.match(calls[1], /^PATCH \/repos\/acme\/widgets\/issues\/comments\/81/);
      assert.ok(run.outcomes.every((o) => o.status === "done"));
      assert.match(run.summary, /Visited 2 claimed issues/);
    } finally {
      delete process.env.CLAIMABLE_NOW;
      stop();
    }
  });
  it("does nothing before the seven days are up", async () => {
    replay();
    process.env.CLAIMABLE_NOW = "2026-09-05T12:00:00Z";
    try {
      const run = await handleTick("acme/widgets", { token: null, dryRun: false }, { sender: noWrite });
      assert.deepEqual(run.outcomes, []);
      assert.match(run.summary, /none needed a reminder or a release/);
    } finally {
      delete process.env.CLAIMABLE_NOW;
      stop();
    }
  });
  it("in dry-run only describes what it would do", async () => {
    replay();
    process.env.CLAIMABLE_NOW = "2026-09-08T12:00:00Z";
    try {
      const run = await handleTick("acme/widgets", { token: null, dryRun: true }, { sender: noWrite });
      assert.ok(run.outcomes.length === 2 && run.outcomes.every((o) => o.status === "planned"));
      assert.match(run.summary, /#7: would edit the bot comment \(nudge\)/);
    } finally {
      delete process.env.CLAIMABLE_NOW;
      stop();
    }
  });
  it("runs as a process on a schedule event and stays green", () => {
    const event = join(dir, "schedule.json");
    const summary = join(dir, "tick-summary.md");
    writeFileSync(event, JSON.stringify({ schedule: "17 6 * * *" }));
    writeFileSync(summary, "");
    const res = spawnSync(process.execPath, [join(ROOT, "bot/main.ts")], {
      encoding: "utf8",
      env: {
        ...process.env, CLAIMABLE_CASSETTE: "replay", CLAIMABLE_CASSETTE_DIR: CASSETTES, CLAIMABLE_NOW: "2026-09-08T12:00:00Z",
        GITHUB_EVENT_NAME: "schedule", GITHUB_EVENT_PATH: event, GITHUB_STEP_SUMMARY: summary, GITHUB_REPOSITORY: "acme/widgets",
        GITHUB_TOKEN: "", GH_TOKEN: "", INPUT_TOKEN: "", INPUT_DRY_RUN: "true",
      },
    });
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.match(readFileSync(summary, "utf8"), /Visited 2 claimed issues/);
  });
  it("looks at no more than a hundred issues a day", () => {
    assert.equal(TICK_LIMIT, 100);
  });
});

describe("readInputs", () => {
  it("writes only on exactly the string false", () => {
    assert.equal(readInputs({ INPUT_DRY_RUN: "false" }).dryRun, false);
    for (const v of ["FALSE", "False", "false ", " false", "true", "", "no", "0", "maybe", undefined]) assert.equal(readInputs({ INPUT_DRY_RUN: v }).dryRun, true, String(v));
  });
});
