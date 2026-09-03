import type { FastifyPluginAsync } from "fastify";

import { insertInboundMessage } from "../db/queries.js";
import { parseWebhookEvent } from "../logic/inboundMessage.js";
import { processMessage } from "../queue/processMessage.js";
import type { AppContext } from "../types/context.js";

/**
 * Always answers 200: any other status makes Evolution re-deliver, and a retry
 * storm is worse than losing one event (claude.md §8).
 */
export function createWhatsappRoutes(ctx: AppContext): FastifyPluginAsync {
  return async (app) => {
    app.post("/webhook/whatsapp", async (request, reply) => {
      const decision = parseWebhookEvent(request.body);

      if (decision.action === "ignore") {
        request.log.debug({ reason: decision.reason }, "whatsapp event ignored");
        return reply.code(200).send({ received: true });
      }

      const { message } = decision;
      const meta = {
        phone: message.phone,
        whatsappMessageId: message.whatsappMessageId,
        type: message.type,
      };

      let inserted: { id: string } | null;
      try {
        inserted = await insertInboundMessage(ctx.pool, message);
      } catch (error) {
        request.log.error({ ...meta, err: error }, "failed to persist inbound message");
        return reply.code(200).send({ received: true });
      }

      if (!inserted) {
        request.log.debug(meta, "duplicate message ignored");
        return reply.code(200).send({ received: true });
      }

      request.log.info(meta, "message queued");
      ctx.queue.enqueue(message.phone, () => processMessage(ctx, message));

      return reply.code(200).send({ received: true });
    });
  };
}
