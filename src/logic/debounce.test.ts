import assert from "node:assert/strict";
import test from "node:test";

import { concatenateBlock, timeUntilFlush, type DebounceConfig } from "./debounce.js";
import type { InboundMessage } from "./inboundMessage.js";

const config: DebounceConfig = { windowMs: 10_000, maxWaitMs: 45_000 };

test("waits for the remaining silence after the last message", () => {
  const wait = timeUntilFlush(
    { firstMessageAt: 0, lastMessageAt: 3_000 },
    config,
    5_000,
  );
  assert.equal(wait, 8_000);
});

test("flushes as soon as the silence window is met", () => {
  const wait = timeUntilFlush(
    { firstMessageAt: 0, lastMessageAt: 0 },
    config,
    10_000,
  );
  assert.equal(wait, 0);
});

test("never returns a negative wait once the deadline has passed", () => {
  const wait = timeUntilFlush(
    { firstMessageAt: 0, lastMessageAt: 0 },
    config,
    30_000,
  );
  assert.equal(wait, 0);
});

test("the hard cap wins over a user who keeps typing", () => {
  // Still writing at 40s: the silence rule alone would wait until 50s.
  const wait = timeUntilFlush(
    { firstMessageAt: 0, lastMessageAt: 40_000 },
    config,
    40_000,
  );
  assert.equal(wait, 5_000, "should flush at the 45s cap, not 10s later");
});

function message(content: string | null, type: InboundMessage["type"] = "text"): InboundMessage {
  return {
    whatsappMessageId: `id-${content ?? "null"}`,
    phone: "5511999990001",
    type,
    content,
    pushName: null,
  };
}

test("joins the block in arrival order", () => {
  const text = concatenateBlock([
    message("oi"),
    message("a impressora"),
    message("parou de funcionar"),
  ]);
  assert.equal(text, "oi\na impressora\nparou de funcionar");
});

test("skips messages that carry no text", () => {
  const text = concatenateBlock([
    message("olha o erro"),
    message(null, "audio"),
    message("   "),
  ]);
  assert.equal(text, "olha o erro");
});

test("an all-media block produces an empty string", () => {
  assert.equal(concatenateBlock([message(null, "audio")]), "");
});
