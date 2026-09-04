import type pg from "pg";

import type { ConversationState } from "../logic/conversation.js";
import type { MessageDirection } from "../logic/guards.js";
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

/**
 * Creates the conversation on first contact and refreshes its activity clock.
 *
 * A conversation that had been closed by the inactivity sweeper comes back as
 * `idle` with its partial data cleared, so nobody resumes days later inside a
 * stale collection (claude.md §7).
 */
export async function touchConversation(
  pool: pg.Pool,
  phone: string,
): Promise<{ state: ConversationState }> {
  const result = await pool.query<{ state: ConversationState }>(
    `insert into conversations (phone, state, last_interaction_at)
     values ($1, 'idle', now())
     on conflict (phone) do update set
       last_interaction_at = now(),
       state = case when conversations.state = 'closed' then 'idle'
                    else conversations.state end,
       partial_data = case when conversations.state = 'closed' then '{}'::jsonb
                           else conversations.partial_data end
     returning state`,
    [phone],
  );

  return result.rows[0] ?? { state: "idle" };
}

export async function updateConversationState(
  pool: pg.Pool,
  phone: string,
  state: ConversationState,
): Promise<void> {
  await pool.query("update conversations set state = $2 where phone = $1", [
    phone,
    state,
  ]);
}

/** Newest first; the anti-loop decision itself lives in logic/guards.ts. */
export async function getRecentMessageDirections(
  pool: pg.Pool,
  phone: string,
  limit: number,
): Promise<MessageDirection[]> {
  const result = await pool.query<MessageDirection>(
    `select direction, source from messages
     where phone = $1
     order by created_at desc, id desc
     limit $2`,
    [phone, limit],
  );

  return result.rows;
}

/** Closes conversations idle for longer than the timeout, dropping their state. */
export async function closeStaleConversations(
  pool: pg.Pool,
  timeoutHours: number,
): Promise<number> {
  const result = await pool.query(
    `update conversations
     set state = 'closed', partial_data = '{}'::jsonb
     where state <> 'closed'
       and last_interaction_at < now() - make_interval(hours => $1::int)`,
    [timeoutHours],
  );

  return result.rowCount ?? 0;
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
