# claimable as a GitHub Action

Audit a repository's "good first issue" list. The job summary shows which issues are really free, which have reservations, and which are already taken, each with the reason and a link to check it.

```yaml
name: Audit good first issues
on:
  schedule: [{ cron: "0 6 * * 1" }]   # Mondays 06:00 UTC
  workflow_dispatch:
permissions:
  contents: read
  issues: read
  pull-requests: read
jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - id: claimable
        uses: perezamadorluisenrique-gif/claimable@v0
        with:
          label: good first issue
          limit: 30
      - run: echo "${{ steps.claimable.outputs.viable }} of ${{ steps.claimable.outputs.total }} are really claimable"
```

## Inputs

| Input | Default | Meaning |
|---|---|---|
| `repo` | this repository | `owner/repo` to audit |
| `label` | `good first issue` | Only issues with this label; empty means all open issues |
| `limit` | `20` | How many issues to check, 1 to 100 |
| `token` | `github.token` | Token for the API; empty runs anonymously (60 requests an hour) |
| `skip` | none | Filters to skip, comma or space separated |
| `thorough` | `false` | Run every filter even after one rules an issue out |
| `fail-on` | `never` | `never`, `no-viable`, `any-discard` or `any-not-viable` |

## Outputs

`total`, `viable`, `caution`, `discard` (counts), `viable-issues` and `discard-issues` (JSON arrays of URLs), `report-json` and `markdown` (paths to files).

## Notes

- A check costs roughly 8 to 12 API requests per issue. The repository's `GITHUB_TOKEN` allows 1000 an hour, so keep `limit` at 50 or less.
- The installation token cannot read `/user`, so the maintainer's own comments count like anyone else's. That can only over-flag, never clear a taken issue.
- If the runner's Node cannot strip TypeScript types (older than 22.18), the Action runs `actions/setup-node` with 22.18, which changes Node for the later steps of that job.
- Inputs reach the code only through environment variables, never through shell interpolation.
- Fail when a good first issue is already taken: `fail-on: any-discard`.
- Post the report into an issue: `gh issue edit 1 --body-file "${{ steps.claimable.outputs.markdown }}"` with `issues: write`.
- The same report is available locally with `claimable --repo owner/repo --label "good first issue" --markdown`.
