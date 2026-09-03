import assert from "node:assert/strict";
import test from "node:test";

import {
  countTrailingBotMessages,
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
