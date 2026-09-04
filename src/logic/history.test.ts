import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSummaryInput,
  HISTORY_WINDOW,
  planHistory,
  type StoredMessage,
} from "./history.js";

function messages(count: number, from = 1): StoredMessage[] {
  return Array.from({ length: count }, (_, i) => ({
    id: String(from + i),
    direction: (i % 2 === 0 ? "inbound" : "outbound") as "inbound" | "outbound",
    content: `mensagem ${from + i}`,
  }));
}

test("keeps everything verbatim while under the window", () => {
  const plan = planHistory(messages(5), null);

  assert.equal(plan.recent.length, 5);
  assert.deepEqual(plan.toSummarize, []);
  assert.equal(plan.newCoveredThroughId, undefined);
});

test("keeps exactly the window without summarizing", () => {
  const plan = planHistory(messages(HISTORY_WINDOW), null);
  assert.equal(plan.recent.length, HISTORY_WINDOW);
  assert.deepEqual(plan.toSummarize, []);
});

test("sends the overflow to be summarized, keeping the window verbatim", () => {
  const plan = planHistory(messages(HISTORY_WINDOW + 3), null);

  assert.equal(plan.recent.length, HISTORY_WINDOW);
  assert.equal(plan.toSummarize.length, 3);
  assert.equal(plan.newCoveredThroughId, "3", "marker advances to the last compacted turn");
  assert.equal(plan.toSummarize[0]?.text, "mensagem 1", "oldest turns are the ones compacted");
  assert.equal(plan.recent[0]?.text, "mensagem 4");
});

test("skips what a previous summary already covers", () => {
  const plan = planHistory(messages(10), {
    text: "resumo antigo",
    coveredThroughId: "4",
  });

  assert.equal(plan.recent.length, 6, "only messages after the marker");
  assert.equal(plan.recent[0]?.text, "mensagem 5");
});

// A marker pointing at a deleted message (retention, manual cleanup) must not
// silently swallow the conversation.
test("falls back to the full history when the marker no longer exists", () => {
  const plan = planHistory(messages(5), {
    text: "resumo",
    coveredThroughId: "apagada",
  });
  assert.equal(plan.recent.length, 5);
});

test("maps direction to provider roles", () => {
  const plan = planHistory(
    [
      { id: "1", direction: "inbound", content: "pergunta" },
      { id: "2", direction: "outbound", content: "resposta" },
    ],
    null,
  );

  assert.equal(plan.recent[0]?.role, "user");
  assert.equal(plan.recent[1]?.role, "model");
});

test("drops messages with no text, like audio before transcription", () => {
  const plan = planHistory(
    [
      { id: "1", direction: "inbound", content: null },
      { id: "2", direction: "inbound", content: "   " },
      { id: "3", direction: "inbound", content: "oi" },
    ],
    null,
  );

  assert.equal(plan.recent.length, 1);
  assert.equal(plan.recent[0]?.text, "oi");
});

test("the summary input carries the previous summary forward", () => {
  const input = buildSummaryInput({ text: "antes", coveredThroughId: "1" }, [
    { role: "user", text: "e agora?" },
  ]);

  assert.match(input, /antes/);
  assert.match(input, /Colaborador: e agora\?/);
});

test("the first summary has no previous section", () => {
  const input = buildSummaryInput(null, [{ role: "model", text: "olá" }]);
  assert.doesNotMatch(input, /Resumo anterior/);
  assert.match(input, /Atendente: olá/);
});
