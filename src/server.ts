import Fastify from "fastify";

import { parseEnv, type Env } from "./config/env.js";
import { createPool } from "./db/index.js";
import { runMigrations } from "./db/migrate.js";
import { createDebounceBuffer } from "./queue/debounceBuffer.js";
import { createQueue } from "./queue/index.js";
import { processBlock } from "./queue/processMessage.js";
import { startConversationSweeper } from "./queue/sweeper.js";
import { createWhatsappRoutes } from "./routes/whatsapp.js";
import { createEvolutionService } from "./services/evolution.js";
import type { AppContext } from "./types/context.js";

function loadEnv(): Env {
  try {
    return parseEnv(process.env);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const env = loadEnv();

  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      ...(process.env.NODE_ENV === "production"
        ? {}
        : { transport: { target: "pino-pretty" } }),
    },
  });

  const pool = createPool(env.DATABASE_URL);
  await runMigrations(pool, new URL("./db/migrations/", import.meta.url), app.log);

  const queue = createQueue(app.log);

  // A finished block goes through the queue, so the per-conversation lock from
  // phase 2 still serializes it. The callback runs long after `ctx` exists.
  const debounce = createDebounceBuffer(
    {
      windowMs: env.DEBOUNCE_SECONDS * 1000,
      maxWaitMs: env.DEBOUNCE_MAX_SECONDS * 1000,
    },
    app.log,
    (phone, messages) => {
      queue.enqueue(phone, () => processBlock(ctx, phone, messages));
    },
  );

  const ctx: AppContext = {
    env,
    log: app.log,
    pool,
    queue,
    debounce,
    evolution: createEvolutionService(env),
  };

  const stopSweeper = startConversationSweeper(ctx);

  app.get("/health", async () => ({ status: "ok", uptime: process.uptime() }));

  await app.register(createWhatsappRoutes(ctx));

  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, "unhandled error");
    void reply.code(500).send({ error: "internal server error" });
  });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, "shutting down");
    stopSweeper();
    await app.close();
    // Release buffered blocks, then let in-flight tasks finish, before closing
    // the pool they all depend on.
    debounce.flushAll();
    await queue.drain();
    await pool.end();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  await app.listen({ port: env.PORT, host: "0.0.0.0" });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
