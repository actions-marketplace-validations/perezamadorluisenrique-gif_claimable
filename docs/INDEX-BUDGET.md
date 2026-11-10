# Index API budget

Measured on 2026-11-10 with `node index/budget.ts` (offline: it replays the cassettes of the 21-issue evaluation set). `test/index-budget.test.ts` re-measures on every run and fails if a filter starts costing more than the numbers below.

## Limits (docs.github.com, checked 2026-11-10)

- REST with the Actions `GITHUB_TOKEN`: "1,000 requests per hour per repository". The claim bot in this repository shares that bucket, so the index spends at most **800 an hour** (80 %).
- Search, authenticated: "up to 30 requests per minute for all search endpoints", a separate bucket. Search returns at most 1,000 results per query.

## What one project costs

| Request | Measured (worst / average of 21) | Used in the plan |
|---|---|---|
| Shared per project (repo, recent pull requests, tree, README and contributing docs) | 6 / 2.7 (fast) – 5.1 (thorough) | 6 |
| Per analysed issue (comments, timeline; the issue itself is primed from the listing) | 2 / 1.0 – 2.0 | 2 |
| Search per analysed issue (only some filters) | 0.19 – 0.29 | 0.3 |
| Listing open issues of one entry label (100 per page) | 1 | 1 per label, 2 labels |

A visit to a project where nothing changed costs 2 requests (the two listings). A visit that re-analyses `n` issues costs `2 + 6 + 2n`.

## Rotation

- Each project gets a `nextCheck`: daily if it had a new entry issue in the last 7 days, every 3 days if in the last 30, otherwise every 7.
- On a visit, an issue is analysed again only when its `updated_at` moved, except listed (viable) issues, which are re-checked at least every 3 days: a pull request that only mentions an issue does not always bump `updated_at`, and the index must not keep showing a taken issue.
- The collector runs **every hour** (not once a day). Each run visits due projects, oldest due first, and stops cleanly before the run's spend would cross 800. What is left waits for the next hour.

## Simulation (30 days, synthetic projects, deterministic seed)

| Projects | Highest hour | Visits a day or more late (after the first week) |
|---|---|---|
| 300 | 800 | 0 |
| 1,000 | 800 | 0 |
| 1,800 | 800 | 0 |
| 2,000 | 800 | 2,310 (worst 1.6 days) |
| 3,000 | 800 | 13,478 (worst 5.4 days) |

No hour ever goes past 800 at any size. Search peaks under 2 requests a minute.

## Verdict for the plan

3,000 projects do not fit with these worst-case costs: **1,800 do**. Thread D stops at 1,800 (stages 300, then 1,000, then 1,800) unless a later measurement lowers the per-project cost, for example by skipping the tree and docs requests on a visit where no issue changed (already the case) or by caching them for a week.

Not verified: the scheduled runs. GitHub may start hourly cron runs late or drop some under load; the simulation assumes all 24 run. A run that is skipped only delays visits, it never spends more.
