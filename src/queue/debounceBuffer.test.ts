import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import type { DebounceConfig } from "../logic/debounce.js";
import type { InboundMessage } from "../logic/inboundMessage.js";
import { createDebounceBuffer } from "./debounceBuffer.js";

const config: DebounceConfig = { windowMs: 10_000, maxWaitMs: 45_000 };
const silentLog = { debug: () => undefined };

function message(id: string, phone = "5511999990001"): InboundMessage {
  return {
    whatsappMessageId: id,
    phone,
    type: "text",
    content: id,
    pushName: null,
  };
}

interface Flush {
  phone: string;
  ids: string[];
}

function setup(t: TestContext): {
  buffer: ReturnType<typeof createDebounceBuffer>;
  flushes: Flush[];
} {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const flushes: Flush[] = [];
  const buffer = createDebounceBuffer(config, silentLog, (phone, messages) => {
    flushes.push({ phone, ids: messages.map((m) => m.whatsappMessageId) });
  });
  return { buffer, flushes };
}

test("groups a burst from the same phone into one block", (t) => {
  const { buffer, flushes } = setup(t);

  buffer.add(message("a"));
  t.mock.timers.tick(2_000);
  buffer.add(message("b"));
  t.mock.timers.tick(2_000);
  buffer.add(message("c"));

  t.mock.timers.tick(9_000);
  assert.deepEqual(flushes, [], "silence window not met yet");

  t.mock.timers.tick(1_000);
  assert.deepEqual(flushes, [{ phone: "5511999990001", ids: ["a", "b", "c"] }]);
  assert.equal(buffer.pending(), 0);
});

test("keeps windows of different phones apart", (t) => {
  const { buffer, flushes } = setup(t);

  buffer.add(message("a", "5511111111111"));
  buffer.add(message("b", "5522222222222"));
  t.mock.timers.tick(10_000);

  assert.equal(flushes.length, 2);
  assert.deepEqual(
    flushes.map((f) => f.phone).sort(),
    ["5511111111111", "5522222222222"],
  );
});

test("the hard cap answers a user who never stops typing", (t) => {
  const { buffer, flushes } = setup(t);

  buffer.add(message("first"));
  // A message every 5s would postpone the silence window forever.
  for (let i = 0; i < 10; i += 1) {
    t.mock.timers.tick(5_000);
    buffer.add(message(`m${i}`));
  }

  assert.equal(flushes.length, 1, "should have flushed at the 45s cap");
  assert.equal(flushes[0]?.ids[0], "first");
});

test("extends the window once while the contact is still typing", (t) => {
  const { buffer, flushes } = setup(t);

  buffer.add(message("a"));
  t.mock.timers.tick(9_000);
  buffer.notePresence("5511999990001", "typing");

  t.mock.timers.tick(1_000);
  assert.deepEqual(flushes, [], "extended instead of flushing");

  t.mock.timers.tick(10_000);
  assert.equal(flushes.length, 1, "flushes after the single extension");
});

test("never extends twice", (t) => {
  const { buffer, flushes } = setup(t);

  buffer.add(message("a"));
  t.mock.timers.tick(9_000);
  buffer.notePresence("5511999990001", "typing");
  t.mock.timers.tick(10_000);

  // Still typing, but the one allowed extension is spent.
  buffer.notePresence("5511999990001", "typing");
  t.mock.timers.tick(10_000);

  assert.equal(flushes.length, 1);
});

test("a stale typing signal does not extend", (t) => {
  const { buffer, flushes } = setup(t);

  buffer.add(message("a"));
  buffer.notePresence("5511999990001", "typing");
  // The signal is older than the freshness limit by the time the window ends.
  t.mock.timers.tick(10_000);

  assert.equal(flushes.length, 1, "stale presence must not hold the block");
});

test("flushAll releases every open window", (t) => {
  const { buffer, flushes } = setup(t);

  buffer.add(message("a", "5511111111111"));
  buffer.add(message("b", "5522222222222"));
  buffer.flushAll();

  assert.equal(flushes.length, 2);
  assert.equal(buffer.pending(), 0);
});
