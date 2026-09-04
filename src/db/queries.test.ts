import assert from "node:assert/strict";
import test from "node:test";

import { createPool } from "./index.js";
import {
  closeStaleConversations,
  getConversationPartialData,
  getEmployee,
  getRecentMessageDirections,
  insertEmployee,
  insertInboundMessage,
  insertOutboundMessage,
  touchConversation,
  updateConversationPartialData,
  updateConversationState,
  upsertEmployeeFromCsv,
} from "./queries.js";

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

test(
  "returns recent message directions newest first",
  { skip: testDatabaseUrl ? false : "set TEST_DATABASE_URL to run database tests" },
  async (t) => {
    const pool = createPool(testDatabaseUrl!);
    const phone = "5500000000002";
    const suffix = Date.now();

    t.after(async () => {
      await pool.query("delete from messages where phone = $1", [phone]);
      await pool.end();
    });

    await insertInboundMessage(pool, {
      whatsappMessageId: `in-${suffix}`,
      phone,
      type: "text",
      content: "oi",
      pushName: null,
    });
    await insertOutboundMessage(pool, {
      whatsappMessageId: `out-${suffix}`,
      phone,
      content: "resposta",
    });

    const recent = await getRecentMessageDirections(pool, phone, 5);
    assert.deepEqual(recent[0], { direction: "outbound", source: "bot" });
    assert.deepEqual(recent[1], { direction: "inbound", source: "user" });
  },
);

test(
  "reopens a closed conversation with its partial data cleared",
  { skip: testDatabaseUrl ? false : "set TEST_DATABASE_URL to run database tests" },
  async (t) => {
    const pool = createPool(testDatabaseUrl!);
    const phone = "5500000000003";

    t.after(async () => {
      await pool.query("delete from conversations where phone = $1", [phone]);
      await pool.end();
    });

    const created = await touchConversation(pool, phone);
    assert.equal(created.state, "idle");

    // Simulate a collection in progress that the sweeper then closes.
    await updateConversationState(pool, phone, "collecting");
    await pool.query(
      `update conversations set partial_data = '{"ticket":{"summary":"x"}}'::jsonb,
       last_interaction_at = now() - interval '48 hours' where phone = $1`,
      [phone],
    );

    const closed = await closeStaleConversations(pool, 24);
    assert.ok(closed >= 1);

    const reopened = await touchConversation(pool, phone);
    assert.equal(reopened.state, "idle", "a new message restarts the conversation");

    const { rows } = await pool.query<{ partial_data: unknown }>(
      "select partial_data from conversations where phone = $1",
      [phone],
    );
    assert.deepEqual(rows[0]?.partial_data, {}, "stale context must not survive");
  },
);

test(
  "leaves active conversations untouched when sweeping",
  { skip: testDatabaseUrl ? false : "set TEST_DATABASE_URL to run database tests" },
  async (t) => {
    const pool = createPool(testDatabaseUrl!);
    const phone = "5500000000004";

    t.after(async () => {
      await pool.query("delete from conversations where phone = $1", [phone]);
      await pool.end();
    });

    await touchConversation(pool, phone);
    await updateConversationState(pool, phone, "collecting");
    await closeStaleConversations(pool, 24);

    const { rows } = await pool.query<{ state: string }>(
      "select state from conversations where phone = $1",
      [phone],
    );
    assert.equal(rows[0]?.state, "collecting");
  },
);

test(
  "registers an employee met through the chat and finds them again",
  { skip: testDatabaseUrl ? false : "set TEST_DATABASE_URL to run database tests" },
  async (t) => {
    const pool = createPool(testDatabaseUrl!);
    const phone = "5500000000010";

    t.after(async () => {
      await pool.query("delete from employees where phone = $1", [phone]);
      await pool.end();
    });

    assert.equal(await getEmployee(pool, phone), null);

    await insertEmployee(pool, { phone, name: "Ana Souza", department: "Financeiro" });

    const employee = await getEmployee(pool, phone);
    assert.equal(employee?.name, "Ana Souza");
    assert.equal(employee?.department, "Financeiro");
    assert.equal(employee?.source, "auto");
  },
);

test(
  "the CSV import promotes a self-registered employee to csv",
  { skip: testDatabaseUrl ? false : "set TEST_DATABASE_URL to run database tests" },
  async (t) => {
    const pool = createPool(testDatabaseUrl!);
    const phone = "5500000000011";

    t.after(async () => {
      await pool.query("delete from employees where phone = $1", [phone]);
      await pool.end();
    });

    await insertEmployee(pool, { phone, name: "Bruno", department: "Comercial" });

    const outcome = await upsertEmployeeFromCsv(pool, {
      phone,
      name: "Bruno Lima",
      department: "Comercial",
      email: "bruno@example.com",
    });

    assert.equal(outcome, "updated", "an existing phone must not be inserted twice");

    const employee = await getEmployee(pool, phone);
    assert.equal(employee?.source, "csv", "the spreadsheet is the more reliable source");
    assert.equal(employee?.name, "Bruno Lima");
    assert.equal(employee?.email, "bruno@example.com");
  },
);

test(
  "reports whether a CSV row was inserted or updated",
  { skip: testDatabaseUrl ? false : "set TEST_DATABASE_URL to run database tests" },
  async (t) => {
    const pool = createPool(testDatabaseUrl!);
    const phone = "5500000000012";

    t.after(async () => {
      await pool.query("delete from employees where phone = $1", [phone]);
      await pool.end();
    });

    const row = { phone, name: "Carla", department: "Suporte", email: null };
    assert.equal(await upsertEmployeeFromCsv(pool, row), "inserted");
    assert.equal(await upsertEmployeeFromCsv(pool, row), "updated");
  },
);

test(
  "stores and clears the onboarding sub-state in partial_data",
  { skip: testDatabaseUrl ? false : "set TEST_DATABASE_URL to run database tests" },
  async (t) => {
    const pool = createPool(testDatabaseUrl!);
    const phone = "5500000000013";

    t.after(async () => {
      await pool.query("delete from conversations where phone = $1", [phone]);
      await pool.end();
    });

    await touchConversation(pool, phone);
    assert.deepEqual(await getConversationPartialData(pool, phone), {});

    await updateConversationPartialData(pool, phone, {
      onboarding: { step: "awaitingDepartment", name: "Ana", attempts: 0 },
    });

    const stored = await getConversationPartialData(pool, phone);
    assert.equal(
      (stored.onboarding as { name: string } | undefined)?.name,
      "Ana",
    );

    await updateConversationPartialData(pool, phone, {});
    assert.deepEqual(await getConversationPartialData(pool, phone), {});
  },
);
