import { z } from "zod";

import type { AiCompletion, AiMessage } from "../services/ai/provider.js";
import type { ToolDeclaration } from "../types/actions.js";
import type { Employee } from "./onboarding.js";
import type { HistoryEntry } from "./triage.js";

/**
 * The FAQ agent answers through a tool too, not free text.
 *
 * `answered: false` gives the model an honest way out when the material does
 * not cover the question — better than letting it improvise a refusal, or worse,
 * an answer. A support bot that invents a procedure is worse than one that
 * opens a ticket (claude.md §7).
 */
export const faqAnswerSchema = z.strictObject({
  answered: z
    .boolean()
    .describe("true apenas se a resposta estiver no material fornecido."),
  text: z
    .string()
    .describe("A resposta, quando answered=true. Vazio quando answered=false."),
});

export type FaqAnswer = z.infer<typeof faqAnswerSchema>;

export const FAQ_TOOL_NAME = "provideFaqAnswer";

export function buildFaqToolDeclaration(): ToolDeclaration {
  return {
    name: FAQ_TOOL_NAME,
    description:
      "Responder a dúvida do colaborador usando exclusivamente o material fornecido.",
    parameters: z.toJSONSchema(faqAnswerSchema) as Record<string, unknown>,
  };
}

export interface FaqContext {
  employee: Employee;
  question: string;
  /** Recent turns, so the answer can follow the thread. */
  history: readonly HistoryEntry[];
  faq: string;
  externalContext?: string;
}

export type FaqResult =
  | { kind: "answer"; text: string }
  | { kind: "not-covered" }
  | { kind: "rejected"; reason: string };

/**
 * Builds the FAQ agent's input. Deliberately narrow: this prompt only has to
 * answer from the material, so it stays focused where the triage prompt also
 * has to classify.
 */
export function buildFaqInput(
  promptTemplate: string,
  context: FaqContext,
): { system: string; messages: AiMessage[] } {
  const sections = [
    promptTemplate,
    "",
    "## Colaborador",
    `${context.employee.name} — ${context.employee.department}`,
    "",
    "## Base de conhecimento",
    context.faq.trim() || "(vazia)",
  ];

  if (context.externalContext?.trim()) {
    sections.push(
      "",
      "## Avisos e contexto do momento",
      "Estas informações são mais recentes que a base acima e têm prioridade.",
      context.externalContext.trim(),
    );
  }

  const messages: AiMessage[] = [
    ...context.history.map((entry) => ({
      role: entry.role,
      parts: [{ type: "text" as const, text: entry.text }],
    })),
    { role: "user", parts: [{ type: "text", text: context.question }] },
  ];

  return { system: sections.join("\n"), messages };
}

/** Same gate as triage: nothing off-contract is trusted (claude.md §8). */
export function interpretFaqCompletion(completion: AiCompletion): FaqResult {
  const call = completion.toolCall;
  if (!call) {
    return { kind: "rejected", reason: "no-tool-call" };
  }
  if (call.name !== FAQ_TOOL_NAME) {
    return { kind: "rejected", reason: `unknown-tool:${call.name}` };
  }

  const parsed = faqAnswerSchema.safeParse(call.input);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    return { kind: "rejected", reason: `invalid-input:${detail}` };
  }

  const { answered, text } = parsed.data;
  // An "answer" with nothing in it is not an answer; treat it as not covered
  // rather than sending an empty message.
  if (!answered || !text.trim()) {
    return { kind: "not-covered" };
  }

  return { kind: "answer", text: text.trim() };
}
