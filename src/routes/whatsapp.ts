import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

// Tolerant envelope: unknown payloads are logged and acknowledged with 200 so
// Evolution never re-delivers because of a shape we don't handle yet.
const webhookEnvelopeSchema = z.object({
  event: z.string(),
  instance: z.string().optional(),
  data: z.unknown().optional(),
});

const messageDataSchema = z.object({
  key: z.object({
    remoteJid: z.string(),
    fromMe: z.boolean().optional(),
    id: z.string(),
  }),
  pushName: z.string().optional(),
  messageType: z.string().optional(),
});

export const whatsappRoutes: FastifyPluginAsync = async (app) => {
  app.post("/webhook/whatsapp", async (request, reply) => {
    const envelope = webhookEnvelopeSchema.safeParse(request.body);
    if (!envelope.success) {
      request.log.warn("whatsapp webhook: unrecognized payload shape");
      return reply.code(200).send({ received: true });
    }

    const { event, instance, data } = envelope.data;

    if (event === "messages.upsert") {
      const message = messageDataSchema.safeParse(data);
      if (message.success) {
        const { key, pushName, messageType } = message.data;
        // Metadata only — message content never reaches the logs (LGPD).
        request.log.info(
          {
            event,
            instance,
            remoteJid: key.remoteJid,
            fromMe: key.fromMe ?? false,
            whatsappMessageId: key.id,
            pushName,
            messageType,
          },
          "whatsapp message received",
        );
      } else {
        request.log.warn({ event, instance }, "messages.upsert without expected key data");
      }
    } else {
      request.log.info({ event, instance }, "whatsapp event received");
    }

    return reply.code(200).send({ received: true });
  });
};
