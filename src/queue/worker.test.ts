import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import { NonRetryableError } from "../services/errors.js";
import { withRetry, type RetryContext } from "./worker.js";

function retryContext(): RetryContext & { waits: number[] } {
  const waits: number[] = [];
  return {
    waits,
    operation: "sendText",
    meta: { phone: "5511999990001" },
    log: {
      warn: (obj: object) => {
        waits.push((obj as { waitMs: number }).waitMs);
      },
    },
  };
}

/** Drives mocked timers until the promise settles, without waiting for real time. */
async function settle<T>(t: TestContext, promise: Promise<T>): Promise<T> {
  let done = false;
  const tracked = promise.then(
    (value) => {
      done = true;
      return value;
    },
    (error: unknown) => {
      done = true;
      throw error;
    },
  );

  for (let i = 0; i < 50 && !done; i += 1) {
    await Promise.resolve();
    t.mock.timers.tick(60_000);
  }

  return tracked;
}

test("returns the result without retrying when the call succeeds", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const ctx = retryContext();
  let calls = 0;

  const result = await settle(
    t,
    withRetry(async () => {
      calls += 1;
      return "ok";
    }, ctx),
  );

  assert.equal(result, "ok");
  assert.equal(calls, 1);
  assert.deepEqual(ctx.waits, []);
});

test("retries a transient failure and backs off 1s then 5s", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const ctx = retryContext();
  let calls = 0;

  const result = await settle(
    t,
    withRetry(async () => {
      calls += 1;
      if (calls < 3) throw new Error("connection reset");
      return "ok";
    }, ctx),
  );

  assert.equal(result, "ok");
  assert.equal(calls, 3);
  assert.deepEqual(ctx.waits, [1000, 5000]);
});

test("gives up after three attempts and rethrows the last error", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const ctx = retryContext();
  let calls = 0;

  await assert.rejects(
    settle(
      t,
      withRetry(async () => {
        calls += 1;
        throw new Error("evolution is down");
      }, ctx),
    ),
    /evolution is down/,
  );

  assert.equal(calls, 3);
  assert.deepEqual(ctx.waits, [1000, 5000]);
});

test("does not retry a NonRetryableError", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const ctx = retryContext();
  let calls = 0;

  await assert.rejects(
    settle(
      t,
      withRetry(async () => {
        calls += 1;
        throw new NonRetryableError("400 invalid number");
      }, ctx),
    ),
    /invalid number/,
  );

  assert.equal(calls, 1);
  assert.deepEqual(ctx.waits, []);
});
