import { getRecentMessageDirections, insertOutboundMessage } from "../db/queries.js";
import { concatenateBlock } from "../logic/debounce.js";
import { countTrailingBotMessages, shouldSuppressReply } from "../logic/guards.js";
import type { InboundMessage } from "../logic/inboundMessage.js";
import type { AppContext } from "../types/context.js";
import { withRetry } from "./worker.js";

// Placeholder reply until triage (phase 5) decides what to say.
const ACKNOWLEDGEMENT = "Recebi sua mensagem, já estou processando.";

/** How long the typing indicator stays up before Evolution clears it. */
const TYPING_INDICATOR_MS = 2500;

/** Enough history to spot a pile-up of unanswered bot messages. */
const RECENT_MESSAGE_WINDOW = 5;

/**
 * Handles one debounced block of user messages, outside the webhook request.
 * Later phases replace the fixed reply with triage and the agents.
 */
export async function processBlock(
  ctx: AppContext,
  phone: string,
  messages: readonly InboundMessage[],
): Promise<void> {
  const meta = { phone, blockSize: messages.length };

  const recent = await getRecentMessageDirections(ctx.pool, phone, RECENT_MESSAGE_WINDOW);
  const decision = shouldSuppressReply({
    blockSize: messages.length,
    trailingBotMessages: countTrailingBotMessages(recent),
  });

  if (decision.suppress) {
    ctx.log.warn({ ...meta, reason: decision.reason }, "reply suppressed");
    return;
  }

  // Not awaited on purpose: Evolution holds the response for the whole typing
  // delay, and a cosmetic indicator must not add seconds to every reply nor
  // fail the block.
  void ctx.evolution
    .setPresence(phone, "composing", TYPING_INDICATOR_MS)
    .catch((error: unknown) => {
      ctx.log.debug({ ...meta, err: error }, "could not send typing presence");
    });

  const blockText = concatenateBlock(messages);
  ctx.log.debug({ ...meta, blockText }, "processing block");

  const sent = await withRetry(
    () => ctx.evolution.sendText(phone, ACKNOWLEDGEMENT),
    { log: ctx.log, meta, operation: "sendText" },
  );

  // Recorded only after a successful send, so retries cannot duplicate rows.
  await insertOutboundMessage(ctx.pool, {
    whatsappMessageId: sent.whatsappMessageId,
    phone,
    content: ACKNOWLEDGEMENT,
  });

  ctx.log.info({ ...meta, sentMessageId: sent.whatsappMessageId }, "reply sent");
}
