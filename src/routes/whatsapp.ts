import type { FastifyPluginAsync } from "fastify";

import { insertInboundMessage, touchConversation } from "../db/queries.js";
import { parseWebhookEvent } from "../logic/inboundMessage.js";
import type { AppContext } from "../types/context.js";

/**
 * Always answers 200: any other status makes Evolution re-deliver, and a retry
 * storm is worse than losing one event (claude.md §8).
 */
export function createWhatsappRoutes(ctx: AppContext): FastifyPluginAsync {
  return async (app) => {
    app.post("/webhook/whatsapp", async (request, reply) => {
      const decision = parseWebhookEvent(request.body);
      const acknowledge = (): unknown => reply.code(200).send({ received: true });

      if (decision.action === "ignore") {
        request.log.debug({ reason: decision.reason }, "whatsapp event ignored");
        return acknowledge();
      }

      if (decision.action === "presence") {
        ctx.debounce.notePresence(decision.phone, decision.presence);
        request.log.debug(
          { phone: decision.phone, presence: decision.presence },
          "presence noted",
        );
        return acknowledge();
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
        if (inserted) {
          await touchConversation(ctx.pool, message.phone);
        }
      } catch (error) {
        request.log.error({ ...meta, err: error }, "failed to persist inbound message");
        return acknowledge();
      }

      if (!inserted) {
        request.log.debug(meta, "duplicate message ignored");
        return acknowledge();
      }

      request.log.info(meta, "message buffered");
      ctx.debounce.add(message);

      return acknowledge();
    });
  };
}
