# Plan: GitHub Action + a real VIABLE example

Written 2026-11-02 against v0.2.0 (condensed from the Opus plan).

## 1. The Action
- Composite `action.yml` at the root, no build: Node 22.18+ type-strips `src/*.ts`. Entry `action/main.ts` (not shipped to npm) calls `listRepoIssues` + `analyze` directly.
- Inputs: `repo` (default this repo), `label` (default `good first issue`), `limit` (1-100, default 20), `token` (default `github.token`), `skip`, `thorough`, `fail-on` (`never|no-viable|any-discard|any-not-viable`).
- Outputs: `total`, `viable`, `caution`, `discard`, `viable-issues`, `discard-issues` (JSON arrays), `report-json`, `markdown` (paths).
- Inputs reach code only through `env:` (no `${{ inputs.* }}` inside `run:`). Token only via `configure({ token })`.
- Writes markdown to `$GITHUB_STEP_SUMMARY`, outputs to `$GITHUB_OUTPUT`; outside Actions prints markdown to stdout.
- Shared `formatMarkdown()`/`countVerdicts()` in `src/report.ts`; new CLI flag `--markdown` (exclusive with `--json`). `mdInline` escapes `|`, HTML, newlines, backticks, `@login`; caps field length.
- Tests: markdown ordering/escaping/counts, CLI `--markdown`, `readInputs`, `failureReason`, `outputBlock`, offline end-to-end over fixtures, drift guard action.yml vs main.ts vs docs/action.md.
- Docs: `docs/action.md`, README section "In CI: audit your good first issues".

## 2. A real VIABLE example without a personal token
- `.github/workflows/showcase.yml` (manual, no inputs) runs `test/record-showcase.ts` with the repo's own `GITHUB_TOKEN`: searches good-first-issues, runs `analyze` live, records the first VIABLE into `test/showcase/fixtures` (separate from `test/fixtures`, which `record.ts` wipes), verifies by replay, updates README block, pushes a branch and links a compare URL (so CI runs on the human-opened PR).
- Owner clicks: Actions -> Record a VIABLE example -> Run workflow -> open PR from run summary -> merge.
- `check-docs` gets an optional `example-viable` check; landing page shows it as an extra example when `test/showcase/showcase.json` exists.
- Risks: nothing VIABLE in a run (re-run later); large fixtures (size guard); token never stored (cassettes keep bodies only, plus a grep).

## 3. Release
Bump to 0.3.0, run "Publish to npm", tag `v0.3.0` and move `v0` (owner).
