import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { LANGUAGES, query, select, type RepoHit } from "../index/build-projects.ts";

const hit = (name: string, stars: number, over: Partial<RepoHit> = {}): RepoHit => ({
  full_name: `o/${name}`, owner: { login: "o" }, name, stargazers_count: stars, description: "",
  archived: false, fork: false, language: "Go", pushed_at: "2026-11-01T00:00:00Z", ...over,
});

describe("project list", () => {
  it("keeps the most-starred live software repositories per language", () => {
    const got = select({
      Go: [hit("a", 10), hit("b", 30), hit("old", 99, { pushed_at: "2026-01-01" }), hit("arch", 98, { archived: true }),
        hit("awesome-go", 97), hit("c", 20, { description: "Interview guide" }), hit("d", 5)],
      Rust: [hit("b", 30), hit("r", 1)],
    }, 2, new Set(["o/d"]), "2026-08-12");
    assert.deepEqual(got.map((p) => `${p.language}:${p.repo}`), ["Go:b", "Go:a", "Rust:r"]);
  });

  it("honours the exclusion list", () => {
    assert.equal(select({ Go: [hit("a", 1)] }, 5, new Set(["o/a"]), "2026-01-01").length, 0);
  });

  it("quotes languages with symbols", () => {
    assert.match(query("C#", "good-first-issues:>=1", "2026-08-12"), /^language:"C#" /);
    assert.match(query("Go", "help-wanted-issues:>=1", "2026-08-12"), /^language:Go help-wanted/);
  });

  it("the committed list has 300 unique projects across the 20 languages", () => {
    const list = JSON.parse(readFileSync("index/projects.json", "utf8")) as { owner: string; repo: string; language: string }[];
    assert.equal(list.length, 300);
    assert.equal(new Set(list.map((p) => `${p.owner}/${p.repo}`.toLowerCase())).size, 300);
    assert.deepEqual([...new Set(list.map((p) => p.language))].sort(), [...LANGUAGES].sort());
  });
});
