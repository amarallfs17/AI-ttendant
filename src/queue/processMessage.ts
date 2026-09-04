import {
  getConversation,
  getConversationPartialData,
  getEmployee,
  getRecentMessageDirections,
  insertEmployee,
  insertOutboundMessage,
  updateConversationPartialData,
  updateConversationState,
} from "../db/queries.js";
import { concatenateBlock } from "../logic/debounce.js";
import { countTrailingBotMessages, shouldSuppressReply } from "../logic/guards.js";
import type { InboundMessage } from "../logic/inboundMessage.js";
import { advanceOnboarding, type OnboardingState } from "../logic/onboarding.js";
import type { AppContext } from "../types/context.js";
import { runTriage } from "./handleTriage.js";
import { withRetry } from "./worker.js";

// Sent right after registration, before the first triage turn.
const ACKNOWLEDGEMENT = "Recebi sua mensagem, já estou processando.";

/** How long the typing indicator stays up before Evolution clears it. */
const TYPING_INDICATOR_MS = 2500;

/** Enough history to spot a pile-up of unanswered bot messages. */
const RECENT_MESSAGE_WINDOW = 5;

/**
 * Handles one debounced block of user messages, outside the webhook request.
 * Later phases replace the fixed reply with triage and the agents.
 */
export async function processBlock(
  ctx: AppContext,
  phone: string,
  messages: readonly InboundMessage[],
): Promise<void> {
  const meta = { phone, blockSize: messages.length };

  const recent = await getRecentMessageDirections(ctx.pool, phone, RECENT_MESSAGE_WINDOW);
  const decision = shouldSuppressReply({
    blockSize: messages.length,
    trailingBotMessages: countTrailingBotMessages(recent),
  });

  if (decision.suppress) {
    ctx.log.warn({ ...meta, reason: decision.reason }, "reply suppressed");
    return;
  }

  const blockText = concatenateBlock(messages);
  const employee = await getEmployee(ctx.pool, phone);

  if (!employee) {
    await runOnboarding(ctx, phone, messages, blockText, meta);
    return;
  }

  ctx.log.debug(
    { ...meta, employee: employee.name, department: employee.department, blockText },
    "processing block",
  );

  const conversation = await getConversation(ctx.pool, phone);
  if (!conversation) {
    ctx.log.error(meta, "conversation row missing for a known employee");
    return;
  }

  const outcome = await runTriage(ctx, phone, employee, conversation, meta);
  if (!outcome.reply) return;

  if (outcome.nextState && outcome.nextState !== conversation.state) {
    await updateConversationState(ctx.pool, phone, outcome.nextState);
  }

  await reply(ctx, phone, outcome.reply, meta);
}

/**
 * Registers someone we have never seen before, one question at a time. The
 * sub-state lives in `conversations.partial_data.onboarding`; the conversation
 * itself stays `idle`, since the states in claude.md §6 are closed.
 */
async function runOnboarding(
  ctx: AppContext,
  phone: string,
  messages: readonly InboundMessage[],
  blockText: string,
  meta: Record<string, unknown>,
): Promise<void> {
  const partialData = await getConversationPartialData(ctx.pool, phone);
  const current = (partialData.onboarding as OnboardingState | undefined) ?? null;
  const pushName = messages.find((message) => message.pushName)?.pushName ?? null;

  const action = advanceOnboarding(current, { text: blockText, pushName });

  if (action.kind === "ask") {
    await updateConversationPartialData(ctx.pool, phone, {
      ...partialData,
      onboarding: action.next,
    });
    ctx.log.info({ ...meta, step: action.next.step }, "onboarding question sent");
    await reply(ctx, phone, action.text, meta);
    return;
  }

  await insertEmployee(ctx.pool, {
    phone,
    name: action.name,
    department: action.department,
  });

  // The form is over: drop its state so a later message never re-enters it.
  const { onboarding: _done, ...rest } = partialData;
  void _done;
  await updateConversationPartialData(ctx.pool, phone, rest);

  ctx.log.info(
    { ...meta, name: action.name, department: action.department },
    "employee registered",
  );

  // Answer what they originally wrote, now that we know who they are.
  ctx.log.debug({ ...meta, blockText: action.pendingText }, "processing pending block");
  await reply(ctx, phone, ACKNOWLEDGEMENT, meta);
}

async function reply(
  ctx: AppContext,
  phone: string,
  text: string,
  meta: Record<string, unknown>,
): Promise<void> {
  // Not awaited on purpose: Evolution holds the response for the whole typing
  // delay, and a cosmetic indicator must not add seconds to every reply nor
  // fail the block.
  void ctx.evolution
    .setPresence(phone, "composing", TYPING_INDICATOR_MS)
    .catch((error: unknown) => {
      ctx.log.debug({ ...meta, err: error }, "could not send typing presence");
    });

  const sent = await withRetry(() => ctx.evolution.sendText(phone, text), {
    log: ctx.log,
    meta,
    operation: "sendText",
  });

  // Recorded only after a successful send, so retries cannot duplicate rows.
  await insertOutboundMessage(ctx.pool, {
    whatsappMessageId: sent.whatsappMessageId,
    phone,
    content: text,
  });

  ctx.log.info({ ...meta, sentMessageId: sent.whatsappMessageId }, "reply sent");
}
