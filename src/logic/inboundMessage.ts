import { z } from "zod";

export type MessageType = "text" | "audio" | "image";

export interface InboundMessage {
  whatsappMessageId: string;
  phone: string;
  type: MessageType;
  content: string | null;
  pushName: string | null;
}

export type IgnoreReason =
  | "unknown-payload"
  | "not-a-message"
  | "group"
  | "broadcast"
  | "status"
  | "from-me"
  | "unsupported-type"
  | "unresolvable-phone";

export type IngestDecision =
  | { action: "process"; message: InboundMessage }
  | { action: "ignore"; reason: IgnoreReason };

const webhookEventSchema = z.object({
  event: z.string(),
  instance: z.string().optional(),
  data: z
    .object({
      key: z.object({
        remoteJid: z.string(),
        fromMe: z.boolean().optional(),
        id: z.string(),
      }),
      pushName: z.string().optional(),
      message: z.record(z.string(), z.unknown()).nullish(),
    })
    .optional(),
});

/**
 * Extracts the phone number from an Evolution/Baileys JID.
 *
 * `@lid` JIDs carry an internal linked-identity number, not a phone number:
 * accepting one would register a phantom employee, so it resolves to null and
 * the message is ignored with a visible reason instead.
 */
export function normalizePhone(remoteJid: string): string | null {
  const [user] = remoteJid.split("@");
  if (!user || !remoteJid.endsWith("@s.whatsapp.net")) {
    return null;
  }
  const digits = user.replace(/\D/g, "");
  return digits.length > 0 ? digits : null;
}

function classify(
  message: Record<string, unknown> | null | undefined,
): { type: MessageType; content: string | null } | null {
  if (!message) return null;

  if (typeof message.conversation === "string") {
    return { type: "text", content: message.conversation };
  }

  const extended = message.extendedTextMessage;
  if (extended && typeof extended === "object" && "text" in extended) {
    const { text } = extended as { text?: unknown };
    if (typeof text === "string") {
      return { type: "text", content: text };
    }
  }

  const image = message.imageMessage;
  if (image && typeof image === "object") {
    const { caption } = image as { caption?: unknown };
    return { type: "image", content: typeof caption === "string" ? caption : null };
  }

  // Content stays null until whisper transcription lands (phase 8).
  if (message.audioMessage && typeof message.audioMessage === "object") {
    return { type: "audio", content: null };
  }

  return null;
}

export function parseWebhookEvent(body: unknown): IngestDecision {
  const parsed = webhookEventSchema.safeParse(body);
  if (!parsed.success) {
    return { action: "ignore", reason: "unknown-payload" };
  }

  const { event, data } = parsed.data;
  if (event !== "messages.upsert" || !data) {
    return { action: "ignore", reason: "not-a-message" };
  }

  const { key, pushName, message } = data;
  const { remoteJid } = key;

  if (remoteJid.endsWith("@g.us")) {
    return { action: "ignore", reason: "group" };
  }
  if (remoteJid === "status@broadcast") {
    return { action: "ignore", reason: "status" };
  }
  if (remoteJid.endsWith("@broadcast")) {
    return { action: "ignore", reason: "broadcast" };
  }
  // Phase 9 replaces this branch with human handoff detection.
  if (key.fromMe === true) {
    return { action: "ignore", reason: "from-me" };
  }

  const phone = normalizePhone(remoteJid);
  if (!phone) {
    return { action: "ignore", reason: "unresolvable-phone" };
  }

  const classified = classify(message);
  if (!classified) {
    return { action: "ignore", reason: "unsupported-type" };
  }

  return {
    action: "process",
    message: {
      whatsappMessageId: key.id,
      phone,
      type: classified.type,
      content: classified.content,
      pushName: pushName ?? null,
    },
  };
}
