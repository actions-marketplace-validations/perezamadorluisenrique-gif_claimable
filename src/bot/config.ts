/**
 * The bot's configuration file, `.github/claimable.yml`.
 *
 * The package has no dependencies, so this reads a deliberately tiny slice of
 * YAML: top-level `key: value` lines, lists (`- item` lines or `[a, b]`), and
 * one map (`messages:`) of plain strings. Anything else (anchors, aliases,
 * multi-line strings, flow maps, tabs, deeper nesting) is a clear error on
 * that line and the key falls back to its default. The file is read from the
 * default branch through the API, never from a checkout, so a pull request
 * cannot change the rules it is judged by.
 *
 * A bad value never stops the bot: it keeps the default for that key and says
 * so in the job summary.
 */

import { DEFAULT_CONFIG } from "./types.ts";
import type { BotConfig } from "./types.ts";

export const DEFAULT_CONFIG_PATH = ".github/claimable.yml";
const MAX_FILE = 20_000;
const MAX_MESSAGE = 600;

/** Replies whose words a project may replace. */
export const CUSTOM_MESSAGES = ["claimed", "nudge", "expired"] as const;
export type CustomMessage = (typeof CUSTOM_MESSAGES)[number];

type Scalar = string | { quoted: string };
type Value = Scalar | Scalar[] | Map<string, Scalar>;

export type ParsedYaml = { values: Map<string, Value>; errors: string[] };

const text = (v: Scalar): string => (typeof v === "string" ? v : v.quoted);
/** The text of a scalar value, or null when the value is a list or a map. */
const str = (v: Value): string | null => (Array.isArray(v) || v instanceof Map ? null : text(v));

/** Cut a trailing `# comment` that is outside quotes. */
function stripComment(line: string): string {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === "\\" && quote === '"') i++;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === "#" && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i);
    }
  }
  return line;
}

function scalar(raw: string): Scalar | null {
  const v = raw.trim();
  if (v.startsWith('"')) {
    if (v.length < 2 || !v.endsWith('"')) return null;
    try {
      return { quoted: JSON.parse(v) as string };
    } catch {
      return null;
    }
  }
  if (v.startsWith("'")) {
    if (v.length < 2 || !v.endsWith("'")) return null;
    return { quoted: v.slice(1, -1).replace(/''/g, "'") };
  }
  if (/^[&*!|>{}@`%]/.test(v) || v.startsWith("[") || /^-\s/.test(v)) return null;
  return v;
}

function inlineList(raw: string): Scalar[] | null {
  const v = raw.trim();
  if (!v.startsWith("[") || !v.endsWith("]")) return null;
  const inner = v.slice(1, -1).trim();
  if (inner === "") return [];
  const items: string[] = [];
  let cur = "";
  let quote: string | null = null;
  for (const ch of inner) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if (ch === ",") {
      items.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (quote) return null;
  items.push(cur);
  const out: Scalar[] = [];
  for (const item of items) {
    const s = scalar(item);
    if (s === null || text(s) === "") return null;
    out.push(s);
  }
  return out;
}

export function parseYaml(source: string): ParsedYaml {
  const values = new Map<string, Value>();
  const errors: string[] = [];
  const lines = source.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n");
  let open: { key: string; kind: "list" | "map" | null; list: Scalar[]; map: Map<string, Scalar>; line: number } | null = null;
  let skipping = false;

  const close = () => {
    if (!open) return;
    if (open.kind === "list") values.set(open.key, open.list);
    else if (open.kind === "map") values.set(open.key, open.map);
    else errors.push(`line ${open.line}: \`${open.key}\` has no value`);
    open = null;
  };

  lines.forEach((full, index) => {
    const n = index + 1;
    if (full.includes("\t")) {
      if (full.trim() !== "" && !/^\s*#/.test(full)) errors.push(`line ${n}: tabs are not allowed, indent with spaces`);
      return;
    }
    const line = stripComment(full).trimEnd();
    if (line.trim() === "" || line.trim() === "---") return;

    const indent = /^ */.exec(line)![0].length;
    const body = line.trim();

    if (indent > 0) {
      if (skipping) return;
      if (!open) {
        errors.push(`line ${n}: unexpected indentation`);
        return;
      }
      if (body.startsWith("- ") || body === "-") {
        if (open.kind === "map") {
          errors.push(`line ${n}: \`${open.key}\` mixes a list and a map`);
          return;
        }
        const item = scalar(body.slice(1));
        if (item === null || text(item) === "") errors.push(`line ${n}: this list item is not a plain or quoted string`);
        else {
          open.kind = "list";
          open.list.push(item);
        }
        return;
      }
      const sub = /^([A-Za-z][A-Za-z0-9-]*):\s+(.+)$/.exec(body);
      if (!sub) {
        errors.push(`line ${n}: expected \`name: value\``);
        return;
      }
      if (open.kind === "list") {
        errors.push(`line ${n}: \`${open.key}\` mixes a list and a map`);
        return;
      }
      const v = scalar(sub[2]);
      if (v === null) errors.push(`line ${n}: \`${sub[1]}\` is not a plain or quoted string`);
      else {
        open.kind = "map";
        open.map.set(sub[1], v);
      }
      return;
    }

    close();
    skipping = false;
    const top = /^([A-Za-z][A-Za-z0-9-]*):(?:\s+(.*))?$/.exec(body);
    if (!top) {
      errors.push(`line ${n}: expected \`key: value\``);
      skipping = true;
      return;
    }
    const [, key, rest] = top;
    if (values.has(key) || open !== null) {
      errors.push(`line ${n}: \`${key}\` appears twice, the first one is used`);
      skipping = true;
      return;
    }
    if (rest === undefined || rest.trim() === "") {
      open = { key, kind: null, list: [], map: new Map(), line: n };
      return;
    }
    const list = rest.trim().startsWith("[") ? inlineList(rest) : null;
    if (list !== null) {
      values.set(key, list);
      return;
    }
    const v = scalar(rest);
    if (v === null) {
      errors.push(`line ${n}: \`${key}\` must be a plain or quoted string, a number, true/false or a list`);
      skipping = true;
      return;
    }
    values.set(key, v);
  });
  close();
  return { values, errors };
}

const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const NAME_LIMIT = 100;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f\p{Cf}]/u;

export type ReadConfig = { config: BotConfig; warnings: string[] };

/** The configuration for a file's text (`null` = no file), with a warning for everything that was not usable. */
export function readConfig(source: string | null): ReadConfig {
  const config: BotConfig = { ...DEFAULT_CONFIG, labels: [], blockedLabels: [], exemptUsers: [], blockedUsers: [], messages: {} };
  const warnings: string[] = [];
  if (source === null) return { config, warnings };
  if (source.length > MAX_FILE) return { config, warnings: [`The configuration file is longer than ${MAX_FILE} characters, so it is ignored.`] };

  const { values, errors } = parseYaml(source);
  for (const e of errors) warnings.push(`Configuration: ${e}.`);

  const bad = (key: string, expected: string) => warnings.push(`Configuration: \`${key}\` ${expected}; using the default.`);

  const int = (key: string, min: number, max: number): number | null => {
    const v = values.get(key);
    if (v === undefined) return null;
    const t = str(v);
    if (t === null || !/^\d{1,4}$/.test(t) || Number(t) < min || Number(t) > max) {
      bad(key, `must be a whole number from ${min} to ${max}`);
      return null;
    }
    return Number(t);
  };
  const bool = (key: string): boolean | null => {
    const v = values.get(key);
    if (v === undefined) return null;
    if (v === "true" || v === "false") return v === "true";
    bad(key, "must be true or false");
    return null;
  };
  const list = (key: string, ok: (s: string) => boolean, what: string): string[] | null => {
    const v = values.get(key);
    if (v === undefined) return null;
    const items = Array.isArray(v) ? v : v instanceof Map ? null : [v];
    if (!items) {
      bad(key, "must be a list");
      return null;
    }
    const out: string[] = [];
    for (const item of items) {
      const s = text(item);
      if (!ok(s)) {
        bad(key, `has an entry that is not ${what} (${JSON.stringify(s.slice(0, 30))})`);
        return null;
      }
      out.push(s);
    }
    if (out.length > 100) {
      bad(key, "has more than 100 entries");
      return null;
    }
    return out;
  };
  const labelOk = (s: string) => s.length > 0 && s.length <= NAME_LIMIT && !CONTROL.test(s) && !s.includes(",");
  const userOk = (s: string) => LOGIN.test(s.replace(/^@/, ""));

  const nudge = int("nudge-days", 1, 365);
  if (nudge !== null) config.nudgeDays = nudge;
  const release = int("release-days", 1, 365);
  if (release !== null) config.releaseDays = release;
  const max = int("max-claims", 1, 50);
  if (max !== null) config.maxClaims = max;
  const hint = bool("hint-on-natural-claims");
  if (hint !== null) config.hintOnNaturalClaims = hint;
  const labels = list("labels", labelOk, "a label name");
  if (labels) config.labels = labels;
  const blockedLabels = list("blocked-labels", labelOk, "a label name");
  if (blockedLabels) config.blockedLabels = blockedLabels;
  const exempt = list("exempt-users", userOk, "a GitHub login");
  if (exempt) config.exemptUsers = exempt.map((u) => u.replace(/^@/, ""));
  const blocked = list("blocked-users", userOk, "a GitHub login");
  if (blocked) config.blockedUsers = blocked.map((u) => u.replace(/^@/, ""));

  const claimed = values.get("claimed-label");
  if (claimed !== undefined) {
    const t = str(claimed);
    if (t === null) bad("claimed-label", "must be a label name");
    else if (!labelOk(t)) bad("claimed-label", "must be a label name of at most 100 characters");
    else config.claimedLabel = t;
  }

  const messages = values.get("messages");
  if (messages !== undefined) {
    if (!(messages instanceof Map)) bad("messages", `must be a map with some of ${CUSTOM_MESSAGES.join(", ")}`);
    else {
      for (const [k, v] of messages) {
        const t = text(v);
        if (!(CUSTOM_MESSAGES as readonly string[]).includes(k)) warnings.push(`Configuration: \`messages.${k}\` is not a message you can change (${CUSTOM_MESSAGES.join(", ")}).`);
        else if (t.length === 0 || t.length > MAX_MESSAGE) warnings.push(`Configuration: \`messages.${k}\` must be between 1 and ${MAX_MESSAGE} characters; using the default.`);
        else config.messages[k as CustomMessage] = t;
      }
    }
  }

  const known = new Set(["nudge-days", "release-days", "max-claims", "labels", "blocked-labels", "hint-on-natural-claims", "exempt-users", "blocked-users", "claimed-label", "messages"]);
  for (const key of values.keys()) if (!known.has(key)) warnings.push(`Configuration: \`${key}\` is not a setting the bot knows; ignored.`);

  return { config, warnings };
}

/** Where the file lives: a plain relative path inside the repository, or the default. */
export function configPath(input: string | undefined): { path: string; warning: string | null } {
  const v = (input ?? "").trim();
  if (v === "") return { path: DEFAULT_CONFIG_PATH, warning: null };
  const ok = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(v) && v.length <= 100 && !v.split("/").some((p) => p === ".." || p === ".");
  return ok ? { path: v, warning: null } : { path: DEFAULT_CONFIG_PATH, warning: "The `config` input is not a plain relative path; using the default." };
}
