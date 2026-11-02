# CLAUDE.md

Repo facts only; the owner's general rules are the Claude project instructions.

## What this is

`claimable` is a zero-dependency CLI (and browser page) that tells a contributor whether a GitHub
issue is actually free to work on, by running seven filters against the GitHub REST API and
returning `viable` / `reservations` / `discard` (printed as VIABLE / CAUTION / DISCARD).

## Commands

Development needs Node 22.18+: `.ts` files in `src/` and `test/` run directly via Node's native
type stripping. There is no `npm install` and no dependency tree. The published package targets
Node 18+ through a generated plain-JS `dist/`.

```bash
npm run check        # syntax/type-strip check of the CLI entry
npm test             # full suite: node --test "test/**/*.test.ts", offline, deterministic
node --test test/units.test.ts                                # one file
node --test --test-name-pattern="parseRef" test/units.test.ts # one test/describe by name
npm run compare      # tool verdicts vs. hand-triaged ground truth (prints a row per issue)
npm run check:docs   # fail if README/CONTRIBUTING numbers or example output drifted; add `-- --fix` to rewrite them
npm run demo         # regenerate docs/demo.svg from a real replayed run
npm run build        # strip types src/ -> dist/ (what npm ships)
npm run build:web    # build + assemble the browser version into site/
npm run record       # re-record fixtures from the LIVE API (needs a token)
```

Run the CLI against the recorded fixtures (offline, pinned clock):

```bash
CLAIMABLE_CASSETTE=replay CLAIMABLE_NOW=2026-09-15 node src/cli.ts openfoodfacts/openfoodfacts-explorer#1660
```

CI (`.github/workflows/ci.yml`) runs `check`, `test`, `compare`, `check:docs`, regenerates the demo
and fails on `git diff docs/demo.svg`, builds `dist/` and the site, and smoke-tests the packed
tarball through an npx-style bin symlink on Node 18/20/22/24. If you change output, run
`npm run demo` and `npm run check:docs -- --fix`, or CI will fail. If you add or remove tests, the
test count in README.md and CONTRIBUTING.md changes and `check:docs -- --fix` updates it.

## Architecture

**Pipeline.** `src/cli.ts` parses args and resolves inputs (issue refs, `--repo` scan, `--find`
search, or `-` for stdin) into `IssueRef`s → `analyze()` in `src/analyze.ts` runs the filters →
`src/report.ts` formats. `src/index.ts` is the library entry the browser page imports.

**Filters** live in `src/checks/`, one file each, with signature `(ref) => Promise<Finding[]>`.
Their order is `CHECK_ORDER` in `src/types.ts` (cheapest and most decisive first), and the mapping
from id to function is `CHECKS` in `analyze.ts`. After the first `blocker` finding, later filters
are skipped unless `--thorough`. A filter that throws is recorded in `skipped` and downgrades the
verdict to `reservations`: an unrunnable check is never a silent pass. `hacktoberfest.ts` is
opt-in and deliberately outside `CHECK_ORDER`. Adding a filter means touching `CheckId` and
`CHECK_ORDER` in `types.ts`, `CHECKS` in `analyze.ts`, and the README table.

**Action.** `action.yml` (composite) runs `action/main.ts`, which calls `listRepoIssues` + `analyze` and writes the job summary via `formatMarkdown()` (also the CLI `--markdown`). `test/action.test.ts` guards `action.yml` against drift. `test/record-showcase.ts` + `.github/workflows/showcase.yml` record a VIABLE example into `test/showcase/` (not `test/fixtures`) with the repo's own token.

**GitHub access.** All API calls go through `api()`/`apiOptional()` in `src/github.ts`, reached via
the accessors in `src/fetchers.ts`. The client keeps module-level state: an in-process memo (so
several filters sharing a request cost one fetch), the resolved token (`GITHUB_TOKEN`/`GH_TOKEN`,
then `gh auth token`, then anonymous), the viewer login, and the cassette mode. `configure()`
resets that state and clears the memo. Filters must not call `fetch` directly.

**Cassettes and time.** Tests never hit the network. `CLAIMABLE_CASSETTE=replay` (or
`configure({ cassetteMode: "replay" })`) reads `test/fixtures/<slug>-<sha256[:12]>.json`, keyed by
the exact request path, so a filter that changes a URL or query string needs re-recorded fixtures.
Any "how long ago" logic must use `now()`/`daysSince()` from `fetchers.ts`, which honour
`CLAIMABLE_NOW`; the suite pins the clock to 2026-09-15 and the viewer to the triage user.
`npm run record` (`test/record.ts`) **deletes `test/fixtures/` and re-records every ground-truth
issue from the live API**, which changes their state to today's. Treat it as a deliberate, rare
operation. `/user` is never recorded.

**Evaluation set.** `test/ground-truth.ts` holds 21 hand-triaged issues; `ground-truth.test.ts`
asserts against them and `test/compare.ts` prints the side-by-side. `test/claim-corpus.ts` labels
real thread comments by comment id to score the claim-detection patterns in
`src/checks/claimants.ts`.

**Browser version.** `web/` plus the same `dist/`: `scripts/build-web.js` copies `web/` to `site/`,
copies `dist/` to `site/lib/`, and writes `site/example.json` from a replayed run. An import map in
`web/index.html` points `node:child_process`, `node:crypto`, `node:fs`, `node:path` at
`web/shims/`. `test/web.test.ts` walks the import graph from `src/index.ts` and fails if the shared
code imports a Node built-in (or a named export) the shims don't cover, so a new `node:*` import in
`src/` needs a shim. Pages deploys from `main` via `.github/workflows/pages.yml`.

**Build.** `scripts/build.js` uses `node:module`'s `stripTypeScriptTypes` and rewrites relative
`.ts` import specifiers to `.js`. Source must therefore stay strippable: use `import type` for types
and avoid TS-only runtime syntax such as enums, namespaces, and parameter properties. Relative imports
in `src/` are written with the `.ts` extension.

## Rules that are not obvious from the code

- **A filter may never clear an issue that is actually taken.** The ground-truth test forbids this
  outright, and `reservations` does not count as a save. Over-flagging a fine issue is tolerated
  and counted.
- **Never edit the ground truth or claim-corpus labels to match the tool.** When a hand verdict is
  proven wrong, keep the original and add a `correction` with evidence beside it.
- Every finding should carry an `evidence` URL a human can open to verify it. Never fabricate one.
- Filters read comment text rather than counting comments; comment count is not a signal.
- Releasing: bump `version` in package.json in a commit, then run the "Publish to npm" workflow
  by hand (`workflow_dispatch`, no inputs). `prepublishOnly` runs build, check, test, and compare.
- Contributions made with AI assistance say so in the PR description (CONTRIBUTING.md).
