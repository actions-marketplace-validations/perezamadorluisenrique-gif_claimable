# Claimable claim bot

A GitHub Action that lets contributors reserve an issue by commenting on it. It runs in your repository, with your repository's token: no server, no GitHub App, no secrets of ours.

It leaves one short comment per issue and edits it as things change. It never acts on a sentence like "can I take this?": only on an explicit command.

## Install

Start with `dry-run: true`. The bot then writes what it *would* do into the job summary and nothing else. When the summaries look right, remove the line.

```yaml
# .github/workflows/claim-bot.yml
name: Claim bot
on:
  issue_comment:
    types: [created]
permissions:
  issues: write
concurrency:
  group: claim-bot-${{ github.event.issue.number }}
  cancel-in-progress: false
jobs:
  claim:
    if: github.event.issue.pull_request == null && github.event.comment.user.type != 'Bot'
    runs-on: ubuntu-latest
    steps:
      - uses: perezamadorluisenrique-gif/claimable/bot@v1
        with:
          dry-run: true
```

No `actions/checkout` step is needed, and none should be added to run a commenter's code. `permissions: issues: write` is the only permission the bot uses.

## Commands

| Comment | Does |
|---|---|
| `/claim` (also `.take`, `/assign me`) | Assigns the issue to you, adds the `claimed` label, and says until when |
| `/unclaim` (also `/release`, `/unassign me`) | Releases it. Only the person who holds it or a maintainer can |
| `/claim status` | Says who holds it and the dates |

A command counts only as the first word of a line of your own text. A quote, a code block, inline code or a bot never gives one.

## When it says no

It names the reason and does not assign: the issue is closed, someone else holds it (or a maintainer assigned it by hand), a pull request by someone else is open against it, it carries a label like `on hold` or `blocked`, or you already hold two claims here.

## Inputs

| Input | Default | Meaning |
|---|---|---|
| `token` | `github.token` | Token that assigns, labels and comments; needs `issues: write` |
| `dry-run` | `false` | Anything but `false` only describes the actions in the job summary |

Private repositories run in report-only mode for now: the bot says what it would do and does nothing.

## Notes

- Comments are read from the event file and the API; the text of a comment never reaches a shell, a path or a command.
- The `concurrency` block makes simultaneous comments on one issue run one after the other. GitHub keeps only the newest waiting run, so of three comments posted within seconds the middle one may go unanswered; nobody is wrongly assigned, the person just comments again. If a maintainer assigns the issue by hand in the same second as a `/claim`, the issue can end up with two assignees.
- Only people with triage access or more count as maintainers for `/unclaim`: the bot checks the repository permission, not the organisation membership.
- If the runner's Node is older than 22.18 the Action runs `actions/setup-node`, which changes Node for the later steps of that job.
- Only pull requests of the same repository count as competition for an issue.
- If GitHub refuses a write (no permission, the person cannot be assigned here) the run ends green with a line in the job summary. The bot never fails your workflow.
- Threads of more than 1,000 comments or events are not read in full, so the bot does nothing on them.
- It remembers nothing outside the issue: the assignee, the timeline and a hidden marker in its own comment (honoured only when a bot wrote it).
