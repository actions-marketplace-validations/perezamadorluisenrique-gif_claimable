/**
 * Reading a bot command out of a comment.
 *
 * The bot acts in public, on somebody else's repository, so the reading is
 * deliberately strict. A command counts only when it is the first word of a
 * line of the author's own text. Anything that merely *mentions* one (an
 * explanation, a quote of another person, a code sample, a bot) is not one:
 * missing a command costs its author a second try, reading a phantom one
 * assigns a stranger.
 *
 * Commands:
 *   claim    /claim   .take   /assign me
 *   unclaim  /unclaim /release /unassign me
 *   status   /claim status
 */

import type { Command, CommandKind } from "./types.ts";

/** What may follow a command: the end of the line, a space, or punctuation. */
const END = String.raw`(?=$|[\s,!?:;)]|\.(?:\s|$))`;

const COMMANDS: { kind: CommandKind; pattern: RegExp }[] = [
  { kind: "status", pattern: new RegExp(String.raw`^/claim[ \t]+status${END}`, "i") },
  { kind: "claim", pattern: new RegExp(String.raw`^/claim${END}`, "i") },
  { kind: "claim", pattern: new RegExp(String.raw`^\.take${END}`, "i") },
  { kind: "claim", pattern: new RegExp(String.raw`^/assign[ \t]+me${END}`, "i") },
  { kind: "unclaim", pattern: new RegExp(String.raw`^/unclaim${END}`, "i") },
  { kind: "unclaim", pattern: new RegExp(String.raw`^/release${END}`, "i") },
  { kind: "unclaim", pattern: new RegExp(String.raw`^/unassign[ \t]+me${END}`, "i") },
];

export type CommentAuthor = { login: string; type: string } | null;

/** Deleted accounts and bots never give commands. */
export function isBotAuthor(author: CommentAuthor): boolean {
  if (!author) return true;
  return author.type === "Bot" || /\[bot\]$/i.test(author.login) || author.login.toLowerCase() === "ghost";
}

/**
 * The text of the comment that is the author's own, as lines: without HTML
 * comments, fenced code, inline code, quotes and indented code.
 */
function ownLines(body: string): string[] {
  const noHtml = body.replace(/<!--[\s\S]*?(?:-->|$)/g, "\n");

  const kept: string[] = [];
  let fence: string | null = null;
  for (const line of noHtml.split(/\r?\n/)) {
    const open = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (open && open[1][0] === fence[0] && open[1].length >= fence.length) fence = null;
      continue;
    }
    if (open) {
      fence = open[1];
      continue;
    }
    kept.push(line);
  }

  // Inline code can span lines, so it is cut out of the joined text.
  const noInline = kept.join("\n").replace(/(`+)[\s\S]*?\1/g, "\u0000");

  return noInline
    .split("\n")
    .filter((line) => !/^( {4,}|\t)/.test(line) && !/^ {0,3}>/.test(line))
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * The one command in a comment, or null. Two different commands in the same
 * comment ("/claim" and "/unclaim") are ambiguous, so they are none.
 */
export function parseCommand(body: string | null, author: CommentAuthor): Command | null {
  if (!body || isBotAuthor(author)) return null;
  const found = new Set<CommandKind>();
  for (const line of ownLines(body)) {
    const hit = COMMANDS.find((c) => c.pattern.test(line));
    if (hit) found.add(hit.kind);
  }
  if (found.size !== 1) return null;
  return { kind: [...found][0] };
}
