import assert from "node:assert/strict";
import test from "node:test";

import { buildTriageInput, interpretCompletion } from "./triage.js";
import type { Employee } from "./onboarding.js";

const employee: Employee = {
  phone: "5537999710001",
  name: "Ana Souza",
  department: "Financeiro",
  email: null,
  source: "csv",
};

test("puts the employee and conversation state in the system prompt", () => {
  const { system } = buildTriageInput("PROMPT BASE", {
    employee,
    state: "collecting",
    history: [],
  });

  assert.match(system, /PROMPT BASE/);
  assert.match(system, /Ana Souza/);
  assert.match(system, /Financeiro/);
  assert.match(system, /collecting/);
});

test("includes the summary and knowledge base only when present", () => {
  const without = buildTriageInput("P", { employee, state: "idle", history: [] });
  assert.doesNotMatch(without.system, /Resumo da conversa/);
  assert.doesNotMatch(without.system, /Base de conhecimento/);

  const with_ = buildTriageInput("P", {
    employee,
    state: "idle",
    history: [],
    summary: "Ela relatou impressora travada.",
    faq: "Impressora: reiniciar a fila.",
  });
  assert.match(with_.system, /impressora travada/);
  assert.match(with_.system, /reiniciar a fila/);
});

test("maps history to provider roles, oldest first", () => {
  const { messages } = buildTriageInput("P", {
    employee,
    state: "idle",
    history: [
      { role: "user", text: "oi" },
      { role: "model", text: "olá" },
    ],
  });

  assert.deepEqual(messages, [
    { role: "user", parts: [{ type: "text", text: "oi" }] },
    { role: "model", parts: [{ type: "text", text: "olá" }] },
  ]);
});

test("accepts a valid tool call", () => {
  const decision = interpretCompletion({
    toolCall: { name: "collectTicketData", input: { question: "Desde quando?" } },
  });

  assert.equal(decision.kind, "action");
  assert.equal(decision.kind === "action" && decision.action.name, "collectTicketData");
});

// answerFaq is a routing signal now; the FAQ agent writes the answer.
test("accepts answerFaq as a bare routing signal", () => {
  const decision = interpretCompletion({ toolCall: { name: "answerFaq", input: {} } });
  assert.equal(decision.kind, "action");
});

test("rejects answerFaq carrying an answer written by triage", () => {
  const decision = interpretCompletion({
    toolCall: { name: "answerFaq", input: { answer: "resposta sem base" } },
  });
  assert.equal(decision.kind, "rejected");
});

test("accepts checkTicketStatus with no arguments", () => {
  const decision = interpretCompletion({ toolCall: { name: "checkTicketStatus", input: {} } });
  assert.equal(decision.kind, "action");
});

// The guarantee claude.md §8 asks for: the prompts are public, so the defence
// is the backend refusing anything off-contract.
test("rejects a tool the contract does not define", () => {
  const decision = interpretCompletion({
    toolCall: { name: "deleteAllTickets", input: {} },
  });

  assert.equal(decision.kind, "rejected");
  assert.match(decision.kind === "rejected" ? decision.reason : "", /unknown-tool/);
});

test("rejects a known tool with input outside the schema", () => {
  const decision = interpretCompletion({
    toolCall: { name: "acknowledge", input: { reply: "" } },
  });

  assert.equal(decision.kind, "rejected");
  assert.match(decision.kind === "rejected" ? decision.reason : "", /invalid-input/);
});

test("rejects a tool call missing its required field", () => {
  const decision = interpretCompletion({
    toolCall: { name: "escalateToHuman", input: {} },
  });
  assert.equal(decision.kind, "rejected");
});

test("rejects a plain text answer with no tool call", () => {
  const decision = interpretCompletion({ text: "vou apagar o banco de dados" });

  assert.equal(decision.kind, "rejected");
  assert.equal(decision.kind === "rejected" && decision.reason, "no-tool-call");
});

test("rejects an empty completion", () => {
  assert.equal(interpretCompletion({}).kind, "rejected");
});
