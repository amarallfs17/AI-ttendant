import type { ConversationState } from "./conversation.js";

export interface MessageDirection {
  direction: "inbound" | "outbound";
  source: "user" | "bot" | "human";
}

export type SuppressionReason = "no-user-message" | "loop-detected";

export type ReplyDecision =
  | { suppress: true; reason: SuppressionReason }
  | { suppress: false };

/** How many bot replies may pile up unanswered before we call it a loop. */
const MAX_UNANSWERED_BOT_MESSAGES = 2;

/**
 * Counts the bot messages sitting at the end of a conversation with no user
 * message after them. `recent` must be ordered newest first.
 */
export function countTrailingBotMessages(
  recent: readonly MessageDirection[],
): number {
  let count = 0;
  for (const message of recent) {
    if (message.direction === "outbound" && message.source === "bot") {
      count += 1;
      continue;
    }
    break;
  }
  return count;
}

/**
 * Decides whether the bot may answer a block of user messages.
 *
 * claude.md §7 asks that the bot never send two messages in a row without a
 * user reply. Enforcing that by "is the last stored message from the bot?"
 * breaks with debounce: a user who types while the bot is answering produces a
 * block whose messages are *older* than that answer, and their follow-up would
 * be silently dropped. The real guarantees against double replies are
 * structural — deduplication by whatsapp_message_id, and one block producing
 * exactly one reply — so this guard only catches what those cannot: a send that
 * no user message prompted, and a genuine pile-up of unanswered bot messages.
 */
export function shouldSuppressReply(input: {
  blockSize: number;
  trailingBotMessages: number;
}): ReplyDecision {
  if (input.blockSize === 0) {
    return { suppress: true, reason: "no-user-message" };
  }
  if (input.trailingBotMessages >= MAX_UNANSWERED_BOT_MESSAGES) {
    return { suppress: true, reason: "loop-detected" };
  }
  return { suppress: false };
}

/** Irreversible actions get a ceiling: a loop must not open ticket after ticket. */
export const MAX_TICKETS_PER_HOUR = 3;

export type ActionBlockReason =
  | "conversation-paused"
  | "human-handling"
  | "ticket-rate-limit";

export type ActionPermission =
  | { allowed: true }
  | { allowed: false; reason: ActionBlockReason };

/**
 * Decides whether the agent may act at all, before the action itself is
 * considered (claude.md §8).
 *
 * `paused_until` and `humanHandling` are written by the handoff in phase 9;
 * honouring them here means the bot goes quiet the moment a person takes over,
 * with no further change to this file.
 */
export function canActAutomatically(input: {
  state: ConversationState;
  pausedUntil: Date | null;
  now: Date;
}): ActionPermission {
  if (input.state === "humanHandling") {
    return { allowed: false, reason: "human-handling" };
  }
  if (input.pausedUntil && input.pausedUntil > input.now) {
    return { allowed: false, reason: "conversation-paused" };
  }
  return { allowed: true };
}

/** Guards the one irreversible action the agent can take on its own. */
export function canCreateTicket(ticketsInLastHour: number): ActionPermission {
  return ticketsInLastHour >= MAX_TICKETS_PER_HOUR
    ? { allowed: false, reason: "ticket-rate-limit" }
    : { allowed: true };
}
