/**
 * Builds `index/projects.json`: for each of 20 languages, the most-starred
 * repositories that have open entry issues, were pushed in the last 90 days and
 * are not archived. Projects in `index/exclude.txt` are left out.
 *
 *   node index/build-projects.ts [--per-language 15] [--out index/projects.json] [--hits saved.json]
 *
 * Uses repository search (30 requests a minute, its own bucket): one query per
 * language and entry-label qualifier, so 40 requests for the whole list.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { api } from "../src/github.ts";
import type { Project } from "./collect.ts";
import { readExclude } from "./collect.ts";

export const LANGUAGES = [
  "JavaScript", "TypeScript", "Python", "Java", "Go", "Rust", "C++", "C#", "C", "PHP",
  "Ruby", "Kotlin", "Swift", "Dart", "Scala", "Elixir", "Haskell", "Lua", "Julia", "Shell",
] as const;

/** GitHub counts these two labels for the `good-first-issues:` and `help-wanted-issues:` qualifiers. */
export const QUALIFIERS = ["good-first-issues:>=1", "help-wanted-issues:>=1"] as const;

export type RepoHit = {
  full_name: string;
  owner: { login: string };
  name: string;
  stargazers_count: number;
  description: string | null;
  archived: boolean;
  fork: boolean;
  language: string | null;
  pushed_at: string;
};

/** Lists, guides and course material: their entry issues are rarely code to write. */
export const NOT_SOFTWARE = /awesome|interview|tutorial|roadmap|cheat.?sheet|guide|course|books?\b|resources|learn/i;

export function query(language: string, qualifier: string, since: string): string {
  const lang = language.includes(" ") || language.includes("+") || language.includes("#") ? `"${language}"` : language;
  return `language:${lang} ${qualifier} archived:false fork:false pushed:>=${since}`;
}

/**
 * Merges the hits of both qualifiers per language, best stars first, and keeps
 * `perLanguage` per language. A repository found under two languages stays in
 * the first. Pure, so the selection rules are tested offline.
 */
export function select(
  hits: Record<string, RepoHit[]>,
  perLanguage: number,
  exclude: Set<string>,
  since: string,
): Project[] {
  const seen = new Set<string>();
  const out: Project[] = [];
  for (const language of LANGUAGES) {
    const pool = (hits[language] ?? [])
      .filter((h) => !h.archived && !h.fork && h.pushed_at >= since)
      .filter((h) => !NOT_SOFTWARE.test(h.name) && !NOT_SOFTWARE.test(h.description ?? ""))
      .sort((a, b) => b.stargazers_count - a.stargazers_count);
    let taken = 0;
    for (const h of pool) {
      if (taken >= perLanguage) break;
      const k = h.full_name.toLowerCase();
      if (seen.has(k) || exclude.has(k)) continue;
      seen.add(k);
      taken++;
      out.push({
        owner: h.owner.login,
        repo: h.name,
        language,
        stars: h.stargazers_count,
        description: (h.description ?? "").slice(0, 200),
      });
    }
  }
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const opt = (name: string, dflt: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : dflt;
  };
  const perLanguage = Number(opt("--per-language", "15"));
  const out = opt("--out", "index/projects.json");
  const since = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
  const exclude = readExclude(existsSync("index/exclude.txt") ? readFileSync("index/exclude.txt", "utf8") : "");
  // `--hits <file>` reuses search results saved earlier ({language: hits[]}),
  // for a machine where only another client can reach the search API.
  const hitsFile = opt("--hits", "");
  const hits: Record<string, RepoHit[]> = hitsFile ? JSON.parse(readFileSync(hitsFile, "utf8")) : {};
  for (const language of hitsFile ? [] : LANGUAGES) {
    hits[language] = [];
    for (const q of QUALIFIERS) {
      const res = await api<{ items: RepoHit[] }>(
        `/search/repositories?q=${encodeURIComponent(query(language, q, since))}&sort=stars&order=desc&per_page=50`,
      );
      hits[language].push(...res.items);
      await sleep(2500); // stay under 30 search requests a minute
    }
  }
  const projects = select(hits, perLanguage, exclude, since);
  writeFileSync(out, JSON.stringify(projects, null, 1) + "\n");
  console.log(`${projects.length} projects written to ${out}`);
}
