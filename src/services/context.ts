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

async function fetchMarkdown(url: string): Promise<string> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { accept: "text/plain, text/markdown, */*" },
  });

  if (!response.ok) {
    throw new Error(`context fetch returned ${response.status}`);
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
): Promise<string> {
  if (!url) return "";

  const cached = await getCachedContext(pool, url);
  const isFresh =
    cached && Date.now() - cached.updatedAt.getTime() < REFRESH_AFTER_MS;

  if (isFresh) {
    return cached.content;
  }

  try {
    const content = await fetchMarkdown(url);
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
): Promise<boolean> {
  if (!url) return false;

  try {
    const content = await fetchMarkdown(url);
    await upsertCachedContext(pool, url, content);
    log.debug({ url, bytes: content.length }, "external context refreshed on push");
    return true;
  } catch (error) {
    log.warn({ url, err: error }, "forced context refresh failed");
    return false;
  }
}
