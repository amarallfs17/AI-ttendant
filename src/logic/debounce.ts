import type { InboundMessage } from "./inboundMessage.js";

export interface DebounceConfig {
  /** Silence needed before a block is considered finished. */
  windowMs: number;
  /** Hard cap measured from the first message, so a chatty user still gets an answer. */
  maxWaitMs: number;
}

export interface DebounceWindow {
  firstMessageAt: number;
  lastMessageAt: number;
}

/**
 * Milliseconds still to wait before processing the block; 0 means process now.
 *
 * Kept free of timers so the rule is testable without waiting: the queue layer
 * turns this number into a setTimeout (claude.md §3, logic does no I/O).
 */
export function timeUntilFlush(
  window: DebounceWindow,
  config: DebounceConfig,
  now: number,
): number {
  const quietDeadline = window.lastMessageAt + config.windowMs;
  const hardDeadline = window.firstMessageAt + config.maxWaitMs;
  const deadline = Math.min(quietDeadline, hardDeadline);
  return Math.max(0, deadline - now);
}

/**
 * Joins a block into the single text the agent will read.
 *
 * Messages without text (audio before transcription, image without caption)
 * contribute nothing here; the block still carries them for later phases.
 */
export function concatenateBlock(messages: readonly InboundMessage[]): string {
  return messages
    .map((message) => message.content?.trim())
    .filter((content): content is string => Boolean(content))
    .join("\n");
}
