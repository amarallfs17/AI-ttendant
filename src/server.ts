import Fastify from "fastify";

import { parseEnv, type Env } from "./config/env.js";
import { createPool } from "./db/index.js";
import { runMigrations } from "./db/migrate.js";
import { createQueue } from "./queue/index.js";
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

  const ctx: AppContext = {
    env,
    log: app.log,
    pool,
    queue: createQueue(app.log),
    evolution: createEvolutionService(env),
  };

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
    await app.close();
    // Let in-flight tasks finish before the pool they use is closed.
    await ctx.queue.drain();
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
