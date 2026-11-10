# Claimable Bot: progress

Plan: `docs/BOT-PLAN.md`. One line per work order, newest last.

## B0.1 Corpora (2026-11-10)

- `test/bot-corpus.ts`: 150 comments labelled with the command they contain (the plan asks for 120; the extra rows are more traps, none were dropped). 107 are written for the bot; 43 are the natural-language claims of `claim-corpus.ts`, read from the fixtures by id, all of them `null` because the bot acts only on explicit commands.
- `test/bot-threads/`: 49 recorded situations (the plan asks for 40). Six are rebuilt from real ground-truth issues (real issue, timeline and comments, plus one synthetic trigger comment); the rest are written by hand around the hard cases of the plan.
- `test/bot-format.test.ts` checks only the shape of both banks. No bot logic exists yet.
- Decision recorded for B1.2: a natural-language claim ("I would like to work on this") never holds an issue for the bot, because it acts on commands only. Thread `gt-natural-language-claims-do-not-hold` pins that down.
