# Contributing

Thanks for looking. This is a small tool with a narrow job: tell a contributor whether a
GitHub issue is actually workable before they spend a weekend on it.

## The one rule

**A filter may never clear an issue that is actually taken.** The two possible errors are
not equally expensive — flagging a fine issue as risky costs someone thirty seconds of
reading, clearing a taken one costs them a weekend and a rejected pull request — so the
test suite forbids the second outright. `CAUTION` does not count as a save, because a
caution is something people click past.

Everything below follows from that.

## Getting set up

Node 22.18 or newer. There is nothing to install: TypeScript runs natively and the
project has no dependencies.

```bash
git clone https://github.com/perezamadorluisenrique-gif/claimable
cd claimable
npm test          # 385 tests, offline, deterministic
npm run compare   # the tool's verdicts next to the hand-triaged ones
```

Both commands work offline from a clean clone, with no token. They replay recorded API
responses from `test/fixtures/`, and the clock is pinned, so a pull request opened on the
other side of the world today cannot change the result tomorrow.

Run the tool itself against the fixtures the same way:

```bash
CLAIMABLE_CASSETTE=replay CLAIMABLE_NOW=2026-09-15 node src/cli.ts openfoodfacts/openfoodfacts-explorer#1660
```

## The most useful thing you can send

A verdict you disagree with. Not a feature — a case.

If `claimable` cleared something that was taken, that is the bug this project exists to
prevent and it is the highest-priority report there is. If it ruled out something fine,
that is worth fixing too, one notch down. Either way, open an issue with the reference and
what actually turned out to be true; the templates ask for exactly that.

## The claim bot's banks

The claim bot (`src/bot/`, work in progress) is judged on two banks that, like the ground
truth, are never edited to suit the code: `test/bot-corpus.ts` (comments labelled with the
command they contain, `null` for everything that only mentions one) and `test/bot-threads/`
(recorded situations with the exact actions the bot must take). `test/bot-format.test.ts`
checks their shape. A wrong action in public is the bot's version of clearing a taken issue.

## Adding a case to the evaluation set

The evaluation set (`test/ground-truth.ts`) is 21 issues triaged by hand on 2026-09-15,
with the verdict and the reason recorded at the time.

**The ground truth is never edited to make the tool look better.** Where later
verification proves a hand verdict wrong, the original stays and a `correction` is
recorded next to it with its evidence. Rewriting the answers to match the tool would turn
the agreement rate into a tautology.

To add a case:

1. Triage the issue yourself and write down the verdict and the reason *before* running
   the tool on it.
2. Record the API responses: `npm run record` (this one talks to the live API and wants a
   token — `GITHUB_TOKEN`, or be logged in with `gh`).
3. Add the entry to `test/ground-truth.ts` with your verdict, your reason, and a link to
   the evidence.
4. `npm run compare` and, if the tool disagrees with you, say so in the pull request
   rather than adjusting either side to match.

Fixtures are committed, so a case you add stays replayable for everyone.

## Adding or changing a filter

Filters live in `src/checks/`, one file each, and are ordered cheapest and most decisive
first so that scanning forty issues spends its request budget on the ones still in the
running.

A filter must:

- **Say where to verify it.** Every finding carries a URL. A verdict without somewhere to
  go and check it is an opinion.
- **Admit when it could not run.** Silently treating an unreachable check as a pass is how
  a tool like this starts lying. A filter that cannot run is listed in the output and
  downgrades the verdict to `CAUTION`.
- **Read, not count.** Comment count is not a signal: many comments can mean contested, or
  an active umbrella issue where six people are each working a different file.
- **Come with a unit test for the case that was wrong once.** `test/units.test.ts` covers
  the pure text heuristics, several of them taken verbatim from real issue bodies.

## Pull requests

- Small and single-purpose beats comprehensive.
- `npm test` and `npm run compare` must pass; CI runs both, plus a smoke test of the
  packed tarball.
- If you changed the output, run `npm run demo` so `docs/demo.svg` still shows the real
  thing, and `npm run check:docs -- --fix` so the numbers and example in the README do.
- Describe what a user would now see that they did not see before. If a verdict changed,
  name the issue it changed on.

## Disclosing AI assistance

This project's own filter 7 checks whether a repository requires it, so it would be poor
form to be coy: parts of this codebase were written with AI assistance, and the commit
history says so. If you use a model to help with a contribution, say so in the pull
request. What is not negotiable either way is that you have read the diff, run the tests,
and can defend the change — which is the same standard the tool asks of the issues it
clears.

## Code of conduct

Be decent. Assume the other person is trying to help. Disagreements about a verdict are
settled with evidence, which is the nice thing about a tool whose every claim comes with a
link.
