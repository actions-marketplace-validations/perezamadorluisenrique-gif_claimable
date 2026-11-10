/**
 * The free-issues index pages, written into `site/free/` by `scripts/build-web.js`.
 *
 * Every page is static HTML that works without JavaScript; a small inline
 * script only filters the rows already on the page. Nothing loads from another
 * server. An issue is listed only when its stored verdict is `viable` and its
 * check is recent, and the wording never says an issue is free: it says no sign
 * of it being taken was found, and when.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ProjectData, StoredIssue } from "./collect.ts";

/** A listed issue older than this is left out, whatever the collector did. */
export const MAX_AGE_DAYS = 4;
const REPO = "https://github.com/perezamadorluisenrique-gif/claimable";
const BASE = "https://perezamadorluisenrique-gif.github.io/claimable/free/";

export type Row = StoredIssue & { owner: string; repo: string; language: string };

export function esc(t: string): string {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function slug(t: string): string {
  return t.toLowerCase().replace(/\+/g, "p").replace(/#/g, "sharp").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function readData(dir: string): ProjectData[] {
  const root = join(dir, "data");
  if (!existsSync(root)) return [];
  const out: ProjectData[] = [];
  for (const owner of readdirSync(root).sort()) {
    for (const file of readdirSync(join(root, owner)).sort()) {
      if (file.endsWith(".json")) out.push(JSON.parse(readFileSync(join(root, owner, file), "utf8")) as ProjectData);
    }
  }
  return out;
}

/** The rows the index may show: viable and checked within MAX_AGE_DAYS of `now`. */
export function listed(projects: ProjectData[], now: number): Row[] {
  const rows: Row[] = [];
  for (const p of projects) {
    for (const i of p.issues) {
      if (i.verdict !== "viable") continue;
      if ((now - Date.parse(i.checkedAt)) / 86_400_000 > MAX_AGE_DAYS) continue;
      rows.push({ ...i, owner: p.owner, repo: p.repo, language: p.language ?? "Other" });
    }
  }
  return rows.sort((a, b) => b.checkedAt.localeCompare(a.checkedAt) || a.owner.localeCompare(b.owner) || a.number - b.number);
}

const T = {
  en: {
    title: "Free issues index",
    lede: "Beginner-friendly GitHub issues where claimable found no sign of anyone already working on them. Every row says when it was checked. Read the thread before you start: a check is not a promise.",
    status: (d: string) => `No signs of being taken, checked ${d}`,
    search: "Search",
    language: "Language",
    label: "Label",
    all: "All",
    evidence: "What was checked",
    report: "Report a mistake",
    none: "No issues to show yet. The first checks run every hour; come back later.",
    count: (n: number) => `${n} issue${n === 1 ? "" : "s"}`,
    languages: "By language",
    how: "How it works",
    howText: "Every hour, the index lists open issues labelled good first issue or help wanted in about 300 active projects and runs the same seven checks as the claimable command line tool: open pull requests, claims in the thread, blocking labels, prerequisites and more. Only issues with no warning are listed. Projects can ask to be left out by opening an issue.",
    other: "Español",
    home: "All issues",
  },
  es: {
    title: "Índice de issues libres",
    lede: "Issues de GitHub para empezar en los que claimable no encontró señales de que alguien ya esté trabajando. Cada fila dice cuándo se comprobó. Lee el hilo antes de empezar: una comprobación no es una promesa.",
    status: (d: string) => `Sin señales de estar tomado, comprobado el ${d}`,
    search: "Buscar",
    language: "Lenguaje",
    label: "Etiqueta",
    all: "Todos",
    evidence: "Qué se comprobó",
    report: "Informar de un error",
    none: "Aún no hay issues que mostrar. Las comprobaciones corren cada hora; vuelve más tarde.",
    count: (n: number) => `${n} issue${n === 1 ? "" : "s"}`,
    languages: "Por lenguaje",
    how: "Cómo funciona",
    howText: "Cada hora, el índice lista los issues abiertos con la etiqueta good first issue o help wanted de unos 300 proyectos activos y les pasa los mismos siete filtros que la herramienta claimable: pull requests abiertos, reservas en el hilo, etiquetas que bloquean, requisitos previos y más. Solo salen los issues sin ningún aviso. Un proyecto puede pedir no salir abriendo un issue.",
    other: "English",
    home: "Todos los issues",
  },
} as const;
type Lang = keyof typeof T;

const CSS = `
:root{--bg:#fbfaf7;--fg:#1d1d1b;--muted:#5c5a55;--line:#dedad2;--accent:#0b6b3a;--link:#0b4f8a;--card:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#141413;--fg:#ecebe6;--muted:#b0ada5;--line:#38362f;--accent:#6fd39c;--link:#8cc4ff;--card:#1d1c1a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main,header,footer{max-width:960px;margin:0 auto;padding:0 16px}header{padding-top:24px}
a{color:var(--link)}h1{font-size:1.8rem;margin:.2em 0}h2{font-size:1.2rem;margin-top:2em}
.lede{color:var(--muted);max-width:65ch}nav a{margin-right:12px}
form{display:flex;flex-wrap:wrap;gap:12px;margin:20px 0}label{display:flex;flex-direction:column;font-size:.9rem;color:var(--muted)}
input,select{font:inherit;padding:8px;min-height:44px;border:1px solid var(--line);border-radius:6px;background:var(--card);color:var(--fg)}
ol{list-style:none;padding:0}li.issue{border:1px solid var(--line);border-radius:8px;padding:12px 14px;margin:10px 0;background:var(--card)}
.issue h2.t{font-size:1rem;margin:0 0 4px}.meta{font-size:.9rem;color:var(--muted)}.ok{color:var(--accent);font-weight:600}
.tags span{display:inline-block;font-size:.8rem;border:1px solid var(--line);border-radius:99px;padding:0 8px;margin-right:6px}
.links a{margin-right:14px;font-size:.9rem}footer{color:var(--muted);font-size:.9rem;padding-bottom:40px}
.langs{columns:3 140px;padding-left:18px}.langs li{margin:4px 0}`;

// Filters the rows already on the page; with JavaScript off, every row shows.
const JS = `
const f=document.getElementById('filters');if(f){f.hidden=false;const q=f.querySelector('#q'),l=f.querySelector('#lang'),t=f.querySelector('#label'),n=document.getElementById('count');
const rows=[...document.querySelectorAll('li.issue')];const fmt=n.dataset;
function go(){const s=q.value.trim().toLowerCase();let k=0;for(const r of rows){const ok=(!s||r.textContent.toLowerCase().includes(s))&&(!l.value||r.dataset.lang===l.value)&&(!t.value||r.dataset.labels.split('|').includes(t.value));r.hidden=!ok;if(ok)k++}n.textContent=k===1?fmt.one.replace('N',k):fmt.many.replace('N',k)}
for(const e of [q,l,t])e.addEventListener('input',go)}`;

function day(iso: string): string {
  return iso.slice(0, 10);
}

function reportUrl(r: Row): string {
  const title = `Index: ${r.owner}/${r.repo}#${r.number} looks taken`;
  const body = `Issue: ${r.url}\nListed as checked on ${day(r.checkedAt)}.\n\nWhat shows it is taken (a link to the comment or pull request):\n`;
  return `${REPO}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
}

function rowHtml(r: Row, lang: Lang, root: string): string {
  const t = T[lang];
  const tags = r.labels.map((l) => `<span>${esc(l)}</span>`).join("");
  const evidence = [r.url, ...r.evidence.filter((e) => e !== r.url)].slice(0, 3);
  return `<li class="issue" data-lang="${esc(r.language)}" data-labels="${esc(r.labels.join("|"))}">
<h2 class="t"><a href="${esc(r.url)}">${esc(r.title)}</a></h2>
<p class="meta"><a href="${root}p/${esc(r.owner.toLowerCase())}/${esc(r.repo.toLowerCase())}/">${esc(r.owner)}/${esc(r.repo)}</a> #${r.number} · ${esc(r.language)}</p>
<p class="meta ok">${esc(t.status(day(r.checkedAt)))}</p>
<p class="tags">${tags}</p>
<p class="links">${evidence.map((e, i) => `<a href="${esc(e)}">${i === 0 ? t.evidence : `${t.evidence} (${i + 1})`}</a>`).join("")}<a href="${esc(reportUrl(r))}">${t.report}</a></p>
</li>`;
}

function page(opts: { lang: Lang; title: string; h1: string; canonical: string; root: string; body: string; alt?: string; description: string }): string {
  const t = T[opts.lang];
  return `<!doctype html>
<html lang="${opts.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(opts.title)}</title>
<meta name="description" content="${esc(opts.description)}">
<link rel="canonical" href="${esc(opts.canonical)}">
<style>${CSS}</style>
</head>
<body>
<header>
<nav><a href="${opts.root}">${t.home}</a><a href="${opts.root}../">claimable</a>${opts.alt ? `<a href="${opts.alt}" hreflang="${opts.lang === "en" ? "es" : "en"}">${t.other}</a>` : ""}</nav>
<h1>${esc(opts.h1)}</h1>
</header>
<main>
${opts.body}
</main>
<footer><p>${esc(t.howText)}</p><p><a href="${REPO}">Source</a> · MIT</p></footer>
<script>${JS}</script>
</body>
</html>
`;
}

function listing(rows: Row[], lang: Lang, root: string, filters: boolean): string {
  const t = T[lang];
  if (rows.length === 0) return `<p>${t.none}</p>`;
  const langs = [...new Set(rows.map((r) => r.language))].sort();
  const labels = [...new Set(rows.flatMap((r) => r.labels))].sort();
  const form = filters
    ? `<form id="filters" role="search" hidden onsubmit="return false">
<label for="q">${t.search}<input id="q" type="search"></label>
<label for="lang">${t.language}<select id="lang"><option value="">${t.all}</option>${langs.map((l) => `<option>${esc(l)}</option>`).join("")}</select></label>
<label for="label">${t.label}<select id="label"><option value="">${t.all}</option>${labels.map((l) => `<option>${esc(l)}</option>`).join("")}</select></label>
</form>`
    : "";
  const one = t.count(1).replace("1", "N");
  const many = t.count(2).replace("2", "N");
  return `${form}<p id="count" aria-live="polite" data-one="${esc(one)}" data-many="${esc(many)}">${esc(t.count(rows.length))}</p>
<ol>${rows.map((r) => rowHtml(r, lang, root)).join("\n")}</ol>`;
}

export type Built = { pages: string[]; listed: number };

/** Writes `free/` under `site` from the collector's data in `dataDir`. */
export function buildFreeSite(site: string, dataDir: string, now = Date.now()): Built {
  const projects = readData(dataDir);
  const rows = listed(projects, now);
  const out = join(site, "free");
  const pages: string[] = [];
  const write = (rel: string, html: string) => {
    mkdirSync(join(out, rel), { recursive: true });
    writeFileSync(join(out, rel, "index.html"), html);
    pages.push(rel);
  };
  const languages = [...new Set(projects.map((p) => p.language ?? "Other"))].sort();
  const langList = (root: string, lang: Lang) =>
    languages.length
      ? `<h2>${T[lang].languages}</h2><ul class="langs">${languages
          .map((l) => `<li><a href="${root}lang/${slug(l)}/">${esc(l)}</a> (${rows.filter((r) => r.language === l).length})</li>`)
          .join("")}</ul>`
      : "";

  for (const lang of ["en", "es"] as const) {
    const t = T[lang];
    const root = lang === "en" ? "" : "../";
    write(
      lang === "en" ? "" : "es",
      page({
        lang,
        title: `${t.title} · claimable`,
        h1: t.title,
        canonical: BASE + (lang === "en" ? "" : "es/"),
        root: lang === "en" ? "./" : "../",
        alt: lang === "en" ? "es/" : "../",
        description: t.lede,
        body: `<p class="lede">${esc(t.lede)}</p>${langList(root || "./", lang)}<h2>${t.home}</h2>${listing(rows, lang, root || "./", true)}`,
      }),
    );
  }

  for (const l of languages) {
    const sub = rows.filter((r) => r.language === l);
    write(
      `lang/${slug(l)}`,
      page({
        lang: "en",
        title: `${l} good first issues with no sign of being taken · claimable`,
        h1: `${l}: free issues`,
        canonical: `${BASE}lang/${slug(l)}/`,
        root: "../../",
        description: `${sub.length} beginner-friendly ${l} issues on GitHub where no sign of anyone working on them was found, each with the date it was checked.`,
        body: `<p class="lede">${esc(T.en.lede)}</p>${listing(sub, "en", "../../", true)}`,
      }),
    );
  }

  for (const p of projects) {
    const sub = rows.filter((r) => r.owner === p.owner && r.repo === p.repo);
    const name = `${p.owner}/${p.repo}`;
    write(
      `p/${p.owner.toLowerCase()}/${p.repo.toLowerCase()}`,
      page({
        lang: "en",
        title: `${name}: issues with no sign of being taken · claimable`,
        h1: name,
        canonical: `${BASE}p/${p.owner.toLowerCase()}/${p.repo.toLowerCase()}/`,
        root: "../../../",
        description: `Good first issues and help wanted issues in ${name} where no sign of anyone working on them was found. Last visited ${day(p.visitedAt)}.`,
        body: `${p.description ? `<p class="lede">${esc(p.description)}</p>` : ""}<p class="meta"><a href="https://github.com/${esc(name)}">github.com/${esc(name)}</a> · ${esc(p.language ?? "")} · visited ${day(p.visitedAt)}</p>${listing(sub, "en", "../../../", false)}`,
      }),
    );
  }

  writeFileSync(join(out, "issues.json"), JSON.stringify({ generated: new Date(now).toISOString(), issues: rows }, null, 1) + "\n");
  return { pages, listed: rows.length };
}

export const FREE_BASE = BASE;
