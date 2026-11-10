/**
 * A very small GitHub REST client.
 *
 * No dependencies on purpose: `fetch` and `node:*` cover everything here, and a
 * tool whose whole point is "check before you trust" should not ask you to
 * install a dependency tree to run it.
 *
 * Three things it does that a bare fetch does not:
 *   - finds a token without being told (env, then the `gh` CLI)
 *   - respects both rate limits GitHub has, including the undocumented one
 *   - can record and replay responses, so the test suite is deterministic
 *     against an API whose answers change by the hour
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_API = "https://api.github.com";
const UA = "claimable (+https://github.com/perezamadorluisenrique-gif/claimable)";

export type CassetteMode = "off" | "record" | "replay";

type ClientState = {
  /** Explicit API base (flag or test override); wins over GITHUB_API_URL. */
  apiUrl: string | null;
  token: string | null;
  tokenResolved: boolean;
  /** Overrides the /user lookup; lets replayed fixtures name their viewer. */
  viewer: string | null | undefined;
  cassetteMode: CassetteMode;
  cassetteDir: string;
  /** In-process memo, so repeated checks on one repo cost one request. */
  memo: Map<string, unknown>;
  requests: number;
};

const state: ClientState = {
  apiUrl: null,
  token: null,
  tokenResolved: false,
  viewer: undefined,
  cassetteMode: (process.env.CLAIMABLE_CASSETTE as CassetteMode) || "off",
  cassetteDir: process.env.CLAIMABLE_CASSETTE_DIR || "test/fixtures",
  memo: new Map(),
  requests: 0,
};

export function configure(
  opts: Partial<Pick<ClientState, "cassetteMode" | "cassetteDir" | "token" | "viewer" | "apiUrl">>,
): void {
  if (opts.apiUrl !== undefined) state.apiUrl = opts.apiUrl ? opts.apiUrl.trim().replace(/\/+$/, "") : null;
  if (opts.cassetteMode !== undefined) state.cassetteMode = opts.cassetteMode;
  if (opts.cassetteDir !== undefined) state.cassetteDir = opts.cassetteDir;
  if (opts.viewer !== undefined) state.viewer = opts.viewer;
  if (opts.token !== undefined) {
    state.token = opts.token;
    state.tokenResolved = true;
  }
  state.memo.clear();
}

/**
 * The REST base URL, resolved in order: `--api-url` / `configure()`, then
 * `GITHUB_API_URL` (which GitHub Actions sets, on Enterprise too), then
 * github.com. Trailing slashes are dropped so joining a path never yields `//`.
 */
export function apiBase(): string {
  const raw = state.apiUrl ?? process.env.GITHUB_API_URL?.trim();
  return raw ? raw.replace(/\/+$/, "") : DEFAULT_API;
}

/**
 * The browser-facing origin that matches `apiBase()`, for evidence links.
 *   https://api.github.com          → https://github.com
 *   https://ghe.example.com/api/v3  → https://ghe.example.com
 *   https://api.acme.ghe.com        → https://acme.ghe.com
 */
export function webBase(): string {
  const base = apiBase();
  if (base === DEFAULT_API) return "https://github.com";
  try {
    const url = new URL(base);
    const host = url.host.replace(/^api\./i, "");
    const path = url.pathname.replace(/\/api\/v3\/?$/i, "").replace(/\/+$/, "");
    return `${url.protocol}//${host}${path}`;
  } catch {
    return "https://github.com";
  }
}

export function requestCount(): number {
  return state.requests;
}

/**
 * Token resolution, in order of least surprise:
 *   1. GITHUB_TOKEN / GH_TOKEN — what CI sets.
 *   2. `gh auth token` — what a contributor already has on their machine.
 *   3. nothing, and we run anonymously at 60 requests/hour.
 *
 * Running anonymously is allowed rather than fatal: a user evaluating one issue
 * should not have to authenticate first. The rate-limit error, if it comes,
 * says what to do about it.
 */
function resolveToken(): string | null {
  if (state.tokenResolved) return state.token;
  state.tokenResolved = true;

  const fromEnv = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (fromEnv) {
    state.token = fromEnv.trim();
    return state.token;
  }

  // On Windows the CLI may be `gh.exe` or a `gh.cmd` shim; the latter only runs
  // through a shell. Try the direct binary first so the common case does not
  // pay for the shell (and does not trip Node's shell-argument deprecation).
  const attempts: { cmd: string; shell: boolean }[] =
    process.platform === "win32"
      ? [{ cmd: "gh.exe", shell: false }, { cmd: "gh", shell: true }]
      : [{ cmd: "gh", shell: false }];

  for (const attempt of attempts) {
    try {
      const out = execFileSync(attempt.cmd, ["auth", "token"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 5000,
        shell: attempt.shell,
      });
      const trimmed = out.trim();
      if (trimmed.length > 0) {
        state.token = trimmed;
        return state.token;
      }
    } catch {
      // Not installed, not authenticated, or not on PATH — try the next form.
    }
  }

  state.token = null;
  return state.token;
}

export function hasToken(): boolean {
  return resolveToken() !== null;
}

/**
 * Responses that must never be written to a fixture file.
 *
 * `/user` is the authenticated caller's own profile. Fixtures get committed and
 * the repository is public, so recording it would publish whatever GitHub
 * happens to return about whoever ran the recorder — and it is not needed
 * anyway, since replayed runs pin the viewer explicitly.
 */
const NEVER_RECORD = [/^\/user(\?|$)/];

function isRecordable(path: string): boolean {
  return !NEVER_RECORD.some((p) => p.test(path));
}

export function cassettePath(path: string): string {
  const hash = createHash("sha256").update(path).digest("hex").slice(0, 12);
  const slug = path
    .replace(/^\//, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .slice(0, 80);
  return join(state.cassetteDir, `${slug}-${hash}.json`);
}

export class HttpError extends Error {
  status = 0;
  path = "";
}

function httpError(status: number, path: string, message: string): HttpError {
  const err = new HttpError(message);
  err.status = status;
  err.path = path;
  return err;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * GitHub enforces two different limits. The documented one (`x-ratelimit-*`)
 * resets on a known clock. The secondary one is undocumented, fires on burst
 * traffic, and answers 403 with a `retry-after` header. Handling only the first
 * is the usual bug — so both are handled, and both wait rather than fail.
 */
async function requestRaw(path: string, attempt = 0): Promise<{ body: unknown; headers: Headers }> {
  const token = resolveToken();
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": UA,
  };
  if (token) headers.authorization = `Bearer ${token}`;

  state.requests += 1;
  const res = await fetch(`${apiBase()}${path}`, { headers });

  if (res.status === 403 || res.status === 429) {
    const retryAfter = Number(res.headers.get("retry-after") || 0);
    const remaining = Number(res.headers.get("x-ratelimit-remaining") || -1);
    const reset = Number(res.headers.get("x-ratelimit-reset") || 0);

    let waitMs = 0;
    if (retryAfter > 0) {
      waitMs = retryAfter * 1000;
    } else if (remaining === 0 && reset > 0) {
      waitMs = Math.max(0, reset * 1000 - Date.now()) + 1000;
    }

    if (waitMs > 0 && attempt < 3) {
      if (waitMs > 120_000) {
        const mins = Math.ceil(waitMs / 60_000);
        throw httpError(
          res.status,
          path,
          token
            ? `rate limited for ${mins} more minutes`
            : `rate limited for ${mins} more minutes — running without a token (60 req/h). Authenticate with \`gh auth login\` or set GITHUB_TOKEN for 5000 req/h.`,
        );
      }
      await sleep(waitMs);
      return requestRaw(path, attempt + 1);
    }
  }

  if (res.status >= 500 && attempt < 3) {
    await sleep(500 * 2 ** attempt);
    return requestRaw(path, attempt + 1);
  }

  if (!res.ok) {
    let detail = "";
    try {
      const parsed = (await res.json()) as { message?: string };
      detail = parsed.message ? `: ${parsed.message}` : "";
    } catch {
      /* body was not JSON; the status code is enough */
    }
    throw httpError(res.status, path, `GET ${path} → ${res.status}${detail}`);
  }

  return { body: await res.json(), headers: res.headers };
}

/** GET a path, honouring the cassette and the in-process memo. */
export async function api<T>(path: string): Promise<T> {
  if (state.memo.has(path)) return state.memo.get(path) as T;

  if (state.cassetteMode === "replay") {
    const file = cassettePath(path);
    if (!existsSync(file)) {
      throw httpError(0, path, `no cassette for ${path} (expected ${file}) — re-record with CLAIMABLE_CASSETTE=record`);
    }
    const recorded = JSON.parse(readFileSync(file, "utf8")) as { status: number; body: unknown; error?: string };
    if (recorded.error) throw httpError(recorded.status, path, recorded.error);
    state.memo.set(path, recorded.body);
    return recorded.body as T;
  }

  try {
    const { body } = await requestRaw(path);
    if (state.cassetteMode === "record" && isRecordable(path)) {
      mkdirSync(state.cassetteDir, { recursive: true });
      writeFileSync(
        cassettePath(path),
        JSON.stringify({ path, recordedFor: path, status: 200, body }, null, 2),
      );
    }
    state.memo.set(path, body);
    return body as T;
  } catch (err) {
    if (state.cassetteMode === "record" && err instanceof HttpError && err.status === 404) {
      mkdirSync(state.cassetteDir, { recursive: true });
      writeFileSync(
        cassettePath(path),
        JSON.stringify({ path, status: 404, body: null, error: err.message }, null, 2),
      );
    }
    throw err;
  }
}

/**
 * Write to the API (POST, PATCH, DELETE). The one place that does.
 *
 * Never memoised, never recorded, and refused outright while replaying: a test
 * run that reaches this function has a bug, and must not be able to write to a
 * real repository by accident. 5xx is retried a few times; 403, 404 and 422 are
 * the caller's to interpret (no access, gone, nothing to change).
 */
export async function send<T = unknown>(method: "POST" | "PATCH" | "DELETE", path: string, body?: unknown, attempt = 0): Promise<T> {
  if (state.cassetteMode === "replay") {
    throw httpError(0, path, `${method} ${path} refused: writes are disabled while replaying cassettes`);
  }
  const token = resolveToken();
  if (!token) throw httpError(401, path, `${method} ${path} needs a token`);
  state.requests += 1;
  const res = await fetch(`${apiBase()}${path}`, {
    method,
    headers: {
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": UA,
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status >= 500 && attempt < 3) {
    await sleep(500 * 2 ** attempt);
    return send<T>(method, path, body, attempt + 1);
  }
  if (!res.ok) {
    let detail = "";
    try {
      const parsed = (await res.json()) as { message?: string };
      detail = parsed.message ? `: ${parsed.message}` : "";
    } catch {
      /* not JSON; the status is enough */
    }
    throw httpError(res.status, path, `${method} ${path} → ${res.status}${detail}`);
  }
  state.memo.clear();
  if (res.status === 204) return undefined as T;
  try {
    return (await res.json()) as T;
  } catch {
    return undefined as T;
  }
}

/** Like `api`, but a 404 means "absent", not "broken". */
export async function apiOptional<T>(path: string): Promise<T | null> {
  try {
    return await api<T>(path);
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) return null;
    throw err;
  }
}

/**
 * The authenticated user's login, or null when running anonymously.
 *
 * Needed so the tool does not report you as the obstacle. Without it, an issue
 * you claimed yourself last week comes back "DISCARD — @you claimed it", which
 * is technically true and completely useless.
 */
export async function viewerLogin(): Promise<string | null> {
  if (state.viewer !== undefined) return state.viewer;
  if (!resolveToken()) return null;
  try {
    const user = await api<{ login: string }>("/user");
    return user.login;
  } catch {
    return null;
  }
}

/** Search has its own, much stricter limit — used sparingly and never in a loop. */
export async function search<T>(kind: "issues", query: string, perPage = 20): Promise<{ total_count: number; items: T[] }> {
  const path = `/search/${kind}?q=${encodeURIComponent(query)}&per_page=${perPage}`;
  return api<{ total_count: number; items: T[] }>(path);
}
