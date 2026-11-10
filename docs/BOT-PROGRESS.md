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
