import type { FastifyBaseLogger } from "fastify";
import type pg from "pg";

import type { Env } from "../config/env.js";
import type { DebounceBuffer } from "../queue/debounceBuffer.js";
import type { Queue } from "../queue/index.js";
import type { AiProvider } from "../services/ai/provider.js";
import type { EvolutionService } from "../services/evolution.js";

/**
 * Wiring passed explicitly from server.ts into routes and queue tasks —
 * dependency injection without a container (claude.md §3).
 */
export interface AppContext {
  env: Env;
  log: FastifyBaseLogger;
  pool: pg.Pool;
  queue: Queue;
  debounce: DebounceBuffer;
  evolution: EvolutionService;
  ai: AiProvider;
  /** Prompts and knowledge base, read once at boot. */
  triagePrompt: string;
  faqPrompt: string;
  knowledgeBase: string;
}
