import assert from "node:assert/strict";
import test from "node:test";

import {
  canActAutomatically,
  canCreateTicket,
  countTrailingBotMessages,
  MAX_TICKETS_PER_HOUR,
  shouldSuppressReply,
  type MessageDirection,
} from "./guards.js";

const userMessage: MessageDirection = { direction: "inbound", source: "user" };
const botMessage: MessageDirection = { direction: "outbound", source: "bot" };
const humanMessage: MessageDirection = { direction: "outbound", source: "human" };

test("counts the run of bot messages at the end of a conversation", () => {
  assert.equal(countTrailingBotMessages([botMessage, botMessage, userMessage]), 2);
  assert.equal(countTrailingBotMessages([userMessage, botMessage]), 0);
  assert.equal(countTrailingBotMessages([]), 0);
});

test("a human reply does not count as a bot message", () => {
  assert.equal(countTrailingBotMessages([humanMessage, botMessage]), 0);
});

test("answers a normal block of user messages", () => {
  const decision = shouldSuppressReply({ blockSize: 2, trailingBotMessages: 0 });
  assert.equal(decision.suppress, false);
});

test("suppresses a reply that no user message prompted", () => {
  const decision = shouldSuppressReply({ blockSize: 0, trailingBotMessages: 0 });
  assert.equal(decision.suppress, true);
  assert.equal(decision.suppress && decision.reason, "no-user-message");
});

test("suppresses once two bot messages are already unanswered", () => {
  const decision = shouldSuppressReply({ blockSize: 1, trailingBotMessages: 2 });
  assert.equal(decision.suppress, true);
  assert.equal(decision.suppress && decision.reason, "loop-detected");
});

// The regression this phase's anti-loop decision exists to prevent: someone
// typing while the bot answers produces a block whose messages are older than
// that answer. The literal "last stored message is from the bot" rule would
// drop their follow-up in silence.
test("still answers when the user wrote while the bot was replying", () => {
  const decision = shouldSuppressReply({ blockSize: 1, trailingBotMessages: 1 });
  assert.equal(decision.suppress, false);
});

const now = new Date("2026-09-04T12:00:00Z");

test("acts normally on an idle conversation", () => {
  const permission = canActAutomatically({ state: "idle", pausedUntil: null, now });
  assert.equal(permission.allowed, true);
});

// Phase 9 writes these fields; honouring them here means the bot goes quiet the
// moment a person takes over, with no further change to this file.
test("stays quiet once a human has taken over", () => {
  const permission = canActAutomatically({ state: "humanHandling", pausedUntil: null, now });
  assert.equal(permission.allowed, false);
  assert.equal(permission.allowed === false && permission.reason, "human-handling");
});

test("stays quiet while the conversation is paused", () => {
  const permission = canActAutomatically({
    state: "idle",
    pausedUntil: new Date("2026-09-04T12:30:00Z"),
    now,
  });
  assert.equal(permission.allowed, false);
  assert.equal(permission.allowed === false && permission.reason, "conversation-paused");
});

test("resumes once the pause has expired", () => {
  const permission = canActAutomatically({
    state: "idle",
    pausedUntil: new Date("2026-09-04T11:30:00Z"),
    now,
  });
  assert.equal(permission.allowed, true);
});

test("allows tickets below the hourly ceiling", () => {
  assert.equal(canCreateTicket(0).allowed, true);
  assert.equal(canCreateTicket(MAX_TICKETS_PER_HOUR - 1).allowed, true);
});

// Creating a ticket is the one irreversible action the agent takes alone
// (claude.md §8), so a loop must not be able to spam the board.
test("blocks once the hourly ticket ceiling is reached", () => {
  const permission = canCreateTicket(MAX_TICKETS_PER_HOUR);
  assert.equal(permission.allowed, false);
  assert.equal(permission.allowed === false && permission.reason, "ticket-rate-limit");
});
