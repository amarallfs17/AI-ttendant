import { z } from "zod";

import type { Env } from "../config/env.js";
import { NonRetryableError } from "./errors.js";

const REQUEST_TIMEOUT_MS = 10_000;

// Evolution mirrors the Baileys message back; key.id is what phase 9 uses to
// tell the bot's own messages from a human replying on the phone.
const sendTextResponseSchema = z.object({
  key: z.object({ id: z.string() }),
});

export type Presence = "composing" | "paused";

export interface EvolutionService {
  sendText(phone: string, text: string): Promise<{ whatsappMessageId: string }>;
  setPresence(phone: string, presence: Presence): Promise<void>;
}

export function createEvolutionService(env: Env): EvolutionService {
  const request = async (path: string, body: unknown): Promise<unknown> => {
    let response: Response;
    try {
      response = await fetch(`${env.EVOLUTION_BASE_URL}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: env.EVOLUTION_API_KEY,
        },
        body: JSON.stringify(body),
        // Without a timeout a hung Evolution would block this phone's queue
        // chain forever.
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new Error(`evolution request failed: ${path}`, { cause: error });
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      const message = `evolution responded ${response.status} for ${path}: ${detail.slice(0, 200)}`;
      // 4xx other than 429 will not improve on retry.
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        throw new NonRetryableError(message);
      }
      throw new Error(message);
    }

    return response.json();
  };

  return {
    async sendText(phone, text) {
      const payload = await request(
        `/message/sendText/${env.EVOLUTION_INSTANCE}`,
        { number: phone, text },
      );

      const parsed = sendTextResponseSchema.safeParse(payload);
      if (!parsed.success) {
        throw new Error("evolution sendText returned an unexpected response shape");
      }

      return { whatsappMessageId: parsed.data.key.id };
    },

    async setPresence(phone, presence) {
      await request(`/chat/sendPresence/${env.EVOLUTION_INSTANCE}`, {
        number: phone,
        presence,
      });
    },
  };
}
