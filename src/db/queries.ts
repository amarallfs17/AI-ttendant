import type pg from "pg";

import type { InboundMessage } from "../logic/inboundMessage.js";

/**
 * Inserts the inbound message, using the unique constraint on
 * whatsapp_message_id as the deduplication mechanism (claude.md §7).
 * Returns null when Evolution re-delivered an event we already have.
 */
export async function insertInboundMessage(
  pool: pg.Pool,
  message: InboundMessage,
): Promise<{ id: string } | null> {
  const result = await pool.query<{ id: string }>(
    `insert into messages (whatsapp_message_id, phone, direction, source, type, content)
     values ($1, $2, 'inbound', 'user', $3, $4)
     on conflict (whatsapp_message_id) do nothing
     returning id`,
    [message.whatsappMessageId, message.phone, message.type, message.content],
  );

  return result.rows[0] ?? null;
}

export async function insertOutboundMessage(
  pool: pg.Pool,
  message: { whatsappMessageId: string; phone: string; content: string },
): Promise<void> {
  await pool.query(
    `insert into messages (whatsapp_message_id, phone, direction, source, type, content)
     values ($1, $2, 'outbound', 'bot', 'text', $3)
     on conflict (whatsapp_message_id) do nothing`,
    [message.whatsappMessageId, message.phone, message.content],
  );
}
