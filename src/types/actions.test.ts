import assert from "node:assert/strict";
import test from "node:test";

import {
  ACTION_NAMES,
  actionSchemas,
  buildToolDeclarations,
  isActionName,
} from "./actions.js";

test("exposes exactly the four actions from claude.md §7", () => {
  assert.deepEqual([...ACTION_NAMES].sort(), [
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

test("answerFaq requires a non-empty answer", () => {
  assert.equal(actionSchemas.answerFaq.safeParse({ answer: "ok" }).success, true);
  assert.equal(actionSchemas.answerFaq.safeParse({ answer: "" }).success, false);
  assert.equal(actionSchemas.answerFaq.safeParse({}).success, false);
});

test("schemas reject fields the model invents", () => {
  const result = actionSchemas.answerFaq.safeParse({
    answer: "ok",
    executeShellCommand: "rm -rf /",
  });
  assert.equal(result.success, false, "extra keys must not pass the contract");
});

test("tool declarations are generated from the same schemas", () => {
  const declarations = buildToolDeclarations();
  assert.equal(declarations.length, ACTION_NAMES.length);

  const answerFaq = declarations.find((tool) => tool.name === "answerFaq");
  assert.ok(answerFaq?.description, "the model needs to know when to use it");

  const schema = answerFaq?.parameters as {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
  };
  assert.equal(schema.type, "object");
  assert.ok("answer" in schema.properties);
  assert.deepEqual(schema.required, ["answer"]);
});

test("checkTicketStatus declares an object with no required fields", () => {
  const tool = buildToolDeclarations().find((t) => t.name === "checkTicketStatus");
  const schema = tool?.parameters as { type: string; required?: string[] };
  assert.equal(schema.type, "object");
  assert.ok(!schema.required?.length);
});
