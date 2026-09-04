import type pg from "pg";

import type { ConversationState } from "../logic/conversation.js";
import type { MessageDirection } from "../logic/guards.js";
import type { InboundMessage } from "../logic/inboundMessage.js";
import type { Employee } from "../logic/onboarding.js";

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

export async function getEmployee(
  pool: pg.Pool,
  phone: string,
): Promise<Employee | null> {
  const result = await pool.query<Employee>(
    `select phone, name, department, email, source
     from employees where phone = $1`,
    [phone],
  );

  return result.rows[0] ?? null;
}

/** Registers someone the bot met through the chat (claude.md §7). */
export async function insertEmployee(
  pool: pg.Pool,
  employee: { phone: string; name: string; department: string },
): Promise<void> {
  await pool.query(
    `insert into employees (phone, name, department, source)
     values ($1, $2, $3, 'auto')
     on conflict (phone) do nothing`,
    [employee.phone, employee.name, employee.department],
  );
}

/**
 * Loads the roster from a spreadsheet. A record the bot had created on its own
 * is promoted to `csv`, since the imported file is the more reliable source.
 */
export async function upsertEmployeeFromCsv(
  pool: pg.Pool,
  employee: {
    phone: string;
    name: string;
    department: string;
    email: string | null;
  },
): Promise<"inserted" | "updated"> {
  const result = await pool.query<{ inserted: boolean }>(
    `insert into employees (phone, name, department, email, source)
     values ($1, $2, $3, $4, 'csv')
     on conflict (phone) do update set
       name = excluded.name,
       department = excluded.department,
       email = coalesce(excluded.email, employees.email),
       source = 'csv'
     returning (xmax = 0) as inserted`,
    [employee.phone, employee.name, employee.department, employee.email],
  );

  return result.rows[0]?.inserted ? "inserted" : "updated";
}

export async function getConversationPartialData(
  pool: pg.Pool,
  phone: string,
): Promise<Record<string, unknown>> {
  const result = await pool.query<{ partial_data: Record<string, unknown> }>(
    "select partial_data from conversations where phone = $1",
    [phone],
  );

  return result.rows[0]?.partial_data ?? {};
}

export async function updateConversationPartialData(
  pool: pg.Pool,
  phone: string,
  partialData: Record<string, unknown>,
): Promise<void> {
  await pool.query(
    "update conversations set partial_data = $2::jsonb where phone = $1",
    [phone, JSON.stringify(partialData)],
  );
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
