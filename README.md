# claimable

**"Unassigned" is not the same as "free".**

<p align="center">
  <img
    src="https://raw.githubusercontent.com/perezamadorluisenrique-gif/claimable/main/docs/demo.svg"
    alt="claimable ruling out a GitHub issue that two contributors had already claimed in the comment thread, with a permalink to each claim"
    width="900">
</p>

No dependencies. No install. Node 18 or later.

```bash
npx claimable oppia/oppia#26840
```

Or without a terminal: **[paste an issue into the browser version](https://perezamadorluisenrique-gif.github.io/claimable/)**,
which runs the same seven filters — the same code, not a port — straight against GitHub's
API from your browser.

GitHub's `no:assignee` filter is how most people look for something to work on, and it is
wrong often enough to waste real weekends. An issue can read *open, unassigned, good first
issue* while a finished pull request has been sitting on it for three weeks — because
GitHub does not assign an issue to whoever opens a PR against it.

`claimable` runs the checks a careful contributor runs by hand before starting, and tells
you what it found and where to verify it. The issue above was claimed twice in the thread;
this one is in a repository nobody has pushed to in ten months:

<!-- example: ohcnetwork/create-care-mfe-plug#4 2026-09-18 -->
```
$ claimable ohcnetwork/create-care-mfe-plug#4

DISCARD  ohcnetwork/create-care-mfe-plug#4  .gitignore is not created when a new plug is created using npx command
         https://github.com/ohcnetwork/create-care-mfe-plug/issues/4

  Why: no push in 301 days (last: 2025-11-21) — a PR here is unlikely to ever be reviewed

  repo alive
    × no push in 301 days (last: 2025-11-21) — a PR here is unlikely to ever be reviewed
      https://github.com/ohcnetwork/create-care-mfe-plug — pushed_at 2025-11-21T07:58:23Z
    ! no closed pull requests found — no evidence that PRs get reviewed here
      https://github.com/ohcnetwork/create-care-mfe-plug/pulls?q=is%3Apr+is%3Aclosed

  Not run (already ruled out): existing PR, blocked / umbrella, claimants, prerequisites, environment, claim protocol — use --thorough to run them anyway
```

---

## The seven filters

Ordered cheapest and most decisive first, so scanning forty issues spends its request
budget on the ones still in the running.

| # | Filter | The question | The mistake it prevents |
|---|---|---|---|
| 1 | **repo alive** | Does anything get merged here? | A perfect PR to a repo nobody reads is a diary entry |
| 2 | **existing PR** | Is someone already fixing it? | `no:assignee` says "free" when a finished PR is open |
| 3 | **blocked / umbrella** | Did the project say not to start? | `on hold` with zero comments reads as unclaimed |
| 4 | **claimants** | Has a human called it in the thread? | Assignment is not how most projects track this |
| 5 | **prerequisites** | Does the fix need code that does not exist? | "Work: Medium" hiding 65 KB of unlisted porting |
| 6 | **environment** | Can you even build it on this machine? | Discovering the WSL2 requirement after cloning |
| 7 | **claim protocol** | What does the project demand first? | 200 stress runs standing between you and assignment |

Three of these encode corrections to heuristics that seemed obviously right and were
backwards:

- **Comment count is not a signal.** Many comments can mean contested — or an active
  umbrella issue where six people are each working a different file. The tool reads the
  comments instead of counting them.
- **Silence is a red flag, not an opportunity.** An easy issue in a busy repo is claimed
  within days. One that has sat untouched for months is usually sitting there for a
  reason. Maintainer difficulty labels are unreliable; the market of other contributors is
  not.
- **`pushed_at` measures the maintainers, not you.** A repo can be pushed to this week and
  still not have merged a pull request in five months. Filter 1 checks both.

---

## Does it actually work?

The evaluation set is not invented. It is 21 issues triaged by hand, one at a time, on
2026-09-15, while looking for real contribution work — with the verdict and the reason
recorded at the time. Roughly one in six candidates that looked good on paper survived.

Against that set, replayed from recorded API fixtures so the result is deterministic:

```
$ npm run compare

16/20 agree with the verified verdict · 4 signals the hand pass missed · 1 excluded as drift
```

Do not take that number on trust. The fixtures are committed, so the whole evaluation
replays from a clean clone in one command — offline, no token, no `npm install`, nothing
to install:

```bash
git clone https://github.com/perezamadorluisenrique-gif/claimable && cd claimable && npm run compare
```

It prints a line per issue: the hand verdict, the tool's verdict, and which filter decided.

Broken down:

| | |
|---|---|
| **12 / 12** | hand rejections reproduced, most of them for the same reason |
| **4** | issues the hand pass *cleared* that the tool rules out — all four verified as genuine misses |
| **4** | soft disagreements: flagged as risky where the hand pass said fine |
| **1** | excluded as drift — the issue was closed three days after the triage |
| **0** | issues wrongly ruled out |

The four misses are the interesting part, because two of them are the exact failure the
tool exists to prevent:

- `frappe/lms#2711` — PR #2727 had been open for five days. The issue still read
  *unassigned*.
- `openfoodfacts-explorer#1660` — claimed in the thread ten days earlier. Nobody had
  scrolled down.

And two more were cleared by hand on the strength of `pushed_at`:
`hotosm/xlsform-builder#19` and `#22` sit in a repo pushed to two days before the triage,
which has not merged a pull request since 2026-04-07.

**The ground-truth file is never edited to match the tool.** Where later verification
proved a hand verdict wrong, the original stays and a `correction` is recorded next to it
with its evidence. Rewriting the answers to match would make the agreement rate a
tautology.

### The asymmetry the test suite enforces

The two possible errors are not equally bad, so they are not treated equally:

- Clearing an issue that is actually taken costs somebody a weekend and a rejected PR.
  **The suite forbids this outright** — and `CAUTION` is not good enough, because a
  caution is something people click past.
- Flagging a fine issue as risky costs thirty seconds of reading. **Tolerated, counted,
  and printed** at the end of the run.

---

## Usage

```bash
claimable <issue> [<issue> ...]
claimable --repo <owner/repo> [--label <label>] [--limit <n>]
claimable --find "<GitHub issue search>" [--limit <n>]
```

Issues can be written as `owner/repo#123` or as any GitHub issue URL, including one copied
from a comment permalink. A lone `-` reads them from a pipe, one per line, so anything that
lists issues can feed it:

```bash
gh issue list -R oppia/oppia -l "good first issue" --json url -q '.[].url' | claimable - --quiet
```

| Option | Effect |
|---|---|
| `--repo owner/repo` | Scan a repository's open issues instead of named ones |
| `--label <label>` | With `--repo`: only issues with this label (repeatable) |
| `--find <query>` | Search all of GitHub, then run every result through the filters |
| `--limit <n>` | With `--repo` or `--find`: how many to scan (default 20) |
| `--api-url <url>` | GitHub Enterprise: the API base, e.g. `https://ghe.example.com/api/v3`. Defaults to `$GITHUB_API_URL` (set by GitHub Actions), then `https://api.github.com`. Evidence links follow the matching web host |
| `--thorough` | Run every filter even after one rules an issue out |
| `--hacktoberfest` | Also check whether a PR here would count for [Hacktoberfest](https://hacktoberfest.com/participation/) |
| `--skip <check>` | Skip a filter (repeatable) |
| `--json` | Machine-readable output |
| `--markdown` | Markdown report for job summaries and issue bodies (not with `--json`) |
| `--quiet` | One line per issue |
| `--viable-only` | Print only issues that survive every filter |

Exit code is `0` when at least one issue is viable, `1` when nothing is, `2` on a usage or
network error — so it composes into a script.

### Finding issues, not just checking them

Every "good first issue" finder answers *where are the issues?* None of them answers
*which of these is still free?* — so `--find` takes a GitHub search, and hands every
result to the seven filters:

```bash
claimable --find 'label:hacktoberfest language:typescript' --limit 30
claimable --find 'label:"good first issue" org:openfoodfacts'
```

The query is ordinary [GitHub issue search](https://docs.github.com/en/search-github/searching-on-github/searching-issues-and-pull-requests)
syntax. `is:issue is:open no:assignee archived:false` are added unless the query already
says otherwise, because each of those would be ruled out anyway, after costing a full
set of requests. Add `--hacktoberfest` to be warned about repositories where a merged PR
would not count for the event unless a maintainer labels it `hacktoberfest-accepted`.
It prints one line per result as it goes, then the full detail of
whatever cleared every filter. Search has GitHub's tightest rate limit, so this is the
mode that most wants a token.

### Authentication

Optional. `claimable` reads `GITHUB_TOKEN`/`GH_TOKEN`, then falls back to `gh auth token`,
then runs anonymously at GitHub's 60 requests/hour. Scanning more than a handful of issues
wants a token; checking one does not.

Authenticating has a second benefit: the tool then knows who you are, and stops reporting
your own comments as somebody else having claimed the issue.

Colour follows the terminal, and both standard overrides are honoured: `NO_COLOR` turns it
off anywhere, `FORCE_COLOR=1` (or `CLICOLOR_FORCE=1`) keeps it through a pipe, for
`less -R` and for CI logs.

---

## In CI: audit your good first issues

Maintainers can run claimable on a schedule and see, in the job summary, which of their "good first issue" issues are really free:

```yaml
- uses: perezamadorluisenrique-gif/claimable@v0
  with:
    label: good first issue
    fail-on: never   # or any-discard, to fail when one is already taken
```

Inputs, outputs and a full workflow are in [docs/action.md](docs/action.md). The same report is available locally with `--markdown`.

## What it does not do

Stated plainly, because a triage tool that hides its blind spots is worse than none:

- **It does not read wikis.** Projects that keep setup instructions outside the repo —
  Oppia is one — get an explicit *"setup cost unverified"*, never a false all-clear.
- **It does not judge whether you can do the work.** Filter 5 finds unlisted scope; it
  cannot tell you whether the listed scope is within reach.
- **It does not read your mind about umbrella issues.** It tells you an issue is an
  umbrella and that you should claim a unit of work rather than the issue. Which unit is
  still yours to pick.
- **A filter that cannot run says so.** Silently treating an unreachable check as a pass
  is how a tool like this starts lying, so every skipped filter is listed in the output
  and downgrades the verdict to `CAUTION`.

---

## Development

Development requires Node 22.18+ (TypeScript runs natively; no dependency tree). The
published package is plain JavaScript and runs on Node 18 and later — CI runs the packed
tarball on 18, 20, 22 and 24, so `npx claimable` works on the Node an `apt install` gives
you. Development runs the
`src/*.ts` files directly — no build step.

```bash
npm test          # 176 tests, offline, deterministic
npm run compare   # tool verdicts next to the hand verdicts, side by side
npm run demo      # regenerate the README demo from a real run
npm run check:docs # fail if a number in these docs no longer matches the code
npm run record    # re-record API fixtures (talks to the live API)
npm run build:web # assemble the browser version into site/
```

`npm run demo` spawns the CLI against the committed fixtures, captures what it actually
writes to a terminal, and draws that into `docs/demo.svg`. The demo is therefore a
recording rather than a mock-up, and a demo that has drifted from the real output is a
one-command fix.

The published package is different: Node refuses to type-strip `.ts` files that live under
`node_modules`, so a package whose `bin`/`exports` point at raw TypeScript cannot run once
installed. `npm run build` uses Node's own stripper (`node:module`'s `stripTypeScriptTypes`,
the same one `--experimental-strip-types` calls internally) to generate a plain-JS `dist/`
at publish time — `prepublishOnly` runs it automatically, so `npm publish` always ships
working JS. `dist/` is generated, not committed.

The browser version is `web/` plus that same `dist/`: an import map points the four Node
built-ins the filters import at small stand-ins in `web/shims/`, so the page runs the
filters themselves rather than a copy that could drift. `test/web.test.ts` walks the import
graph and fails if a new built-in is not covered. To look at it locally, run
`npm run build:web` and serve `site/` with any static server.

Fixtures are recorded snapshots of the GitHub API. The suite pins both the clock
(`CLAIMABLE_NOW`) and the authenticated user, so it does not change its mind when somebody
on the other side of the world opens a pull request.

## Feedback

The verdicts are the product, so a verdict you disagree with is the most useful thing you
can send. [Open a discussion](https://github.com/perezamadorluisenrique-gif/claimable/discussions)
with the issue reference and what the tool got wrong, or
[file an issue](https://github.com/perezamadorluisenrique-gif/claimable/issues/new/choose)
— the templates ask for the reference and the verdict, which is all a reproduction needs.
[CONTRIBUTING.md](CONTRIBUTING.md) covers adding a filter and adding a case to the
evaluation set.

## Licence

MIT
