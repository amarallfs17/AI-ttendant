import type pg from "pg";

import { getCachedContext, upsertCachedContext } from "../db/queries.js";

const REFRESH_AFTER_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;
/** A context file is a page of reminders, not a document dump. */
const MAX_CONTENT_BYTES = 256 * 1024;

export interface ContextLogger {
  debug: (obj: object, message: string) => void;
  warn: (obj: object, message: string) => void;
}

/**
 * A private repository will not serve its raw file to an anonymous request, so
 * a token turns this into an authenticated GitHub Contents API call:
 * `application/vnd.github.raw` asks that endpoint for the file itself rather
 * than the JSON metadata wrapper.
 *
 * Without a token nothing changes — a public raw URL is fetched as before.
 */
function buildHeaders(token: string | undefined): Record<string, string> {
  if (!token) {
    return { accept: "text/plain, text/markdown, */*" };
  }

  return {
    accept: "application/vnd.github.raw",
    authorization: `Bearer ${token}`,
    "x-github-api-version": "2022-11-28",
  };
}

async function fetchMarkdown(url: string, token: string | undefined): Promise<string> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: buildHeaders(token),
  });

  if (!response.ok) {
    // 404 on a private repo almost always means the token cannot see it, which
    // GitHub reports as "not found" rather than "forbidden".
    const hint =
      response.status === 404 && token
        ? " (repositório privado: confira se o token tem acesso a ele)"
        : response.status === 401 || response.status === 403
          ? " (token inválido ou sem permissão de leitura)"
          : "";
    throw new Error(`context fetch returned ${response.status}${hint}`);
  }

  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_CONTENT_BYTES) {
    throw new Error("context file is larger than the allowed size");
  }

  return text;
}

/**
 * Current reminders to put in front of the agent — "system X is down today" —
 * without a redeploy. Optional: with no URL configured the feature is simply
 * off (claude.md §10).
 *
 * A stale reminder beats no answer, so a failed fetch serves whatever is
 * cached and only warns.
 */
export async function getExternalContext(
  pool: pg.Pool,
  url: string | undefined,
  log: ContextLogger,
  token?: string,
): Promise<string> {
  if (!url) return "";

  const cached = await getCachedContext(pool, url);
  const isFresh =
    cached && Date.now() - cached.updatedAt.getTime() < REFRESH_AFTER_MS;

  if (isFresh) {
    return cached.content;
  }

  try {
    const content = await fetchMarkdown(url, token);
    await upsertCachedContext(pool, url, content);
    log.debug({ url, bytes: content.length }, "external context refreshed");
    return content;
  } catch (error) {
    if (cached) {
      log.warn({ url, err: error }, "context fetch failed; serving stale cache");
      return cached.content;
    }
    log.warn({ url, err: error }, "context fetch failed and nothing is cached");
    return "";
  }
}

/** Forced refresh, used by the GitHub webhook when the file changes. */
export async function refreshExternalContext(
  pool: pg.Pool,
  url: string | undefined,
  log: ContextLogger,
  token?: string,
): Promise<boolean> {
  if (!url) return false;

  try {
    const content = await fetchMarkdown(url, token);
    await upsertCachedContext(pool, url, content);
    log.debug({ url, bytes: content.length }, "external context refreshed on push");
    return true;
  } catch (error) {
    log.warn({ url, err: error }, "forced context refresh failed");
    return false;
  }
}
