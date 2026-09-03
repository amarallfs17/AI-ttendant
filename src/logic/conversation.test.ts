import assert from "node:assert/strict";
import test from "node:test";

import {
  CONVERSATION_STATES,
  isConversationState,
  isValidTransition,
  type ConversationState,
} from "./conversation.js";

const validTransitions: ReadonlyArray<[ConversationState, ConversationState]> = [
  ["idle", "collecting"],
  ["collecting", "awaitingConfirmation"],
  ["awaitingConfirmation", "idle"],
  ["humanHandling", "idle"],
  ["closed", "idle"],
  // A human can take over at any point.
  ["idle", "humanHandling"],
  ["collecting", "humanHandling"],
  ["awaitingConfirmation", "humanHandling"],
  // The sweeper can close anything.
  ["idle", "closed"],
  ["collecting", "closed"],
  ["awaitingConfirmation", "closed"],
  ["humanHandling", "closed"],
];

for (const [from, to] of validTransitions) {
  test(`allows ${from} -> ${to}`, () => {
    assert.equal(isValidTransition(from, to), true);
  });
}

const invalidTransitions: ReadonlyArray<[ConversationState, ConversationState]> = [
  // Cannot confirm a ticket that was never collected.
  ["idle", "awaitingConfirmation"],
  // Collection cannot restart without going through triage again.
  ["awaitingConfirmation", "collecting"],
  ["closed", "collecting"],
  ["closed", "awaitingConfirmation"],
  ["closed", "humanHandling"],
  ["humanHandling", "collecting"],
  ["humanHandling", "awaitingConfirmation"],
  ["collecting", "idle"],
];

for (const [from, to] of invalidTransitions) {
  test(`rejects ${from} -> ${to}`, () => {
    assert.equal(isValidTransition(from, to), false);
  });
}

test("staying in the same state is always a valid no-op", () => {
  for (const state of CONVERSATION_STATES) {
    assert.equal(isValidTransition(state, state), true);
  }
});

test("isConversationState recognises stored values", () => {
  assert.equal(isConversationState("awaitingConfirmation"), true);
  assert.equal(isConversationState("waiting"), false);
});
