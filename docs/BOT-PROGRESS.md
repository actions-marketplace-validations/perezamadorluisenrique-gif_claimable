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
