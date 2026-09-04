import assert from "node:assert/strict";
import test from "node:test";

import { advanceOnboarding, type OnboardingState } from "./onboarding.js";

test("offers the profile name for confirmation on first contact", () => {
  const action = advanceOnboarding(null, {
    text: "minha impressora parou",
    pushName: "Samuel",
  });

  assert.equal(action.kind, "ask");
  assert.match(action.kind === "ask" ? action.text : "", /Samuel/);
  assert.equal(action.kind === "ask" && action.next.step, "awaitingName");
  assert.equal(action.kind === "ask" && action.next.suggestedName, "Samuel");
});

test("keeps the original message to answer after registration", () => {
  const action = advanceOnboarding(null, {
    text: "minha impressora parou",
    pushName: "Samuel",
  });
  assert.equal(action.kind === "ask" && action.next.pendingText, "minha impressora parou");
});

test("asks for the name outright when there is no profile name", () => {
  const action = advanceOnboarding(null, { text: "oi", pushName: null });
  assert.equal(action.kind, "ask");
  assert.match(action.kind === "ask" ? action.text : "", /seu nome/i);
  assert.equal(action.kind === "ask" && action.next.suggestedName, undefined);
});

test("ignores a profile name that is unusable as a name", () => {
  const action = advanceOnboarding(null, { text: "oi", pushName: "🔥" });
  assert.equal(action.kind === "ask" && action.next.suggestedName, undefined);
});

const awaitingName: OnboardingState = {
  step: "awaitingName",
  suggestedName: "Samuel",
  pendingText: "minha impressora parou",
  attempts: 0,
};

for (const reply of ["sim", "Sim!", "isso", "sou eu", "correto", "ok", "SIM"]) {
  test(`"${reply}" confirms the suggested name`, () => {
    const action = advanceOnboarding(awaitingName, { text: reply, pushName: null });
    assert.equal(
      action.kind === "ask" && action.next.name,
      "Samuel",
      `"${reply}" should be read as confirmation, not as a name`,
    );
  });
}

test("confirming the suggestion moves on to the department", () => {
  const action = advanceOnboarding(awaitingName, { text: "sim", pushName: null });
  assert.equal(action.kind, "ask");
  assert.equal(action.kind === "ask" && action.next.step, "awaitingDepartment");
  assert.equal(action.kind === "ask" && action.next.name, "Samuel");
  assert.match(action.kind === "ask" ? action.text : "", /setor/i);
});

test("a different answer becomes the name instead of the suggestion", () => {
  const action = advanceOnboarding(awaitingName, { text: "Maria Silva", pushName: null });
  assert.equal(action.kind === "ask" && action.next.name, "Maria Silva");
});

test("carries the original message through the name step", () => {
  const action = advanceOnboarding(awaitingName, { text: "sim", pushName: null });
  assert.equal(action.kind === "ask" && action.next.pendingText, "minha impressora parou");
});

test("registers the employee once the department arrives", () => {
  const state: OnboardingState = {
    step: "awaitingDepartment",
    name: "Samuel",
    pendingText: "minha impressora parou",
    attempts: 0,
  };
  const action = advanceOnboarding(state, { text: "Financeiro", pushName: null });

  assert.equal(action.kind, "register");
  assert.equal(action.kind === "register" && action.name, "Samuel");
  assert.equal(action.kind === "register" && action.department, "Financeiro");
  assert.equal(
    action.kind === "register" && action.pendingText,
    "minha impressora parou",
  );
});

test("asks again when the answer is not usable as a name", () => {
  const state: OnboardingState = { step: "awaitingName", attempts: 0 };
  const action = advanceOnboarding(state, { text: "a", pushName: null });

  assert.equal(action.kind, "ask");
  assert.equal(action.kind === "ask" && action.next.step, "awaitingName");
  assert.equal(action.kind === "ask" && action.next.attempts, 1);
});

// Someone who keeps describing their problem instead of answering must not be
// trapped in the form: an imperfect name beats an endless loop.
test("takes the answer after two rejections instead of asking forever", () => {
  const tooLong = "socorro preciso muito urgente de ajuda com a impressora do setor inteiro agora";
  const first = advanceOnboarding({ step: "awaitingName", attempts: 0 }, {
    text: tooLong,
    pushName: null,
  });
  assert.equal(first.kind === "ask" && first.next.attempts, 1);

  const second = advanceOnboarding(
    first.kind === "ask" ? first.next : { step: "awaitingName", attempts: 1 },
    { text: tooLong, pushName: null },
  );

  assert.equal(second.kind, "ask");
  assert.equal(second.kind === "ask" && second.next.step, "awaitingDepartment");
  assert.ok(
    (second.kind === "ask" && second.next.name?.length) ?? 0,
    "the name is accepted, truncated",
  );
  assert.ok((second.kind === "ask" && (second.next.name?.length ?? 0) <= 60) || false);
});

test("an empty answer is never accepted, even after retries", () => {
  const action = advanceOnboarding({ step: "awaitingName", attempts: 5 }, {
    text: "   ",
    pushName: null,
  });
  assert.equal(action.kind, "ask");
});
