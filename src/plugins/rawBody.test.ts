import assert from "node:assert/strict";
import test from "node:test";

import Fastify from "fastify";

import { registerRawBody } from "./rawBody.js";

async function appWithEcho() {
  const app = Fastify();
  registerRawBody(app);
  app.post("/echo", async (request) => ({
    body: request.body,
    raw: request.rawBody,
  }));
  await app.ready();
  return app;
}

// The WhatsApp route reads request.body; keeping the raw text must not change
// that in any way.
test("still parses the body as before", async (t) => {
  const app = await appWithEcho();
  t.after(async () => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/echo",
    headers: { "content-type": "application/json" },
    payload: '{"event":"messages.upsert","data":{"key":{"id":"abc"}}}',
  });

  assert.equal(response.statusCode, 200);
  const parsed = response.json<{ body: { event: string; data: { key: { id: string } } } }>();
  assert.equal(parsed.body.event, "messages.upsert");
  assert.equal(parsed.body.data.key.id, "abc");
});

test("keeps the raw bytes exactly as they arrived", async (t) => {
  const app = await appWithEcho();
  t.after(async () => app.close());

  // Deliberately odd spacing and key order: re-serializing would not reproduce
  // it, which is why signatures need the original text.
  const payload = '{  "b":1,\n  "a":"acentuação"  }';
  const response = await app.inject({
    method: "POST",
    url: "/echo",
    headers: { "content-type": "application/json" },
    payload,
  });

  assert.equal(response.json<{ raw: string }>().raw, payload);
});

test("malformed JSON still answers 400 instead of crashing", async (t) => {
  const app = await appWithEcho();
  t.after(async () => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/echo",
    headers: { "content-type": "application/json" },
    payload: "{not json",
  });

  assert.equal(response.statusCode, 400);
});

test("an empty body is accepted, as Fastify did before", async (t) => {
  const app = await appWithEcho();
  t.after(async () => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/echo",
    headers: { "content-type": "application/json" },
    payload: "",
  });

  assert.equal(response.statusCode, 200);
});
