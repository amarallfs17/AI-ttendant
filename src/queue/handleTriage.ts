import {
  countRecentTickets,
  getConversationMessages,
  updateConversationPartialData,
} from "../db/queries.js";
import { canActAutomatically, canCreateTicket } from "../logic/guards.js";
import {
  buildSummaryInput,
  planHistory,
  SUMMARY_PROMPT,
  type HistorySummary,
} from "../logic/history.js";
import type { Employee } from "../logic/onboarding.js";
import { buildTriageInput, interpretCompletion } from "../logic/triage.js";
import type { StoredConversation } from "../db/queries.js";
import { buildToolDeclarations } from "../types/actions.js";
import type { Action } from "../types/actions.js";
import type { AppContext } from "../types/context.js";
import { withRetry } from "./worker.js";

/** Enough to cover the verbatim window plus what still needs compacting. */
const MESSAGE_FETCH_LIMIT = 60;
const TICKET_WINDOW_HOURS = 1;

const NEUTRAL_FALLBACK =
  "Desculpe, não consegui entender. Pode explicar de outro jeito?";
const TECHNICAL_FALLBACK =
  "Estou com uma dificuldade técnica no momento. Já vou verificar e retorno em seguida.";

export interface TriageOutcome {
  reply: string | null;
  nextState?: "collecting";
}

/**
 * Runs one triage turn: assembles the context, asks the model, and refuses
 * anything that does not match the contract (claude.md §8).
 *
 * Returns the text to send; the caller owns sending and recording it, so there
 * is exactly one outbound path in the codebase.
 */
export async function runTriage(
  ctx: AppContext,
  phone: string,
  employee: Employee,
  conversation: StoredConversation,
  meta: Record<string, unknown>,
): Promise<TriageOutcome> {
  const permission = canActAutomatically({
    state: conversation.state,
    pausedUntil: conversation.pausedUntil,
    now: new Date(),
  });

  if (!permission.allowed) {
    ctx.log.info({ ...meta, reason: permission.reason }, "automatic action blocked");
    return { reply: null };
  }

  const stored = await getConversationMessages(ctx.pool, phone, MESSAGE_FETCH_LIMIT);
  const summary =
    (conversation.partialData.historySummary as HistorySummary | undefined) ?? null;
  const plan = planHistory(stored, summary);

  const activeSummary = plan.toSummarize.length
    ? await compactHistory(ctx, phone, conversation, summary, plan.toSummarize, plan.newCoveredThroughId, meta)
    : summary;

  const { system, messages } = buildTriageInput(ctx.triagePrompt, {
    employee,
    state: conversation.state,
    history: plan.recent,
    summary: activeSummary?.text,
  });

  let completion;
  try {
    completion = await withRetry(
      () => ctx.ai.complete({ system, messages, tools: buildToolDeclarations() }),
      { log: ctx.log, meta, operation: "triage" },
    );
  } catch (error) {
    ctx.log.error({ ...meta, err: error }, "triage failed");
    return { reply: TECHNICAL_FALLBACK };
  }

  const decision = interpretCompletion(completion);
  if (decision.kind === "rejected") {
    // The reason goes to the log, never to the user.
    ctx.log.warn({ ...meta, reason: decision.reason }, "model output rejected");
    return { reply: NEUTRAL_FALLBACK };
  }

  ctx.log.info({ ...meta, action: decision.action.name }, "triage decided");
  return executeAction(ctx, phone, decision.action, meta);
}

async function executeAction(
  ctx: AppContext,
  phone: string,
  action: Action,
  meta: Record<string, unknown>,
): Promise<TriageOutcome> {
  switch (action.name) {
    case "answerFaq":
      // Phase 6 puts the knowledge base into the prompt behind this answer.
      return { reply: action.input.answer };

    case "collectTicketData": {
      const tickets = await countRecentTickets(ctx.pool, phone, TICKET_WINDOW_HOURS);
      const permission = canCreateTicket(tickets);
      if (!permission.allowed) {
        ctx.log.warn({ ...meta, tickets }, "ticket rate limit reached");
        return {
          reply:
            "Você já abriu vários chamados na última hora. Vou pedir para alguém do suporte falar com você.",
        };
      }
      // Phase 7 turns this into real guided collection.
      return { reply: action.input.question, nextState: "collecting" };
    }

    case "checkTicketStatus":
      // Phase 10 queries Jira for real.
      return {
        reply:
          "Ainda não encontrei chamados abertos no seu nome. Se quiser abrir um, é só me contar o que aconteceu.",
      };

    case "escalateToHuman":
      // Phase 9 adds the pause and the maintainer notification.
      ctx.log.info({ ...meta, reason: action.input.reason }, "escalation requested");
      return {
        reply:
          "Certo, vou pedir para uma pessoa do suporte falar com você. Assim que possível alguém retorna por aqui.",
      };
  }
}

/** Folds older turns into the running summary so cost stops growing. */
async function compactHistory(
  ctx: AppContext,
  phone: string,
  conversation: StoredConversation,
  previous: HistorySummary | null,
  toSummarize: ReturnType<typeof planHistory>["toSummarize"],
  coveredThroughId: string | undefined,
  meta: Record<string, unknown>,
): Promise<HistorySummary | null> {
  if (!coveredThroughId) return previous;

  try {
    const completion = await withRetry(
      () =>
        ctx.ai.complete({
          system: SUMMARY_PROMPT,
          messages: [
            {
              role: "user",
              parts: [{ type: "text", text: buildSummaryInput(previous, toSummarize) }],
            },
          ],
        }),
      { log: ctx.log, meta, operation: "summarizeHistory" },
    );

    const text = completion.text?.trim();
    if (!text) {
      // Never swallow this: it means the provider answered the summary call
      // with something unusable, and the history would keep growing unnoticed.
      ctx.log.warn(meta, "summarization returned no text; keeping the previous summary");
      return previous;
    }

    const updated: HistorySummary = { text, coveredThroughId };
    await updateConversationPartialData(ctx.pool, phone, {
      ...conversation.partialData,
      historySummary: updated,
    });
    ctx.log.info({ ...meta, turns: toSummarize.length }, "history compacted");
    return updated;
  } catch (error) {
    // A failed summary must not cost the user their answer: fall back to the
    // previous one and carry on with the recent turns.
    ctx.log.error({ ...meta, err: error }, "history summarization failed");
    return previous;
  }
}
