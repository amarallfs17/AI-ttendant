export const CONVERSATION_STATES = [
  "idle",
  "collecting",
  "awaitingConfirmation",
  "humanHandling",
  "closed",
] as const;

export type ConversationState = (typeof CONVERSATION_STATES)[number];

/**
 * The only state changes the system may perform. Anything outside this table is
 * a bug: the caller logs and keeps the current state rather than corrupting it
 * (claude.md §7, explicit conversation state).
 *
 * `humanHandling` and `closed` are reachable from anywhere — a human can take
 * over at any moment, and the inactivity sweeper can close any conversation.
 */
const VALID_TRANSITIONS: Record<ConversationState, readonly ConversationState[]> = {
  idle: ["collecting", "humanHandling", "closed"],
  collecting: ["awaitingConfirmation", "humanHandling", "closed"],
  awaitingConfirmation: ["idle", "humanHandling", "closed"],
  humanHandling: ["idle", "closed"],
  closed: ["idle"],
};

export function isValidTransition(
  from: ConversationState,
  to: ConversationState,
): boolean {
  // Staying put is always fine and means nothing changed.
  if (from === to) return true;
  return VALID_TRANSITIONS[from].includes(to);
}

export function isConversationState(value: string): value is ConversationState {
  return (CONVERSATION_STATES as readonly string[]).includes(value);
}
