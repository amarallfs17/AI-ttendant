import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { normalizePhone, parseWebhookEvent } from "./inboundMessage.js";

function event(overrides: {
  remoteJid?: string;
  fromMe?: boolean;
  id?: string;
  pushName?: string;
  message?: Record<string, unknown> | null;
  eventName?: string;
}): unknown {
  return {
    event: overrides.eventName ?? "messages.upsert",
    instance: "support",
    data: {
      key: {
        remoteJid: overrides.remoteJid ?? "5511999990001@s.whatsapp.net",
        fromMe: overrides.fromMe ?? false,
        id: overrides.id ?? "3EB0FAKE01",
      },
      pushName: overrides.pushName,
      message:
        overrides.message === undefined
          ? { conversation: "oi" }
          : overrides.message,
    },
  };
}

test("parses a plain text message", () => {
  const decision = parseWebhookEvent(
    event({ message: { conversation: "impressora travada" }, pushName: "Fulano" }),
  );
  assert.equal(decision.action, "process");
  assert.deepEqual(decision.action === "process" ? decision.message : null, {
    whatsappMessageId: "3EB0FAKE01",
    phone: "5511999990001",
    type: "text",
    content: "impressora travada",
    pushName: "Fulano",
  });
});

test("parses an extended text message (reply or link preview)", () => {
  const decision = parseWebhookEvent(
    event({ message: { extendedTextMessage: { text: "segue o print" } } }),
  );
  assert.equal(decision.action, "process");
  assert.equal(decision.action === "process" && decision.message.type, "text");
  assert.equal(
    decision.action === "process" && decision.message.content,
    "segue o print",
  );
});

test("parses an image message keeping the caption as content", () => {
  const decision = parseWebhookEvent(
    event({ message: { imageMessage: { caption: "erro na tela", mimetype: "image/jpeg" } } }),
  );
  assert.equal(decision.action, "process");
  assert.equal(decision.action === "process" && decision.message.type, "image");
  assert.equal(decision.action === "process" && decision.message.content, "erro na tela");
});

test("parses an image without caption as null content", () => {
  const decision = parseWebhookEvent(
    event({ message: { imageMessage: { mimetype: "image/jpeg" } } }),
  );
  assert.equal(decision.action === "process" && decision.message.content, null);
});

test("parses an audio message with null content until transcription", () => {
  const decision = parseWebhookEvent(
    event({ message: { audioMessage: { mimetype: "audio/ogg; codecs=opus", ptt: true } } }),
  );
  assert.equal(decision.action, "process");
  assert.equal(decision.action === "process" && decision.message.type, "audio");
  assert.equal(decision.action === "process" && decision.message.content, null);
});

test("keeps pushName null when absent", () => {
  const decision = parseWebhookEvent(event({}));
  assert.equal(decision.action === "process" && decision.message.pushName, null);
});

const ignoredCases: ReadonlyArray<[string, unknown, string]> = [
  ["group messages", event({ remoteJid: "1234567890-1600000000@g.us" }), "group"],
  ["status updates", event({ remoteJid: "status@broadcast" }), "status"],
  ["broadcast lists", event({ remoteJid: "1234567890@broadcast" }), "broadcast"],
  ["messages sent from the number itself", event({ fromMe: true }), "from-me"],
  ["lid JIDs that carry no phone number", event({ remoteJid: "182736451@lid" }), "unresolvable-phone"],
  ["unsupported message shapes", event({ message: { stickerMessage: {} } }), "unsupported-type"],
  ["messages with no content at all", event({ message: null }), "unsupported-type"],
  ["events other than messages.upsert", event({ eventName: "messages.update" }), "not-a-message"],
  ["payloads that do not match the envelope", { anything: "else" }, "unknown-payload"],
  ["non-object payloads", "not json", "unknown-payload"],
];

for (const [name, payload, reason] of ignoredCases) {
  test(`ignores ${name}`, () => {
    const decision = parseWebhookEvent(payload);
    assert.equal(decision.action, "ignore");
    assert.equal(decision.action === "ignore" && decision.reason, reason);
  });
}

test("normalizePhone strips the JID suffix", () => {
  assert.equal(normalizePhone("5511999990001@s.whatsapp.net"), "5511999990001");
});

test("normalizePhone rejects lid and group JIDs", () => {
  assert.equal(normalizePhone("182736451@lid"), null);
  assert.equal(normalizePhone("123-160@g.us"), null);
});

test("normalizePhone rejects malformed input", () => {
  assert.equal(normalizePhone(""), null);
  assert.equal(normalizePhone("@s.whatsapp.net"), null);
  assert.equal(normalizePhone("5511999990001"), null);
});

// Guards against the checked-in fixtures drifting away from the parser.
const fixtureExpectations: ReadonlyArray<[string, string]> = [
  ["messagesUpsert.text.json", "process"],
  ["messagesUpsert.image.json", "process"],
  ["messagesUpsert.audio.json", "process"],
  ["messagesUpsert.group.json", "group"],
  ["messagesUpsert.status.json", "status"],
  ["messagesUpsert.fromMe.json", "from-me"],
];

for (const [file, expected] of fixtureExpectations) {
  test(`fixture ${file} is handled as ${expected}`, async () => {
    const raw = await readFile(new URL(`../../fixtures/${file}`, import.meta.url), "utf8");
    const decision = parseWebhookEvent(JSON.parse(raw));

    if (expected === "process") {
      assert.equal(decision.action, "process");
    } else {
      assert.equal(decision.action, "ignore");
      assert.equal(decision.action === "ignore" && decision.reason, expected);
    }
  });
}
