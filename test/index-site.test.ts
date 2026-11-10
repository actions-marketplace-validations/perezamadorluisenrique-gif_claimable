import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { buildFreeSite, listed, slug } from "../index/site.ts";
import type { ProjectData } from "../index/collect.ts";

const NOW = Date.parse("2026-11-10T12:00:00Z");
const iss = (number: number, verdict: "viable" | "discard" | "reservations", checkedAt = "2026-11-10T10:00:00Z") => ({
  number, title: `Fix <thing> ${number}`, url: `https://github.com/acme/widget/issues/${number}`, labels: ["good first issue"],
  updatedAt: "2026-11-09T00:00:00Z", checkedAt, verdict, reason: verdict, evidence: [],
});
const DATA: ProjectData[] = [
  { owner: "acme", repo: "widget", language: "C++", stars: 10, description: "Widgets & more", visitedAt: "2026-11-10T10:00:00Z",
    issues: [iss(1, "viable"), iss(2, "discard"), iss(3, "reservations"), iss(4, "viable", "2026-11-01T00:00:00Z")] },
  { owner: "Other", repo: "Thing", language: "Go", visitedAt: "2026-11-10T10:00:00Z", issues: [] },
];

function build() {
  const data = mkdtempSync(join(tmpdir(), "idxd-"));
  for (const p of DATA) {
    mkdirSync(join(data, "data", p.owner.toLowerCase()), { recursive: true });
    writeFileSync(join(data, "data", p.owner.toLowerCase(), `${p.repo.toLowerCase()}.json`), JSON.stringify(p));
  }
  const site = mkdtempSync(join(tmpdir(), "idxs-"));
  return { site, built: buildFreeSite(site, data, NOW) };
}

function pages(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...pages(p));
    else if (e.endsWith(".html")) out.push(p);
  }
  return out;
}

describe("free issues index site", () => {
  it("lists only recent viable issues", () => {
    assert.deepEqual(listed(DATA, NOW).map((r) => r.number), [1]);
  });

  it("writes home, Spanish home, one page per language and per project", () => {
    const { site, built } = build();
    assert.equal(built.listed, 1);
    assert.deepEqual(built.pages.sort(), ["", "es", "lang/cpp", "lang/go", "p/acme/widget", "p/other/thing"].sort());
    const home = readFileSync(join(site, "free/index.html"), "utf8");
    assert.match(home, /No signs of being taken, checked 2026-11-10/);
    assert.doesNotMatch(home, /Fix &lt;thing&gt; 2|Fix &lt;thing&gt; 3|Fix &lt;thing&gt; 4/);
    assert.match(home, /Fix &lt;thing&gt; 1/, "titles are escaped");
    assert.match(home, /issues\/new\?title=Index/, "report a mistake link");
    const es = readFileSync(join(site, "free/es/index.html"), "utf8");
    assert.match(es, /<html lang="es">/);
    assert.match(es, /Sin señales de estar tomado, comprobado el 2026-11-10/);
    assert.equal(slug("C#"), "csharp");
  });

  it("every page has one h1, no resources from other servers, and never says free as a fact", () => {
    const { site } = build();
    for (const file of pages(join(site, "free"))) {
      const html = readFileSync(file, "utf8");
      assert.equal(html.match(/<h1[\s>]/g)?.length, 1, file);
      assert.doesNotMatch(html, /<(script|img|iframe)[^>]+src=/i, file);
      assert.doesNotMatch(html, /<link[^>]+rel="(stylesheet|preconnect|preload|icon)"/i, file);
      assert.doesNotMatch(html, /\b(is|are) (free|available) to (work on|take)\b|guaranteed/i, file);
      assert.match(html, /<meta name="viewport"/);
    }
  });

  it("builds an empty index that says checks are pending", () => {
    const site = mkdtempSync(join(tmpdir(), "idxe-"));
    const built = buildFreeSite(site, join(site, "nothing"), NOW);
    assert.equal(built.listed, 0);
    assert.match(readFileSync(join(site, "free/index.html"), "utf8"), /No issues to show yet/);
  });
});
