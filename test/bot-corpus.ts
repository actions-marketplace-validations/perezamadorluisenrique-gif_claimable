/**
 * Comments labelled by hand with the bot command they contain, if any.
 *
 * The bot acts on a comment, in public, on somebody else's repository, so the
 * one thing it must never do is read a command that is not one. A missed
 * command costs the author a second try; a phantom command assigns a stranger.
 * That asymmetry is why every kind of text that merely *mentions* a command is
 * in here as a `null`: a sentence explaining `/claim`, a quote of somebody else
 * typing it, a code block showing it, a bot saying it.
 *
 * Two sources make the 120:
 *   - `HAND_ROWS`, written for the bot (commands in every shape, and the traps).
 *   - every human comment of `claim-corpus.ts`, read from the recorded
 *     fixtures by id. They are real claims in natural language ("I would like
 *     to work on this"), and none of them is a command: the bot asks for an
 *     explicit `/claim`, so each one is `null`.
 *
 * Like the other corpora, a label is never changed to make the parser look
 * better. If one is wrong, say why in a comment beside it.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CommandKind } from "../src/bot/types.ts";
import type { GhComment } from "../src/types.ts";
import { CLAIM_CORPUS } from "./claim-corpus.ts";

export type CommandRow = {
  body: string;
  /** Defaults to a human, `alice`. */
  author?: { login: string; type: "User" | "Bot" };
  expect: CommandKind | null;
  note: string;
};

const HUMAN = { login: "alice", type: "User" } as const;
const BOT = { login: "github-actions[bot]", type: "Bot" } as const;

export const HAND_ROWS: CommandRow[] = [
  // ── claim: the command, alone and with company ───────────────────────────
  { body: "/claim", expect: "claim", note: "bare command" },
  { body: "/claim\n", expect: "claim", note: "trailing newline" },
  { body: "/CLAIM", expect: "claim", note: "upper case" },
  { body: "/Claim", expect: "claim", note: "capitalised" },
  { body: "  /claim", expect: "claim", note: "two spaces of indentation" },
  { body: "/claim please, I can have it done this week", expect: "claim", note: "text after" },
  { body: "/claim I'd like to fix this", expect: "claim", note: "intent after" },
  { body: "Hi! I have some time this week.\n/claim", expect: "claim", note: "greeting before, command on its own line" },
  { body: "Hi!\n\n/claim\n\nThanks", expect: "claim", note: "text on both sides" },
  { body: "/claim.", expect: "claim", note: "full stop" },
  { body: "/claim!", expect: "claim", note: "exclamation" },
  { body: "/claim\r\n", expect: "claim", note: "Windows line ending" },
  { body: "Sounds good.\r\n/claim\r\nThanks", expect: "claim", note: "Windows line endings around" },
  { body: "/claim :)", expect: "claim", note: "emoticon after" },
  { body: "/claim, working on it", expect: "claim", note: "comma then words" },
  { body: ".take", expect: "claim", note: "alias .take" },
  { body: ".TAKE", expect: "claim", note: "alias .take in capitals" },
  { body: ".take this one", expect: "claim", note: "alias with words after" },
  { body: "Thanks for the pointer!\n.take", expect: "claim", note: "alias on a later line" },
  { body: "/assign me", expect: "claim", note: "alias /assign me" },
  { body: "/Assign Me", expect: "claim", note: "alias in mixed case" },
  { body: "/assign me please", expect: "claim", note: "alias with please" },
  { body: "/claim\n/claim", expect: "claim", note: "the same command twice is one command" },
  { body: "```\nnpm test\n```\n/claim", expect: "claim", note: "command after a closed code block" },
  { body: "> is anyone on this?\n\n/claim", expect: "claim", note: "command after a quote" },
  { body: "I ran `npm test` and it passes.\n/claim", expect: "claim", note: "command after inline code" },
  { body: "/claim\t", expect: "claim", note: "trailing tab" },

  // ── unclaim ──────────────────────────────────────────────────────────────
  { body: "/unclaim", expect: "unclaim", note: "bare command" },
  { body: "/UNCLAIM", expect: "unclaim", note: "upper case" },
  { body: "/unclaim sorry, no time this month", expect: "unclaim", note: "reason after" },
  { body: "/release", expect: "unclaim", note: "alias /release" },
  { body: "/Release", expect: "unclaim", note: "alias capitalised" },
  { body: "/release this", expect: "unclaim", note: "alias with words" },
  { body: "/unassign me", expect: "unclaim", note: "alias /unassign me" },
  { body: "/unassign me, I'm busy", expect: "unclaim", note: "alias with reason" },
  { body: "Can't continue.\n/unclaim", expect: "unclaim", note: "after a sentence" },
  { body: "/unclaim\r\n", expect: "unclaim", note: "Windows line ending" },
  { body: "/unclaim.", expect: "unclaim", note: "full stop" },

  // ── status ───────────────────────────────────────────────────────────────
  { body: "/claim status", expect: "status", note: "bare command" },
  { body: "/CLAIM STATUS", expect: "status", note: "upper case" },
  { body: "/claim  status", expect: "status", note: "two spaces between" },
  { body: "/claim\tstatus", expect: "status", note: "tab between" },
  { body: "/claim status please", expect: "status", note: "words after" },
  { body: "/claim status?", expect: "status", note: "question mark" },
  { body: "Quick check:\n/claim status", expect: "status", note: "after a sentence" },

  // ── null: a command mentioned, not given ─────────────────────────────────
  { body: "use /claim to reserve it", expect: null, note: "mid-sentence explanation" },
  { body: "You can type /claim to take this issue.", expect: null, note: "explaining the command" },
  { body: "Try /claim", expect: null, note: "command is not the first word" },
  { body: "I wonder if /claim works in this repo", expect: null, note: "musing" },
  { body: "Can I /claim this?", expect: null, note: "question" },
  { body: "Is /claim enabled here?", expect: null, note: "question about the bot" },
  { body: "> /claim", expect: null, note: "quoted" },
  { body: "> /claim\n> thanks", expect: null, note: "quoted block" },
  { body: ">/claim", expect: null, note: "quote without a space" },
  { body: "  > /claim", expect: null, note: "indented quote" },
  { body: ">> /claim", expect: null, note: "nested quote" },
  { body: "> @bob said:\n> /claim\n\nI agree with Bob.", expect: null, note: "quote, then an opinion" },
  { body: "```\n/claim\n```", expect: null, note: "fenced block" },
  { body: "```bash\n/claim\n```", expect: null, note: "fenced block with a language" },
  { body: "~~~\n/claim\n~~~", expect: null, note: "tilde fence" },
  { body: "Example:\n```\n/claim\n```\nNot yet, please.", expect: null, note: "command shown inside a fence" },
  { body: "```\n/claim", expect: null, note: "fence never closed" },
  { body: "`/claim`", expect: null, note: "inline code" },
  { body: "`/claim` to reserve", expect: null, note: "inline code first" },
  { body: "Type `/claim` to reserve it", expect: null, note: "inline code mid-sentence" },
  { body: "    /claim", expect: null, note: "indented code block" },
  { body: "\t/claim", expect: null, note: "tab-indented code block" },
  { body: "<!-- /claim -->", expect: null, note: "HTML comment" },
  { body: "<!--\n/claim\n-->", expect: null, note: "multi-line HTML comment" },
  { body: "/claim", author: BOT, expect: null, note: "typed by a bot" },
  { body: "/unclaim", author: { login: "dependabot[bot]", type: "Bot" }, expect: null, note: "typed by another bot" },
  { body: ".take", author: { login: "claim-helper", type: "Bot" }, expect: null, note: "typed by a bot without the suffix" },
  { body: "/claim", author: { login: "some-app[bot]", type: "User" }, expect: null, note: "login ends in [bot]" },
  { body: "/claimed", expect: null, note: "look-alike /claimed" },
  { body: "/claims", expect: null, note: "look-alike /claims" },
  { body: "/claiming this", expect: null, note: "look-alike /claiming" },
  { body: "/claim-this", expect: null, note: "hyphenated look-alike" },
  { body: "/claim/status", expect: null, note: "looks like a path" },
  { body: "/unclaimed", expect: null, note: "look-alike /unclaimed" },
  { body: "/released", expect: null, note: "look-alike /released" },
  { body: "/assign", expect: null, note: "/assign without a target" },
  { body: "/assign @bob", expect: null, note: "assigning somebody else" },
  { body: "/unassign", expect: null, note: "/unassign without a target" },
  { body: "/unassign @bob", expect: null, note: "unassigning somebody else" },
  { body: "claim", expect: null, note: "the word, no slash" },
  { body: "I claim this", expect: null, note: "a sentence" },
  { body: "unclaim", expect: null, note: "the word unclaim" },
  { body: "release", expect: null, note: "the word release" },
  { body: "take", expect: null, note: "the word take" },
  { body: "\\/claim", expect: null, note: "escaped slash" },
  { body: "https://example.com/claim", expect: null, note: "inside a URL" },
  { body: "／claim", expect: null, note: "full-width slash" },
  { body: "/ claim", expect: null, note: "space after the slash" },
  { body: "/", expect: null, note: "only a slash" },
  { body: ".taken", expect: null, note: "look-alike .taken" },
  { body: ".take-over", expect: null, note: "hyphenated .take" },
  { body: "x.take", expect: null, note: ".take inside a word" },
  { body: "- /claim", expect: null, note: "list item" },
  { body: "* /claim", expect: null, note: "starred list item" },
  { body: "1. /claim", expect: null, note: "numbered list item" },
  { body: "**/claim**", expect: null, note: "bold" },
  { body: "[/claim](https://example.com)", expect: null, note: "link text" },
  { body: "👍 /claim", expect: null, note: "emoji first" },
  { body: "/claim\n/unclaim", expect: null, note: "claim and unclaim together: ambiguous" },
  { body: "/claim\n/claim status", expect: null, note: "claim and status together: ambiguous" },
  { body: "", expect: null, note: "empty" },
  { body: "   \n  \n", expect: null, note: "only blanks" },
  { body: "Is anyone working on this? I would like to take it.", expect: null, note: "natural language, no command" },
];

/** The natural-language claims of `claim-corpus.ts`, by comment id. */
export function fixtureRows(fixturesDir = join(import.meta.dirname, "fixtures")): CommandRow[] {
  const bodies = new Map<number, string>();
  for (const file of readdirSync(fixturesDir).filter((f) => f.includes("-comments-per-page-"))) {
    const recorded = JSON.parse(readFileSync(join(fixturesDir, file), "utf8")) as { body: GhComment[] | null };
    for (const comment of recorded.body ?? []) bodies.set(comment.id, comment.body ?? "");
  }
  return CLAIM_CORPUS.map((row) => {
    const body = bodies.get(row.id);
    if (body === undefined) throw new Error(`comment ${row.id} of claim-corpus.ts is not in the fixtures`);
    return { body, expect: null, note: `claim-corpus ${row.id}: ${row.note}` };
  });
}

export function commandRows(): CommandRow[] {
  return [...HAND_ROWS, ...fixtureRows()].map((row) => ({ ...row, author: row.author ?? HUMAN }));
}
