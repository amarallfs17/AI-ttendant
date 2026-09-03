import timers from "node:timers/promises";

import { NonRetryableError } from "../services/errors.js";

export interface RetryLogger {
  warn: (obj: object, message: string) => void;
}

export interface RetryContext {
  log: RetryLogger;
  /** Identifies the conversation in the logs (claude.md §3). */
  meta: Record<string, unknown>;
  operation: string;
}

const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 1000;
const BACKOFF_FACTOR = 5;

/**
 * Retries transient failures (network, 5xx, 429) with exponential backoff:
 * 1s then 5s. Services throw, the worker decides (claude.md §3).
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  { log, meta, operation }: RetryContext,
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof NonRetryableError || attempt >= MAX_ATTEMPTS) {
        throw error;
      }

      const waitMs = BASE_DELAY_MS * BACKOFF_FACTOR ** (attempt - 1);
      log.warn(
        { ...meta, operation, attempt, maxAttempts: MAX_ATTEMPTS, waitMs, err: error },
        "operation failed, retrying",
      );
      await timers.setTimeout(waitMs);
    }
  }
}
