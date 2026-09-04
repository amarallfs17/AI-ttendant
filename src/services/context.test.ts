import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import test from "node:test";

import { createPool } from "../db/index.js";
import { upsertCachedContext } from "../db/queries.js";
import { getExternalContext, refreshExternalContext } from "./context.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const skip = testDatabaseUrl ? false : "set TEST_DATABASE_URL to run database tests";

const silentLog = { debug: () => undefined, warn: () => undefined };

/** Serves a body once, then counts how many times it was asked. */
async function serveMarkdown(body: string, status = 200): Promise<{
  url: string;
  hits: () => number;
  close: () => Promise<void>;
}> {
  let hits = 0;
  const server = createServer((_req, res) => {
    hits += 1;
    res.writeHead(status, { "Content-Type": "text/markdown" });
    res.end(body);
  });

  server.listen(0);
  await once(server, "listening");
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  return {
    url: `http://127.0.0.1:${port}/context.md`,
    hits: () => hits,
    close: async () => {
      server.close();
      await once(server as Server, "close");
    },
  };
}

test("with no URL configured the feature is simply off", async () => {
  assert.equal(await getExternalContext(null as never, undefined, silentLog), "");
});

test("fetches and caches on the first call", { skip }, async (t) => {
  const pool = createPool(testDatabaseUrl!);
  const origin = await serveMarkdown("# Avisos\nVIC em manutenção.");

  t.after(async () => {
    await pool.query("delete from context_cache where url = $1", [origin.url]);
    await origin.close();
    await pool.end();
  });

  const first = await getExternalContext(pool, origin.url, silentLog);
  assert.match(first, /VIC em manutenção/);
  assert.equal(origin.hits(), 1);

  // Freshly cached: the second call must not hit the network again.
  const second = await getExternalContext(pool, origin.url, silentLog);
  assert.equal(second, first);
  assert.equal(origin.hits(), 1, "a fresh cache must not refetch");
});

test("refetches once the cache is stale", { skip }, async (t) => {
  const pool = createPool(testDatabaseUrl!);
  const origin = await serveMarkdown("conteudo novo");

  t.after(async () => {
    await pool.query("delete from context_cache where url = $1", [origin.url]);
    await origin.close();
    await pool.end();
  });

  await upsertCachedContext(pool, origin.url, "conteudo velho");
  await pool.query(
    "update context_cache set updated_at = now() - interval '1 hour' where url = $1",
    [origin.url],
  );

  const content = await getExternalContext(pool, origin.url, silentLog);
  assert.equal(content, "conteudo novo");
  assert.equal(origin.hits(), 1);
});

// A stale reminder beats no answer at all.
test("serves the stale cache when the fetch fails", { skip }, async (t) => {
  const pool = createPool(testDatabaseUrl!);
  // Nothing is listening on this port.
  const url = "http://127.0.0.1:9/context.md";

  t.after(async () => {
    await pool.query("delete from context_cache where url = $1", [url]);
    await pool.end();
  });

  await upsertCachedContext(pool, url, "aviso antigo mas util");
  await pool.query(
    "update context_cache set updated_at = now() - interval '1 hour' where url = $1",
    [url],
  );

  const content = await getExternalContext(pool, url, silentLog);
  assert.equal(content, "aviso antigo mas util");
});

test("returns empty when the fetch fails with nothing cached", { skip }, async (t) => {
  const pool = createPool(testDatabaseUrl!);
  t.after(async () => pool.end());

  const content = await getExternalContext(pool, "http://127.0.0.1:9/x.md", silentLog);
  assert.equal(content, "");
});

test("an error response is not cached as content", { skip }, async (t) => {
  const pool = createPool(testDatabaseUrl!);
  const origin = await serveMarkdown("404 not found", 404);

  t.after(async () => {
    await pool.query("delete from context_cache where url = $1", [origin.url]);
    await origin.close();
    await pool.end();
  });

  assert.equal(await getExternalContext(pool, origin.url, silentLog), "");
});

test("a forced refresh updates the cache", { skip }, async (t) => {
  const pool = createPool(testDatabaseUrl!);
  const origin = await serveMarkdown("versao publicada");

  t.after(async () => {
    await pool.query("delete from context_cache where url = $1", [origin.url]);
    await origin.close();
    await pool.end();
  });

  await upsertCachedContext(pool, origin.url, "versao anterior");

  assert.equal(await refreshExternalContext(pool, origin.url, silentLog), true);
  assert.equal(await getExternalContext(pool, origin.url, silentLog), "versao publicada");
});

test("a forced refresh with no URL reports that it did nothing", async () => {
  assert.equal(await refreshExternalContext(null as never, undefined, silentLog), false);
});
