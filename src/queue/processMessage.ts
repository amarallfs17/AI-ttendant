import { insertOutboundMessage } from "../db/queries.js";
import type { InboundMessage } from "../logic/inboundMessage.js";
import type { AppContext } from "../types/context.js";
import { withRetry } from "./worker.js";

// Placeholder reply until debounce (phase 3) and triage (phase 5) land.
const ACKNOWLEDGEMENT = "Recebi sua mensagem, já estou processando.";

/**
 * Entry point of the message pipeline, called by the queue outside the webhook
 * request. Later phases grow this into: debounce -> triage -> agents.
 */
export async function processMessage(
  ctx: AppContext,
  message: InboundMessage,
): Promise<void> {
  const meta = {
    phone: message.phone,
    whatsappMessageId: message.whatsappMessageId,
  };

  const sent = await withRetry(
    () => ctx.evolution.sendText(message.phone, ACKNOWLEDGEMENT),
    { log: ctx.log, meta, operation: "sendText" },
  );

  // Recorded only after a successful send, so retries cannot duplicate rows.
  await insertOutboundMessage(ctx.pool, {
    whatsappMessageId: sent.whatsappMessageId,
    phone: message.phone,
    content: ACKNOWLEDGEMENT,
  });

  ctx.log.info({ ...meta, sentMessageId: sent.whatsappMessageId }, "reply sent");
}
