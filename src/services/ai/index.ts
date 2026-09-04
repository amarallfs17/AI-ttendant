import type { Env } from "../../config/env.js";
import { createGeminiProvider } from "./gemini.js";
import type { AiProvider } from "./provider.js";

export function createAiProvider(env: Env): AiProvider {
  if (env.AI_PROVIDER === "gemini") {
    return createGeminiProvider(env.AI_API_KEY, env.AI_MODEL);
  }

  // Better a clear failure at boot than a surprise mid-conversation.
  throw new Error(
    `AI_PROVIDER="${env.AI_PROVIDER}" is not implemented yet; only "gemini" is available.`,
  );
}
