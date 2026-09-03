import assert from "node:assert/strict";
import test from "node:test";

import { createPool } from "./index.js";
import { insertInboundMessage, insertOutboundMessage } from "./queries.js";

// Deliberately not DATABASE_URL: pointed at Supabase, these tests would write
// phantom rows into the production database.
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

test(
  "deduplicates inbound messages by whatsapp_message_id",
  { skip: testDatabaseUrl ? false : "set TEST_DATABASE_URL to run database tests" },
  async (t) => {
    const pool = createPool(testDatabaseUrl!);
    const whatsappMessageId = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const phone = "5500000000000";

    t.after(async () => {
      await pool.query("delete from messages where phone = $1", [phone]);
      await pool.end();
    });

    const message = {
      whatsappMessageId,
      phone,
      type: "text" as const,
      content: "primeira entrega",
      pushName: null,
    };

    const first = await insertInboundMessage(pool, message);
    assert.ok(first, "the first delivery should insert a row");

    const redelivery = await insertInboundMessage(pool, message);
    assert.equal(redelivery, null, "a re-delivery should be rejected");

    const { rows } = await pool.query<{ count: string }>(
      "select count(*) from messages where whatsapp_message_id = $1",
      [whatsappMessageId],
    );
    assert.equal(rows[0]?.count, "1");
  },
);

test(
  "records outbound messages as bot messages",
  { skip: testDatabaseUrl ? false : "set TEST_DATABASE_URL to run database tests" },
  async (t) => {
    const pool = createPool(testDatabaseUrl!);
    const whatsappMessageId = `test-out-${Date.now()}`;
    const phone = "5500000000001";

    t.after(async () => {
      await pool.query("delete from messages where phone = $1", [phone]);
      await pool.end();
    });

    await insertOutboundMessage(pool, {
      whatsappMessageId,
      phone,
      content: "resposta",
    });

    const { rows } = await pool.query<{ direction: string; source: string }>(
      "select direction, source from messages where whatsapp_message_id = $1",
      [whatsappMessageId],
    );
    assert.deepEqual(rows[0], { direction: "outbound", source: "bot" });
  },
);
