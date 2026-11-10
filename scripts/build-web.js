#!/usr/bin/env node
/**
 * Assemble the browser version into `site/`.
 *
 * The page runs the command-line tool's own filters, not a port of them: the
 * plain-JS `dist/` that `npm run build` makes for npm is copied in as
 * `site/lib/`, and the four Node built-ins it imports are pointed at small
 * browser stand-ins by an import map in `web/index.html`. A verdict in the
 * browser is therefore the same code path as a verdict in a terminal.
 *
 * It also records the example the page shows before anyone has typed: a real
 * report, replayed from the committed fixtures on the evaluation date, and
 * labelled as such on the page.
 */

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { evalFigures } from "./eval-figures.js";

const SITE = "site";

if (!existsSync("dist/index.js")) {
  console.error("dist/ is missing — run `npm run build` first (npm run build:web does both)");
  process.exit(1);
}

rmSync(SITE, { recursive: true, force: true });
mkdirSync(SITE, { recursive: true });
cpSync("web", SITE, { recursive: true });
cpSync("dist", `${SITE}/lib`, { recursive: true });
// Pages would otherwise run the site through Jekyll, which skips nothing here
// but costs a build and has opinions about underscores.
writeFileSync(`${SITE}/.nojekyll`, "");

const RECORDED = "2026-09-15";
const BASE = "https://perezamadorluisenrique-gif.github.io/claimable";
process.env.CLAIMABLE_NOW = `${RECORDED}T12:00:00Z`;
const { configure } = await import("../dist/github.js");
const { analyze } = await import("../dist/analyze.js");

// Recorded reports, replayed from the committed fixtures: no API call, no rate
// limit. Each declares its verdict, and the build fails if a fixture change
// would turn the label into a lie. There is no VIABLE here on purpose: no
// fixture issue is cleared, and a verdict is never faked for the page.
const EXAMPLES = [
  { slug: "frappe-lms-2711", ref: { owner: "frappe", repo: "lms", number: 2711 }, verdict: "discard", label: "Says unassigned. A PR is already open.", blurb: "says unassigned, PR already open" },
  { slug: "openfoodfacts-1660", ref: { owner: "openfoodfacts", repo: "openfoodfacts-explorer", number: 1660 }, verdict: "discard", label: "Claimed in the thread.", blurb: "already claimed in the thread" },
  { slug: "musicblocks-352", ref: { owner: "sugarlabs", repo: "musicblocks-v4", number: 352 }, verdict: "reservations", label: "Stale claims.", blurb: "stale claims, check before starting" },
];

const examples = [];
for (const ex of EXAMPLES) {
  configure({ cassetteMode: "replay", cassetteDir: "test/fixtures", token: null, viewer: "perezamadorluisenrique-gif" });
  const report = await analyze(ex.ref);
  if (report.verdict !== ex.verdict) {
    console.error(`example ${ex.slug}: expected ${ex.verdict}, replay gave ${report.verdict}`);
    process.exit(1);
  }
  examples.push({ slug: ex.slug, verdict: ex.verdict, label: ex.label, blurb: ex.blurb, report });
}
const { figures, agree, of } = evalFigures();
const pkg = JSON.parse(readFileSync("package.json", "utf8"));

writeFileSync(
  `${SITE}/example.json`,
  `${JSON.stringify({ recorded: RECORDED, report: examples[0].report, examples, stats: { ...figures, agree, of } }, null, 2)}\n`,
);

// Search engines and link previews read static HTML, not the script's output,
// so each example also gets its own page whose head carries its verdict.
const page = readFileSync("web/index.html", "utf8");
const esc = (t) => t.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const word = { discard: "DISCARD", reservations: "CAUTION", viable: "VIABLE" };
const ld = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "claimable",
  applicationCategory: "DeveloperApplication",
  operatingSystem: "Node.js 18+",
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  license: "https://opensource.org/licenses/MIT",
  codeRepository: "https://github.com/perezamadorluisenrique-gif/claimable",
  downloadUrl: "https://www.npmjs.com/package/claimable",
  softwareVersion: pkg.version,
});
const withLd = (html) => html.replace("</head>", `<script type="application/ld+json">${ld}</script>\n</head>`);
writeFileSync(`${SITE}/index.html`, withLd(page).replace('<link rel="canonical" href="https://perezamadorluisenrique-gif.github.io/claimable/">', `<link rel="canonical" href="${BASE}/">`));
const urls = [`${BASE}/`];
for (const ex of examples) {
  const title = `${word[ex.verdict]} ${refText(ex.report.ref)}: ${ex.blurb}`;
  const url = `${BASE}/e/${ex.slug}/`;
  urls.push(url);
  const html = withLd(page)
    .replace("<head>", `<head>\n<base href="../../">`)
    .replace(/<title>.*?<\/title>/, `<title>${esc(title)} · claimable</title>`)
    .replace(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${esc(title)}">`)
    .replace(/<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${url}">`)
    .replace(/<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${url}">`)
    .replace("<body>", `<body data-example="${ex.slug}">`);
  mkdirSync(`${SITE}/e/${ex.slug}`, { recursive: true });
  writeFileSync(`${SITE}/e/${ex.slug}/index.html`, html);
}
// The free-issues index, from the collector's data (a checkout of the
// `index-data` branch). Without it the pages still build and say the first
// checks are pending.
const { buildFreeSite, FREE_BASE } = await import("../index/site.ts");
const free = buildFreeSite(SITE, process.env.CLAIMABLE_INDEX_DATA || "index-data");
for (const rel of free.pages) urls.push(FREE_BASE + (rel ? `${rel}/` : ""));
cpSync("docs/social-preview.png", `${SITE}/social-preview.png`);
writeFileSync(`${SITE}/robots.txt`, `User-agent: *\nAllow: /\nSitemap: ${BASE}/sitemap.xml\n`);
writeFileSync(`${SITE}/sitemap.xml`, `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${u}</loc></url>`).join("\n")}\n</urlset>\n`);

function refText(r) {
  return `${r.owner}/${r.repo}#${r.number}`;
}

console.log(`index: ${free.pages.length} pages, ${free.listed} issues listed`);
console.log(`built ${SITE}/ — ${examples.map((e) => `${e.verdict} ${refText(e.report.ref)}`).join(", ")}`);
