import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, describe, it } from "node:test";
import { failureReason, outputBlock, readInputs } from "../action/main.ts";
import { cassettePath, configure } from "../src/github.ts";

const ROOT = resolve(import.meta.dirname, "..");
const dir = mkdtempSync(join(tmpdir(), "claimable-action-"));
after(() => rmSync(dir, { recursive: true, force: true }));

describe("readInputs", () => {
  it("applies defaults", () => {
    const i = readInputs({ INPUT_REPO: "o/r", INPUT_LABEL: "good first issue" });
    assert.deepEqual([i.limit, i.labels, i.skip, i.thorough, i.failOn, i.token], [20, ["good first issue"], [], false, "never", null]);
  });
  it("parses skip lists and empty labels", () => {
    const i = readInputs({ INPUT_REPO: "o/r", INPUT_SKIP: "claimants, environment", INPUT_LABEL: "" });
    assert.deepEqual(i.skip, ["claimants", "environment"]);
    assert.deepEqual(i.labels, []);
  });
  it("rejects bad input", () => {
    for (const bad of [{ INPUT_REPO: "nope" }, { INPUT_REPO: "o/r", INPUT_SKIP: "x" }, { INPUT_REPO: "o/r", INPUT_LIMIT: "0" },
      { INPUT_REPO: "o/r", INPUT_LIMIT: "101" }, { INPUT_REPO: "o/r", INPUT_LIMIT: "abc" }, { INPUT_REPO: "o/r", INPUT_FAIL_ON: "x" }]) {
      assert.throws(() => readInputs(bad));
    }
  });
});

describe("failureReason", () => {
  const c = (viable: number, caution: number, discard: number) => ({ total: viable + caution + discard, viable, caution, discard });
  it("never fails when never", () => assert.equal(failureReason("never", c(0, 0, 3)), null));
  it("no-viable", () => {
    assert.ok(failureReason("no-viable", c(0, 1, 1)));
    assert.equal(failureReason("no-viable", c(1, 0, 1)), null);
  });
  it("any-discard", () => {
    assert.ok(failureReason("any-discard", c(2, 0, 1)));
    assert.equal(failureReason("any-discard", c(2, 1, 0)), null);
  });
  it("any-not-viable", () => {
    assert.ok(failureReason("any-not-viable", c(2, 1, 0)));
    assert.equal(failureReason("any-not-viable", c(2, 0, 0)), null);
  });
});

describe("outputBlock", () => {
  it("uses name=value for one line", () => assert.equal(outputBlock("a", "b"), "a=b\n"));
  it("uses a delimiter for several lines", () => assert.match(outputBlock("a", "b\nc"), /^a<<CLAIMABLE_EOF\nb\nc\nCLAIMABLE_EOF\n$/));
});

describe("action end to end, offline", () => {
  cpSync(join(ROOT, "test/fixtures"), dir, { recursive: true });
  configure({ cassetteDir: dir });
  const path = "/repos/frappe/lms/issues?state=open&per_page=30&page=1&labels=good+first+issue";
  writeFileSync(cassettePath(path), JSON.stringify({ path, status: 200, body: [{ number: 2711 }] }));
  configure({ cassetteDir: "test/fixtures" });

  const exec = (failOn: string) => {
    const summary = join(dir, `summary-${failOn}.md`);
    const output = join(dir, `output-${failOn}.txt`);
    writeFileSync(summary, "");
    writeFileSync(output, "");
    const run = spawnSync(process.execPath, [join(ROOT, "action/main.ts")], {
      encoding: "utf8",
      env: {
        ...process.env, CLAIMABLE_CASSETTE: "replay", CLAIMABLE_CASSETTE_DIR: dir, CLAIMABLE_NOW: "2026-09-15T12:00:00Z",
        GITHUB_STEP_SUMMARY: summary, GITHUB_OUTPUT: output, RUNNER_TEMP: dir, GITHUB_TOKEN: "", GH_TOKEN: "",
        INPUT_REPO: "frappe/lms", INPUT_LABEL: "good first issue", INPUT_LIMIT: "1", INPUT_TOKEN: "", INPUT_FAIL_ON: failOn,
      },
    });
    return { run, summary: readFileSync(summary, "utf8"), output: readFileSync(output, "utf8") };
  };

  it("writes the summary and outputs and exits 0 on never", () => {
    const r = exec("never");
    assert.equal(r.run.status, 0, r.run.stdout + r.run.stderr);
    assert.match(r.summary, /DISCARD/);
    assert.match(r.summary, /frappe\/lms#2711/);
    assert.match(r.output, /^total=1$/m);
    assert.match(r.output, /^discard=1$/m);
  });
  it("exits 1 on any-discard", () => {
    const r = exec("any-discard");
    assert.equal(r.run.status, 1);
    assert.match(r.run.stdout, /::error::/);
  });
});

describe("action.yml and its docs", () => {
  const yml = readFileSync(join(ROOT, "action.yml"), "utf8");
  const inputsBlock = yml.slice(yml.indexOf("\ninputs:"), yml.indexOf("\noutputs:"));
  const names = [...inputsBlock.matchAll(/^  ([a-z-]+):/gm)].map((m) => m[1]);
  const main = readFileSync(join(ROOT, "action/main.ts"), "utf8");
  const docs = readFileSync(join(ROOT, "docs/action.md"), "utf8");
  it("every input is read, passed and documented", () => {
    assert.ok(names.length >= 7);
    for (const n of names) {
      const env = `INPUT_${n.toUpperCase().replace(/-/g, "_")}`;
      assert.ok(main.includes(env), `${env} not read in main.ts`);
      assert.ok(yml.includes(`${env}: \${{ inputs.${n} }}`), `${env} not passed in action.yml`);
      assert.ok(docs.includes(`\`${n}\``), `${n} not in docs/action.md`);
    }
  });
});
