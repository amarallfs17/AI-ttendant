import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { createQueue, type QueueLogger } from "./index.js";

function silentLog(): QueueLogger & { errors: object[] } {
  const errors: object[] = [];
  return {
    errors,
    debug: () => undefined,
    error: (obj) => {
      errors.push(obj);
    },
  };
}

test("runs tasks for the same phone in sequence", async () => {
  const queue = createQueue(silentLog());
  const events: string[] = [];

  queue.enqueue("5511", async () => {
    events.push("first:start");
    await delay(20);
    events.push("first:end");
  });
  queue.enqueue("5511", async () => {
    events.push("second:start");
    events.push("second:end");
  });

  await queue.drain();

  assert.deepEqual(events, ["first:start", "first:end", "second:start", "second:end"]);
});

test("runs tasks for different phones in parallel", async () => {
  const queue = createQueue(silentLog());
  const events: string[] = [];

  queue.enqueue("5511", async () => {
    events.push("a:start");
    await delay(20);
    events.push("a:end");
  });
  queue.enqueue("5522", async () => {
    events.push("b:start");
    await delay(20);
    events.push("b:end");
  });

  await queue.drain();

  // Interleaved starts prove the two chains are independent.
  assert.deepEqual(events, ["a:start", "b:start", "a:end", "b:end"]);
});

test("a failing task does not break the chain for that phone", async () => {
  const log = silentLog();
  const queue = createQueue(log);
  let ranAfterFailure = false;

  queue.enqueue("5511", () => Promise.reject(new Error("boom")));
  queue.enqueue("5511", async () => {
    ranAfterFailure = true;
  });

  await queue.drain();

  assert.equal(ranAfterFailure, true);
  assert.equal(log.errors.length, 1);
});

test("drain waits for tasks queued while draining", async () => {
  const queue = createQueue(silentLog());
  let finished = false;

  queue.enqueue("5511", async () => {
    await delay(10);
    queue.enqueue("5522", async () => {
      await delay(10);
      finished = true;
    });
  });

  await queue.drain();

  assert.equal(finished, true);
});

test("the chain map empties once the work is done", async () => {
  const queue = createQueue(silentLog());

  queue.enqueue("5511", async () => {
    await delay(5);
  });
  assert.equal(queue.pending(), 1);

  await queue.drain();

  assert.equal(queue.pending(), 0);
});
