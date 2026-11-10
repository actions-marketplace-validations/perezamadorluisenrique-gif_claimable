# Claimable Bot: progress

Plan: `docs/BOT-PLAN.md`. One line per work order, newest last.

## B0.1 Corpora (2026-11-10)

- `test/bot-corpus.ts`: 150 comments labelled with the command they contain (the plan asks for 120; the extra rows are more traps, none were dropped). 107 are written for the bot; 43 are the natural-language claims of `claim-corpus.ts`, read from the fixtures by id, all of them `null` because the bot acts only on explicit commands.
- `test/bot-threads/`: 49 recorded situations (the plan asks for 40). Six are rebuilt from real ground-truth issues (real issue, timeline and comments, plus one synthetic trigger comment); the rest are written by hand around the hard cases of the plan.
- `test/bot-format.test.ts` checks only the shape of both banks. No bot logic exists yet.
- Decision recorded for B1.2: a natural-language claim ("I would like to work on this") never holds an issue for the bot, because it acts on commands only. Thread `gt-natural-language-claims-do-not-hold` pins that down.

## B1.1 Commands (2026-11-10)

- `src/bot/commands.ts`: `parseCommand(body, author)`. A command counts only as the first word of a line of the author's own text: HTML comments, fenced and inline code, indented code and quotes are cut out first; deleted accounts, `type: Bot` and `[bot]` logins never give commands; two different commands in one comment are ambiguous and read as none.
- Result against the bank: 150 of 150 read as labelled, 0 false readings (`test/bot-commands.test.ts`).

## B1.2 State and decisions (2026-11-10)

- `src/bot/state.ts` (`readState`, marker parse/render), `src/bot/decide.ts` (`decide`, `deadlines`) and `src/bot/messages.ts` (`renderComment`), all pure.
- `test/bot-threads.test.ts`: 49 of 49 recorded threads give exactly the expected actions. The expected actions were written by hand before the code existed; none was changed afterwards.
- The marker is trusted only in a comment written by a bot (`type: Bot` and a `[bot]` login), so pasting a marker into an ordinary comment changes nothing (thread `claim-forged-marker-is-ignored`).
- Refusals are checked in this order: closed, who holds it, blocked label, required label, pull request of someone else, quota. A refusal never changes the marker; a comment from the holder after a reminder clears `nudgedAt`.
- Not decided here: the reminder and release on `tick` (B2.1). A `tick` currently answers `none`.

## B1.3 The Action (2026-11-10)

- `bot/action.yml` + `bot/main.ts` (the Action), `src/bot/apply.ts` (the only code that writes, through `send()` in `src/github.ts`), `docs/bot.md` (15-line install, `dry-run` first), and `.github/workflows/claim-bot.yml` (this repository runs its own bot, for now only on issues labelled `bot-sandbox`).
- Deviation from the plan, on purpose: the `config` input is not in this release. It arrives with B2.2, when there is a parser behind it; an input that does nothing misleads.
- Safety properties pinned by `test/bot-action.test.ts`: no `${{ }}` inside any `run:` script (action, workflow and every YAML block in the docs); only `issues: write`; no `pull_request_target`; no checkout of an event-derived ref; the bot's own code never spawns, evaluates or calls `fetch`; `dry-run` is on unless it is exactly `false`; `send()` refuses while cassettes replay; a failed write is an outcome, never an exception; a claim that GitHub did not accept as an assignment stops before the label and the "reserved" comment.
- Threads of more than 1,000 comments or events (10 pages) are not read in full, and the bot does nothing on them. The same when the author holds more issues than 300.
- Private repositories run report-only (the paid part, ahead of B2.3's `license`).

### B1.3 security review (Opus, high) and what changed

One blocker, fixed in the same PR: a pull request from another repository (or any open one that only mentions the issue elsewhere) counted as competition, so a stranger could block every claim and the bot's reply linked to the wrong `#N`. Only pull requests of the same repository count now (thread `claim-pr-from-another-repo-does-not-block`; the bank has 50 threads).

Also fixed: the marker is honoured only on the first line of a bot comment (a bot echoing a user's quote could forge it); label text in the comment goes through `mdText` (Markdown syntax and invisible or bidi characters inert); `oneLine` escapes `\r`; the bot re-reads the trigger comment from the API (edited or deleted comments are not acted on); `dry-run` writes only on exactly `false`; "maintainer" for `/unclaim` is checked against the repository permission (triage or more), not the association; `persist-credentials: false` on the checkout.

Documented, not changed: GitHub keeps only the newest waiting run per `concurrency` group, so the middle of three comments in seconds may go unanswered (nobody is wrongly assigned); a hand assignment in the same second as a `/claim` can leave two assignees; `actions/setup-node@v5` is a moving tag as in the audit Action and changes the job's Node when it runs; a same-repo pull request that only mentions the issue counts as competition (the audit does the same).

## B1.4 Version 1 of the bot (2026-11-10)

- Live proof on the sandbox issue ([#33](https://github.com/perezamadorluisenrique-gif/claimable/issues/33), labelled `bot-sandbox`), run by this repository's own workflow after B1.3 merged: `/claim` assigned the issue, added `claimed` and wrote the one comment ("reserved for you as of 2026-11-10 … reminder by 2026-11-17, released by 2026-11-24"); `/claim status` edited that same comment ("Held by … since 2026-11-10"); `/unclaim` unassigned, removed the label and edited the same comment again ("released this issue"). Three commands, one bot comment, no extra noise.
- `.github/workflows/claim-bot.yml` now runs on every issue of this repository.
- Package version 0.4.0; the README has the install block and the real comment text.
- To do on the laptop (queued in `cola-laptop.md`): create the tags `v0.4.0` and `v1` (tags cannot be pushed from the cloud session) so `uses: .../claimable/bot@v1` resolves.

## B2.1 Reminders and releases (2026-11-10)

- `decide()` now answers the `tick` event (`decideTick` in `src/bot/decide.ts`); `handleTick` in `bot/main.ts` visits every open issue with the `claimed` label (at most 100 a day) on `schedule` and `workflow_dispatch`. New replies `nudge` and `expired`.
- Rules, all pinned by 15 new threads (the bank has 65, the plan asked for 12 more): reminder after `nudge-days` without a sign of life from the holder (a comment, a linked pull request of theirs open or closed, or a commit that mentions the issue); release `release-days` after the reminder; a sign of life after the reminder starts the clock again and the comment returns to the plain status; **an open pull request of the holder blocks both**; only claims the bot made itself are touched (label, bot comment and marker must all name the current assignee), so a hand assignment or a reassignment is left alone; closed and locked issues are left alone. Dates are compared by day, so a run earlier in the day than the claim does not push a release to the next day.
- `.github/workflows/claim-bot.yml` and the install block in `docs/bot.md` and the README have a second job, `remind`, with its own `concurrency` group.
- Not proven live: this repository has no stale claim on a public issue and the rules forbid commenting from here with a footer. To see it on the real thing, someone with the laptop comments `/claim` on the `bot-sandbox` issue and runs the `Claim bot` workflow by hand; Actions cannot fake the date, so the real check is a week later.

## B2.2 Configuration (2026-11-10)

- `src/bot/config.ts`: a YAML parser of our own (the package has no dependencies) for flat keys, lists and the one `messages` map; everything else is an error with its line. `readConfig` keeps the default for each bad value and returns a warning for the job summary. The new `config` input of `bot/action.yml` (`INPUT_CONFIG`) names the file, accepted only as a plain relative path.
- Keys: `nudge-days`, `release-days`, `max-claims`, `labels`, `blocked-labels`, `hint-on-natural-claims`, `exempt-users`, `messages` (as the plan says) plus `blocked-users` and `claimed-label` (the engine already had them; the plan's risk table promises a block list). `messages` can replace `claimed`, `nudge` and `expired`, with `{user}`, `{since}`, `{nudge-date}`, `{release-date}`, `{last-date}` filled in a single pass from sanitised values.
- Read from the default branch through `getFile` (never from a checkout). A missing file is the defaults; a file that exists but cannot be read stops the bot for that run, because acting on defaults could break a rule the project set.
- `hint-on-natural-claims`: only when the project asks, only if the bot has no comment on the issue yet (so once), and only where a `/claim` would work (open, unlocked, nobody holds it, no blocking label, an allowed label present). It is a pointer to the command, never an assignment. Reply kind `hint`.
- Bank: 71 threads (6 new: four hint cases, one custom claimed label). `test/bot-config.test.ts` covers the parser, hostile input, the path rule and the file read end to end offline.

## B2.3 Report-only mode (2026-11-10)

- `chooseMode` in `bot/main.ts`: `live`, `dry-run` (the input) or `report-only` (private repository, which wins over the input). Report-only writes nothing and puts one line at the top of the summary, "Report-only mode: this repository is private, so the bot describes what it would do and writes nothing.", with no price, plan or licence word anywhere (a test greps the line, the docs and the code around it). The old warning line is gone; the daily visit now reads the repository's visibility from the API.
- Deviation from the plan, on purpose: there is no `license` input yet. An input that does nothing misleads (same reason `config` waited for B2.2). It arrives with R1 in the Pro thread, which is switched off.
- `test/bot-report-only.test.ts`: `applyActions` never calls the sender for any of the 8 action kinds when dry; a sender that throws is passed to the whole bot on a private repository, for a `/claim` and for the daily visit, with `dry-run: false`; only `src/bot/apply.ts` may import or call `send`; the wording test above.

## B2.4 Version 0.5.0 (2026-11-10)

- `docs/bot.md` now has the guide "From a home-made `/take` to the bot" and a questions section. `package.json` is 0.5.0.
- What is not proven live and why: reminders and releases need a claim that stays quiet for a week, and the Actions runner cannot be given another date. The unit, thread and offline end-to-end tests cover the rules; the live check is queued for the laptop session in `cola-laptop.md` (comment `/claim` on a `bot-sandbox` issue, look at the `remind` job a week later).
- The tags `v0.5.0` and `v1` are queued for the laptop too, because tags cannot be pushed from the cloud session. Until `v1` moves, installs that pin `@v1` keep the 0.4.0 bot (no reminders, no settings file).

## I0.1 Index API budget (2026-11-10)

- `index/budget.ts` measures what `analyze()` costs by replaying the evaluation set (`requestLog()` in `src/github.ts` counts memo misses, live or replayed), and simulates 30 days of the rotation. Numbers and sources in `docs/INDEX-BUDGET.md`.
- The Actions token gives 1,000 REST requests an hour per repository (shared with the claim bot); the index spends at most 800 an hour and runs hourly.
- Deviation from the plan: 3,000 projects do not fit at worst-case costs; 1,800 do. Thread D's last stage is 1,800. The test pins the capacity, so a cheaper filter or a costlier one shows up as a failing test.
- `primeMemo()` lets the collector reuse each issue from the listing instead of fetching it again.
