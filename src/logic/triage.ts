import {
  actionSchemas,
  isActionName,
  type Action,
} from "../types/actions.js";
import type { AiCompletion, AiMessage } from "../services/ai/provider.js";
import type { ConversationState } from "./conversation.js";
import type { Employee } from "./onboarding.js";

export interface HistoryEntry {
  role: "user" | "model";
  text: string;
}

export interface TriageContext {
  employee: Employee;
  state: ConversationState;
  /** Oldest first. */
  history: readonly HistoryEntry[];
  /** Compacted older turns, when the conversation outgrew the window. */
  summary?: string;
  /** Knowledge base; empty until phase 6 wires it in. */
  faq?: string;
  /** External markdown context; empty until phase 6. */
  externalContext?: string;
}

export type TriageDecision =
  | { kind: "action"; action: Action }
  | { kind: "rejected"; reason: string };

/**
 * Assembles what the model sees. Kept pure so the prompt can be asserted in a
 * test without a network call.
 */
export function buildTriageInput(
  promptTemplate: string,
  context: TriageContext,
): { system: string; messages: AiMessage[] } {
  const sections = [
    promptTemplate,
    "",
    "## Colaborador",
    `Nome: ${context.employee.name}`,
    `Setor: ${context.employee.department}`,
    "",
    "## Estado da conversa",
    context.state,
  ];

  if (context.summary) {
    sections.push("", "## Resumo da conversa anterior", context.summary);
  }
  if (context.faq) {
    sections.push("", "## Base de conhecimento", context.faq);
  }
  if (context.externalContext) {
    sections.push("", "## Contexto adicional", context.externalContext);
  }

  const messages: AiMessage[] = context.history.map((entry) => ({
    role: entry.role,
    parts: [{ type: "text", text: entry.text }],
  }));

  return { system: sections.join("\n"), messages };
}

/**
 * Turns a raw completion into a decision, or refuses it.
 *
 * This is the gate the claude.md §8 demands: the prompts are public, so the
 * defence is not secrecy but the backend refusing to act on anything that does
 * not match the contract exactly.
 */
export function interpretCompletion(completion: AiCompletion): TriageDecision {
  const call = completion.toolCall;
  if (!call) {
    return { kind: "rejected", reason: "no-tool-call" };
  }

  if (!isActionName(call.name)) {
    return { kind: "rejected", reason: `unknown-tool:${call.name}` };
  }

  const parsed = actionSchemas[call.name].safeParse(call.input);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    return { kind: "rejected", reason: `invalid-input:${call.name}:${detail}` };
  }

  // The cast is safe: the name was narrowed and its own schema just parsed it.
  return { kind: "action", action: { name: call.name, input: parsed.data } as Action };
}
