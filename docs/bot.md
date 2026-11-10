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
  schedule:
    - cron: "17 6 * * *"
  workflow_dispatch:
permissions:
  issues: write
jobs:
  claim:
    if: github.event_name == 'issue_comment' && github.event.issue.pull_request == null && github.event.comment.user.type != 'Bot'
    concurrency:
      group: claim-bot-${{ github.event.issue.number }}
      cancel-in-progress: false
    runs-on: ubuntu-latest
    steps:
      - uses: perezamadorluisenrique-gif/claimable/bot@v1
        with:
          dry-run: true
  remind:
    if: github.event_name != 'issue_comment'
    concurrency:
      group: claim-bot-daily
      cancel-in-progress: false
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

## Reminders and releases

Once a day the `remind` job visits every open issue with the `claimed` label.

1. **Reminder.** If the holder has shown no sign of life for 7 days, the bot edits its comment once and mentions them. A sign of life is a comment of theirs on the issue, a pull request of theirs linked to it (open, draft or closed), or a commit of theirs that mentions it.
2. **Release.** If there is still none 7 days after the reminder, the bot unassigns the issue, removes the label and says so in the same comment. Anyone can then `/claim` it.

It never releases anything while the holder has an open pull request, and it only touches claims it made itself: an issue a maintainer assigned by hand, or reassigned after the claim, is left alone. If the holder answers after the reminder, the clock starts again and the comment goes back to the plain status. The first visit after the `schedule` run is added can take up to a day; run the workflow by hand from the Actions tab to try it earlier. GitHub switches off scheduled workflows in a repository with no commits for 60 days.

## Settings

Everything has a safe default; the file is optional. Put it at `.github/claimable.yml` (or point the `config` input somewhere else). The bot reads it from the **default branch** through the API, so a pull request cannot change the rules it is judged by.

```yaml
nudge-days: 7                  # days without activity before the one reminder
release-days: 7                # days after the reminder before the claim is released
max-claims: 2                  # open claims one person may hold at once
labels:                        # when set, only issues with one of these labels can be claimed
  - good first issue
  - help wanted
blocked-labels: [on hold, needs design]   # extra labels that stop claims (blocked, on hold... always do)
exempt-users: [octocat]        # never counted against max-claims
blocked-users: []              # their commands are ignored
claimed-label: claimed         # the label that marks a held issue
hint-on-natural-claims: false  # true: answer "can I take this?" once, with how to /claim
messages:                      # your own words; {user} {since} {nudge-date} {release-date} {last-date}
  claimed: "{user} it is yours. If it goes quiet I will remind you on {nudge-date}."
```

`messages` can replace `claimed`, `nudge` and `expired`. The package has no dependencies, so the file is read by a small parser of its own: top-level `key: value` lines, lists (`- item` lines or `[a, b]`), and the one `messages` map. Anchors, multi-line strings, `{...}` maps, tabs and deeper nesting are reported as errors with the line number. A bad value keeps its default and the problem appears in the job summary, so a typo never switches the bot off. The one exception: if the file exists but GitHub fails to deliver it, the bot does nothing that run rather than act on defaults the project did not choose.

## When it says no

It names the reason and does not assign: the issue is closed, someone else holds it (or a maintainer assigned it by hand), a pull request by someone else is open against it, it carries a label like `on hold` or `blocked`, or you already hold two claims here.

## Inputs

| Input | Default | Meaning |
|---|---|---|
| `token` | `github.token` | Token that assigns, labels and comments; needs `issues: write` |
| `config` | `.github/claimable.yml` | Path of the settings file (see Settings). Read from the default branch |
| `dry-run` | `false` | Anything but `false` only describes the actions in the job summary |



## Private repositories: report-only mode

In a private repository the bot runs in report-only mode. It reads the issue and, for every command and every daily visit, writes into the job summary what it *would* do (the assignment, the label, the exact comment) and changes nothing. The first line of the summary says so. Use it to see how the bot would behave on your issues; `dry-run: true` gives the same view in a public repository. In both, the summary shows the comment word for word, so you can judge the tone before it speaks in public.

## From a home-made `/take` to the bot

Many projects already run a small workflow that assigns whoever comments `take` or `/take`. Moving to the bot keeps what contributors type and adds what such scripts usually lack.

1. Keep your workflow for now and install the bot next to it with `dry-run: true`. Read a week of job summaries.
2. Contributors can keep writing `.take`; `/claim`, `/assign me` and `.take` all work. A plain `take` or `/take` is not a command (a bare word is too easy to write by accident); say so in your CONTRIBUTING file.
3. Remove your old workflow and the `dry-run` line on the same day, so a comment is never handled twice.
4. Issues already assigned by hand keep their assignee and are never released. Only claims made through the bot get reminders. To bring an old assignment under the bot, ask the assignee to comment `/unclaim` and then `/claim`.
5. Put your rules in `.github/claimable.yml` (see Settings) instead of in the script: the reminder and release days, the claim limit, which labels can be claimed.

## Questions

**Does it assign someone who writes "can I work on this?"** No. It acts only on a command. With `hint-on-natural-claims: true` it answers such a sentence once, with how to claim.

**What counts as activity?** A comment by the holder, a pull request of theirs linked to the issue (open, draft or closed), or a commit of theirs that mentions the issue. Comments by the bot do not count.

**Will it release an issue with an open pull request?** Never. An open pull request of the holder stops both the reminder and the release.

**Can a maintainer take an issue away?** Yes: `/unclaim` from anyone with triage access or more. Assigning by hand also works, and the bot leaves that assignment alone.

**Does it spam?** It keeps one comment per issue and edits it. The reminder is that same comment, edited once. The reminder mentions the holder once; nothing else in it pings anyone.

**What if two people comment `/claim` at once?** The workflow runs one comment at a time per issue; the first one gets the issue and the second is told who holds it.

**Does it work on a fork or on pull requests?** Pull requests are ignored. The workflow runs in the repository that owns the issue, with that repository's token, and never checks out anyone's code.

**What does it cost?** Nothing: it uses your own Actions minutes (a few seconds per comment and one short run a day), no server of ours, no secrets of ours. A private repository gets report-only mode.

**How do I stop it?** Delete the workflow file. The labels and comments it left stay as ordinary issue data; nothing else is stored anywhere.

## Notes

- Comments are read from the event file and the API; the text of a comment never reaches a shell, a path or a command.
- The `concurrency` block makes simultaneous comments on one issue run one after the other. GitHub keeps only the newest waiting run, so of three comments posted within seconds the middle one may go unanswered; nobody is wrongly assigned, the person just comments again. If a maintainer assigns the issue by hand in the same second as a `/claim`, the issue can end up with two assignees.
- Only people with triage access or more count as maintainers for `/unclaim`: the bot checks the repository permission, not the organisation membership.
- If the runner's Node is older than 22.18 the Action runs `actions/setup-node`, which changes Node for the later steps of that job.
- Only pull requests of the same repository count as competition for an issue.
- If GitHub refuses a write (no permission, the person cannot be assigned here) the run ends green with a line in the job summary. The bot never fails your workflow.
- Threads of more than 1,000 comments or events are not read in full, so the bot does nothing on them.
- It remembers nothing outside the issue: the assignee, the timeline and a hidden marker in its own comment (honoured only when a bot wrote it).
