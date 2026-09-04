import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFaqInput,
  buildFaqToolDeclaration,
  FAQ_TOOL_NAME,
  interpretFaqCompletion,
} from "./faqAgent.js";
import type { Employee } from "./onboarding.js";

const employee: Employee = {
  phone: "5537999710001",
  name: "Ana Souza",
  department: "Financeiro",
  email: null,
  source: "csv",
};

const base = {
  employee,
  question: "como configuro a impressora?",
  history: [],
  faq: "Impressora: use Adicionar Dispositivo.",
};

test("puts the knowledge base and the employee in the prompt", () => {
  const { system } = buildFaqInput("PROMPT FAQ", base);

  assert.match(system, /PROMPT FAQ/);
  assert.match(system, /Ana Souza/);
  assert.match(system, /Adicionar Dispositivo/);
});

test("the question is the last user message", () => {
  const { messages } = buildFaqInput("P", {
    ...base,
    history: [{ role: "user", text: "oi" }],
  });

  assert.equal(messages.length, 2);
  assert.equal(messages[1]?.role, "user");
  assert.deepEqual(messages[1]?.parts, [
    { type: "text", text: "como configuro a impressora?" },
  ]);
});

test("says the base is empty rather than sending nothing", () => {
  const { system } = buildFaqInput("P", { ...base, faq: "   " });
  assert.match(system, /\(vazia\)/);
});

// A maintenance notice must beat the documented procedure.
test("marks the external context as taking priority", () => {
  const { system } = buildFaqInput("P", {
    ...base,
    externalContext: "O sistema VIC está em manutenção até as 14h.",
  });

  assert.match(system, /manutenção até as 14h/);
  assert.match(system, /prioridade/i);
});

test("omits the external context section when there is none", () => {
  const { system } = buildFaqInput("P", { ...base, externalContext: "  " });
  assert.doesNotMatch(system, /Avisos e contexto/);
});

test("the tool declaration carries both fields", () => {
  const tool = buildFaqToolDeclaration();
  const schema = tool.parameters as {
    properties: Record<string, unknown>;
    required?: string[];
  };

  assert.equal(tool.name, FAQ_TOOL_NAME);
  assert.ok("answered" in schema.properties);
  assert.ok("text" in schema.properties);
  assert.deepEqual([...(schema.required ?? [])].sort(), ["answered", "text"]);
});

test("returns the answer when the material covers the question", () => {
  const result = interpretFaqCompletion({
    toolCall: { name: FAQ_TOOL_NAME, input: { answered: true, text: "  É só reiniciar.  " } },
  });

  assert.equal(result.kind, "answer");
  assert.equal(result.kind === "answer" && result.text, "É só reiniciar.");
});

// The honest outcome: better to offer a ticket than to invent a procedure.
test("reports not-covered when the material has no answer", () => {
  const result = interpretFaqCompletion({
    toolCall: { name: FAQ_TOOL_NAME, input: { answered: false, text: "" } },
  });
  assert.equal(result.kind, "not-covered");
});

test("treats an empty answer as not covered instead of sending nothing", () => {
  const result = interpretFaqCompletion({
    toolCall: { name: FAQ_TOOL_NAME, input: { answered: true, text: "   " } },
  });
  assert.equal(result.kind, "not-covered");
});

// claude.md §8 applies to the second agent exactly as it does to triage.
test("rejects a completion with no tool call", () => {
  const result = interpretFaqCompletion({ text: "resposta solta sem contrato" });
  assert.equal(result.kind, "rejected");
  assert.equal(result.kind === "rejected" && result.reason, "no-tool-call");
});

test("rejects a tool that is not the FAQ tool", () => {
  const result = interpretFaqCompletion({
    toolCall: { name: "sendEmail", input: {} },
  });
  assert.equal(result.kind, "rejected");
  assert.match(result.kind === "rejected" ? result.reason : "", /unknown-tool/);
});

test("rejects input that does not match the schema", () => {
  const missingField = interpretFaqCompletion({
    toolCall: { name: FAQ_TOOL_NAME, input: { answered: true } },
  });
  assert.equal(missingField.kind, "rejected");

  const injected = interpretFaqCompletion({
    toolCall: {
      name: FAQ_TOOL_NAME,
      input: { answered: true, text: "ok", runCommand: "rm -rf /" },
    },
  });
  assert.equal(injected.kind, "rejected", "extra fields must be visible, not stripped");
});
