import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { defaultQuery, upsertReadmeBlock } from "./record-showcase.ts";

const readme = "intro\n<!-- example: a/b#1 2026-09-18 -->\n```\n$ claimable a/b#1\n```\nrest\n";

describe("record-showcase", () => {
  it("builds a query limited to recently updated issues", () => {
    assert.match(defaultQuery(new Date("2026-11-02T00:00:00Z")), /updated:>=2026-10-03/);
  });
  it("inserts the block after the first example", () => {
    const out = upsertReadmeBlock(readme, "x/y#2", "2026-11-02");
    assert.ok(out.indexOf("example-viable: x/y#2") > out.indexOf("example: a/b#1"));
    assert.ok(out.endsWith("rest\n"));
  });
  it("is idempotent and replaces an existing block", () => {
    const once = upsertReadmeBlock(readme, "x/y#2", "2026-11-02");
    assert.equal(upsertReadmeBlock(once, "x/y#2", "2026-11-02"), once);
    const twice = upsertReadmeBlock(once, "z/w#3", "2026-11-03");
    assert.ok(!twice.includes("x/y#2") && twice.includes("z/w#3"));
  });
  it("never lets record.ts wipe the showcase", () => {
    assert.match(readFileSync(new URL("./record.ts", import.meta.url), "utf8"), /test\/fixtures/);
  });
});
