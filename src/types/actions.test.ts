import assert from "node:assert/strict";
import test from "node:test";

import {
  ACTION_NAMES,
  actionSchemas,
  buildToolDeclarations,
  isActionName,
} from "./actions.js";

test("exposes exactly the five actions from claude.md §7", () => {
  assert.deepEqual([...ACTION_NAMES].sort(), [
    "acknowledge",
    "answerFaq",
    "checkTicketStatus",
    "collectTicketData",
    "escalateToHuman",
  ]);
});

test("isActionName narrows only to known actions", () => {
  assert.equal(isActionName("answerFaq"), true);
  assert.equal(isActionName("dropDatabase"), false);
  assert.equal(isActionName("toString"), false, "must not match inherited properties");
});

// answerFaq only routes now: the FAQ agent writes the answer with the
// knowledge base in front of it.
test("answerFaq carries no payload", () => {
  assert.equal(actionSchemas.answerFaq.safeParse({}).success, true);
  assert.equal(
    actionSchemas.answerFaq.safeParse({ answer: "resposta inventada" }).success,
    false,
  );
});

test("acknowledge takes a short reply and refuses a long one", () => {
  assert.equal(actionSchemas.acknowledge.safeParse({ reply: "De nada!" }).success, true);
  assert.equal(actionSchemas.acknowledge.safeParse({ reply: "" }).success, false);
  assert.equal(
    actionSchemas.acknowledge.safeParse({ reply: "a".repeat(201) }).success,
    false,
    "an acknowledgement must not become a free-form answer channel",
  );
});

test("schemas reject fields the model invents", () => {
  const result = actionSchemas.escalateToHuman.safeParse({
    reason: "ok",
    executeShellCommand: "rm -rf /",
  });
  assert.equal(result.success, false, "extra keys must not pass the contract");
});

test("tool declarations are generated from the same schemas", () => {
  const declarations = buildToolDeclarations();
  assert.equal(declarations.length, ACTION_NAMES.length);

  const acknowledge = declarations.find((tool) => tool.name === "acknowledge");
  assert.ok(acknowledge?.description, "the model needs to know when to use it");

  const schema = acknowledge?.parameters as {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
  };
  assert.equal(schema.type, "object");
  assert.ok("reply" in schema.properties);
  assert.deepEqual(schema.required, ["reply"]);
});

test("checkTicketStatus declares an object with no required fields", () => {
  const tool = buildToolDeclarations().find((t) => t.name === "checkTicketStatus");
  const schema = tool?.parameters as { type: string; required?: string[] };
  assert.equal(schema.type, "object");
  assert.ok(!schema.required?.length);
});
